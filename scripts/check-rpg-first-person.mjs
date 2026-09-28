import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url)), output=process.env.RPG_UI_EVIDENCE??'/tmp/roseblox-rpg-first-person-evidence';
await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4337','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser;
const checks=[], errors=[];
try{
 for(let i=0;i<40;i++){if(await fetch('http://127.0.0.1:4337/').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function open(query,init){
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
  if(init)await page.addInitScript(init);
  await page.goto(`http://127.0.0.1:4337/examples/rpg-template/?view=first${query}`);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.player.grounded&&window.fixture.player.active);
  return page;
 }
 const pos=page=>page.evaluate(()=>window.fixture.player.position.toArray());
 const holdKey=async(page,key,ms)=>{await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);};
 const lookDir=page=>page.evaluate(()=>{const v=window.fixture.camera.getWorldDirection(new window.fixture.camera.position.constructor());v.y=0;v.normalize();return [v.x,v.z];});

 // Walking and looking in the plain garden.
 let page=await open('');
 assert.equal(await page.evaluate(()=>window.fixture.player.visual.visible),false);checks.push('body hidden');
 const eye=await page.evaluate(()=>window.fixture.camera.position.y-window.fixture.player.position.y);
 assert.ok(Math.abs(eye-1.8*.92)<.08,`eye height ${eye}`);checks.push('eye height');
 assert.equal(await page.evaluate(()=>window.fixtureState.bindings[0].label),'WASD');
 assert.match(await page.locator('details.controls').textContent(),/Mouse.*Look/);checks.push('first-person legend');
 let [x0,,z0]=await pos(page);await holdKey(page,'KeyW',600);let [x1,,z1]=await pos(page);
 assert.ok(z0-z1>1&&Math.abs(x1-x0)<.2,`forward walk ${x1-x0},${z1-z0}`);checks.push('W walks toward view');
 const before=await lookDir(page);
 await page.mouse.move(640,400);await page.mouse.move(900,400,{steps:10});await page.waitForTimeout(50);
 const after=await lookDir(page);
 assert.ok(Math.acos(Math.min(1,before[0]*after[0]+before[1]*after[1]))>.3,'mouse look turns view');checks.push('fallback mouse look');
 [x0,,z0]=await pos(page);await holdKey(page,'KeyW',600);[x1,,z1]=await pos(page);
 const len=Math.hypot(x1-x0,z1-z0);
 assert.ok(len>1&&((x1-x0)*after[0]+(z1-z0)*after[1])/len>.9,'walk follows the new view');checks.push('movement follows look');
 await page.screenshot({path:`${output}/first-person-garden.png`});
 await page.close();

 // Melee uses view facing; walls still block. LMB is the first ability.
 page=await open('&melee=1');
 const health=()=>page.evaluate(()=>Object.fromEntries(['enemy','side','blocked','behind','far'].map(id=>[id,window.fixture.actors.get(id).health])));
 await page.keyboard.press('Digit1');
 assert.deepEqual(await health(),{enemy:30,side:30,blocked:40,behind:40,far:40});checks.push('key swing hits in front of view');
 await page.waitForFunction(()=>window.fixtureState.abilities[0].remaining===0);
 await page.mouse.move(640,420);await page.mouse.down();await page.mouse.up();
 assert.equal(await page.evaluate(()=>window.swingEffects),2);
 assert.deepEqual(await health(),{enemy:20,side:20,blocked:40,behind:40,far:40});checks.push('LMB swing');

 // Dialogue suspends first-person capture; a canvas click cannot resume under it.
 await page.keyboard.press('KeyF');await page.waitForFunction(()=>window.fixtureState.phase==='dialogue');
 assert.equal(await page.evaluate(()=>window.fixture.player.active),false);
 await page.evaluate(()=>window.fixture.renderer.domElement.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.fixture.player.active),false);checks.push('dialogue blocks canvas resume');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.waitForFunction(()=>window.fixtureState.phase==='playing'&&window.fixture.player.active);checks.push('dialogue close resumes');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.fixtureState.phase==='paused');
 assert.equal(await page.evaluate(()=>window.fixture.player.active),false);
 await page.getByRole('button',{name:'Resume',exact:true}).click();
 await page.waitForFunction(()=>window.fixtureState.phase==='playing'&&window.fixture.player.active);checks.push('pause and resume');
 await page.screenshot({path:`${output}/first-person-melee.png`});
 await page.close();

 // Browsers grant capture asynchronously; a slow grant must not pause the round it is starting.
 page=await open('',()=>{
  let owner=null;const changed=()=>document.dispatchEvent(new Event('pointerlockchange'));
  Object.defineProperty(Document.prototype,'pointerLockElement',{configurable:true,get:()=>owner});
  Element.prototype.requestPointerLock=function(){return new Promise(resolve=>setTimeout(()=>{owner=this;changed();resolve();},400));};
  Document.prototype.exitPointerLock=function(){if(owner){owner=null;changed();}};
 });
 assert.equal(await page.evaluate(()=>document.pointerLockElement===window.fixture.renderer.domElement),true);
 assert.equal(await page.evaluate(()=>window.fixtureState.phase),'playing');checks.push('delayed capture grant');
 await page.evaluate(()=>document.exitPointerLock());
 await page.waitForFunction(()=>window.fixtureState.phase==='paused');checks.push('losing capture pauses');
 await page.close();
 assert.deepEqual(errors,[]);
 const result={passed:true,checks,errors};
 await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();}
