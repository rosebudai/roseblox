import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url)), output=process.env.RPG_UI_EVIDENCE??'/tmp/roseblox-rpg-interaction-evidence';
await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4337','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser;
try {
  for(let i=0;i<40;i++){if(await fetch('http://127.0.0.1:4337/').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.CANARY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4337/examples/rpg-template/?interaction=1');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  const candidate=id=>page.waitForFunction(id=>window.fixtureState.interaction?.id===id,id);
  await candidate('guide');
  assert.equal(await page.evaluate(()=>window.fixture.selected),null);
  // A nearer wall-blocked pickup and scenery must not hide the reachable guide.
  await page.keyboard.press('KeyF');
  await page.getByRole('button',{name:'Accept: Recover token',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.selected),null);
  // Clicking something else must not redirect F away from the closest usable object.
  await page.evaluate(()=>{window.fixture.select('guide');window.fixture.player.teleport([1.6,.1,.3]);});
  await candidate('token');
  await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(()=>window.fixture.progress.count('token')),1);
  assert.equal(await page.evaluate(()=>window.fixture.selected),'guide');
  assert.equal(await page.evaluate(()=>window.fixture.actors.get('token').dead),true);
  assert.notEqual(await page.evaluate(()=>window.fixtureState.interaction?.id),'token');
  await page.evaluate(()=>window.fixture.player.teleport([20,.1,0]));
  await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(()=>window.fixture.progress.count('token')),1);
  await page.evaluate(()=>{window.fixture.select(null);window.fixture.player.teleport([-1.6,.1,.3]);});
  await candidate('guide');await page.keyboard.press('KeyF');
  await page.getByRole('button',{name:'Claim: Recover token',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.progress.currency),5);
  assert.equal(await page.evaluate(()=>window.fixture.session.playing),true);
  // A quest-only target remains usable, including when behind the hero.
  await page.evaluate(()=>window.fixture.player.teleport([10,.1,-1.3]));
  await candidate('marker');await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(()=>window.fixture.progress.quests.find(q=>q.id==='visit-marker').state),'completed');
  // Never execute the last displayed prompt after the player has left its reach.
  await page.evaluate(()=>{window.fixture.player.teleport([20,.1,0]);window.fixture.interact();});
  assert.equal(await page.evaluate(()=>window.fixtureState.interaction),null);
  assert.equal(await page.evaluate(()=>window.fixtureState.phase),'playing');
  // An enemy within reach is not an interaction; a paused game cannot collect.
  await page.evaluate(()=>window.fixture.player.teleport([0,.1,-4.8]));
  await candidate(undefined);await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(()=>window.fixtureState.interaction),null);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.fixture.player.teleport([.9,.1,-1.6]);window.fixture.interact();});
  assert.equal(await page.evaluate(()=>window.fixture.progress.count('hidden')),0);
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await candidate('blocked-token');await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(()=>window.fixture.progress.count('hidden')),1);
  assert.equal(await page.evaluate(()=>window.fixture.selected),null);
  await page.screenshot({path:output+'/interaction.png'});
  assert.deepEqual(errors,[]);
  const result={passed:true,checks:['NPC dialogue without selection','nearest usable target','wall occlusion','scenery and enemies ignored','click selection does not override proximity','collect once','quest delivery and claim','quest-only target','no facing requirement','revalidate current range','pause suspends interaction'],errors};
  await writeFile(output+'/checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser?.close();server.kill();}
