# Open-world RPG mechanics

Import `{ createRpgWorld, fitRpgModel }` from `./rosie/roseblox.js`.
Use your own Three.js scene, renderer, models, terrain, lighting, HUD and RAF loop.
The module supplies physics and one third-person player; it creates no world art.

```js
const world = await createRpgWorld();
// Keep visible terrain and collision aligned. Flat floor example:
world.addBody({ position: [0, -.5, 0], shape: { type: 'box', size: [200, 1, 200] } });
const player = await world.addPlayer({
  camera, canvas: renderer.domElement, model: heroGltf.scene,
  feet: [0, 0, 0], height: 1.8, radius: .35, modelYaw: 0,
  speed: 5, runSpeed: 8, jumpSpeed: 7, distance: 6,
  onAttack: () => attack(),
});
scene.add(player.root);
playButton.onclick = () => player.start(); // real gesture, after essential assets load
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  world.advance(dt, {
    paused: !player.active,
    beforeStep: step => updateEnemies(step),
    afterStep: step => updateCombatAndQuests(step),
  });
  if (player.active) updateEffects(dt);
  renderer.render(scene, camera);
});
```

## Player contract

WASD moves relative to the camera; Shift runs; Space jumps. Mouse movement orbits
freely, wheel zooms, left click calls `onAttack`. Pointer lock has a mouse-look
fallback. Escape, focus loss and tab hiding pause; `start()` resumes. Show your
pause UI when `active` becomes false. Do not attach another camera/input controller.

The character faces the camera heading by default, including while standing still.
Use `facing: 'movement'` only when that is the intended game design. `modelYaw`
corrects the asset's local forward axis in radians; world forward is -Z. The camera
must be a scene-root PerspectiveCamera. Distance options: `distance`, `minDistance`
(default 2), `maxDistance` (14), initial `yaw`/`pitch` and `sensitivity`.

`feet` and `player.position` are world-space feet coordinates. The helper fits a
detached model to `height`, centers it and aligns its feet with the capsule. Add
`player.root` to the scene; never manually copy positions or rotate this root.
`player.visual` is an unscaled feet-origin group that follows the body. Add
independently fitted weapons to this group, then position/animate them in meters:
`const sword = fitRpgModel(swordGltf.scene, {height: .8, yaw: 0});
player.visual.add(sword); sword.position.set(.45, .9, -.3);`.
Do not parent equipment under the internally scaled hero model.

Player methods: `start()`, `stop()`, `jump()`, `teleport([x,y,z])` (feet),
`setMoveSpeed(walk,run)`, `remove()`. Getters: `active`, `locked`, `grounded`.
`setAction(name,down)` accepts `forward/backward/left/right/run/jump`; use these
for authored touch controls. Author touch camera gestures if targeting mobile.
`player.body` is the underlying collider handle; use it in collision queries.

## World contract

- `addBody({type:'fixed'|'dynamic'|'kinematic', position, shape, sensor, data})`:
  positions are collider centers; default type is fixed. Shapes: box `{type:'box',
  size:[x,y,z]}`, sphere `{type:'sphere',radius}`, capsule `{type:'capsule',radius,
  height}` (height is cylinder length). Use fixed bodies for buildings and stationary
  quest givers. Body handles expose `position`, `quaternion`, `data`, `bindObject(root)`,
  `teleport(center)`, `setRotation([x,y,z,w])`, `remove()`.
- `addCharacter({position,radius,height,jumpSpeed})`: kinematic capsule for moving
  NPCs/enemies; `setVelocity([x,0,z])`, `jump()`, `grounded`. Put its fitted visual
  under an unscaled root, offset down by `height/2 + radius`, then `bindObject(root)`.
  AI, combat, animation, quests and interaction remain your game code.
- `addStaticMesh(mesh,{data})`: fixed collider from existing triangle geometry and
  its current world transform, including indexed terrain. Call after placing it.
  Surface winding must face outward/up. Collision is a snapshot: remove and recreate
  the body if geometry changes. Decorative plants/particles need no collider.
- `castRay(origin,direction,{maxDistance,exclude,bodies,sensors})` or
  `castSegment(from,to,{exclude,bodies,sensors})` returns null or
  `{body,point,normal,distance}`. Exclude `player.body`, not `player`. Sensors are
  ignored by default. Use collision for reach/line-of-sight, game rules for damage.
- `onCollision(({type,a,b}) => ...)` reports start/end transitions and returns an
  unsubscribe function. `a`/`b` are handles, with your `data` attached.
- Call `advance(dt,{paused,beforeStep,afterStep})` exactly once per rendered frame.
  Callbacks use seconds and fixed simulation steps. Pausing stops simulation and
  clears held input. `dispose()` releases physics/controls; dispose your art yourself.

Use normal generated models, surface textures and environment skyboxes. This API
does not prescribe a visual style, world layout, asset count or game-code budget.
