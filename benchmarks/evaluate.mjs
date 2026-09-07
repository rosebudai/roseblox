#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = 1;
const now = () => new Date().toISOString();
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
const aggregate = (checks) => checks.some((check) => check.status === 'fail')
  ? 'fail' : checks.length && checks.every((check) => check.status === 'pass') ? 'pass' : 'ungraded';

export function validateCase(manifest, caseId, stageId) {
  if (manifest.version !== VERSION || !Array.isArray(manifest.cases)) {
    throw new Error('Expected a version 1 case manifest.');
  }
  const testCase = manifest.cases.find((item) => item.id === caseId);
  const requestedStage = testCase?.stages?.find((item) => item.id === stageId);
  if (!requestedStage) throw new Error(`Unknown case/stage: ${caseId}/${stageId}`);
  const lineage = [];
  const visited = new Set();
  for (let item = requestedStage; item;) {
    if (visited.has(item.id)) throw new Error(`Cyclic stage inheritance: ${item.id}`);
    visited.add(item.id);
    lineage.unshift(item);
    const parent = item.extends;
    item = parent ? testCase.stages.find((candidate) => candidate.id === parent) : null;
    if (parent && !item) throw new Error(`Unknown inherited stage: ${parent}`);
  }
  const stage = { ...requestedStage,
    steps: lineage.flatMap((item) => item.steps ?? []),
    assertions: lineage.flatMap((item) => item.assertions ?? []),
    reviewCriteria: lineage.flatMap((item) => item.reviewCriteria ?? []),
  };
  if (!['oneshot', 'edit'].includes(stage.kind)) throw new Error('Stage kind must be oneshot or edit.');
  const steps = [...(testCase.steps ?? []), ...(stage.steps ?? [])];
  const assertions = [...(testCase.assertions ?? []), ...(stage.assertions ?? [])];
  const checkpoints = new Set(['loaded', 'final']);
  for (const step of steps) {
    if (!['click', 'press', 'hold', 'move', 'wait', 'checkpoint'].includes(step.action)) {
      throw new Error(`Unknown action: ${step.action}`);
    }
    if (step.ms != null && (!Number.isFinite(step.ms) || step.ms < 0 || step.ms > 60000)) {
      throw new Error('Step duration must be between 0 and 60000 milliseconds.');
    }
    if (step.action === 'checkpoint') {
      if (!step.id || checkpoints.has(step.id)) throw new Error(`Duplicate/empty checkpoint: ${step.id}`);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(step.id)) throw new Error(`Unsafe checkpoint id: ${step.id}`);
      checkpoints.add(step.id);
    }
  }
  const orderedCheckpoints = ['loaded', ...steps.filter((step) => step.action === 'checkpoint').map((step) => step.id), 'final'];
  const ids = new Set();
  for (const assertion of assertions) {
    if (!assertion.id || ids.has(assertion.id)) throw new Error(`Duplicate/empty assertion: ${assertion.id}`);
    ids.add(assertion.id);
    if (!checkpoints.has(assertion.at)) throw new Error(`Unknown checkpoint: ${assertion.at}`);
    if (!['visible', 'text', 'visible-text', 'number', 'number-delta'].includes(assertion.type)) {
      throw new Error(`Unknown assertion type: ${assertion.type}`);
    }
    if (!assertion.selector) throw new Error(`Missing selector: ${assertion.id}`);
    if (assertion.type === 'number-delta' && !checkpoints.has(assertion.from)) {
      throw new Error(`Unknown comparison checkpoint: ${assertion.from}`);
    }
    if (assertion.type === 'number-delta' && orderedCheckpoints.indexOf(assertion.from) >= orderedCheckpoints.indexOf(assertion.at)) {
      throw new Error(`Numeric baseline must precede the outcome: ${assertion.id}`);
    }
    if (['text', 'visible-text'].includes(assertion.type) && typeof assertion.equals !== 'string' && typeof assertion.matches !== 'string') {
      throw new Error(`Text assertion requires equals or matches: ${assertion.id}`);
    }
    if (assertion.type.startsWith('number') && !['equals', 'min', 'max'].some((key) => Number.isFinite(assertion[key]))) {
      throw new Error(`Numeric assertion requires equals, min or max: ${assertion.id}`);
    }
    if (assertion.matches) new RegExp(assertion.matches, assertion.flags ?? '');
  }
  return { testCase, stage, steps, assertions };
}

// Observe actual browser draws; this probe never supplies game state or modifies a runtime-check result.
function installDrawProbe() {
  const contexts = [];
  const original = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakSet();
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const context = original.call(this, type, ...args);
    if (context && ['webgl', 'webgl2', 'experimental-webgl'].includes(type) && !seen.has(context)) {
      seen.add(context);
      const record = { canvas: this, type, draws: 0, lost: false, instrumented: false };
      contexts.push(record);
      this.addEventListener('webglcontextlost', () => { record.lost = true; });
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (typeof context[name] !== 'function') continue;
        const draw = context[name];
        try {
          context[name] = function (...parameters) {
            const result = draw.apply(this, parameters);
            record.draws += 1;
            return result;
          };
          record.instrumented = true;
        } catch { /* Browser implementations may disallow instrumenting methods. */ }
      }
    }
    return context;
  };
  Object.defineProperty(window, '__rosebloxBrowserObservation', {
    configurable: false,
    value: (selector) => contexts.filter((record) => record.canvas.matches(selector)).map((record) => ({
      type: record.type, draws: record.draws, contextLost: record.lost,
      instrumented: record.instrumented,
      width: record.canvas.width, height: record.canvas.height,
      connected: record.canvas.isConnected,
    })),
  });
}

// This is a DOM visibility filter, not proof of legibility or absence of occlusion.
// Screenshots still require explicit review. Keep legacy innerText observations unchanged.
export function collectVisibleText(root) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const walker = doc.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    // CSS visibility is inherited but descendants may explicitly restore it.
    let hidden = ['hidden', 'collapse'].includes(view.getComputedStyle(node.parentElement).visibility);
    if (hidden) continue;
    for (let element = node.parentElement; element; element = element.parentElement) {
      const style = view.getComputedStyle(element);
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(element.tagName)
          || style.display === 'none'
          || Number.parseFloat(style.opacity) === 0) {
        hidden = true;
        break;
      }
    }
    if (hidden) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const inViewport = [...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.bottom > 0 && rect.left < view.innerWidth && rect.top < view.innerHeight);
    if (inViewport) texts.push(node.textContent.trim());
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

async function observe(frame, assertion) {
  const locator = frame.locator(assertion.selector);
  const count = await locator.count();
  if (count !== 1) return { present: count > 0, count, visible: false, error: `Expected one match, found ${count}.` };
  const visible = await locator.isVisible();
  const text = await locator.innerText({ timeout: 3000 });
  const matches = text.match(/[-+]?\d+(?:\.\d+)?/g) ?? [];
  const number = matches.length === 1 ? Number(matches[0]) : null;
  const visibleText = assertion.collectVisibleText ? await locator.evaluate(collectVisibleText) : undefined;
  return { present: true, count, visible, text: text.trim(), number,
    ...(visibleText === undefined ? {} : { visibleText }) };
}

export function gradeAssertion(assertion, checkpoints) {
  const observation = checkpoints[assertion.at]?.observations?.[assertion.selector];
  const result = { id: assertion.id, description: assertion.description ?? assertion.id,
    required: assertion.required !== false, at: assertion.at, selector: assertion.selector,
    expected: assertion, observed: observation ?? null, status: 'ungraded' };
  if (!observation) return { ...result, reason: 'The checkpoint was not reached.' };
  if (!observation.visible) return { ...result, status: 'fail', reason: observation.error ?? 'Requested UI is not visible.' };
  if (assertion.type === 'visible') return { ...result, status: 'pass' };
  if (['text', 'visible-text'].includes(assertion.type)) {
    const text = assertion.type === 'visible-text' ? observation.visibleText : observation.text;
    if (typeof text !== 'string') return { ...result, reason: 'The requested text observation was not collected.' };
    const passed = typeof assertion.equals === 'string'
      ? text === assertion.equals
      : new RegExp(assertion.matches, assertion.flags ?? '').test(text);
    return { ...result, status: passed ? 'pass' : 'fail' };
  }
  let value = observation.number;
  if (assertion.type === 'number-delta') {
    const before = checkpoints[assertion.from]?.observations?.[assertion.selector];
    result.before = before ?? null;
    if (!before?.visible || before.number == null) {
      return { ...result, reason: 'No unambiguous visible numeric baseline.' };
    }
    value = value == null ? null : value - before.number;
    result.delta = value;
  }
  if (value == null) return { ...result, reason: 'Visible text does not contain exactly one number.' };
  const passed = (assertion.equals == null || value === assertion.equals)
    && (assertion.min == null || value >= assertion.min)
    && (assertion.max == null || value <= assertion.max);
  return { ...result, status: passed ? 'pass' : 'fail' };
}

export function compareReports(previous, current) {
  if (!previous) return { status: 'ungraded', reason: 'No previous stage report supplied.', regressions: [] };
  if (previous.caseId !== current.caseId) throw new Error('Previous report is from a different case.');
  const passed = [...previous.checks, ...previous.assertions, ...previous.reviews].filter((check) => check.required !== false && check.status === 'pass');
  const currentChecks = new Map([...current.checks, ...current.assertions, ...current.reviews].map((check) => [check.id, check]));
  const comparisons = passed.map((check) => ({ id: check.id, before: 'pass', after: currentChecks.get(check.id)?.status ?? 'ungraded' }));
  const regressions = comparisons.filter((check) => check.after === 'fail');
  return { status: regressions.length ? 'fail' : comparisons.length && comparisons.every((check) => check.after === 'pass') ? 'pass' : 'ungraded',
    previousRunId: previous.runId, previousStageId: previous.stageId, comparisons, regressions,
    reason: comparisons.length ? null : 'The previous report has no passing required checks.' };
}

async function serveArtifact(artifactPath, entry = 'index.html') {
  const artifact = await realpath(resolve(artifactPath));
  const isDirectory = (await stat(artifact)).isDirectory();
  const root = isDirectory ? artifact : dirname(artifact);
  const initial = isDirectory ? entry : relative(root, artifact);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.wasm': 'application/wasm', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let filename = resolve(root, `.${pathname}`);
      if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html');
      filename = await realpath(filename);
      const child = relative(root, filename);
      if (child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)) {
        response.writeHead(403).end(); return;
      }
      const content = await readFile(filename);
      response.writeHead(200, { 'content-type': mime[extname(filename)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(content);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((success, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', success); });
  return { url: `http://127.0.0.1:${server.address().port}/${initial.split(sep).map(encodeURIComponent).join('/')}`,
    close: () => new Promise((done) => server.close(done)) };
}

async function loadChromium() {
  try { return (await import('playwright')).chromium; }
  catch (firstError) {
    try { return (await import('@playwright/test')).chromium; }
    catch { throw new Error('Playwright is unavailable. Install the repository dependencies and Chromium in the workstation.', { cause: firstError }); }
  }
}

/** Evaluate an already generated game. Model calls and runtime-check submission belong to the caller. */
export async function evaluateGame({ manifest, caseId, stageId = 'create', url, artifact, outputDir,
  previous = null, metadata = {}, chromium = null, launchOptions = {} }) {
  if (Boolean(url) === Boolean(artifact)) throw new Error('Supply exactly one of url or artifact.');
  const { testCase, stage, steps, assertions } = validateCase(manifest, caseId, stageId);
  if (previous && previous.caseId !== caseId) throw new Error('Previous report is from a different case.');
  const output = resolve(outputDir);
  await mkdir(output, { recursive: true });
  try {
    await stat(resolve(output, 'report.json'));
    throw new Error('Output directory already contains a report. Choose a new directory to retain the previous run.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const report = {
    version: VERSION, runId: randomUUID(), caseId, stageId, kind: stage.kind, startedAt: now(),
    manifestSha256: fingerprint(JSON.stringify(manifest)),
    expectedModel: stage.expectedModel ?? null, generationMetadata: metadata,
    modelIdentityVerifiedByBrowser: false,
    prompt: stage.prompt ?? testCase.prompt, target: { url: url ?? null, artifact: artifact ? resolve(artifact) : null },
    checkpoints: {}, actions: [], assertions: [], checks: [], reviews: [],
    console: [], pageErrors: [], requestFailures: [], httpErrors: [], infrastructureErrors: [],
    limitations: ['Browser evaluation does not verify model identity or generation completion.',
      'Canvas screenshot changes and draw calls do not prove player movement or requested gameplay.',
      'Visible HUD assertions are graded separately from visual gameplay review.',
      'The draw probe observes WebGL on HTML canvases; worker OffscreenCanvas/WebGPU rendering is ungraded.'],
  };
  let browser, context, page, server, gameFrame;
  const started = Date.now();
  const canvasSelector = testCase.canvasSelector ?? 'canvas';
  const timeout = testCase.timeoutMs ?? 30000;
  const recordCheckpoint = async (id) => {
    const checkpoint = { id, at: now(), elapsedMs: Date.now() - started, observations: {} };
    report.checkpoints[id] = checkpoint;
    const screenshotFile = `${id}.png`;
    await page.screenshot({ path: resolve(output, screenshotFile), fullPage: false });
    checkpoint.screenshot = screenshotFile;
    checkpoint.screenshotSha256 = fingerprint(await readFile(resolve(output, screenshotFile)));
    const canvas = gameFrame.locator(canvasSelector).first();
    checkpoint.canvas = { count: await gameFrame.locator(canvasSelector).count(), visible: await canvas.isVisible().catch(() => false) };
    if (checkpoint.canvas.visible) {
      const canvasFile = `${id}-canvas.png`;
      await canvas.screenshot({ path: resolve(output, canvasFile), timeout: 5000 });
      checkpoint.canvas.screenshot = canvasFile;
      checkpoint.canvas.screenshotSha256 = fingerprint(await readFile(resolve(output, canvasFile)));
    }
    checkpoint.webgl = await gameFrame.evaluate((selector) => window.__rosebloxBrowserObservation?.(selector) ?? [], canvasSelector);
    checkpoint.pointerLock = await gameFrame.evaluate(() => ({
      active: document.pointerLockElement !== null,
      elementId: document.pointerLockElement?.id ?? null,
      elementTag: document.pointerLockElement?.tagName ?? null,
    }));
    const selectors = new Set(assertions.filter((assertion) => assertion.at === id || assertion.from === id).map((assertion) => assertion.selector));
    for (const selector of selectors) {
      try { checkpoint.observations[selector] = await observe(gameFrame, { selector,
        collectVisibleText: assertions.some((assertion) => assertion.selector === selector && assertion.type === 'visible-text'),
      }); }
      catch (error) { checkpoint.observations[selector] = { visible: false, error: String(error) }; }
    }
  };
  try {
    if (artifact) { server = await serveArtifact(artifact, testCase.entry ?? 'index.html'); url = server.url; }
    const engine = chromium ?? await loadChromium();
    browser = await engine.launch({ headless: true, ...launchOptions });
    report.browser = { version: browser.version(), engine: 'chromium', headless: launchOptions.headless !== false };
    context = await browser.newContext({ viewport: testCase.viewport ?? { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript(installDrawProbe);
    page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on('console', (message) => report.console.push({ type: message.type(), text: message.text(), location: message.location(), at: now() }));
    page.on('pageerror', (error) => report.pageErrors.push({ message: error.message, stack: error.stack, at: now() }));
    page.on('requestfailed', (request) => report.requestFailures.push({ url: request.url(), resourceType: request.resourceType(), failure: request.failure(), at: now() }));
    page.on('response', (response) => {
      if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status(), resourceType: response.request().resourceType(), at: now() });
    });
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      report.checks.push({ id: 'browser.navigation', required: true, status: response && response.status() >= 400 ? 'fail' : 'pass', httpStatus: response?.status() ?? null });
    } catch (error) {
      report.checks.push({ id: 'browser.navigation', required: true, status: 'fail', reason: String(error) });
      throw error;
    }
    report.target.finalUrl = page.url();
    gameFrame = page.mainFrame();
    if (testCase.frameSelector) {
      const element = await page.locator(testCase.frameSelector).elementHandle();
      gameFrame = await element?.contentFrame();
      if (!gameFrame) throw new Error('The specified game iframe did not load.');
    }
    try {
      await gameFrame.locator(canvasSelector).first().waitFor({ state: 'visible', timeout });
      if (testCase.readySelector) await gameFrame.locator(testCase.readySelector).waitFor({ state: 'visible', timeout });
      report.checks.push({ id: 'browser.ready', required: true, status: 'pass' });
    } catch (error) {
      report.checks.push({ id: 'browser.ready', required: true, status: 'fail', reason: String(error) });
      await recordCheckpoint('startup-failed');
      throw error;
    }
    await page.waitForTimeout(testCase.settleMs ?? 1500);
    await recordCheckpoint('loaded');
    for (const step of steps) {
      const action = { ...step, startedAt: now() };
      report.actions.push(action);
      try {
        if (step.action === 'checkpoint') await recordCheckpoint(step.id);
        if (step.action === 'wait') await page.waitForTimeout(step.ms ?? 500);
        if (step.action === 'click') {
          if (step.selector) {
            const target = gameFrame.locator(step.selector);
            const ownsPointerLock = await target.evaluate((element) => document.pointerLockElement === element);
            if (ownsPointerLock && !step.position) {
              // Repositioning a locked pointer changes FPS aim before the shot.
              action.inputMode = 'pointer-lock-preserved';
              await page.mouse.down();
              await page.mouse.up();
            } else {
              await target.click(step.position ? { position: step.position } : {});
            }
          }
          else await page.mouse.click(step.x, step.y);
        }
        if (step.action === 'move') await page.mouse.move(step.x, step.y, { steps: step.steps ?? 1 });
        if (step.action === 'press') await page.keyboard.press(step.key);
        if (step.action === 'hold') {
          const keys = step.keys ?? [step.key];
          try { for (const key of keys) await page.keyboard.down(key); await page.waitForTimeout(step.ms ?? 500); }
          finally { for (const key of [...keys].reverse()) await page.keyboard.up(key); }
        }
        action.status = 'completed';
      } catch (error) { action.status = 'failed'; action.error = String(error); break; }
      finally { action.completedAt = now(); }
    }
    await recordCheckpoint('final');
  } catch (error) { report.infrastructureErrors.push({ message: String(error), at: now() }); }
  finally {
    for (const close of [() => context?.close(), () => browser?.close(), () => server?.close()]) {
      try { await close(); } catch (error) { report.infrastructureErrors.push({ message: String(error), phase: 'cleanup', at: now() }); }
    }
  }
  report.assertions = assertions.map((assertion) => gradeAssertion(assertion, report.checkpoints));
  const finalCanvas = report.checkpoints.final ?? report.checkpoints.loaded;
  const rendering = finalCanvas?.webgl?.filter((item) => item.connected && item.width > 0 && item.height > 0) ?? [];
  const consoleErrors = report.console.filter((item) => item.type === 'error');
  for (const entry of consoleErrors) {
    try {
      if (new URL(entry.location.url).pathname === '/favicon.ico' && entry.text.startsWith('Failed to load resource:')) {
        entry.excludedFromFailureReason = 'The automatic browser favicon request is not a game asset.';
      }
    } catch { /* Console entries without a source URL remain eligible failures. */ }
  }
  const gameConsoleErrors = consoleErrors.filter((item) => !item.excludedFromFailureReason);
  report.checks.push(
    { id: 'browser.canvas', required: true, status: finalCanvas ? finalCanvas.canvas.visible ? 'pass' : 'fail' : 'ungraded' },
    { id: 'browser.webgl-rendering', required: true,
      status: rendering.some((item) => item.draws > 0 && !item.contextLost) ? 'pass' : rendering.some((item) => item.instrumented) ? 'fail' : 'ungraded', observed: rendering },
    { id: 'browser.page-errors', required: true, status: page ? report.pageErrors.length ? 'fail' : 'pass' : 'ungraded', count: report.pageErrors.length },
    { id: 'browser.console-errors', required: testCase.failOnConsoleError !== false,
      status: page ? gameConsoleErrors.length ? 'fail' : 'pass' : 'ungraded',
      count: gameConsoleErrors.length, excludedCount: consoleErrors.length - gameConsoleErrors.length },
    { id: 'browser.input-replay', required: true,
      status: report.actions.some((action) => action.status === 'failed') ? 'fail' : report.actions.length === steps.length && page ? 'pass' : 'ungraded' },
  );
  report.reviews = [...(testCase.reviewCriteria ?? []), ...(stage.reviewCriteria ?? [])].map((criterion) => ({
    ...criterion, required: criterion.required !== false, status: 'ungraded',
    reason: 'Requires visual assessment of this run and referenced screenshots.', evidence: [], reviewer: null,
  }));
  report.visualChangeEvidence = Object.values(report.checkpoints).filter((item) => item.canvas?.screenshotSha256).map((item, index, all) => ({
    checkpoint: item.id, screenshot: item.canvas.screenshot,
    differsFromPriorCapture: index ? item.canvas.screenshotSha256 !== all[index - 1].canvas.screenshotSha256 : null,
    interpretation: 'Image bytes only; animation, camera motion and overlays can also cause change.',
  }));
  report.browserStatus = aggregate(report.checks.filter((item) => item.required));
  report.requestedBehaviorStatus = aggregate(report.assertions.filter((item) => item.required));
  report.visualReviewStatus = aggregate(report.reviews.filter((item) => item.required));
  report.status = report.infrastructureErrors.length && !report.checks.some((item) => item.status === 'fail') ? 'error'
    : aggregate([report.browserStatus, report.requestedBehaviorStatus, report.visualReviewStatus].map((status) => ({ status })));
  report.editRegression = compareReports(previous, report);
  if (stage.kind === 'edit' && !['fail', 'error'].includes(report.status)) {
    report.status = aggregate([{ status: report.status }, report.editRegression]);
  }
  report.completedAt = now();
  report.durationMs = Date.now() - started;
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function applyReview(report, review, previous = null) {
  if (review.runId !== report.runId || !review.reviewer) throw new Error('Review must identify the exact runId and reviewer.');
  const evidenceFiles = new Set(Object.values(report.checkpoints).flatMap((item) => [item.screenshot, item.canvas?.screenshot]).filter(Boolean));
  for (const criterion of report.reviews) {
    const assessment = review.criteria?.find((item) => item.id === criterion.id);
    if (!assessment) continue;
    if (!['pass', 'fail'].includes(assessment.status) || !assessment.reason?.trim() || !assessment.evidence?.length
      || !assessment.evidence.every((file) => evidenceFiles.has(file))) {
      throw new Error(`Review ${criterion.id} needs a decision, rationale and screenshot evidence from this run.`);
    }
    Object.assign(criterion, { status: assessment.status, reason: assessment.reason, evidence: assessment.evidence, reviewer: review.reviewer });
  }
  report.browserStatus = aggregate(report.checks.filter((item) => item.required));
  report.requestedBehaviorStatus = aggregate(report.assertions.filter((item) => item.required));
  report.visualReviewStatus = aggregate(report.reviews.filter((item) => item.required));
  if (previous) report.editRegression = compareReports(previous, report);
  report.status = report.infrastructureErrors.length && !report.checks.some((item) => item.status === 'fail') ? 'error'
    : aggregate([report.browserStatus, report.requestedBehaviorStatus, report.visualReviewStatus].map((status) => ({ status })));
  report.reviewedAt = now();
  if (report.kind === 'edit' && !['fail', 'error'].includes(report.status)) {
    report.status = aggregate([{ status: report.status }, report.editRegression]);
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw new Error('Arguments must be --name value pairs.');
    options[args[i].slice(2)] = args[i + 1];
  }
  const readJson = async (filename) => JSON.parse(await readFile(resolve(filename), 'utf8'));
  if (options['apply-review']) {
    const report = await applyReview(await readJson(options.report), await readJson(options['apply-review']),
      options.previous ? await readJson(options.previous) : null);
    await writeFile(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ runId: report.runId, status: report.status, report: resolve(options.report) }));
    return;
  }
  if (!options.manifest || !options.case || !options.output) {
    throw new Error('Usage: node benchmarks/evaluate.mjs --manifest cases.json --case coin-course --stage create --url URL [or --artifact DIR] --output DIR [--previous report.json] [--metadata metadata.json]');
  }
  const report = await evaluateGame({ manifest: await readJson(options.manifest), caseId: options.case,
    stageId: options.stage ?? 'create', url: options.url, artifact: options.artifact, outputDir: options.output,
    previous: options.previous ? await readJson(options.previous) : null,
    metadata: options.metadata ? await readJson(options.metadata) : {},
    launchOptions: { ...(options['browser-executable'] ? { executablePath: options['browser-executable'] } : {}),
      ...(options.headed === 'true' ? { headless: false } : {}) } });
  console.log(JSON.stringify({ runId: report.runId, status: report.status, browserStatus: report.browserStatus,
    requestedBehaviorStatus: report.requestedBehaviorStatus, report: resolve(options.output, 'report.json') }));
  if (['fail', 'error'].includes(report.status)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
}
