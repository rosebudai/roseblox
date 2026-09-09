import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.argv[2]??'http://127.0.0.1:8913';
const output=process.argv[3]??'/tmp/roseblox-presentation';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/local/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const checks=[],errors=[];
try {
 for(const fallback of [false,true]) {
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(response.url()+': '+response.status());});
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`${base}/tests/fixtures/presentation.html${fallback?'?fallback':''}`);
  await page.waitForFunction(()=>window.probe?.game.getDiagnostics().frames>1,null,{timeout:60000});
  const setup=await page.evaluate(()=>{const {game}=window.probe;return {lights:game.defaultLights,env:!!game.scene.environment,bg:game.scene.environment===game.scene.background,tone:game.renderer.toneMapping,draws:game.renderer.info.render.calls};});
  assert.equal(setup.lights.directionalLight,null);assert.equal(setup.env,true);assert.equal(setup.bg,true);assert.ok(setup.draws>0);
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.waitForFunction(()=>window.probe.fps.active);
  const locked=await page.evaluate(()=>window.probe.fps.locked); assert.equal(locked,!fallback);
  const before=await page.evaluate(()=>({pose:window.probe.player.transform.position.toArray(),aim:window.probe.game.camera.quaternion.toArray()}));
  await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
  await page.mouse.move(470,330);await page.mouse.move(540,325,{steps:6});
  const moved=await page.evaluate(()=>({pose:window.probe.player.transform.position.toArray(),aim:window.probe.game.camera.quaternion.toArray()}));
  assert.ok(moved.pose[2]<before.pose[2]-.2);assert.notDeepEqual(moved.aim,before.aim);
  await page.mouse.click(540,325);assert.equal(await page.evaluate(()=>window.probe.shots),1);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.probe.fps.active),false);
  await page.mouse.click(500,350);await page.waitForFunction(()=>window.probe.fps.active);
  assert.equal(await page.evaluate(()=>window.probe.shots),1);
  await page.setViewportSize({width:700,height:700});await page.waitForTimeout(250);
  const rects=await page.evaluate(()=>{const s=window.probe.hud.elements.stats;return Object.fromEntries(Object.entries(s).map(([name,node])=>{const r=node.getBoundingClientRect();return[name,{x:r.x,y:r.y,right:r.right,bottom:r.bottom}]}));});
  assert.ok(rects.health.x<350&&rects.ammo.x>350&&rects.health.bottom<700&&rects.ammo.right<700);
  await page.screenshot({path:`${output}/${fallback?'fallback':'native'}-play.png`});
  const teardown=await page.evaluate(()=>{const {game,hud,fps}=window.probe;fps.stop();hud.setState('won','Complete');hud.setMessage('Sound off');const state=hud.elements.root.dataset.state;game.setRenderPipeline(null);game.engine.update(1/60);game.clearEnvironment();game.dispose();return {state,disposed:game.engine.disposed,huds:document.querySelectorAll('.rb-hud').length};});
  assert.deepEqual(teardown,{state:'won',disposed:true,huds:0});
  checks.push({mode:fallback?'denied-native fallback':'native-request',status:'pass',setup,rects});await page.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/result.json`,JSON.stringify({status:'pass',checks,errors},null,2));
} catch(error) {await writeFile(`${output}/result.json`,JSON.stringify({status:'fail',checks,errors,error:error.stack},null,2));throw error;}
finally{await browser.close();}
