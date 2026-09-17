import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url)), output=process.env.RPG_UI_EVIDENCE??'/tmp/roseblox-rpg-combat-evidence';
await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4336','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser;
try{
 for(let i=0;i<40;i++){if(await fetch('http://127.0.0.1:4336/').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4336/examples/rpg-template/?melee=1');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.fixture.player.grounded);
 // Real browser pointer events exercise capture and button chording, beyond synthetic unit events.
 await page.evaluate(()=>{window.startView=window.fixture.camera.quaternion.clone();window.startFacing=window.fixture.player.body.quaternion;});
 await page.mouse.move(900,550);await page.mouse.down({button:'left'});await page.mouse.move(1060,590,{steps:8});await page.mouse.up({button:'left'});
 await page.waitForTimeout(100);
 assert.ok(await page.evaluate(()=>window.startView.angleTo(window.fixture.camera.quaternion))>.3);
 assert.ok(await page.evaluate(()=>window.startFacing.angleTo(window.fixture.player.body.quaternion))<1e-5);
 assert.equal(await page.evaluate(()=>window.fixture.selected),null);
 // Looking sideways must not redirect a forward swing.
 const health=()=>page.evaluate(()=>Object.fromEntries(['enemy','side','blocked','behind','far'].map(id=>[id,window.fixture.actors.get(id).health])));
 const ready=()=>page.waitForFunction(()=>window.fixtureState.abilities[0].remaining===0);
 await page.keyboard.press('Digit1');
 assert.deepEqual(await health(),{enemy:30,side:30,blocked:40,behind:40,far:40});
 assert.equal(await page.evaluate(()=>window.fixture.selected),null);
 assert.deepEqual(await page.evaluate(()=>window.fixtureState.combatTargets.map(t=>t.id).sort()),['enemy','side']);
 assert.equal(await page.getByRole('meter',{name:'Target health'}).isVisible(),true);
 assert.equal(await page.getByRole('meter',{name:'Target health'}).evaluate(el=>el.value),.75);
 await page.keyboard.press('Digit1');assert.equal(await page.evaluate(()=>window.swingEffects),1);
 await page.evaluate(()=>window.fixture.showDialogue({text:'Input suspension'}));await page.keyboard.press('Digit1');
 assert.equal(await page.evaluate(()=>window.swingEffects),1);
 await page.getByRole('button',{name:'Close',exact:true}).click();await ready();
 await page.evaluate(()=>{window.fixture.select('guide');window.fixture.player.teleport([15,.1,15]);});
 await page.keyboard.press('Digit1');assert.equal(await page.evaluate(()=>window.swingEffects),2);
 assert.ok(await page.evaluate(()=>window.fixtureState.abilities[0].remaining)>0);assert.deepEqual(await health(),{enemy:30,side:30,blocked:40,behind:40,far:40});
 await ready();await page.evaluate(()=>window.fixture.player.teleport([0,.1,0]));await page.waitForFunction(()=>window.fixture.player.grounded);
 await page.keyboard.press('Digit1');assert.equal(await page.evaluate(()=>window.fixture.selected),'guide');
 assert.deepEqual(await health(),{enemy:20,side:20,blocked:40,behind:40,far:40});
 for(let i=0;i<2;i++){await ready();await page.keyboard.press('Digit1');}
 assert.equal(await page.evaluate(()=>window.fixture.actors.get('enemy').dead),true);
 assert.deepEqual(await page.evaluate(()=>window.fixtureState.combatTargets),[]);
 // Right press aligns the character to the view; its camera azimuth is preserved.
 await page.evaluate(()=>window.orbitView=window.fixture.camera.quaternion.clone());
 await page.mouse.move(900,550);await page.mouse.down({button:'right'});await page.waitForTimeout(150);
 assert.ok(await page.evaluate(()=>window.orbitView.angleTo(window.fixture.camera.quaternion))<1e-5);
 assert.ok(await page.evaluate(()=>window.startFacing.angleTo(window.fixture.player.body.quaternion))>.3);
 await page.mouse.down({button:'left'});await page.waitForTimeout(150);await page.mouse.up({button:'right'});await page.mouse.up({button:'left'});
 await page.evaluate(()=>window.stopped=window.fixture.player.position);await page.waitForTimeout(200);
 assert.ok(await page.evaluate(()=>window.stopped.distanceTo(window.fixture.player.position))<.02);
 assert.equal(await page.evaluate(()=>document.pointerLockElement===null),true);
 await page.screenshot({path:output+'/melee-camera.png'});assert.deepEqual(errors,[]);
 const result={passed:true,checks:['real LMB orbit','independent character heading','no selection required','damage reveals health','forward multiple hits','wall/rear/range filtering','cooldown','miss effects','NPC selection independent','dialogue input suspension','dead enemy cleanup','RMB alignment without view reset','mouse chord cleanup','no pointer lock'],errors};
 await page.close();
 const slow=await browser.newPage({viewport:{width:800,height:600}});
 await slow.addInitScript(()=>{
   window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),100);
   window.cancelAnimationFrame=clearTimeout;
 });
 await slow.goto('http://127.0.0.1:4336/examples/rpg-template/');
 await slow.getByRole('button',{name:'Play',exact:true}).click();await slow.waitForFunction(()=>window.fixture.player.grounded);
 const jump=await slow.evaluate(async()=>{
   const player=window.fixture.player, floor=player.position.y, start=performance.now();let top=floor,airborne=false;
   player.jump();
   for(let i=0;i<30;i++){
     await new Promise(requestAnimationFrame);top=Math.max(top,player.position.y);
     if(!player.grounded)airborne=true;
     if(airborne&&player.grounded)return {rise:top-floor,wallSeconds:(performance.now()-start)/1000};
   }
   throw new Error('Jump did not land');
 });
 assert.ok(jump.rise>.9&&jump.rise<1.1,JSON.stringify(jump));
 assert.ok(jump.wallSeconds>.55&&jump.wallSeconds<1.1,JSON.stringify(jump));
 result.slowFrameJump=jump;await slow.close();
 await writeFile(output+'/checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();}
