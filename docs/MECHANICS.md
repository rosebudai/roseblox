# Three.js mechanics adapter

Use normal Three.js scene, renderer, assets, lighting, UI and game rules. Import `createMechanics` from `./rosie/roseblox.js`. This module exports only `createMechanics`; it creates no scene, renderer, art or HUD. Keep the project's Three.js importmap. Rapier loads automatically. World +Y is up, -Z is forward, lengths are metres and times seconds.

## Integration and clock

```js
const mechanics = await createMechanics();
const player = await mechanics.addFpsPlayer({camera, canvas, position:[0,2,5], onFire:shoot});
startButton.onclick = () => player.start();
// In your one existing animation loop:
mechanics.advance(dt, {
  paused: !player.active,
  beforeStep: dt => updateEnemyMovement(dt),
  afterStep: dt => updateGameRules(dt),
});
updateVisuals(dt);
renderer.render(scene,camera); // Or your own composer.
```

The game creates and resizes its renderer/camera. Keep the FPS camera at the scene root; its pose belongs exclusively to the FPS controller. Add the camera to the scene so attached weapon models render. `advance(dt,options)` internally substeps physics at 1/60 seconds, limits stalled frames, then interpolates bindings and updates the camera. Call it once per rendered frame, before rendering. `beforeStep` sets desired actor movement; `afterStep` sees current simulation positions and contacts. Both callbacks receive fixed dt; run gameplay timers there. Presentation runs after `advance`. No second physics step or control system is needed.

`paused:true` freezes physics and fixed callbacks, clears held input on entry and prevents paused-time catch-up. Render menus normally while paused. `createMechanics({gravity:[0,-9.81,0],fixedTimeStep:1/60,maxSubSteps:8,maxFrameDelta:.25,interpolate:true})` permits overrides. `getDiagnostics()` reports bodies, contacts, frames, fixedSteps, simulatedSeconds, droppedSeconds and disposed. Call `mechanics.dispose()` on teardown; separately dispose your art, renderer, listeners and asset helpers.

## Bodies and visuals

`mechanics.addBody({type:'fixed',shape:{type:'box',size:[10,1,10]},position:[0,-.5,0],quaternion:[0,0,0,1],friction:.7,restitution:0,sensor:false,data:{}})` returns a body handle. Types: `fixed`, `dynamic`, `kinematic`. Shapes: `{type:'box',size:[x,y,z]}`, `{type:'sphere',radius:.5}`, `{type:'capsule',radius:.35,height:1.1}`. Capsule height is the cylindrical portion; full height adds two radii. Positions are collider centers. Match simple level colliders to the visible floors, walls, doors and substantial props. Bodies have no automatic visible meshes.

For a moving visible object: `const unbind = body.bindObject(meshOrGroup)`. Binding writes that root's pose after physics; put model-axis corrections, decorative offsets and animation on children. The scene owns the object and its resources. Binding never rescales collision from model bounds. `unbind()` releases that binding; `body.remove()` removes physics and releases its bindings without deleting your art. Remove the object's scene root yourself when removing an enemy. Hiding art alone leaves solid collision intact.

Handles expose `id`, mutable `data`, `removed`, and snapshot getters `position` (Three.Vector3), `quaternion` (Three.Quaternion), `grounded`. Getter snapshots are read-only inputs: changing them does not move the body. `body.teleport([x,y,z])` moves immediately, resets velocity and interpolation; character teleports apply their spawn clearance. `body.setRotation([x,y,z,w])` sets a quaternion. `body.setVelocity([x,y,z])` drives a dynamic body or character in metres/second. `body.moveTo([x,y,z],quaternion?)` moves a kinematic prop on the next step; use it for doors/platforms, not characters. Do not write a bound mesh root position every frame.

## FPS player and NPCs

`await mechanics.addFpsPlayer({camera,canvas,position:[0,2,5],radius:.35,height:1.1,speed:5,runSpeed:8,jumpSpeed:7,eyeOffset:[0,.55,0],sensitivity:.0023,yaw:0,pitch:0,onFire:shoot})` returns a body handle with FPS controls. WASD/arrows move relative to camera, Shift sprints, Space jumps, mouse looks without dragging, left click calls `onFire`. Keep on-foot jumping. The player has no visible body; a camera-held weapon is separate art. Spawn above the floor and keep the eye inside the capsule.

Call `player.start()` from a real Start click after essential assets load. It requests native pointer lock, with playable no-button mouse look/edge turning when capture is unavailable. `.active` is gameplay activity, `.locked` is native capture only, `.enabled` includes a paused round. Gate shooting, rules and simulation on `.active`. Escape, capture loss and window blur pause input; show your resume UI while enabled and inactive. A canvas click or repeated `start()` resumes without resetting aim. `stop()` ends a round; stop/reset/start begins with configured aim. `remove()` also releases camera/input ownership. Use one FPS owner per canvas/camera. `setAction('forward'|'backward'|'left'|'right'|'jump'|'run',true|false)` supplies optional touch/gamepad actions.

`mechanics.addCharacter({position,radius:.35,height:1.1,velocity:[0,0,0]})` creates an NPC capsule with the same grounded collision/gravity motor and no input/camera/AI. Supply world-space horizontal desired velocity with `setVelocity`, usually from `beforeStep`; set zero to stop walking. Gravity remains engine-owned. Choose routes and facing in game code. `spawnClearance` optionally overrides the small default spawn/reset offset; it does not rescue a body embedded deeply in geometry.

## Hits, line of sight and contacts

`mechanics.castRay(origin,direction,{maxDistance:100,exclude:player})` returns the nearest collider hit `{body,point,normal,distance}` or null. Vectors accept three-number arrays or Vector3. Solid world cover is included by default; `exclude` accepts a handle or array. Damage only when `hit.body.data` identifies a target. For shooting, obtain world origin/direction from the camera after its current look update. `mechanics.castSegment(from,to,{exclude:[source,target]})` tests line of sight/projectile travel up to the endpoint.

Queries use collider geometry, independent of art visibility. Use optional `bodies:[handles]` only when deliberately restricting the query; include cover when needed. Sensors are excluded unless `sensors:true`. Bodies/queries optionally accept Rapier-packed `collisionGroups` (16-bit membership then 16-bit filter). New bodies and teleports are queryable immediately without stepping time. Collider queries use current simulation poses; visual interpolation is presentation only. Normal Three.js raycasting remains available for exact visual surface effects.

`const off = mechanics.onCollision(({type,a,b})=>{})` reports `type:'start'|'end'` and body handles, including sensor entry/exit and character contacts. Use sensors for pickups, door zones or goals; rules and state transitions are your code. Removing a touching body ends its tracked contacts. `off()` unsubscribes. Advanced `mechanics.physics` exposes `{RAPIER,world}` for reading or specialized operations; adapter-owned bodies must be moved/removed through their handles. Never call `world.step` yourself.

## Optional camera-held model fitting

You can author weapon art directly with Three.js. For the existing projection-based fitting helper, import `createViewModels` from `./rosie/visuals.js`, then:

```js
const viewModels = createViewModels({camera});
const weapon = await viewModels.attach(modelUrl, {
  sourceForward:'long-axis', forwardHint:[0,0,1], framing:'held',
});
```

Call `viewModels.update(dt)` before rendering and `viewModels.dispose()` on teardown. The handle has `.mesh` for small recoil/sway and `.dispose()`. `sourceForward` can instead be a known authored direction vector; `sourceUp` defaults to `[0,1,0]`. Long-axis fitting aligns geometry but cannot recognize the muzzle: the hint chooses front/back. `rotation:[x,y,z]` is an additional authored offset in radians. Held framing defaults to `screenPosition:[.5,-.76]`, `screenSize:[.72,.9]`, `distance:.9`, with NDC screen coordinates; only the held bottom may extend to -1.35. Direction, alignment, size and placement are separate. Use the generated local model URL; models are static unless their metadata lists animation clips. The helper uses scene lighting and has no world collision.
