import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { collectVisibleText, evaluateGame, gradeAssertion, validateCase } from './evaluate.mjs';

test('visible-text validates separately and cannot fall back to hidden innerText', () => {
  const assertion = { id: 'win', at: 'loaded', selector: 'body', type: 'visible-text', matches: 'You\\s+won', flags: 'i' };
  const manifest = { version: 1, cases: [{ id: 'visibility', assertions: [assertion], stages: [{ id: 'create', kind: 'oneshot' }] }] };
  validateCase(manifest, 'visibility', 'create');
  const checkpoints = { loaded: { observations: { body: { visible: true, text: 'Ready You won', visibleText: 'Ready' } } } };
  assert.equal(gradeAssertion(assertion, checkpoints).status, 'fail');
  assert.equal(gradeAssertion({ ...assertion, type: 'text' }, checkpoints).status, 'pass');
  checkpoints.loaded.observations.body.visibleText = 'Ready You won';
  assert.equal(gradeAssertion(assertion, checkpoints).status, 'pass');
  delete checkpoints.loaded.observations.body.visibleText;
  assert.equal(gradeAssertion(assertion, checkpoints).status, 'ungraded');
  assert.throws(() => validateCase({ version: 1, cases: [{ ...manifest.cases[0], assertions: [{ ...assertion, matches: undefined }] }] }, 'visibility', 'create'), /requires equals or matches/);
});

test('real Chromium excludes transparent, hidden, zero-size and offscreen wins but records a revealed win', { skip: !process.env.ROSEBLOX_BROWSER_TEST && !process.env.ROSEBLOX_VISIBLE_TEXT_BROWSER_TEST }, async () => {
  const retain = Boolean(process.env.ROSEBLOX_VISIBLE_TEXT_CALIBRATION_ROOT);
  const root = retain ? resolve(process.env.ROSEBLOX_VISIBLE_TEXT_CALIBRATION_ROOT)
    : await mkdtemp(resolve(tmpdir(), 'roseblox-visible-text-'));
  if (retain) await mkdir(root, { recursive: false });
  try {
  const artifact = resolve(root, 'fixture');
  await mkdir(artifact);
  const fixture = `<!doctype html><html><head><style>
    body { margin:0; background:#18212b; color:white; font:22px sans-serif; }
    canvas { width:300px; height:200px; }
    #offscreen { position:fixed; top:-9999px; }
    #zero { font-size:0; line-height:0; }
  </style></head><body><canvas id="game" width="300" height="200"></canvas><p>Ready</p>
    <p id="opacity" style="opacity:0">You won transparent</p>
    <section style="opacity:0"><p id="ancestor">You won ancestor transparent</p></section>
    <p id="display" style="display:none">You won display hidden</p>
    <section style="visibility:hidden"><p id="visibility">You won hidden visibility</p></section>
    <p id="collapse" style="visibility:collapse">You won collapse</p>
    <p id="zero">You won zero size</p>
    <p id="offscreen">You won offscreen</p>
    <section style="visibility:hidden"><p id="override" style="visibility:visible">Restored visibility</p></section>
    <p id="live" style="opacity:0">You <strong>won</strong></p>
    <script>
      const gl = document.querySelector('canvas').getContext('webgl');
      const vs=gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');gl.compileShader(vs);
      const fs=gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs,'void main(){gl_FragColor=vec4(.3,.7,.2,1.);}');gl.compileShader(fs);
      const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.useProgram(program);
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,0,1]),gl.STATIC_DRAW);
      const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
      function draw(){gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(draw)}draw();
      addEventListener('keydown',e=>{if(e.key==='w')document.querySelector('#live').style.opacity='1'});
    </script></body></html>`;
  await writeFile(resolve(artifact, 'index.html'), fixture);
  const { chromium } = process.env.ROSEBLOX_PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(process.env.ROSEBLOX_PLAYWRIGHT_MODULE).href)
    : await import('playwright');
  const launchOptions = { executablePath: process.env.ROSEBLOX_CHROMIUM ?? '/usr/local/bin/chromium' };
  const manifest = { version: 1, cases: [{ id: 'visible-text-calibration', canvasSelector: '#game', settleMs: 100,
    steps: [{ action: 'press', key: 'w' }, { action: 'checkpoint', id: 'revealed' }],
    assertions: [
      { id: 'hidden-wins-absent', at: 'loaded', selector: 'body', type: 'visible-text', equals: 'Ready Restored visibility' },
      { id: 'legacy-opacity-text-unchanged', at: 'loaded', selector: '#opacity', type: 'text', matches: 'You won' },
      { id: 'revealed-win', at: 'revealed', selector: 'body', type: 'visible-text', matches: 'You\\s+won' },
    ], stages: [{ id: 'create', kind: 'oneshot' }] }] };
  const report = await evaluateGame({ manifest, caseId: 'visible-text-calibration', artifact, outputDir: resolve(root, 'evaluation'),
    chromium, launchOptions, metadata: { evidenceKind: 'assistant-authored calibration', measuredRosieOperations: 0, generationSample: false } });
  assert.equal(report.browserStatus, 'pass', JSON.stringify(report));
  assert.equal(report.requestedBehaviorStatus, 'pass', JSON.stringify(report.assertions));
  assert.equal(report.checkpoints.loaded.observations.body.visibleText, 'Ready Restored visibility');
  assert.equal(report.checkpoints.revealed.observations.body.visibleText, 'Ready Restored visibility You won');
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    const observations = {};
    for (const id of ['opacity', 'ancestor', 'display', 'visibility', 'collapse', 'zero', 'offscreen', 'live']) {
      observations[id] = await page.locator(`#${id}`).evaluate(collectVisibleText);
      assert.equal(observations[id], '', id);
    }
    observations.override = await page.locator('#override').evaluate(collectVisibleText);
    assert.equal(observations.override, 'Restored visibility');
    await page.keyboard.press('w');
    observations.revealed = await page.locator('#live').evaluate(collectVisibleText);
    assert.equal(observations.revealed, 'You won');
    await page.screenshot({ path: resolve(root, 'revealed-calibration.png') });
    await writeFile(resolve(root, 'observations.json'), JSON.stringify({ label: 'Assistant-authored calibration, not a Rosie generation sample.', measuredRosieOperations: 0, observations }, null, 2) + '\n');
  } finally { await browser.close(); }
  assert.ok((await readFile(resolve(root, 'evaluation', 'loaded.png'))).length > 0);
  } finally { if (!retain) await rm(root, { recursive: true, force: true }); }
});
