import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://127.0.0.1:8893';
const output = process.argv[3] ?? '/tmp/roseblox-voxel-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 740 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(`${base}/examples/voxel/`);
  await page.waitForFunction(() => window.voxelExample?.game.getDiagnostics().frames > 2, { timeout: 60000 });
  await page.screenshot({ path: `${output}/ready.png` });
  const scene = await page.evaluate(() => {
    const { game } = window.voxelExample;
    const sun = game.scene.getObjectByName('Roseblox voxel scenery').children.find(child => child.isDirectionalLight);
    return { calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, shadowProjection: sun.shadow.camera.projectionMatrix.elements[0], instances: game.scene.getObjectByName('Roseblox voxel scenery').children.filter(child => child.isInstancedMesh).reduce((sum, child) => sum + child.count, 0) };
  });
  assert.ok(scene.calls < 60, `Scenery uses too many draw calls: ${scene.calls}`);
  assert.ok(scene.instances > 400, 'Demo did not create substantial instanced scenery');
  assert.ok(Math.abs(scene.shadowProjection - 1 / 28) < 1e-9, 'Directional shadow projection does not cover the landscape');
  results.push({ name: 'substantial landscape uses bounded draw calls and full terrain shadow projection', status: 'pass', detail: scene });
  await page.locator('#start').click();
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'CANVAS');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.voxelExample.player.transform.position.z < 0, { timeout: 10000 });
  const walking = await page.evaluate(() => window.voxelExample.player.mesh.children[0].children.some(child => child.isGroup && Math.abs(child.rotation.x) > 0.01));
  assert.ok(walking, 'Real keyboard movement did not animate avatar limbs');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'You won', { timeout: 15000 });
  await page.keyboard.up('w');
  assert.ok(await page.locator('#restart').isVisible());
  assert.equal(await page.locator('#score').textContent(), 'Score: 3 / 3');
  await page.screenshot({ path: `${output}/won.png` });
  await page.locator('#restart').click();
  assert.equal(await page.locator('#score').textContent(), 'Score: 0 / 3');
  assert.equal(await page.evaluate(() => window.voxelExample.coins.length), 3);
  assert.ok(await page.locator('#restart').isVisible(), 'Restart is inaccessible during play');
  await page.evaluate(() => window.voxelExample.hud.setState('playing', 'Miss'));
  assert.ok(await page.locator('#status').isVisible());
  assert.equal(await page.locator('#status').textContent(), 'Miss');
  results.push({ name: 'real Start, keyboard movement/walk animation, collection, visible win, reset and play feedback', status: 'pass' });
  await page.evaluate(() => {
    window.voxelExample.hud.elements.objective.textContent = 'Defend the woodland, find every hidden treasure and survive until the timer reaches zero';
    window.voxelExample.hud.setState('playing', 'You survived');
  });
  for (const viewport of [{ width: 640, height: 480 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => document.querySelector('canvas').clientWidth <= innerWidth);
    const separation = await page.evaluate(() => {
      const bar = document.querySelector('.rb-bar').getBoundingClientRect();
      const feedback = document.querySelector('.rb-feedback').getBoundingClientRect();
      return { right: bar.right, left: feedback.left, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(separation.right <= separation.left && !separation.overflow, `HUD overlaps at ${viewport.width}px: ${JSON.stringify(separation)}`);
    await page.screenshot({ path: `${output}/hud-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1100, height: 740 });
  results.push({ name: 'long objective and survival feedback fit 640px and 360px viewports without HUD overlap', status: 'pass' });

  const lifecycle = await page.evaluate(async () => {
    const { createGame, createVoxelKit } = await import('/build/roseblox.js');
    const THREE = await import('three');
    window.voxelExample.game.dispose();
    const game = await createGame({ canvas: document.querySelector('canvas'), autoStart: false });
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const check = (name, callback) => { const detail = callback(); return { name, status: 'pass', detail }; };
    const checks = [];
    const originalBackground = game.scene.background;
    const originalLights = game.scene.children.filter(child => child.isLight).map(light => [light, light.visible]);
    const player = game.addPlayer({ position: [0, 2, 0] });
    const originalMaterial = player.mesh.material;
    const other = game.addBox({ body: 'none', position: [7, 2, 0] });
    other.mesh.material.dispose();
    other.mesh.material = originalMaterial;
    const kit = createVoxelKit(game, { seed: 3 });
    const secondContainer = document.createElement('div');
    secondContainer.style.cssText = 'position:absolute;width:200px;height:150px;left:0;bottom:0';
    const secondCanvas = document.createElement('canvas'); secondContainer.append(secondCanvas); document.body.append(secondContainer);
    const otherGame = await createGame({ canvas: secondCanvas, autoStart: false });
    const otherKit = createVoxelKit(otherGame, { theme: 'snow' });
    const otherGround = otherKit.ground();
    const otherVisual = otherGround.mesh.children[0];
    let otherReleases = 0;
    otherVisual.geometry.addEventListener('dispose', () => otherReleases++);
    const first = kit.ground({ size: [8, 2, 8], position: [-6, -1, 0] });
    const second = kit.ground({ size: [8, 2, 8], position: [6, 2, 0] });
    checks.push(check('scenery samples separate ground elevations and skips uncovered space', () => {
      const trees = kit.scatter('trees', { count: 30, bounds: [-10, 10, -4, 4] });
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      let left = 0, right = 0;
      for (let index = 0; index < trees.object.count; index += 3) {
        trees.object.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale);
        const top = position.x < 0 ? 0 : 3;
        expect(Math.abs(position.y - scale.y / 2 - top) < 1e-5, 'Tree base floats or intersects terrain');
        expect(Math.abs(position.x) >= 2, 'Tree spawned without underlying terrain');
        position.x < 0 ? left++ : right++;
      }
      expect(left && right, 'Did not sample both platforms');
      expect(kit.scatter('flowers', { count: 0 }).object.count === 0, 'Empty batch failed');
      return { left, right };
    }));
    checks.push(check('independent terrain/pickup removals release all instance and texture resources once', () => {
      const a = kit.pickup(), b = kit.pickup({ style: 'crystal' });
      const watched = [first.mesh.children[0], a.mesh.children[0]];
      const counts = [];
      for (const mesh of watched) for (const resource of [mesh, mesh.geometry, mesh.material, mesh.material.map].filter(Boolean)) {
        const item = { releases: 0 }; counts.push(item); resource.addEventListener('dispose', () => item.releases++);
      }
      let siblingDisposals = 0;
      for (const mesh of [second.mesh.children[0], b.mesh.children[0]]) mesh.geometry.addEventListener('dispose', () => siblingDisposals++);
      game.remove(first); game.remove(a);
      expect(counts.every(item => item.releases === 1), 'Removed visuals leaked or double disposed a resource');
      expect(siblingDisposals === 0 && game.world.has(second) && game.world.has(b), 'Removal disposed another entity');
      game.engine.update(1 / 60);
      return { resourcesReleased: counts.length };
    }));
    checks.push(check('avatar preserves shared material visibility and manual kit disposal restores player and scene', () => {
      kit.avatar(player);
      expect(originalMaterial.visible && other.mesh.material.visible, 'Avatar hid a shared material');
      let oldAvatarDisposals = 0;
      player.mesh.children[0].children[0].geometry.addEventListener('dispose', () => oldAvatarDisposals++);
      kit.avatar(player, { color: '#ff0000' });
      expect(oldAvatarDisposals === 1, 'Replacing avatar leaked old geometry');
      kit.dispose(); kit.dispose();
      expect(player.mesh.material === originalMaterial && originalMaterial.visible, 'Original player material was not restored');
      expect(game.world.has(player) && game.world.has(other) && !game.world.has(second), 'Kit disposal removed caller entities or retained its own');
      expect(game.scene.background === originalBackground && originalLights.every(([light, visible]) => light.visible === visible), 'Scene lighting was not restored');
      expect(game.scene.getObjectByName('Roseblox voxel scenery') === undefined, 'Scenery group survived disposal');
      expect(otherGame.world.has(otherGround) && otherReleases === 0 && otherVisual.parent === otherGround.mesh, 'Kit disposal damaged the other game');
      otherGame.engine.update(1 / 60);
    }));
    const recreated = createVoxelKit(game, { theme: 'snow' });
    checks.push(check('HUD supports custom health IDs, extra timer DOM and repeat theme lifecycle without resource growth', () => {
      const hud = recreated.hud({ scoreLabel: 'Health', ids: { score: 'health' } });
      hud.setScore(3);
      const timer = document.createElement('div'); timer.id = 'time'; timer.textContent = 'Time: 30'; hud.elements.bar.append(timer);
      expect(document.querySelector('#health').textContent === 'Health: 3', 'Custom health field is wrong');
      expect(document.querySelector('#time').textContent === 'Time: 30', 'Custom timer is missing');
      const resourceCount = game.engine.resources.size;
      recreated.dispose();
      expect(!document.querySelector('#health') && !document.querySelector('#time'), 'HUD elements leaked');
      const finalKit = createVoxelKit(game, { theme: 'desert' });
      expect(game.engine.resources.size === resourceCount, 'Repeated kits grow engine resource registrations');
      finalKit.ground(); finalKit.avatar(player); finalKit.pickup(); finalKit.hud();
      game.dispose(); game.dispose();
      expect(!document.querySelector('.rb-voxel-hud'), 'Game disposal leaked HUD');
      expect(game.getDiagnostics().errorCount === 0, 'Game disposal raised engine errors');
    }));
    otherGame.dispose(); secondContainer.remove();
    expect(otherReleases === 1, 'Independent game did not release its own geometry');
    return checks;
  });
  results.push(...lifecycle);
  const report = { status: errors.length ? 'fail' : 'pass', results, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.status, 'pass');
} catch (error) {
  await writeFile(`${output}/result.json`, JSON.stringify({ status: 'fail', results, errors, failure: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }
