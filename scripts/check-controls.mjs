import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url)), output=process.env.CONTROLS_EVIDENCE??'/tmp/roseblox-controls-evidence';
await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4340','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser;
const checks=[], errors=[];
try{
 for(let i=0;i<40;i++){if(await fetch('http://127.0.0.1:4340/').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function open(query,touch){
  const context=await browser.newContext(touch?.laptop?{viewport:{width:1280,height:800},hasTouch:true}:touch?{viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1280,height:800}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4340/examples/controls/?${query}`);
  await page.waitForFunction(()=>window.fixture);
  return {page,context,cdp:touch&&!touch.laptop?await context.newCDPSession(page):null};
 }
 const pos=page=>page.evaluate(()=>window.fixture.player.position.toArray());
 const yaw=page=>page.evaluate(()=>{const d=window.fixture.camera.getWorldDirection(new window.fixture.camera.position.constructor());return Math.atan2(d.x,d.z);});
 const steps=page=>page.evaluate(()=>window.fixture.world.getDiagnostics().fixedSteps);
 const wait=async(page,n)=>{const at=await steps(page);await page.waitForFunction(at=>window.fixture.world.getDiagnostics().fixedSteps>=at,at+n);};
 const touch=(cdp,type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id}))});
 const overlay=page=>page.evaluate(()=>{const el=document.querySelector('[data-roseblox-touch=""]');return el?getComputedStyle(el).display:null;});

 // Desktop: no overlay, WASD walks relative to the camera and the wall stops the player.
 let {page,context}=await open('',false);
 assert.equal(await page.evaluate(()=>window.fixture.player.touch),false);
 assert.equal(await overlay(page),null);checks.push('desktop has no touch overlay');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.player.active&&window.fixture.player.grounded);
 await page.keyboard.down('KeyW');await wait(page,150);await page.keyboard.up('KeyW');
 const [,,zWall]=await pos(page);
 assert.ok(zWall<-4.5&&zWall>-5.7,`the wall stops the player (z ${zWall})`);checks.push('desktop WASD and wall collision');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!window.fixture.player.active);
 await page.locator('#menu').waitFor({state:'visible',timeout:2000});checks.push('Escape pauses');
 await context.close();

 // Touch laptop: the overlay shows like any touchscreen, and the keyboard still drives the player.
 ({page,context}=await open('',{laptop:true}));
 assert.equal(await page.evaluate(()=>window.fixture.player.touch),true);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.player.active&&window.fixture.player.grounded);await wait(page,2);
 assert.equal(await overlay(page),'block');
 const k0=await pos(page);await page.keyboard.down('KeyW');await wait(page,30);await page.keyboard.up('KeyW');
 assert.ok(Math.hypot(...(await pos(page)).map((v,i)=>v-k0[i]))>.5);checks.push('touch laptop shows overlay and keeps keyboard');
 await context.close();

 // Mouse with a forced overlay (a mobile game previewed on desktop) and pointer lock refused: the mouse
 // still drives free look and never the stick, and the on-screen buttons still click.
 ({page,context}=await open('touch=1',false));
 await page.evaluate(()=>{HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.reject(new DOMException('refused','NotAllowedError'));});
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.player.active&&window.fixture.player.grounded);await wait(page,2);
 assert.equal(await overlay(page),'block');
 const m0=await pos(page),mYaw=await yaw(page);
 await page.mouse.move(300,400);await page.mouse.down();for(const x of [340,380,420,460])await page.mouse.move(x,380);await wait(page,20);await page.mouse.up();
 assert.ok(Math.hypot(...(await pos(page)).map((v,i)=>v-m0[i]))<.05,'a left-half mouse drag does not walk');
 for(const x of [800,760,720,680])await page.mouse.move(x,400);await wait(page,2);
 assert.ok(Math.abs(await yaw(page)-mYaw)>.05,'free mouse look turns the camera over the overlay');
 assert.ok(await page.evaluate(()=>window.fixture.player.active),'moving onto the overlay does not pause');
 await page.locator('[data-roseblox-touch="button"]',{hasText:'Use'}).click();
 assert.deepEqual(await page.evaluate(()=>window.fixture.presses),['use']);checks.push('mouse passes through a forced overlay');
 await context.close();

 // Touch: overlay only while playing, no pointer lock, analog stick, look drag, both at once, buttons.
 let cdp;({page,context,cdp}=await open('',true));
 assert.equal(await page.evaluate(()=>window.fixture.player.touch),true);checks.push('touch detected automatically');
 assert.equal(await overlay(page),'none');
 await page.getByRole('button',{name:'Play',exact:true}).tap();
 await page.waitForFunction(()=>window.fixture.player.active&&window.fixture.player.grounded);
 await wait(page,2);
 assert.equal(await overlay(page),'block');
 assert.equal(await page.evaluate(()=>document.pointerLockElement),null);checks.push('overlay appears on play without pointer lock');
 const walk=async dy=>{const a=await pos(page);await touch(cdp,'touchStart',[[150,250,1]]);await touch(cdp,'touchMove',[[150,250+dy,1]]);await wait(page,40);await touch(cdp,'touchEnd',[]);const b=await pos(page);await wait(page,10);return Math.hypot(b[0]-a[0],b[2]-a[2]);};
 const half=await walk(-26), full=await walk(-60);
 assert.ok(half>.5&&full>half*1.5,`half stick ${half} vs full ${full}`);checks.push('analog joystick');
 const y0=await yaw(page);
 await page.evaluate(()=>{const hud=document.createElement('div');hud.id='hud';Object.assign(hud.style,{position:'fixed',inset:'0',zIndex:'10'});document.body.append(hud);});
 await touch(cdp,'touchStart',[[600,200,2]]);for(const x of [640,680,720])await touch(cdp,'touchMove',[[x,200,2]]);await touch(cdp,'touchEnd',[]);
 await wait(page,2);
 assert.ok(Math.abs(await yaw(page)-y0)>.2,'right-side drag turns the camera');checks.push('touch look through a HUD layer');
 const a=await pos(page), y1=await yaw(page);
 await touch(cdp,'touchStart',[[150,250,3]]);await touch(cdp,'touchStart',[[150,250,3],[600,200,4]]);
 await touch(cdp,'touchMove',[[150,200,3],[600,200,4]]);
 for(const x of [620,640,660])await touch(cdp,'touchMove',[[150,200,3],[x,200,4]]);
 await wait(page,30);await touch(cdp,'touchEnd',[]);
 const b=await pos(page);
 assert.ok(Math.hypot(b[0]-a[0],b[2]-a[2])>.5&&Math.abs(await yaw(page)-y1)>.1);checks.push('move and look at once');
 await wait(page,20);
 const floor=(await pos(page))[1];
 const jump=page.locator('[data-roseblox-touch="button"]',{hasText:'Jump'});
 await jump.tap();
 await page.waitForFunction(f=>window.fixture.player.position.y>f+.5,floor);checks.push('Jump button');
 await page.locator('[data-roseblox-touch="button"]',{hasText:'Use'}).tap();
 assert.deepEqual(await page.evaluate(()=>window.fixture.presses),['use']);checks.push('host touch button');
 await page.screenshot({path:`${output}/touch-third.png`});
 await touch(cdp,'touchStart',[[150,250,5]]);await touch(cdp,'touchMove',[[150,190,5]]);
 await page.evaluate(()=>window.fixture.player.pause());
 await page.waitForTimeout(100);
 assert.equal(await overlay(page),'none');
 // A paused world does not step; resume and confirm the released stick no longer walks.
 await page.evaluate(()=>window.fixture.player.resume());await wait(page,2);
 const held=await pos(page);await wait(page,30);const after=await pos(page);
 assert.ok(Math.hypot(after[0]-held[0],after[2]-held[2])<.05,'pause releases a held stick');
 await touch(cdp,'touchEnd',[]);checks.push('pause hides the overlay and releases input');
 await context.close();

 // First person on touch: the look drag aims the view.
 ({page,context,cdp}=await open('view=first',true));
 await page.getByRole('button',{name:'Play',exact:true}).tap();
 await page.waitForFunction(()=>window.fixture.player.active);await wait(page,2);
 const f0=await yaw(page);
 await touch(cdp,'touchStart',[[600,200,1]]);for(const x of [560,520,480])await touch(cdp,'touchMove',[[x,200,1]]);await touch(cdp,'touchEnd',[]);
 await wait(page,2);
 assert.ok(Math.abs(await yaw(page)-f0)>.2);checks.push('first-person touch look');
 await page.screenshot({path:`${output}/touch-first.png`});
 await context.close();

 assert.deepEqual(errors,[]);
 const result={passed:true,checks,errors};
 await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();}
