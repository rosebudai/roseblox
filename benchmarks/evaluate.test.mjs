import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { applyReview, compareReports, evaluateGame, gradeAssertion, validateCase } from './evaluate.mjs';
import { summarizeReports } from './summarize.mjs';

test('all checked-in case stages validate before launching a browser', async () => {
  const manifest = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
  for (const item of manifest.cases) for (const stage of item.stages) validateCase(manifest, item.id, stage.id);
});

test('ambiguous scores and absent checkpoints stay ungraded; missing requested UI fails', () => {
  const assertion = { id: 'progress', at: 'after', from: 'before', selector: '#score', type: 'number-delta', min: 1 };
  const checkpoints = { before: { observations: { '#score': { visible: true, number: 0 } } }, after: { observations: { '#score': { visible: true, number: null, text: '1 / 3' } } } };
  assert.equal(gradeAssertion(assertion, checkpoints).status, 'ungraded');
  assert.equal(gradeAssertion(assertion, {}).status, 'ungraded');
  checkpoints.after.observations['#score'] = { visible: false };
  assert.equal(gradeAssertion(assertion, checkpoints).status, 'fail');
  checkpoints.after.observations['#score'] = { visible: true, number: 1, text: 'Score: 1' };
  assert.equal(gradeAssertion(assertion, checkpoints).status, 'pass');
});

test('edit comparison does not interpret missing criteria as regression-free', () => {
  const previous = { caseId: 'game', runId: 'before', stageId: 'create', checks: [], reviews: [], assertions: [{ id: 'progress', required: true, status: 'pass' }] };
  const current = { caseId: 'game', checks: [], reviews: [], assertions: [] };
  assert.equal(compareReports(previous, current).status, 'ungraded');
  current.assertions.push({ id: 'progress', status: 'fail' });
  assert.equal(compareReports(previous, current).regressions.length, 1);
  current.assertions[0].status = 'pass';
  assert.equal(compareReports(previous, current).status, 'pass');
  assert.throws(() => compareReports(previous, { ...current, caseId: 'other' }), /different case/);
});

test('review requires exact run identity and existing screenshot references', async () => {
  const report = { runId: 'run', kind: 'oneshot', checkpoints: { loaded: { screenshot: 'loaded.png' } },
    reviews: [{ id: 'scene', required: true, status: 'ungraded' }], checks: [{ status: 'pass', required: true }],
    assertions: [{ status: 'pass', required: true }], infrastructureErrors: [] };
  const review = { runId: 'other', reviewer: 'human:test', criteria: [{ id: 'scene', status: 'pass', reason: 'Visible scene.', evidence: ['loaded.png'] }] };
  await assert.rejects(applyReview(report, review), /exact runId/);
  review.runId = 'run';
  review.criteria[0].evidence = ['invented.png'];
  await assert.rejects(applyReview(report, review), /screenshot evidence/);
  review.criteria[0].evidence = ['loaded.png'];
  assert.equal((await applyReview(report, review)).status, 'pass');
});

test('a reviewed smoke-only report without requested behavior remains ungraded', async () => {
  const report = { runId: 'smoke', kind: 'oneshot', checkpoints: { loaded: { screenshot: 'loaded.png' } },
    reviews: [{ id: 'scene', required: true, status: 'ungraded' }], checks: [{ status: 'pass', required: true }],
    assertions: [], infrastructureErrors: [] };
  const review = { runId: 'smoke', reviewer: 'human:test', criteria: [{ id: 'scene', status: 'pass', reason: 'A scene is visible.', evidence: ['loaded.png'] }] };
  assert.equal((await applyReview(report, review)).status, 'ungraded');
});

test('reviewing an edit recomputes regression status against the reviewed previous stage', async () => {
  const previous = { runId: 'before', caseId: 'game', stageId: 'create', checks: [{ id: 'render', required: true, status: 'pass' }],
    assertions: [{ id: 'score', required: true, status: 'pass' }], reviews: [{ id: 'scene', required: true, status: 'pass' }] };
  const report = { runId: 'after', caseId: 'game', kind: 'edit', checkpoints: { loaded: { screenshot: 'loaded.png' } },
    reviews: [{ id: 'scene', required: true, status: 'ungraded' }], checks: previous.checks,
    assertions: previous.assertions, infrastructureErrors: [], editRegression: { status: 'ungraded' } };
  const review = { runId: 'after', reviewer: 'human:test', criteria: [{ id: 'scene', status: 'pass', reason: 'Scene retained.', evidence: ['loaded.png'] }] };
  const result = await applyReview(report, review, previous);
  assert.equal(result.status, 'pass');
  assert.equal(result.editRegression.status, 'pass');
});

test('zero graded runs is unknown, requested models are unverified, and run duplicates reject', () => {
  const report = { runId: '1', kind: 'oneshot', status: 'ungraded', expectedModel: 'sol', generationMetadata: { requestedModel: 'sol' } };
  const summary = summarizeReports([report]);
  assert.equal(summary.groups[0].gradedSuccessRate, null);
  assert.equal(summary.groups[0].confirmedSuccessRateAllRuns, 0);
  assert.equal(summary.groups[0].observedModel, 'unverified');
  assert.throws(() => summarizeReports([report, report]), /duplicate runId/);
});

test('real Chromium records WebGL draws and input HUD changes without inventing a visual pass', { skip: !process.env.ROSEBLOX_BROWSER_TEST }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'roseblox-evaluator-contract-'));
  try {
    await writeFile(resolve(root, 'index.html'), `<!doctype html><body><canvas id="game" width="300" height="300"></canvas><p id="score">Score: 0</p><script>
      const gl = document.querySelector('canvas').getContext('webgl');
      const v = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(v, 'attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }'); gl.compileShader(v);
      const f = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(f, 'void main(){ gl_FragColor=vec4(0.3,0.7,0.2,1.0); }'); gl.compileShader(f);
      const program=gl.createProgram(); gl.attachShader(program,v); gl.attachShader(program,f); gl.linkProgram(program); gl.useProgram(program);
      const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,0,1]),gl.STATIC_DRAW);
      const p=gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
      function render(){gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(render)}render();
      addEventListener('keydown', e => { if(e.key==='w') document.querySelector('#score').textContent='Score: 1'; });
      </script></body>`);
    const manifest = { version: 1, cases: [{ id: 'contract', canvasSelector: '#game', settleMs: 100,
      steps: [{ action: 'press', key: 'w' }, { action: 'checkpoint', id: 'after' }],
      assertions: [{ id: 'score', at: 'after', from: 'loaded', selector: '#score', type: 'number-delta', equals: 1 }],
      reviewCriteria: [{ id: 'gameplay', description: 'A synthetic HUD test is not a game success.' }],
      stages: [{ id: 'create', kind: 'oneshot' }] }] };
    const report = await evaluateGame({ manifest, caseId: 'contract', artifact: root, outputDir: resolve(root, 'results'),
      launchOptions: { executablePath: process.env.ROSEBLOX_CHROMIUM ?? '/usr/local/bin/chromium', args: ['--no-sandbox'] } });
    assert.equal(report.browserStatus, 'pass', JSON.stringify(report, null, 2));
    assert.equal(report.requestedBehaviorStatus, 'pass');
    assert.equal(report.visualReviewStatus, 'ungraded');
    assert.equal(report.status, 'ungraded');
    assert.ok(report.checkpoints.loaded.webgl[0].draws > 0);
    assert.ok((await readFile(resolve(root, 'results', 'loaded.png'))).length > 0);
    // A blank canvas has no WebGL evidence even when a HUD claims success.
    await writeFile(resolve(root, 'index.html'), '<canvas id="game"></canvas><p id="score">Score: 1</p>');
    const blank = await evaluateGame({ manifest, caseId: 'contract', artifact: root, outputDir: resolve(root, 'blank'),
      launchOptions: { executablePath: process.env.ROSEBLOX_CHROMIUM ?? '/usr/local/bin/chromium', args: ['--no-sandbox'] } });
    assert.notEqual(blank.status, 'pass');
    assert.equal(blank.checks.find((check) => check.id === 'browser.webgl-rendering').status, 'ungraded');
    await writeFile(resolve(root, 'index.html'), '<canvas id="game"></canvas><p id="score">Score: 1</p><script>throw new Error("synthetic game failure")</script>');
    const broken = await evaluateGame({ manifest, caseId: 'contract', artifact: root, outputDir: resolve(root, 'broken'),
      launchOptions: { executablePath: process.env.ROSEBLOX_CHROMIUM ?? '/usr/local/bin/chromium', args: ['--no-sandbox'] } });
    assert.equal(broken.status, 'fail');
    assert.equal(broken.checks.find((check) => check.id === 'browser.page-errors').status, 'fail');
    assert.match(broken.pageErrors[0].message, /synthetic game failure/);
    await writeFile(resolve(root, 'index.html'), '<p>The requested game did not load.</p>');
    const missing = await evaluateGame({ manifest: { ...manifest, cases: [{ ...manifest.cases[0], timeoutMs: 200 }] },
      caseId: 'contract', artifact: root, outputDir: resolve(root, 'missing'),
      launchOptions: { executablePath: process.env.ROSEBLOX_CHROMIUM ?? '/usr/local/bin/chromium', args: ['--no-sandbox'] } });
    assert.equal(missing.status, 'fail');
    assert.equal(missing.checks.find((check) => check.id === 'browser.ready').status, 'fail');
  } finally { await rm(root, { recursive: true, force: true }); }
});
