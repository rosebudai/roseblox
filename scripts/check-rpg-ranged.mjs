import assert from 'node:assert/strict';
import {serveRepository} from './rpg-check-server.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url)), output=process.env.RPG_UI_EVIDENCE??'/tmp/roseblox-rpg-ranged-evidence';
await mkdir(output,{recursive:true});
const server=await serveRepository(root,4343);
let browser;
const checks=[], errors=[];
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function open(query){
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4343/examples/rpg-template/?${query}`);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.player.grounded&&window.fixture.player.active);
  return page;
 }
 const health=(page,ids)=>page.evaluate(ids=>Object.fromEntries(ids.map(id=>[id,window.fixture.actors.get(id).health])),ids);
 const rifle=page=>page.evaluate(()=>{const a=window.fixtureState.abilities[0];return {ammo:a.ammo,reserve:a.reserve,reloading:a.reloading};});
 const ready=page=>page.waitForFunction(()=>window.fixtureState.abilities[0].remaining===0);
 const fire=async page=>{await ready(page);await page.keyboard.press('Digit1');};

 // Third person with a ranged kit: mouse-look controls, soft lock, ammo, reload, provoking a passive enemy.
 let page=await open('ranged=1');
 assert.equal(await page.evaluate(()=>window.fixtureState.crosshair),true);
 const legend=await page.locator('details.controls').textContent();
 assert.match(legend,/Camera and facing/);assert.match(legend,/Reload/);checks.push('pointer scheme with reload legend');
 const home=await page.evaluate(()=>window.fixture.actors.get('enemy').position().z);
 await fire(page);
 assert.deepEqual(await health(page,['enemy','side']),{enemy:30,side:40});checks.push('soft lock hits the enemy nearest the crosshair');
 assert.equal(await page.evaluate(()=>window.shotEffects),1);
 await page.waitForFunction(home=>window.fixture.actors.get('enemy').position().z>home+.5,home,{timeout:5000});checks.push('shot provokes');
 await fire(page);await fire(page);
 assert.equal((await health(page,['enemy'])).enemy,10);
 assert.deepEqual(await rifle(page),{ammo:0,reserve:3,reloading:true});checks.push('empty clip reloads');
 await page.waitForFunction(()=>!window.fixtureState.abilities[0].reloading);
 assert.deepEqual(await rifle(page),{ammo:3,reserve:0,reloading:false});checks.push('reload fills from reserve');
 await page.mouse.move(640,420);await page.mouse.down();await page.mouse.up();
 assert.equal((await health(page,['enemy'])).enemy,0);
 assert.equal(await page.evaluate(()=>window.fixture.actors.get('enemy').dead),true);checks.push('LMB fires');
 await fire(page);await fire(page);await ready(page);
 assert.deepEqual(await rifle(page),{ammo:0,reserve:0,reloading:false});
 await page.keyboard.press('Digit1');
 assert.match(await page.evaluate(()=>window.fixtureState.notice),/out of ammo/);checks.push('out of ammo');
 await page.screenshot({path:`${output}/third-person-ranged.png`});
 // Pointer-mode suspension: a dialogue outranks canvas clicks.
 await page.keyboard.press('KeyF');await page.waitForFunction(()=>window.fixtureState.phase==='dialogue');
 await page.evaluate(()=>window.fixture.renderer.domElement.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.fixture.player.active),false);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.waitForFunction(()=>window.fixtureState.phase==='playing'&&window.fixture.player.active);checks.push('third-person dialogue blocks canvas resume');
 await page.close();

 // Walls stop shots, locked or not.
 page=await open('ranged=1&wall=1');
 await fire(page);
 assert.deepEqual(await health(page,['enemy','side']),{enemy:40,side:40});checks.push('wall blocks shots');
 await page.close();

 // First person aims through the view centre; R reloads a partial clip.
 page=await open('ranged=1&view=first');
 await fire(page);
 assert.deepEqual(await health(page,['enemy','side']),{enemy:30,side:40});checks.push('first-person centre shot');
 await page.keyboard.press('KeyR');
 assert.equal((await rifle(page)).reloading,true);
 await page.waitForFunction(()=>!window.fixtureState.abilities[0].reloading);
 assert.deepEqual(await rifle(page),{ammo:3,reserve:2,reloading:false});checks.push('R reloads');
 await page.screenshot({path:`${output}/first-person-ranged.png`});
 await page.close();

 // A ranged enemy fires visible, dodgeable shots; pausing freezes them.
 page=await open('gunner=1');
 await page.waitForFunction(()=>window.fixture.health<100,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.fixture.health),94);checks.push('ranged enemy hits a still player');
 await page.waitForFunction(()=>window.fixture.scene.children.some(n=>n.geometry?.type==='SphereGeometry'),null,{timeout:3000});
 await page.keyboard.down('KeyD');await page.waitForTimeout(2500);
 assert.equal(await page.evaluate(()=>window.fixture.health),94);checks.push('strafing dodges');
 await page.keyboard.up('KeyD');
 await page.waitForFunction(()=>window.fixture.scene.children.some(n=>n.geometry?.type==='SphereGeometry'),null,{timeout:3000});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.fixtureState.phase==='paused');
 const frozen=await page.evaluate(()=>window.fixture.scene.children.find(n=>n.geometry?.type==='SphereGeometry')?.position.toArray());
 await page.waitForTimeout(400);
 assert.deepEqual(await page.evaluate(()=>window.fixture.scene.children.find(n=>n.geometry?.type==='SphereGeometry')?.position.toArray()),frozen);checks.push('pause freezes shots');
 await page.screenshot({path:`${output}/gunner.png`});
 await page.close();

 assert.deepEqual(errors,[]);
 const result={passed:true,checks,errors};
 await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();}
