// Exercises real engine movement with the frozen replay. This is not LLM evidence.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { evaluateGame } from './evaluate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output = resolve(process.argv[2] ?? `/tmp/roseblox-coin-calibration-${Date.now()}`);
const manifest = JSON.parse(await readFile(resolve(root,'benchmarks/cases.json'),'utf8'));
const results = [];
let previous = null;
for (const stageId of ['create','restart-edit','night-edit']) {
  const artifact = resolve(output,stageId,'playable');
  await mkdir(artifact,{recursive:true});
  for (const name of ['index.html','game.js']) {
    await copyFile(resolve(root,'benchmarks/fixtures/coin-course',name),resolve(artifact,name));
  }
  await copyFile(resolve(root,'build/roseblox.js'),resolve(artifact,'roseblox.js'));
  await writeFile(resolve(artifact,'stage.js'),
    `export const night=${stageId==='night-edit'}; export const restartEnabled=${stageId!=='create'};\n`);
  const report = await evaluateGame({
    manifest, caseId:'coin-course', stageId, artifact,
    outputDir:resolve(output,stageId,'browser'), previous,
    metadata:{evidenceKind:'assistant-authored-calibration',modelGeneration:false,measuredRosieGeneration:false},
    launchOptions:{executablePath:process.env.CHROMIUM_PATH??'/usr/local/bin/chromium'},
  });
  results.push({stageId,report:resolve(output,stageId,'browser/report.json'),
    requestedBehaviorStatus:report.requestedBehaviorStatus,status:report.status,
    failures:[...report.checks,...report.assertions].filter(check=>check.status==='fail')});
  await writeFile(resolve(output,'summary.json'),JSON.stringify({
    evidenceKind:'assistant-authored-calibration',modelGeneration:false,measuredRosieGeneration:false,results,
    limitations:['Required visual criteria remain ungraded until actual screenshots are reviewed.'],
  },null,2));
  assert.equal(report.requestedBehaviorStatus,'pass',JSON.stringify(results.at(-1)));
  assert.ok(report.checks.filter(check=>check.id.startsWith('browser.')&&check.required)
    .every(check=>check.status==='pass'),JSON.stringify(results.at(-1)));
  assert.equal(report.status,'ungraded','Fixture assertions must not fabricate a visual review');
  previous = report;
}
console.log(JSON.stringify({output,results},null,2));
