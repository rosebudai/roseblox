#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateGame } from './evaluate.mjs';

/** Assistant-authored fixture calibration; no Rosie operation or Rosie provider calls. */
export async function calibrateTargetGallery(outputDir, { executablePath = '/usr/local/bin/chromium' } = {}) {
  const output = resolve(outputDir);
  await mkdir(output, { recursive: true });
  const manifest = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
  const fixture = fileURLToPath(new URL('./fixtures/target-gallery/', import.meta.url));
  const threeModule = fileURLToPath(import.meta.resolve('three'));
  const stages = [
    { id: 'create', targetCount: 3, restart: false },
    { id: 'five-target-edit', targetCount: 5, restart: false },
    { id: 'restart-gallery-edit', targetCount: 5, restart: true },
  ];
  const results = [];
  let previous = null;
  for (const config of stages) {
    const artifact = resolve(output, config.id, 'fixture');
    await cp(fixture, artifact, { recursive: true });
    await mkdir(resolve(artifact, 'vendor'), { recursive: true });
    for (const name of ['three.module.js', 'three.core.js']) {
      await cp(resolve(dirname(threeModule), name), resolve(artifact, 'vendor', name));
    }
    await writeFile(resolve(artifact, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    const report = await evaluateGame({ manifest, caseId: 'target-gallery', stageId: config.id,
      artifact, outputDir: resolve(output, config.id, 'evidence'), previous,
      metadata: { evidenceKind: 'assistant-authored-calibration', rosieGenerationSample: false, rosieProviderCalls: 0 },
      launchOptions: { executablePath, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
    previous = report;
    results.push({ stage: config.id, browserStatus: report.browserStatus,
      requestedBehaviorStatus: report.requestedBehaviorStatus, visualReviewStatus: report.visualReviewStatus,
      status: report.status, report: resolve(output, config.id, 'evidence/report.json'),
      firstShotPointerLock: report.checkpoints['first-hit']?.pointerLock,
      lockedPointerShots: report.actions.filter((action) => action.inputMode === 'pointer-lock-preserved').length,
      failures: [...report.checks, ...report.assertions].filter((item) => item.status !== 'pass') });
  }
  const missManifest = { version: 1, cases: [{
    id: 'target-gallery-miss-calibration', canvasSelector: '#game-canvas', readySelector: '#start', settleMs: 1000,
    steps: [{ action: 'click', selector: '#start' }, { action: 'wait', ms: 100 },
      { action: 'move', x: 1000, y: 400 }, { action: 'click', selector: '#game-canvas' },
      { action: 'checkpoint', id: 'missed' }],
    assertions: [
      { id: 'miss.score-unchanged', at: 'missed', from: 'loaded', selector: '#score', type: 'number-delta', equals: 0 },
      { id: 'miss.observed', at: 'missed', selector: '#status', type: 'text', matches: 'Miss' },
    ], reviewCriteria: [{ id: 'visual.miss', description: 'The player aims away from the target and the real raycast misses.' }],
    stages: [{ id: 'create', kind: 'oneshot' }],
  }] };
  const miss = await evaluateGame({ manifest: missManifest, caseId: 'target-gallery-miss-calibration',
    artifact: resolve(output, 'create/fixture'), outputDir: resolve(output, 'miss/evidence'),
    metadata: { evidenceKind: 'assistant-authored-calibration', rosieGenerationSample: false, rosieProviderCalls: 0 },
    launchOptions: { executablePath, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
  const summary = { evidenceKind: 'assistant-authored-calibration', rosieGenerationSample: false, rosieProviderCalls: 0,
    description: 'Three.js meshes, actual pointer lock/mouse-look and raycasting; exercises evaluator replay, not model output quality.',
    stages: results, missReplay: { browserStatus: miss.browserStatus, requestedBehaviorStatus: miss.requestedBehaviorStatus,
      status: miss.status, report: resolve(output, 'miss/evidence/report.json') } };
  await writeFile(resolve(output, 'calibration-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const summary = await calibrateTargetGallery(process.argv[2] ?? '/tmp/roseblox-gallery-calibration');
  console.log(JSON.stringify(summary, null, 2));
  for (const stage of summary.stages) {
    assert.equal(stage.browserStatus, 'pass', `${stage.stage}: browser contract failed`);
    assert.equal(stage.requestedBehaviorStatus, 'pass', `${stage.stage}: replay failed`);
    assert.equal(stage.visualReviewStatus, 'ungraded', 'Calibration must not invent a visual assessment.');
    assert.equal(stage.firstShotPointerLock?.active, true, 'The known-good fixture must actually acquire pointer lock.');
    assert.ok(stage.lockedPointerShots >= 3, 'Shots must preserve the real locked pointer.');
  }
  assert.equal(summary.missReplay.browserStatus, 'pass');
  assert.equal(summary.missReplay.requestedBehaviorStatus, 'pass', 'An intentionally missed raycast must not increment the score.');
}
