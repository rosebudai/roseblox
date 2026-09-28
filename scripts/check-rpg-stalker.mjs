import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url)), output=process.env.RPG_UI_EVIDENCE??'/tmp/roseblox-rpg-stalker-evidence';
await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4341','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser;
const checks=[], errors=[];
try{
 for(let i=0;i<40;i++){if(await fetch('http://127.0.0.1:4341/').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function open(query){
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4341/examples/rpg-template/?stalker=1&${query}`);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.player.grounded&&window.fixture.player.active);
  return page;
 }
 const state=page=>page.evaluate(()=>{const s=window.fixtureState;return {alert:s.alert,hidden:s.hidden,threat:s.threat,health:s.health};});
 const until=(page,fn,arg,timeout=8000)=>page.waitForFunction(fn,arg,{timeout});
 const pos=page=>page.evaluate(()=>window.fixture.player.position.toArray());
 const hunterDistance=page=>page.evaluate(()=>window.fixture.actors.get('hunter').position().distanceTo(window.fixture.player.position));

 // Seen at once, the player ducks into the closet before the threat fills.
 let page=await open('');
 await until(page,()=>window.fixtureState.alert==='suspicious'&&window.fixtureState.threat>0);checks.push('sight builds threat');
 assert.equal(await page.evaluate(()=>window.fixtureState.interaction?.action),'Hide in');
 await page.keyboard.press('KeyF');
 assert.equal((await state(page)).hidden,true);
 assert.equal(await page.evaluate(()=>window.fixture.player.visual.visible),false);
 const [x0,,z0]=await pos(page);await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');
 const [x1,,z1]=await pos(page);assert.ok(Math.hypot(x1-x0,z1-z0)<.05,'hidden players stay put');
 const [,y0]=await pos(page);await page.keyboard.down('Space');
 const top=await page.evaluate(async()=>{let top=-Infinity;for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);top=Math.max(top,window.fixture.player.position.y);}return top;});
 await page.keyboard.up('Space');assert.ok(top-y0<.1,`hidden players cannot jump (rose ${top-y0})`);
 await page.keyboard.press('Digit1');
 assert.equal(await page.evaluate(()=>window.fixtureState.abilities[0].remaining),0,'no attacks from hiding');
 await until(page,()=>window.fixtureState.alert===''&&window.fixtureState.threat===0);checks.push('hiding calms an unalerted stalker');
 assert.equal(await page.evaluate(()=>window.fixtureState.interaction?.action),'Leave');
 await page.keyboard.press('KeyF');
 assert.equal((await state(page)).hidden,false);checks.push('F hides and leaves');

 // Caught: the chase closes in and hits; hiding right under its nose does not help; it cannot be killed by default.
 await until(page,()=>window.fixtureState.alert==='hunted');checks.push('full threat starts a chase');
 await until(page,()=>window.fixtureState.health===75);checks.push('chaser catches the player');
 assert.ok(await hunterDistance(page)<2);
 await page.keyboard.press('KeyF');assert.equal((await state(page)).hidden,true);
 await until(page,()=>window.fixtureState.health===50);
 assert.equal((await state(page)).hidden,false);checks.push('a close chaser pulls the player out of hiding');
 await page.keyboard.press('Digit1');
 assert.equal(await page.evaluate(()=>window.fixture.actors.get('hunter').dead),false);
 assert.equal(await page.evaluate(()=>window.fixtureState.combatTargets.length),0);checks.push('unkillable by default');
 await page.screenshot({path:`${output}/caught.png`});
 await page.close();

 // Breaking line of sight mid-chase: it searches the last known spot, gives up and goes home.
 page=await open('');
 await until(page,()=>window.fixtureState.alert==='hunted');
 await page.keyboard.press('KeyF');
 assert.ok(await hunterDistance(page)>4);
 await until(page,()=>window.fixtureState.alert==='searching',null,2000);checks.push('lost sight starts a search');
 await page.waitForTimeout(1500);
 assert.ok(await hunterDistance(page)<8,'the search heads for the last known position');
 await page.screenshot({path:`${output}/searching.png`});
 await until(page,()=>window.fixtureState.alert==='',null,15000);
 assert.deepEqual(await state(page),{alert:'',hidden:true,threat:0,health:100});checks.push('search gives up');
 await page.close();

 // Sneaking halves speed and ends when the game pauses.
 page=await open('far=1');
 assert.match(await page.locator('details.controls').textContent(),/Sneak/);
 const walk=async sneak=>{if(sneak)await page.keyboard.down('KeyC');const [a,,b]=await pos(page);await page.keyboard.down('KeyW');await page.waitForTimeout(600);await page.keyboard.up('KeyW');const [c,,d]=await pos(page);if(sneak)await page.keyboard.up('KeyC');return Math.hypot(c-a,d-b);};
 const normal=await walk(false), quiet=await walk(true);
 assert.ok(quiet<normal*.65&&quiet>normal*.3,`sneak ${quiet} vs walk ${normal}`);checks.push('sneak slows movement');
 await page.keyboard.down('KeyC');assert.equal(await page.evaluate(()=>window.fixtureState.sneaking),true);
 await page.keyboard.press('Escape');await until(page,()=>window.fixtureState.phase==='paused');
 assert.equal(await page.evaluate(()=>window.fixtureState.sneaking),false);checks.push('pause ends sneaking');
 await page.keyboard.up('KeyC');
 await page.close();

 // A provoking hit and a respawn change the alert state too, so both reach onAlert.
 page=await open('far=1');
 await page.evaluate(()=>{const h=window.fixture.actors.get('hunter').position();window.alerts=[];window.fixture.player.teleport([h.x,h.y+.1,h.z+1.2]);window.fixture.attack(0);});
 assert.equal(await page.evaluate(()=>window.alerts[0]),'hunter:hunted');checks.push('provoked chase alerts');
 await page.evaluate(()=>window.fixture.damage(100));await until(page,()=>window.fixtureState.phase==='dead');
 await page.getByRole('button',{name:'Respawn',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.alerts.at(-1)),'hunter:patrol');checks.push('respawn calms with an alert');
 await page.close();

 assert.deepEqual(errors,[]);
 const result={passed:true,checks,errors};
 await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();}
