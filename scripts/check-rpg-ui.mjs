import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.RPG_UI_EVIDENCE ?? '/tmp/roseblox-rpg-ui-evidence';
await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4335','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser;
try {
  for(let i=0;i<40;i++){
    if(await fetch('http://127.0.0.1:4335/').then(r=>r.ok).catch(()=>false))break;
    await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const ui of ['journal','ribbon']){
    const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:4335/examples/rpg-template/?ui=${ui}`);
    const phase=expected=>page.waitForFunction(p=>window.fixtureState?.phase===p,expected,{timeout:45000});
    const click=name=>page.getByRole('button',{name,exact:true}).click();
    await phase('ready');
    assert.equal(await page.getByRole('button',{name:'Play',exact:true}).evaluate(el=>el===document.activeElement),true);
    await click('Play'); await phase('playing');
    assert.equal(await page.evaluate(()=>document.activeElement===window.fixture.renderer.domElement),true);
    const before=await page.evaluate(()=>window.fixture.player.position.z);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW');
    assert.ok(await page.evaluate(()=>window.fixture.player.position.z)<before-.2);
    await click('Pause'); await phase('paused');
    assert.equal(await page.getByRole('button',{name:'Resume',exact:true}).evaluate(el=>el===document.activeElement),true);
    await click('Resume'); await phase('playing');
    await page.evaluate(()=>window.fixture.select('guide')); await click('Interact'); await phase('dialogue');
    await click('Test error cleanup'); await phase('playing');
    await click('Interact'); await phase('dialogue'); await click('Accept: Recover token'); await phase('playing');
    await page.evaluate(()=>window.fixture.select('token')); await click('Interact');
    assert.equal(await page.evaluate(()=>window.fixture.progress.count('token')),1);
    await page.evaluate(()=>window.fixture.select('guide')); await click('Interact'); await phase('dialogue');
    await click('Claim: Recover token'); await phase('playing');
    assert.equal(await page.evaluate(()=>window.fixture.progress.currency),5);
    await click('Interact'); await phase('dialogue');
    await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await click('Close'); await phase('paused');
    await click('Resume'); await phase('playing');
    await page.evaluate(()=>window.fixture.showDialogue({text:'Pending action',choices:[{label:'Wait',action:()=>new Promise(resolve=>window.finishChoice=resolve)}]}));
    await click('Wait'); assert.equal(await page.getByRole('button',{name:'Wait',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.fixture.showDialogue({text:'Replacement dialogue'}));
    assert.equal(await page.getByRole('button',{name:'Close',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.evaluate(()=>window.finishChoice()); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.fixtureState.dialogue.text),'Replacement dialogue');
    await click('Close'); await phase('playing');
    await page.screenshot({path:`${output}/${ui}.png`});
    await page.evaluate(()=>window.fixture.damage(100)); await phase('dead');
    await click('Respawn'); await phase('paused'); await click('Resume'); await phase('playing');
    await click('Pause'); await click('Restart'); await phase('ready');
    assert.equal(await page.locator('canvas').count(),1);
    assert.equal(await page.evaluate(()=>window.fixture.progress.currency),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ui,passed:true,checks:'start, focus, movement, pause, quest, error cleanup, focus composition, async stale choice, death, respawn, restart'}));
    await page.close();
  }
  const combat=await browser.newPage({viewport:{width:1280,height:800}}), combatErrors=[];
  combat.on('pageerror',e=>combatErrors.push(e.message));
  await combat.goto('http://127.0.0.1:4335/examples/rpg-template/?combat=1');
  await combat.waitForFunction(()=>window.fixtureState?.phase==='ready');
  await combat.getByText('Controls',{exact:true}).click();
  const legend=await combat.getByLabel('Controls',{exact:true}).innerText();
  assert.match(legend,/A\/D\s+Turn \(strafe while RMB held\)/);
  assert.match(legend,/Q\/E\s+Strafe/);
  assert.match(legend,/RMB drag\s+Camera and character/);
  assert.match(legend,/3\s+Heal/);
  await combat.getByText('Controls',{exact:true}).click();
  await combat.getByRole('button',{name:'Play',exact:true}).click();
  await combat.evaluate(()=>{window.fixture.damage(40);window.firstAbility=window.fixtureState.abilities[2].activate;});
  await combat.getByRole('button',{name:'Heal',exact:true}).click();
  assert.equal(await combat.evaluate(()=>window.fixture.health),88);
  assert.equal(await combat.evaluate(()=>window.firstAbility===window.fixtureState.abilities[2].activate),true);
  await combat.evaluate(()=>window.fixture.damage(28)); await combat.keyboard.press('Digit3');
  assert.equal(await combat.evaluate(()=>window.fixture.health),88);
  await combat.evaluate(()=>window.fixture.select('enemy'));
  assert.equal(await combat.getByRole('meter',{name:'Target health'}).evaluate(el=>el.value),1);
  await combat.getByRole('button',{name:'Strike',exact:true}).click();
  assert.deepEqual(await combat.evaluate(()=>({health:window.fixtureState.target.health,max:window.fixtureState.target.maxHealth,fraction:window.fixtureState.target.healthFraction})),{health:30,max:40,fraction:.75});
  assert.equal(await combat.getByRole('meter',{name:'Target health'}).evaluate(el=>el.value),.75);
  await combat.screenshot({path:`${output}/ability-health-contract.png`});
  assert.deepEqual(combatErrors,[]); await combat.close();
  console.log(JSON.stringify({ability_click_matches_key:true,target_health_normalized:true,controls_legend:true}));
  const recovery=await browser.newPage(), recoveryErrors=[];
  recovery.on('pageerror',e=>recoveryErrors.push(e.message));
  let fail=true;
  await recovery.route('**/fixture.gltf',route=>{
    if(fail){fail=false;return route.fulfill({status:503,body:'Fixture load failure'});}
    return route.continue();
  });
  await recovery.goto('http://127.0.0.1:4335/examples/rpg-template/');
  await recovery.waitForFunction(()=>window.fixtureState?.phase==='error');
  await recovery.getByRole('button',{name:'Retry',exact:true}).click();
  await recovery.waitForFunction(()=>window.fixtureState?.phase==='ready');
  assert.equal(recoveryErrors.length,1); assert.equal(await recovery.locator('canvas').count(),1);
  await recovery.close(); console.log(JSON.stringify({startup_retry:true}));
  if(process.env.RPG_LIBRARY_SMOKE){
    const smoke=JSON.parse(await readFile(process.env.RPG_LIBRARY_SMOKE,'utf8'));
    const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:4335/examples/rpg-template/?model=${encodeURIComponent(smoke.model_url)}`);
    await page.waitForFunction(()=>window.fixtureState?.phase==='ready',null,{timeout:45000});
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.screenshot({path:`${output}/reused-library-model.png`});
    assert.deepEqual(errors,[]); await page.close();
    console.log(JSON.stringify({library_model_loaded:true,media_id:smoke.reused_media_id}));
  }
}finally{await browser?.close();server.kill();}
