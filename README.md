# Roseblox

A small JavaScript engine for browser 3D games, built on Three.js, Rapier, Miniplex and camera-controls. Roseblox supplies reusable physics, input, entity lifecycle and camera building blocks while leaving game rules in ordinary JavaScript modules that a person or model can edit.

This development version modernizes the 2025 engine. It retains `engine`, `CoreComponents`, resource/setup/system registration and direct access to the underlying libraries. New games can use the smaller `createGame` API; multiple previews should use independent instances.

## Current RPG template experiment

The current Playground experiment selects a specialized foundation only for new
single-player desktop open-world 3D RPGs. Other genres and existing games keep
their existing path. The generic mechanics library remains separately useful.

`createRpgGame` from `roseblox-game-engine/rpg-template` owns the application loop,
classic WoW controls, selection, dialogue and scoped pause, quests, inventory,
combat, recovery and a skinnable HUD. Generated code authors assets, Three.js
world construction, content and the theme. See [the authoring API](docs/RPG_TEMPLATE.md)
and [the engineering fixture](examples/rpg-template/index.html).

Build inside the workstation with `npm run build`, then explicitly package the
RPG template with `node scripts/sync-rpg-template.mjs /workspace/PlaygroundGatewayV2`.
This verifies build hashes and writes a separate `rpg_template` package; it does
not replace the historical adapter-only comparison bundle. The Gateway protects
managed runtime and boot files from generation/edit tools. This remains an
experiment, not a production rollout.

## Earlier full-engine API

The accompanying Gateway integration supplies `rosie/roseblox.js` and `rosie/ROSEBLOX.md` to Playground's 3D projects. The compact guide is included in agentic model context for creation and follow-up edits while the engine and guide remain present. Engine implementation source is available on demand. Import the module and retain the starter's Three.js importmap. The complete compact API contract is in [docs/ROSEBLOX.md](docs/ROSEBLOX.md).

```js
import { createGame } from './rosie/roseblox.js';

const game = await createGame({ canvas: document.querySelector('canvas') });
game.addBox({ size: [30, 1, 30], position: [0, -0.5, 0], color: '#72a77c' });
const player = game.addPlayer({ position: [0, 2, 4], speed: 5 });
game.followCamera(player);
game.onUpdate(() => {
  if (player.transform.position.y < -15) game.teleport(player, [0, 2, 4]);
});
window.addEventListener('pagehide', () => game.dispose(), { once: true });
```

`followCamera` lets players drag with either mouse button to orbit and scroll to zoom while following the character. It preserves their angle and distance during movement. Use `game.followCamera(player, { mode: 'fixed' })` when the game needs a locked world-offset view. Releasing the camera or removing its target restores the prior controls configuration.

For generated or retrieved GLB art, `await game.attachModel(entity, assetUrl, {height: 2})` fits an appearance to an existing movement/collision owner. It preserves textures, supports clips that actually exist in the file, and handles independent instances and asynchronous cleanup. Static models remain static; game code can move and turn the whole actor. Choose each game's materials, lighting and asset prompts to match its requested style.

For large walls and floors, `await game.loadMaterial(textureUrl, {repeat:[12,16]})` loads an owned, repeating base-color material with sRGB color and anisotropic filtering. Set repeats from the surface dimensions and intended tile size, then pass the result as a shape's `material`. Image downloads are shared; material sampling and disposal stay independent. The guide includes a two-surface setup using generated `texture_tile` assets.

`game.firstPerson(player, {onFire})` owns desktop eye-follow, pointer look, lock and pause/resume. `game.addCharacter` supplies input-independent grounded NPCs driven by world-space velocity with capsule collision. `game.raycastBetween` checks world-space sight or projectile segments independently of the player's camera. These helpers leave combat, routes and objectives in game code.

For generated first-person weapons, `game.attachCameraModel(url, {sourceForward:"long-axis", framing:"held"})` measures the horizontal geometry axis and allows a bounded bottom crop for the rear/grip. A `forwardHint` chooses the muzzle end; its default +Z is an assumption, and the returned orientation metadata exposes weak direction hints. Known authored directions can still use an exact `sourceForward` vector. Contained framing remains the default for general props. Placement refits after projection changes and shares the existing asset cache and disposal contract. Keep game-specific recoil in game code.

Import standalone `createHud` for themed readouts, controls, Start/Restart and an optional crosshair. Named stats and visual tokens support different genres without repeating HTML/CSS; the HUD owns presentation while callbacks own game state and resets.

For native block-world visuals, import optional `createVoxelKit`. It provides three themed palettes, layered solid platforms, instanced trees/rocks/flowers/clouds, animated block avatars, decorative pickups, pooled effects and an adaptable pixel HUD. Game rules remain in caller code. See the complete setup/reset example in the [API guide](docs/ROSEBLOX.md) and the small playable [voxel example](examples/voxel/main.js). Kit resources are scoped to the owning game and also support manual disposal.

For a standalone page, use `build/roseblox.js` and an importmap:

```html
<script type="importmap">
{"imports":{
  "three":"https://esm.sh/three@0.184.0",
  "three/":"https://esm.sh/three@0.184.0/"
}}
</script>
```

The browser build bundles the engine, Miniplex and camera-controls. It shares your Three.js instance and imports pinned Rapier 0.20.0 from HTTPS. The readable engine stays small enough for source inspection and Playground's validator; Rapier's inline WebAssembly is not copied into the model's project files. CDN access is required on first load.

## Lifecycle and timing

`createGame()` and `createEngine()` produce independent instances. `start()` is idempotent, `stop()` pauses without accumulating elapsed time, and `dispose()` releases listeners, graphics and physics resources permanently. Initialize with `autoStart:false` to drive `engine.update(seconds)` manually.

Simulation and gameplay run at 60 fixed steps per second by default. Frame callbacks handle presentation; `maxSubSteps` bounds catch-up after stalls. Core dependency failures fail initialization with an actionable error. Runtime errors stop the game and are recorded in `getDiagnostics()`; `errorMode:'continue'` explicitly disables a failing system and continues. Diagnostics help debugging but do not establish gameplay quality.

Low-level systems accept `phase:'fixed'|'frame'` and priority. Existing callbacks default to fixed simulation. Use frame phase for presentation-only work. Resource factories may declare dependencies; setup callbacks wait for resources produced by other setups. See source for the full low-level API.

## Development

For Rosebud workspace work, install dependencies and run code in the selected workstation. Host-side edits and Git inspection are supported.

```sh
npm ci
npm test
npm run build
python -m http.server 8893
```

Open `/examples/modern/` for Meadow Run, a small playable demonstration of the compact API. `/examples/getting-started/` and `/examples/adventure/` retain the original ECS examples. The build writes `roseblox-game-engine.js` as a compatibility filename for existing template symlinks.

Run browser checks in a Chromium-capable workstation:

```sh
node tests/game-browser.mjs http://127.0.0.1:8893/examples/modern/ /tmp/roseblox-browser-evidence
node tests/camera-browser.mjs http://127.0.0.1:8893 /tmp/roseblox-camera-evidence
node tests/hud-browser.mjs http://127.0.0.1:8893 /tmp/roseblox-hud-evidence
node --test benchmarks/evaluate.test.mjs benchmarks/visible-text.test.mjs
```

The example test checks real movement, collection, win, restart, jump, fixed-step behavior and disposal. The benchmark runner under `benchmarks/` captures independent browser evidence for generated games and separates load success, requested behavior, and visual review. Missing evidence remains ungraded.

## Playground packaging

After building, copy the verified module and guide to Gateway:

```sh
node scripts/sync-playground.mjs /workspace/PlaygroundGatewayV2
```

The generated manifest records the source commit, whether the source was dirty, dependency versions and file hashes. Rebuild and resync after every engine/guide change. The source revision alone does not identify an uncommitted build; compare the recorded hashes. The integration makes Roseblox available to 3D creates and retains it in revisions for normal follow-up edits. Benchmark baseline runs can disable this injection per evaluation context.

The evaluation harness selects Rosie through the application's route: configured Sol for creation and Luna for edits, with execution metadata retained for verification. A September 5, 2026 local pilot collected four creates and eight edits with optional library discovery; neither treatment project used the engine. After the guide was supplied directly in agentic context, a separate coin-course episode used Roseblox in its create and both edits. Creation and restart passed the requested input checks; the night edit failed the frozen timing check in software-rendered Chromium, while a separate longer traversal completed the win/restart loop. This small sample verifies integration and identifies a performance concern; it does not establish a population-wide improvement or quality on other models. Engine APIs remain provider independent.

## Browser support

Modern browsers with ES modules, importmaps and WebGL2. Input helpers currently target keyboard/mouse. Existing Rosie touch controls or custom game input can supply mobile behavior. Advanced FPS cameras and genre-specific controls can use raw Three.js/camera-controls/Rapier APIs.

MIT. Original engine © 2025 Mike Liu. See [LICENSE](LICENSE).
