# Open-world RPG mechanics

Import `{ createRpgWorld, fitRpgModel }` from `./rosie/roseblox.js`.
Use your own Three.js scene, renderer, models, terrain, lighting, HUD and RAF loop.
The module supplies physics and fitted characters; it creates no world art.

```js
const world = await createRpgWorld();
// Use the same placed mesh for visible terrain and collision.
world.addStaticMesh(terrainMesh);
const player = await world.addPlayer({
  camera, canvas: renderer.domElement, model: heroGltf.scene,
  feet: [0, 0, 0], height: 1.8, radius: .35, modelYaw: 0,
  speed: 5, runSpeed: 8, jumpSpeed: 6.25, distance: 6,
  onSelect: ({ hit }) => selectTarget(hit?.body ?? null),
});
scene.add(player.root);
playButton.onclick = () => player.start(); // real gesture, after essential assets load
const timer = new THREE.Timer();
renderer.setAnimationLoop(time => {
  timer.update(time);
  const dt = Math.max(0, timer.getDelta());
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

The default desktop controls use a free cursor: left click selects world objects,
left drag orbits without turning the character, hold right mouse and drag to turn the camera and character, wheel zooms, and Space
jumps. No pointer lock is requested. W/S move forward/back; A/D turn; Q/E strafe;
A/D also strafe while right mouse is held. Holding both mouse buttons walks forward.
Shift runs. `keyboardLayout:'orbit'` instead uses WASD movement and Q/E camera turn.
Keep Q/E for movement: use F for a selected-target interaction and number keys or
clickable action buttons for combat. Right mouse is camera control, not block/attack.
Escape, window focus loss and tab hiding pause; `start()` resumes the same view.
Show pause UI when `active` becomes false. Do not attach another input controller.

`onSelect({event,ray,hit})` runs on left-button release after a click, never an orbit
or drag. `hit` is the closest nonsensor physics hit (or null), excluding the player;
attach target identity with body `data`. `ray` is a Three.js world-space Ray through
the cursor; use it with your own Raycaster for visuals without colliders. Selection
is separate from interaction: show the selected target, then use game rules to
check reach, line of sight, talk or loot. For combat, query reach from the character
rather than requiring a selected enemy. Clicking HUD controls is handled
by your UI. For an explicitly requested captured-mouse action RPG, opt into
`controlMode:'pointer'`; only that mode binds left click to `onAttack`.

In MMO mode, right mouse aligns the character with the view; left orbit keeps
character heading independent. The default RPG jump uses gravity -20 and speed
6.25 for roughly one unit of rise, with horizontal steering throughout the jump.
Use `facing: 'movement'` for movement-facing. Player and NPC models use local +Z
forward, matching generated assets; `modelYaw: 0` needs no correction for +Z models.
Use `modelYaw` only for an asset with another forward axis. The camera
must be a scene-root PerspectiveCamera. Distance options: `distance`, `minDistance`
(default 2), `maxDistance` (14), initial `yaw`/`pitch` and `sensitivity`.

`feet` and `player.position` are world-space feet coordinates. The helper fits a
detached model to `height`, centers it and aligns its feet with the capsule. Add
`player.root` to the scene; never manually copy positions or rotate this root.
`player.visual` is an unscaled feet-origin group that follows the body. Add
independently fitted weapons to this group, then position/animate them in meters:
`const sword = fitRpgModel(swordGltf.scene, {height: .8, yaw: 0});
player.visual.add(sword); sword.position.set(-.45, .9, .3);`.
Do not parent equipment under the internally scaled hero model.

Player methods: `start()`, `stop()`, `pause()`, `resume()`, `jump()`, `teleport([x,y,z])` (feet),
`setMoveSpeed(walk,run)`, `remove()`. Getters: `active`, `locked`, `grounded`.
`setAction(name,down)` accepts `forward/backward/left/right/turnLeft/turnRight/run/jump`; use these
for authored touch controls. Author touch camera gestures if targeting mobile.
`player.body` is the underlying collider handle; use it in collision queries.

## NPCs and enemies

`const npc = world.addNpc({model: enemyGltf.scene, feet:[4,0,0], height:1.8});
scene.add(npc.root);`
Use the same total height, feet coordinates and +Z model convention as the player.
`npc.setVelocity([vx,0,vz])` handles movement-facing; zero velocity keeps heading.
`npc.faceDirection([dx,0,dz])` turns toward a direction. Set `autoFaceMovement:false`
for manual heading. Both turn the physics body and its bound visual together.
NPCs expose `body`, `root`, `visual`, `position`, `grounded`, `jump()`,
`teleport(feet)` and `remove()`. Animate children under `visual`; the engine owns
`root`. AI, combat, quests and interaction remain your game code.

## World contract

- `addBody({type:'fixed'|'dynamic'|'kinematic', position, shape, sensor, data})`:
  positions are collider centers; default type is fixed. Shapes: box `{type:'box',
  size:[x,y,z]}`, sphere `{type:'sphere',radius}`, capsule `{type:'capsule',radius,
  height}` (height is cylinder length). Use fixed bodies for buildings and stationary
  quest givers. Body handles expose `position`, `quaternion`, `data`, `bindObject(root)`,
  `teleport(center)`, `setRotation([x,y,z,w])`, `remove()`.
- `addStaticMesh(mesh,{data})`: fixed collider from existing triangle geometry and
  its current world transform, including indexed terrain. Call after placing it.
  Register each walkable surface, including raised terrain. Spawn feet above that
  surface so gravity can settle the actor. Surface winding must face outward/up.
  Collision is a snapshot: remove and recreate
  the body if geometry changes. Decorative plants/particles need no collider.
- `castRay(origin,direction,{maxDistance,exclude,bodies,sensors})` or
  `castSegment(from,to,{exclude,bodies,sensors})` returns null or
  `{body,point,normal,distance}`. Exclude `player.body`, not `player`. Sensors are
  ignored by default. Use collision for reach/line-of-sight, game rules for damage.
- `onCollision(({type,a,b}) => ...)` reports start/end transitions and returns an
  unsubscribe function. `a`/`b` are handles, with your `data` attached.
- Call `advance(dt,{paused,beforeStep,afterStep})` exactly once per rendered frame.
  Callbacks use seconds and fixed simulation steps. Pausing stops simulation and
  clears held input. Negative frame deltas advance zero time. `dispose()` releases
  physics/controls; dispose your art yourself.

Use normal generated models, surface textures and environment skyboxes. This API
does not prescribe a visual style, world layout, asset count or game-code budget.

Explicit `pause()` suspends controls, blocks canvas auto-resume and preserves the view.
Use `resume()` to release it. `start()` after `stop()` also preserves the camera;
create a new player to reset the view.

`queryMeleeTargets(origin, forward, candidates, {range:3, arc:Math.PI*2/3, visible})`
returns nearest-first candidates in a forward swing. Each candidate has a world-space
`position` vector; keep your actor reference alongside it. The optional `visible(candidate)`
callback applies your world ray query. Damage, enemy eligibility and effects remain
caller-owned. Use actor facing, not the independently orbiting camera.
