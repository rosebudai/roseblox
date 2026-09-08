# Roseblox browser game building blocks

Use Roseblox when the game needs 3D collision, gravity, a controllable character, or shared entity lifecycle. Render with imported models, ordinary Three.js primitives/materials, or the optional voxel kit; no aesthetic is required. It is optional: use ordinary Three.js for custom renderers or gameplay where physics would add needless complexity. Keep game rules and UI in your own small modules. The engine is provider independent and ordinary JavaScript; there is no model-specific syntax.

Import `createGame` from `./rosie/roseblox.js` (adjust the relative path from nested modules). Keep the starter's `three` and `three/` importmap entries. The engine shares that Three.js instance; Rapier loads from a pinned HTTPS module. No npm build is required in a generated game. Read this API guide first; the source remains available if a custom feature needs it. Do not paste or rewrite the library for ordinary gameplay edits.

```js
import { createGame } from './rosie/roseblox.js';
const game = await createGame({ canvas: document.querySelector('canvas') });
game.addBox({ name: 'ground', size: [30, 1, 30], position: [0, -0.5, 0], color: '#426b46' });
const player = game.addPlayer({ position: [0, 2, 4], speed: 5 });
game.followCamera(player);
game.onUpdate((dt) => {
  if (player.transform.position.y < -15) game.teleport(player, [0, 2, 4]);
});
window.addEventListener('pagehide', () => game.dispose(), { once: true });
```

World convention: metres, seconds, +Y up, forward -Z. Entity positions are their center. A capsule's full height is `height + 2 * radius`. Fixed simulation uses 1/60 second; game callbacks receive seconds. The engine owns the animation loop, render, physics step, input, and resize. Do not add a second `requestAnimationFrame` or physics step. Canvas dimensions follow its container; give the container a definite width/height. WebGL2 is required.

Keyboard input is scoped to the focused canvas. In your Start/Restart button handler call `canvas.focus()` after closing a menu; clicking the canvas also focuses it. `game.input.setAction('forward', true/false)` supplies virtual actions for custom touch controls. Clear virtual actions on pointer release/cancel. The engine clears held input on blur and stop.

The default follow camera supports mouse controls: drag with either left or right mouse button to orbit the player, and scroll to zoom. The camera keeps the chosen angle and distance as the player moves or respawns. With the default `cameraRelative:true`, forward movement follows the direction the camera faces. Show these controls in the game's instructions.

For a generated first-person gun or elongated held tool, use `await game.attachCameraModel(url, {sourceForward:"long-axis", framing:"held"})`. It measures diagonal geometry, then owns fitting and camera placement; no proxy entity is needed. If the authored forward direction is known, supply that exact vector instead. Raw Three.js camera art can still use `game.camera.add(object)`. Entity root poses come from `entity.transform`, so direct `entity.mesh.position` changes are overwritten during rendering.

## Environment and rendering

Choose `createGame({canvas, lighting:false, maxPixelRatio:1.5})` when authoring your own lights. `lighting:false` omits both automatic lights; otherwise the legacy ambient and shadowed directional light remain. `game.defaultLights` exposes their handles (null when omitted). High metalness needs usable reflections/fill. A directional light above a solid roof cannot light its interior through that roof. Use interior fill lights or appropriate deliberate non-shadow-casting decoration; emissive strips alone do not illuminate nearby faces.

For an actual generated skybox, use its returned local `code_reference`:

```js
await game.setEnvironment(skyboxCodeReference, { intensity: 0.8 });
await game.setBloom({ strength: 0.24, radius: 0.45, threshold: 1.4, exposure: 1.15 });
```

`setEnvironment(url,{background=true,lighting=true,intensity=1,backgroundIntensity=1,rotation=0})` loads an equirectangular image, sets SRGB/mapping/anisotropy, and uses it for the background and reflected lighting. Rotation is radians around Y. Show the sky through a real opening or outdoors; do not put an opaque wall across the intended vista. This does not create level geometry. Texture ownership stays with the game: replacement/`clearEnvironment()`/disposal releases it; concurrent or late superseded loads reject without attaching. Handle load failures and wait for essential art before enabling Start. Do not dispose the returned texture yourself. Custom surface textures and world labels can also use Three.js CanvasTexture/material maps; preserve their color space and own their lifecycle.

`await game.setBloom({strength=.24,radius=.45,threshold=1.4,exposure=1.15})` installs restrained bloom plus OutputPass and selects ACES tone mapping. Passes load only on request and resize/dispose with the game. Choose these values for the scene, rather than hiding unreadable lighting under stronger bloom. `game.setRenderPipeline(null)` removes postprocessing and restores direct rendering; tone mapping remains an explicit renderer setting. Do not call a second composer in `onFrame`.

For custom rendering, `game.setRenderPipeline({render(dt),resize(width,height,pixelRatio)?,dispose()?})` transfers one final render pipeline's ownership to the game. It replaces, resizes and disposes the previous pipeline. Dimensions are CSS pixels; use pixelRatio for render targets. The render callback follows camera/frame updates exactly once. Do not reuse a pipeline across games or independently dispose a transferred pipeline.

## Optional room lighting and constructed props

These presentation helpers are ordinary Three.js objects; game rules remain yours. Choose scene objects and their text from the requested setting. The examples demonstrate API usage, not required level content.

```js
import { createInteriorLighting } from './rosie/roseblox.js';
// Create the game with lighting:false; floor y=0, ceiling y=6.
const lights = createInteriorLighting(game, { center: [0,3,0], size: [20,6,24] });
```

`createInteriorLighting(game,{center=[0,3,0],size=[20,6,24],intensity=1,keyColor?,fillColor?,groundColor?,shadows=true})` puts a shadowed spotlight and unshadowed fill inside those room bounds, plus soft hemisphere illumination. Supply the actual interior dimensions in metres. Use one rig for the play space; hemisphere fill is global. This lights the geometry even under a roof, independently of skybox generation. The returned `{root,key,fill,ambient,dispose()}` exposes lights for tuning and is owned by game disposal. It does not change the camera, environment, tone mapping or default lights. Bloom remains an optional separate call. For outdoor scenes, author appropriate sun/sky lighting instead.

`createFramedBox(game,{size=[2.4,1.8,1.8],frameWidth?,color?,frameColor?,accent?,label='',...boxOptions})` returns a normal engine entity. The beveled body is inset; the twelve frame beams are exposed and instanced, not buried in the body. `size` is the full visual/collider extent; position is the center. `frameWidth` defaults to 8.5% of the shortest side and must be less than one third of it. Optional labels are short canvas textures (32 characters maximum) on the local +Z face. Ordinary box options such as body, position, material, friction and shadows work unchanged. Moderate material metalness keeps surfaces readable without requiring strong reflections. Customize the palette or use your own models/geometry for a different visual identity.

## Imported model appearances

Use the exact `code_reference` returned by the asset tool as the model URL. Generated GLBs are static textured models: move/turn/bob their entity or visual in code; do not assume they contain a rig or animation clips. Build terrain/levels in code and keep simple explicit colliders for imported objects.

```js
const player = game.addPlayer({ radius: 0.4, height: 1.2, position: [0, 1, 4] }); // full height 2m
const appearance = await game.attachModel(player, 'assets/models/character.glb', {
  height: 2, anchor: 'bottom', offset: [0, -1, 0], rotation: [0, Math.PI, 0],
}); // replace the example URL with the actual tool output; inspect facing before choosing yaw
game.followCamera(player);
// Existing movement, contact, game.teleport(player, ...) and game.remove(player) work unchanged.
// Optional: appearance.play('Idle') ONLY if appearance.clips includes that real clip name.
```

`await game.attachModel(entity,url,{height?,maxDimension?,anchor='center',rotation=[0,0,0],offset=[0,0,0],hideProxy=true,castShadow=true,receiveShadow=true,cameraVisual?})` adds an appearance beneath the existing entity root. Specify **height OR maxDimension**, in metres. The rotated authored hierarchy is uniformly fitted, then anchored at its bounding-box center (default), bottom-center, or unchanged origin (`anchor:false`), then offset in entity-local coordinates. Rotation is an XYZ Euler offset in radians; facing/feet are not inferred. Root/physics dimensions never change. Match the collider to the intended gameplay footprint, and inspect alignment. An unscaled entity root is assumed when selecting world-size values.

Returns `{mesh,bounds,clips,play(name,{loop=true}),stop(),dispose()}`. `mesh` is a Three Group for procedural visual offsets; `bounds` is its initial entity-local Box3 including offset, not a live collider. Clips advance in the engine's existing frame loop; `{loop:false}` holds the final pose. Static models have `clips:[]`. Materials are cloned per attachment, so traverse `appearance.mesh` to tint its meshes; geometry/textures are cached per game and must not be disposed or modified directly. Multiple calls coexist (body + weapon); dispose the previous handle explicitly to replace an appearance. `hideProxy` hides only the primitive's material, preserving children and root raycast hits, and restores the original material after the final hiding attachment is disposed. **Do not set `entity.mesh.visible=false` to hide its primitive: that hides the imported model too.** Leave the root visible; attachModel already hides the proxy. Deliberately hidden preloads remain hidden until you reveal their root. Avoid decorating the same proxy simultaneously with `kit.avatar`.

Entity removal, renderable replacement and game disposal clean up attachments, mixers and instance resources; a load that finishes after its owner is removed rejects without attaching. Handle failures with `try/catch` and keep loading/error UI honest. Cached geometry/textures remain until game disposal. Player/dynamic/kinematic model entities register for near-camera hiding automatically; use `cameraVisual:true` for other actors or `false` to opt out. This does not add detailed model collision or camera blockers: use the existing simple fixed boxes for walls/buildings. No DRACO/Meshopt/KTX2 decoder is configured; generated assets should use ordinary GLB, or supply a compatible custom loader for compressed external models.

A successful attachment to a caller-hidden root warns that its children remain hidden. This is advisory: intentional hidden preloads still need explicit activation. Engine-owned FPS body/near-camera hiding does not warn.

## Camera-held generated models

```js
const gun = await game.attachCameraModel(gunCodeReference, {
  sourceForward: "long-axis", sourceUp: [0, 1, 0], framing: "held",
  forwardHint: [0, 0, 1], // Chooses the +Z-facing end; an assumption unless authored facts confirm it.
});
// Hide during menus; show when entering play. No collider or addBox is needed.
gun.mesh.visible = false;
// In your Start/Restart handler: gun.mesh.visible = true; fps.start();
let recoil = 0; // Set to a small value such as .04 when firing.
game.onFrame(() => { gun.mesh.position.z = recoil; }); // Small model-local offset, starting at zero.
```

`sourceForward:"long-axis"` measures the dominant geometry axis in the plane perpendicular to `sourceUp` (default `[0,1,0]`). It integrates triangle surfaces, including the GLB's nested transforms and quantized vertices, so a diagonal barrel is aligned without an authored yaw guess. Use it for elongated guns and tools; a round or ambiguous shape requires an explicit vector. It assumes the model is upright along `sourceUp` and does not infer roll, pitch or a semantic muzzle.

`forwardHint` chooses which end of the measured axis is forward. Its default `[0,0,1]` chooses the end nearer +Z; a known +X-facing muzzle uses `[1,0,0]`, and a known backward-facing muzzle needs the corresponding negative hint. The returned `gun.orientation` records `sourceForward`, `sourceUp`, `elongation` (horizontal variance ratio) and `directionConfidence` (absolute cosine to the hint). A confidence near zero means the hint is nearly perpendicular and cannot reliably choose the muzzle end. Record unverified direction assumptions in project notes. Bounding dimensions and a narrow end do not identify a muzzle reliably.

For verified authored orientation, `sourceForward:[x,y,z]` supplies an exact direction **in the loaded GLB scene's coordinates**, from receiver to muzzle. The engine maps forward/up to camera `-Z`/`+Y`; vectors must have nonzero finite lengths and cannot be parallel. Nonperpendicular up is projected perpendicular to forward. Optional XYZ-Euler `rotation` adds a presentation offset in camera axes. Without `sourceForward`, `rotation` keeps its original behavior.

Do not add a second 90-degree yaw after source-axis alignment. Keep the generated weapon directed into the scene toward the aim vanishing point, with the rear/grip continuing below the view.

`attachCameraModel(url,{sourceForward?,sourceUp=[0,1,0],forwardHint=[0,0,1],rotation=[0,0,0],framing="contained",screenPosition?,screenSize?,distance=.9})` fits resting bounds after orientation. Coordinates are normalized: screen center `[0,0]`, right/bottom `[1,-1]`; size is full width/height in those units. Default `contained` framing uses center `[.52,-.52]`, size `[.76,.7]`, and requires the entire rectangle within `[-.96,.96]`. Choose `framing:"held"` for a weapon: its default center `[.5,-.76]` and size `[.72,.9]` intentionally extend the rear/grip below the screen. Only the bottom may extend outside, down to `-1.35`; side/top margins and near-plane protection remain. This is an allowed crop, not a guarantee that arbitrary art will cover every edge. Fitting accounts for perspective depth and the near plane and updates on aspect/FOV/zoom changes. Distance is in metres and increases if required by the near plane.

The returned `{mesh,bounds,clips,play,stop,dispose}` uses the same clip/material/cache ownership as `attachModel`, but has no world entity or collision. `mesh` is the model-local animation offset beneath an engine-owned placement group; its position starts at zero. Set visibility or small recoil offsets there, and let the helper control placement/scale. Large offsets or animated poses beyond the resting bounds can leave the fitted rectangle. It uses scene lighting, casts/receives no shadows, and remains depth-tested against world geometry. Await it before enabling Start. Manual disposal detaches only this instance; game disposal also cleans up, and late loads reject. Keep world enemy models on `attachModel`.

## Compact HUD for any style

Import `createHud` with `createGame` for responsive DOM readouts, status and Start/Restart without creating voxel scenery. Create it after the game mounts its canvas. Supply your game's title, objective, controls and reset callback:

```js
const hud = createHud(game, {
  title, objective, controls,
  preset: 'minimal',
  theme: { accent: '#efc877' },
  stats: { health: { label: 'Health', value: 100, position: 'bottom-left' } },
  onStart: resetGame, onRestart: resetGame,
});
hud.setStat('health', 88);
hud.setMessage(message); // transient feedback preserves outcome controls
// resetGame owns game state; gate rules before setting a won/lost outcome.
```

`stats` maps names to `{label,value,id?,position?}`; position is `panel` (default), `bottom-left` or `bottom-right`. values are strings or finite numbers, including zero. Readout IDs default to their names. Without `stats`, the legacy `scoreLabel:'Score'`/`setScore(value,total?)` readout is provided. `setScore` also works when an explicit `score` stat exists. `ids` customizes default `score,status,start,restart` IDs; every ID in one document must be unique. `status/start/restart` are reserved stat names.

Theme values are CSS strings scoped to this HUD: `font,text,accent,panel,border,borderWidth,radius,shadow,buttonBackground,buttonText,buttonBorder,buttonShadow,textShadow,titleShadow`. The default is a restrained system-font HUD; choose tokens to fit the game's art. No fonts/assets are downloaded. `crosshair:true` shows a centered cross only in `playing`; it does not aim or shoot. Labels/messages render as text, never HTML.

`preset:'minimal'` supplies transparent, unboxed monospace readouts with a warm accent, quiet play status, menu-only controls text and Restart shown on outcomes. Theme overrides still win. Use two or three relevant readouts, with health/ammo in the bottom corners; custom genre styling remains welcome. Omit the preset to retain the existing default. The preset changes presentation, not gameplay state or controls.

`hud.setState('ready'|'playing'|'won'|'lost',message?)` controls presentation only. Start/Restart run your callback synchronously, resume the engine and focus the canvas. Keep callbacks active during menus and own gameplay resets/pauses explicitly. `hud.elements` exposes `root,bar,objective,controls,status,message,start,restart,stats,slots` (named readout elements), plus `score`/`crosshair` when present. Set `elements.start.disabled=true` while essential art loads, and re-enable it on success. Use exposed elements or custom DOM for the information layout the genre needs. `hud.setMessage(text)` changes a separate transient message without changing state or the outcome text; `setState` clears it. Do not call `setState(playing)` merely to report mute, ammunition or hits. `hud.dispose()` removes its DOM/listeners; `game.dispose()` also cleans it up. Multiple HUDs require distinct IDs; they do not share theme or state.

## Optional voxel presentation

Import `createVoxelKit` alongside `createGame` for an original block-world style without asset downloads. It supplies pixel materials, warm lighting, layered solid ground, instanced scenery, animated characters and a compact game HUD. Use game code for enemies, aiming, health, timers, scoring and win conditions. This complete small setup renders before Start, enables movement on Start/Restart and disposes everything on exit:

```js
import { createGame, createVoxelKit } from './rosie/roseblox.js';
const game = await createGame({ canvas: document.querySelector('canvas') });
const kit = createVoxelKit(game, { theme: 'woodland', seed: 7 });
kit.ground({ size: [40, 2, 50], position: [0, -1, -10] });
kit.scatter('trees', { count: 30, bounds: [-18,18,-32,12], exclude: [-4,4,-30,12] });
kit.scatter('flowers', { count: 60 });
kit.scatter('clouds', { count: 10 });
const player = kit.avatar(game.addPlayer({ position: [0, 1.1, 4], speed: 5 }));
game.followCamera(player);
player.player.enabled = false;
let playing = false;
const hud = kit.hud({ title: 'YOUR GAME', objective: 'Explore the trail', onStart: reset, onRestart: reset });
function reset() {
  game.teleport(player, [0, 1.1, 4]);
  player.player.enabled = playing = true;
  hud.setScore(0); hud.setState('playing'); // Reset your enemies/timer here too.
}
game.onUpdate(dt => {
  if (!playing) return;
  if (player.transform.position.y < -15) game.teleport(player, [0, 1.1, 4]);
  // Real game rules here. On completion: playing=false;
  // player.player.enabled=false; hud.setState('won', 'You won');
});
window.addEventListener('pagehide', () => game.dispose(), { once: true });
```

- `createVoxelKit(game,{theme:'woodland'|'desert'|'snow',seed=1,lighting=true})`: one active kit per game. Themes affect palette and scenery; no gameplay is imposed.
- `kit.ground({size,position,color,...game.addBox options})`: returns an ordinary solid entity with layered visuals whose top matches its collider. Call repeatedly for platforms, hills or arenas. A `body:'none'` scenery apron uses a small material depth bias so a coplanar solid floor renders in front, without changing heights or physics. Multiple coplanar decorative grounds with the same bias can still overlap; avoid stacking them. `game.remove(entity)` releases each independently.
- `kit.scatter('trees'|'rocks'|'flowers'|'clouds',{count=24,bounds:[minX,maxX,minZ,maxZ],exclude:[minX,maxX,minZ,maxZ],cameraCollision})`: decorative scenery, no gameplay colliders. Trees block the follow camera by default; other kinds do not. Set `cameraCollision:false` to opt out. Trees/rocks/flowers sit on the highest kit ground beneath them; uncovered positions are skipped. Create grounds first. Scenery is static; regenerate it after moving/removing its ground. Returns `{object,count,dispose()}`; `count` is actual placements.
- `kit.blocks([{position:[x,y,z],size:[x,y,z],color}],{shadows=false,cameraCollision=false})`: custom instanced decoration, no gameplay colliders; set `cameraCollision:true` for scenery that should block the follow camera; returns `{object,dispose()}`. Use `game.addBox`/`kit.ground` for solid obstacles.
- `kit.avatar(entity,{color})`: returns the same entity, replacing its proxy appearance with an automatically walking block character. Its physics/controls remain unchanged. All kit avatars register for near-camera hiding during follow, including enemies; the kit removes that registration on disposal. Kit visuals hide the original proxy material; pass `color` when creating ground/pickups or call `kit.avatar(entity,{color})` again to change the character, rather than recoloring the hidden `entity.mesh.material`.
- `kit.pickup({position,style:'coin'|'crystal',color,name,data})`: returns a nonphysical animated entity. Detect collection by distance or `game.raycast({entities:targets})`, then `kit.burst(entity.transform.position)` and `game.remove(entity)`. No automatic scoring. For moving targets update `entity.transform.position`.
- `kit.hud({title,objective,scoreLabel='Score',controls,onStart,onRestart,ids})`: optional DOM HUD. `hud.setScore(value,total?)`, `hud.setState('ready'|'playing'|'won'|'lost',message?)`. Start/Restart invoke your reset callback and focus the canvas. Restart and status stay visible while playing. `ids` defaults to `{score:'score',status:'status',start:'start',restart:'restart'}`; use e.g. `scoreLabel:'Health',ids:{score:'health'}`. `hud.elements` exposes `root,bar,score,status,start,restart,objective,controls`; append a custom `#time`/`#health` element to `bar` and update its text for extra stats. Use unique IDs for multiple HUDs, or supply your own HTML. Never assume a fixed score goal.
- `kit.dispose()` removes its scenery, pickups, grounds and HUD, restores decorated avatars and prior lighting. Caller-owned players/enemies remain. `game.dispose()` also disposes its kit. Batch handles and HUDs may be disposed separately. Kit-owned resources are not shared between games.

Scatter bounds must contain existing kit ground **outside** the exclusion area. Check the returned `.count`: requesting a positive count that places nothing emits a warning; `count:0` stays silent. To surround a narrow trail, explicitly add broad scenery ground first. Use `body:'none'` only when this background should be visual rather than walkable:
```js
kit.ground({size:[32,1,40],position:[0,-1,-8],body:'none'}); // visual top at Y=-0.5
const trees = kit.scatter('trees',{count:34,bounds:[-15,15,-27,11],exclude:[-5,5,-24,9]});
// trees.count is the actual number placed; verify expected scenery is visible.
```

## First-person games

Use `game.firstPerson` for desktop FPS/horror eye-follow, aiming and mouse input. Native pointer lock is used when available; unsupported or denied hosts use no-button mouse look with continuous turning near the canvas edge. Default yaw0 faces forward **-Z**. The helper owns the camera and the player's input enable state; game rules must explicitly gate on `fps.active` so Escape pauses timers, enemies and damage:

```js
const player = game.addPlayer({ position: [0, 1, 6], radius: .35, height: 1.1 }); // Space jumps by default
const fps = game.firstPerson(player, { eyeOffset: [0, .55, 0], onFire: shoot });
startButton.onclick = () => { resetRound(); fps.start(); }; // trusted Start/Restart click
game.onUpdate(dt => {
  for (const enemy of enemies) if (enemy.character) enemy.character.enabled = fps.active;
  if (!fps.active) return;
  updateEnemiesAndTimer(dt);
});
function shoot() {
  // Called by an active left click in native or free-look mode; implement ammo/reload here.
  const hit = game.raycast({ entities: [...enemies, ...solidCover] });
  // Apply damage only when the closest hit is an enemy.
}
function finishRound() { fps.stop(); showOutcome(); }
```

`game.firstPerson(entity,{eyeOffset=[0,.55,0],sensitivity=.0023,yaw=0,pitch=0,hideBody=true,onFire?})` returns `{start(),stop(),dispose(),enabled,locked,active,error}`. Eye offset is from entity center in world axes; choose it within the player collider. `start()` enables a new round, resets configured aim, focuses the canvas and requests pointer lock. Escape or leaving the free-look canvas makes `.active=false`; the next canvas click resumes without shooting or resetting aim. Active left clicks call `onFire` in either native or free-look mode; keyboard actions such as reload stay in game code and should also check `.active`. Unsupported/denied pointer lock automatically falls back to no-button mouse look. `.locked` only reports native capture, so gate gameplay on `.active`, never `.locked`. Show a click-to-resume hint while `.enabled && !.active`. `stop()` disables play and releases this canvas's lock while retaining the eye camera for the outcome screen. Physics/rendering continue while inactive; only controlled movement and your active-gated rules pause.

The player's visual root is hidden during FPS ownership by default and its previous visibility restores on release; use `hideBody:false` only with your own first-person body presentation. Enemies stay visible. Do not add a competing mouse-look or camera callback. Calling `followCamera`, `releaseCamera`, another `firstPerson`, entity removal, or game/engine disposal releases this controller and restores prior player/control settings. `fps.dispose()` releases it independently. Camera-attached weapons/lights remain usable. For an unusual manual camera, the low-level ownership option below remains available.

## Scripted characters and line of sight

Use `game.addCharacter({position, radius, height})` for grounded enemies/NPCs that must stop or slide against scenery. It has a capsule/controller but no keyboard input or automatic camera/facing. Set `enemy.character.velocity` in world metres/second; the engine integrates it once per physics step and adds gravity. Use Y=0 for ordinary ground movement. `character.enabled=false` pauses desired motion while gravity continues; `grounded` reports floor contact. Set this flag from the active round/FPS state **before** an early return, or clear velocity when paused: stored velocity otherwise keeps moving the actor even if game rules return early. `game.teleport` clears desired velocity and accumulated gravity and adds the same one-time clearance as a player. Do not also write that actor's physical position or add a second movement controller.

```js
const enemy = game.addCharacter({position:[3,1,-6],radius:.4,height:1.2});
const art = await game.attachModel(enemy, creatureUrl, {height:2});
game.onUpdate(() => {
  if (!playing) { enemy.character.velocity.set(0,0,0); return; }
  const direction = player.transform.position.clone().sub(enemy.transform.position);
  direction.y = 0;
  enemy.character.velocity.copy(direction.normalize().multiplyScalar(2));
  // Turn the visual independently of its physics-owned root, if this model faces -Z.
  art.mesh.rotation.y = Math.atan2(-direction.x, -direction.z);
});
```

This supplies collision sliding, not pathfinding. Choose reachable patrol waypoints and pursuit routes in game code; a wall can stop an actor until its desired direction changes. Do not move `body:'none'` enemies through walls when the game requires solid collision.

For enemy sight or a projectile segment, use `game.raycastBetween(from,to,{entities:blockers})`. It checks the world-space segment, independent of the player's camera, and returns the closest visible mesh hit or `null`. Include the relevant wall/cover entities and omit the source/target actors for a clear-sight test. For example, `!game.raycastBetween(enemyEye,playerEye,{entities:solidCover})` means no listed cover lies between those points. Segment queries include mesh children, have no hits beyond the target endpoint, and return `null` for coincident endpoints. Hidden roots are excluded. This is a visual-geometry query; it does not create colliders or choose routes. `game.raycast({x,y,...})` remains a **camera-origin screen ray** for player aiming, not an enemy sight query.

## Surface materials

For a textured setting, choose a reusable palette of three or four distinct materials suited to the actual scene. Prioritize broad visible surfaces and material differences that help distinguish locations; use fewer when the scene has fewer surface types. Reuse materials across matching surfaces and use tint for minor color variations. Generate the palette early with a single `generate_assets` batch: `generation_kind:"texture_tile"`, `aspect_ratio:"1:1"`. Describe one seamless, opaque, edge-to-edge base-color material seen straight on under even lighting. Specify the material's detail scale and restrained wear; omit perspective, objects, borders, text and baked directional shadows. Keep surfaces moderately light so scene lighting can shade them. Use geometry for depth and lighting for shadows; an image map alone adds neither.

`await game.loadMaterial(code_reference, {repeat:[u,v], roughness:0.85, metalness:0, color:0xffffff})` returns a game-owned `THREE.MeshStandardMaterial`. It sets sRGB color, repeat wrapping, mipmapped filtering and renderer anisotropy. Repeated requests for one URL share its downloaded image while keeping separate texture sampling. Load it before adding the shapes that use it; shapes own independent copies. `game.dispose()` releases source materials and images, including late loads. An optional early `material.dispose()` leaves existing shape copies usable. Use a new material request for a differently sized surface; changing the source after shape creation does not update that shape.

Choose repeat counts from the visible face's dimensions divided by a tile's intended size in metres. A 24-by-32-metre floor using a 2-metre square tile needs `[12,16]`; a 32-by-7-metre wall needs `[16,3.5]`. Box top faces map X/Z, front/back map X/Y, and left/right map Z/Y. Orient wall segments consistently and keep repeat counts proportional, rather than stretching one tile across a room. This helper uses the mesh's UVs; it does not project textures or change collision.

```js
const [floorMaterial, wallMaterial] = await Promise.all([
  game.loadMaterial(floorCodeReference, {repeat:[12,16], roughness:0.88}),
  game.loadMaterial(wallCodeReference, {repeat:[16,3.5], roughness:0.8}),
]);
game.addBox({size:[24,0.5,32], position:[0,-0.25,0], material:floorMaterial});
game.addBox({size:[0.5,7,32], position:[12,3.5,0], material:wallMaterial});
```

## Public game API

- `await createGame({canvas, autoStart=true, gravity={x:0,y:-9.81,z:0}, fixedTimeStep=1/60, maxSubSteps=8, ...engineConfig})`: returns an independent game. Pass `autoStart:false` for manual `game.engine.update(seconds)` in tests.
- `game.addBox({name, size:[x,y,z], position:[x,y,z], color, body='fixed', sensor=false, friction=0.7, restitution=0, material, data})`.
- `game.addSphere({name, radius=0.5, position, color, body='fixed', ...})`. Body choices: `'fixed'`, `'dynamic'`, `'kinematic'`, `'none'`. Use `'none'` for decorative meshes and distance-based pickups; `'dynamic'` for falling/bouncing objects. A sensor has a collider but does not block motion.

Shape `material` accepts a `MeshStandardMaterial` parameter object or an actual Three.js Material (Basic, Standard, Shader, etc.). Instances retain their type and settings; the shape owns a clone, including independent texture wrappers with shared CPU image data. Shader uniform textures in arrays/plain structs are included. Removing a shape releases its copies, leaving caller materials/textures and other shapes usable. Live render-target textures require a caller-owned custom mesh and are rejected here; custom shader callbacks remain responsible for resources they allocate. Do not dispose shared source images or assume changing the caller's material changes existing shapes.
- `game.addPlayer({position=[0,2,0], radius=0.5, height=1, speed=5, runSpeed=8, jumpSpeed=7, cameraRelative=true, facing='camera', spawnClearance, ...})`: capsule character with collision, gravity, steps, WASD/arrows, Shift and Space. Retain default Space jumping for on-foot FPS/RPG games and list it in the controls; set `jumpSpeed:0` only when the requested design explicitly disables jumping. Full capsule height is `height + 2*radius`. Creation and player teleport add `spawnClearance` once to the requested Y (default about 0.033m at 60Hz/default gravity: controller skin + one gravity step + tolerance). This prevents a capsule placed exactly on a floor from sinking/sticking before play; it does not repair deeply embedded spawn positions. Retain the default for nominal spawn/reset coordinates where the capsule touches the floor. Set `spawnClearance:0` only when your coordinates already supply real geometric clearance above the floor, not merely to preserve an exact nominal Y. Change `player.player.speed`, `runSpeed`, `jumpSpeed`, `facing`, or `enabled` for upgrades/menus. Desktop controls only; use the existing mobile controls or custom input for touch.

Player facing rotates the physical root and all attached visuals around world Y, with local -Z forward. The default `facing:'camera'` follows the camera's horizontal look direction even while idle, strafing or backing up; camera pitch never tilts the character. Use `facing:'movement'` to turn toward travel and hold the last heading when idle, or `facing:'manual'` when game code owns rotation. These modes do not change camera controls or movement directions. Correct an imported model's forward axis once with `attachModel`'s local `rotation`; the engine preserves that correction while turning. Do not add a competing per-frame mesh rotation to an engine-controlled player.
- `game.followCamera(entity,{offset=[0,6,9],lookOffset=[0,0.5,0],mode='orbit'})`: follows the entity with mouse orbit/zoom. `offset` sets the initial camera position relative to the entity; `lookOffset` sets the tracked point. Player movement preserves the user's chosen angle and zoom. Panning is disabled during follow so the target stays on the entity. Use `mode:'fixed'` to lock the camera to the configured world offset and ignore mouse camera input. `game.releaseCamera()` or target removal restores the previous controls configuration. Fixed nonsensor shapes and voxel trees automatically shorten the camera distance when obstructed, restoring it as the path clears. The followed entity, actors, sensors and effects are excluded. If the camera enters or approaches the followed visual's world bounds, that mesh and its children temporarily hide; they restore when clear or follow ends. Previously hidden visuals stay hidden; materials and physics are unchanged. Use `cameraCollision:false` on fixed shapes to opt out. Keep the tracked point outside scenery; collision cannot repair a target embedded inside a wall. For custom FPS, use the exposed Three.js camera.
- `game.addCameraObstacle(mesh)`: registers a static Three.js Mesh/InstancedMesh for follow-camera collision only; returns an unregister callback. Call it before disposing custom scenery. Geometry/material ownership stays with the caller. No gameplay collider is created.
- `game.registerCameraVisual(entity)`: opt a custom actor into near-camera hiding while any follow target is active; returns an idempotent unregister callback. The followed entity and kit avatars are protected automatically. Only registered actor visuals hide; ordinary scenery and physics stay unchanged. Clear/release/removal/disposal restore prior visibility.
- `game.onUpdate((dt,game)=>{...})`: fixed-step game rules after physics; returns unsubscribe. Update HUD only when values change. Store scores/timers/enemies in game code, not the library. Use `game.onFrame((dt,game)=>{...})` for presentation/custom FPS camera changes after the built-in camera update, once per render.
- `game.teleport(entity,[x,y,z])`: moves both physics and visuals and clears velocity. Players/scripted characters add their configured one-time spawn clearance to Y; other entities use the exact position. Scripted characters also clear their desired velocity. Use for respawn/reset; writing `mesh.position` alone will be overwritten by physics.
- `game.remove(entity)`: removes the entity and immediately releases its mesh/physics resources, including while paused. Do not separately remove its Rapier body.
- `game.raycast({x=0,y=0,entities=[...game.world],maxDistance=Infinity})`: closest visible mesh intersection, or `null`. Coordinates are normalized screen coordinates; `(0,0)` is the center. Result includes `entity`, `point`, `distance`, and Three.js hit properties. Filter `entities` for your targets. For shooting, call from real click input and use ray hits, not a timer that increments score.
- `game.start()`, `game.stop()`, `game.dispose()`: resume, pause, release permanently. Create a new game after disposal. Dispose game-specific DOM listeners as well.
- `game.getDiagnostics()`: simulation timing, recorded errors, retained ECS query count, owned mesh/body/controller counts, and renderer memory counts where available. Counts describe tracked objects, not GPU bytes or a gameplay score.

Physics runs at a fixed step. Moving physical meshes and built-in follow/first-person cameras interpolate between the last two physics poses, adding at most one physics step of presentation delay. `.transform` and `.body` remain authoritative for game logic; raycasts use those poses and restore the displayed meshes afterward. Use `game.teleport` to reset the presentation history immediately. `createGame({interpolate:false})` displays the latest physics pose directly. Nonphysical objects remain directly controlled by their transforms.

`game.engine.on('collision-started', ({entityA,entityB}) => ...)` and `'collision-ended'` report one transition per entity pair, combining Rapier contacts and computed character-controller contacts. Sensors use Rapier intersection events. Legacy sphere trigger zones emit `trigger-exited` when an actor or its detector/transform is removed, or when the zone leaves its query; disposal clears membership without firing gameplay callbacks.

For a manual FPS camera, call `game.releaseCamera()` and set `game.controls.enabled=false`; then assign the camera position/rotation directly or in `onFrame`. With no active follow target, disabled controls no longer overwrite that pose. Follow modes still update their camera, including fixed mode. For scripted camera-controls transitions, keep controls enabled and disable input bindings with `game.controls.constructor.ACTION.NONE` on `mouseButtons`/`touches`; restore the bindings afterward. FPS canvas clicks while unlocked should request pointer lock and return without shooting; once locked, clicks shoot. Handle Escape and lock failure so the next canvas click can resume the current round without resetting it.

Entities expose `.name`, `.data`, `.transform.position` (THREE.Vector3), `.transform.rotation` (Quaternion), `.transform.quaternion` (Three.js-compatible alias of that same rotation), `.mesh` (THREE.Mesh), and `.body` (Rapier rigid body, unless body is `'none'`). Physical entities expose `.physicsBody.collider` (Rapier Collider). A player also has `.player` control settings and `.physicsBody.controller`. Nonphysical poses should update `.transform.position` and `.transform.quaternion` or `.rotation`, not only the mesh; physics owns physical entity poses, including both quaternion aliases. Use `entity.mesh.material.color.set(...)` to edit appearance. The game exposes `.scene`, `.renderer`, `.camera`, `.controls`, `.physics` (`world` and `RAPIER`), `.input`, `.world` (Miniplex), and `.engine` for advanced features.

For sustained physical contact, query the actual colliders in `onUpdate` after physics:
```js
const contact = player.physicsBody.collider.contactCollider(enemy.physicsBody.collider, 0.08);
```
This returns contact details or `null` when separated by more than 0.08m. It handles rotated shapes. The character controller keeps a 0.02m skin, and moving surfaces can produce additional separation per physics step: use a small tolerance suited to your speed/timestep, then verify sustained contact in play. For example, a 1.5m/s kinematic enemy at 60Hz can push an idle player while leaving a roughly 0.054m gap, so 0.04m misses it. For overlap-only hazards that should not push the player, use a sensor collider. Use queries only while both entities exist; body `'none'` has no collider. Gate damage on active play and a cooldown in seconds, keep health bounded, and reset the cooldown on restart.

## Edits and validation

Keep the engine module stable across edits. Change the game's configuration and feature modules, preserving unrelated mechanics. New controls must keep focus/blur and mobile behavior intentional. Before calling a game complete, load the actual preview, check console/import errors, press the documented controls, perform the core action, and exercise the requested win/lose/restart loop. After an edit, repeat previously working actions and verify the new behavior. A successful build or moving screenshot is not proof of a playable game.

The low-level API remains available: `createEngine()`, `GameSystems`, legacy singleton `engine`, and `CoreComponents`. It uses resource factories, dependency-resolved setup callbacks, and systems with `phase:'fixed'|'frame'`. Prefer a new engine instance per preview. Use raw Three.js/Rapier APIs when the compact helpers do not fit; do not invent undocumented Roseblox methods.
