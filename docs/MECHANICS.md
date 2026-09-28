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

The game creates and resizes its renderer/camera. Keep the FPS camera at the scene root; its pose belongs exclusively to the FPS controller. Add the camera to the scene so attached weapon models render. `advance(dt,options)` internally substeps physics at 1/60 seconds, limits stalled frames, then interpolates bindings and updates the camera. Call it once per rendered frame, before rendering. Finite negative render deltas are treated as zero; NaN and infinity are rejected. `beforeStep` sets desired actor movement; `afterStep` sees current simulation positions and contacts. Both callbacks receive fixed dt; run gameplay timers there. Presentation runs after `advance`. No second physics step or control system is needed.

`paused:true` freezes physics and fixed callbacks, clears held input on entry and prevents paused-time catch-up. An enabled desktop controller that loses focus/capture also pauses the world automatically, including fixed callbacks. Reflect `player.enabled && !player.active` in the resume UI; gate timers outside fixed callbacks on `.active` too. Advanced hosts managing multiple input surfaces can set `autoPause:false`. `createMechanics({gravity:[0,-9.81,0],fixedTimeStep:1/60,maxSubSteps:8,maxFrameDelta:.25,maxCcdSubsteps:4,interpolate:true})` permits overrides. `getDiagnostics()` reports bodies, contacts, frames, fixedSteps, simulatedSeconds, droppedSeconds, negativeDeltaFrames and disposed. Call `mechanics.dispose()` on teardown; separately dispose your art, renderer, listeners and asset helpers.

## Bodies and visuals

`mechanics.addBody({type:'fixed',shape:{type:'box',size:[10,1,10]},position:[0,-.5,0],quaternion:[0,0,0,1],friction:.7,restitution:0,sensor:false,data:{}})` returns a body handle. Types: `fixed`, `dynamic`, `kinematic`. Shapes: `{type:'box',size:[x,y,z]}`, `{type:'sphere',radius:.5}`, `{type:'capsule',radius:.35,height:1.1}`. Capsule height is the cylindrical portion; full height adds two radii. Positions are collider centers. Match simple level colliders to the visible floors, walls, doors and substantial props. Bodies have no automatic visible meshes.

For a moving visible object: `const unbind = body.bindObject(meshOrGroup)`. Binding writes that root's pose after physics; put model-axis corrections, decorative offsets and animation on children. The scene owns the object and its resources. Binding never rescales collision from model bounds. `unbind()` releases that binding; `body.remove()` removes physics and releases its bindings without deleting your art. Remove the object's scene root yourself when removing an enemy. Hiding art alone leaves solid collision intact.

Handles expose `id`, mutable `data`, `removed`, and snapshot getters `position` (Three.Vector3), `quaternion` (Three.Quaternion), `grounded`. Getter snapshots are read-only inputs: changing them does not move the body. `body.teleport([x,y,z])` moves immediately, resets velocity and interpolation; character teleports apply their spawn clearance. `body.setRotation([x,y,z,w])` sets a quaternion. `body.setVelocity([x,y,z])` drives a dynamic body or character in metres/second. `body.moveTo([x,y,z],quaternion?)` moves a kinematic prop on the next step; use it for doors/platforms, not characters. Do not write a bound mesh root position every frame.

For an authored curved road, sloped terrain or rotated level mesh, use `mechanics.addStaticMesh(mesh,{surfaceUp:[0,1,0],data:{road:true}})` after its transform is final. It snapshots the mesh's triangles with parent transforms and scale, preserving the visible surface height. Use `surfaceUp:[0,1,0]` for open roads/terrain so double-sided art with downward triangles still supports vehicles from above. Omit it for closed meshes with outward winding. Keep the authored geometry; do not flatten roads into primitive tracks for the controller. Supply a simplified collision mesh for detailed scenery. Each call takes one static Mesh (indexed or nonindexed); animated/skinned/instanced meshes and partial draw ranges need a separate collision proxy. The returned fixed body has no visual binding. Later mesh edits require removing/recreating its collider. Normal box colliders remain suitable for simple walls.

## On-foot players and NPCs

`await mechanics.addFpsPlayer({camera,canvas,position:[0,2,5],radius:.35,height:1.1,speed:5,runSpeed:8,jumpSpeed:7,eyeOffset:[0,.55,0],sensitivity:.0023,yaw:0,pitch:0,onFire:shoot})` returns a body handle with FPS controls. WASD/arrows move relative to camera, Shift sprints, Space jumps, mouse looks without dragging, left click calls `onFire`. Keep on-foot jumping. The player has no visible body; a camera-held weapon is separate art. Spawn above the floor and keep the eye inside the capsule.

Call `player.start()` from a real Start click after essential assets load. It requests native pointer lock, with playable no-button mouse look/edge turning when capture is unavailable. `.active` is gameplay activity, `.locked` is native capture only, `.enabled` includes a paused round. Gate shooting, rules and simulation on `.active`. Escape, capture loss and window blur pause input; show your resume UI while enabled and inactive. A canvas click or repeated `start()` resumes without resetting aim. `stop()` ends a round; stop/reset/start begins with configured aim. `remove()` also releases camera/input ownership. Use one FPS owner per canvas/camera. `setAction('forward'|'backward'|'left'|'right'|'jump'|'run',true|false)` supplies optional touch/gamepad actions.

For third-person RPGs, use `await mechanics.addThirdPersonPlayer({camera,canvas,position:[0,2,5],speed:5,runSpeed:8,jumpSpeed:7,distance:6,targetOffset:[0,.6,0],onAttack:attack})`. It supplies WASD relative to the orbit, Shift run, Space jump, no-button mouse look, full horizontal orbit, broad vertical look and wheel zoom. `minDistance:2,maxDistance:14,yaw:0,pitch:.3,sensitivity:.0023` are optional. Pitch is camera elevation; positive is above the target. It has the same `start/stop/active/enabled/locked/setAction` lifecycle as FPS. Use this player API rather than rebuilding a drag camera on an NPC capsule.

Bind your hero root with `player.bindObject(heroRoot)`. The root faces camera-forward by default; `facing:'movement'` instead turns it only while moving. The default root forward axis is -Z; set `forwardAxis:'+Z'` for a +Z-facing asset. Correct any remaining model-axis offset on its child and place its feet at child Y=`-(height/2+radius)`. The camera retracts at world colliders and retains orbit on resume. `player.setMoveSpeed(walk,run=walk)` adjusts locomotion for stamina, blocking or a temporary dash without taking over gravity/input. Leave camera pose and player locomotion to this controller; combat, animation, inventory and quests stay in game code.

`mechanics.addCharacter({position,radius:.35,height:1.1,velocity:[0,0,0],jumpSpeed:7})` creates a generic capsule with the same grounded collision/gravity motor and no input/camera/AI. Supply world-space horizontal desired velocity with `setVelocity`, usually from `beforeStep`; set zero to stop walking. `character.jump()` queues one grounded jump and returns false while airborne or with `jumpSpeed:0`. Gravity remains engine-owned; do not implement jumping by repeatedly setting Y velocity. Routes and AI remain game code. Set `autoFaceMovement:true` to align the bound root with horizontal velocity; the default is false. `forwardAxis:'+Z'` (default) or `'-Z'` defines its local front. `character.faceDirection([x,y,z])` sets horizontal facing through the physics body; a zero direction retains heading. `spawnClearance` optionally overrides the small default spawn/reset offset; it does not rescue a body embedded deeply in geometry.

## Arcade racing

```js
const car = await mechanics.addArcadeVehicle({canvas, camera, position:[0,1,8], heading:0});
car.bindObject(carRoot); // Root origin is the chassis center; art is a child.
startButton.onclick = () => car.start();
// In the game's existing RAF, before rendering:
mechanics.advance(dt, {paused: !car.active, afterStep: updateRaceRules});
```

W/Up accelerates, S/Down brakes then reverses, A/D or arrows steer, Space drifts, R resets to the initial spawn, Escape pauses. Canvas click resumes; window blur pauses. Mouse lock is unnecessary. `start()` enables controls, `stop()` ends driving, `active` gates gameplay, and `enabled` remains true while waiting to resume. `reset(position?,heading?)` teleports, clears velocity/input and snaps the camera; supply `onReset:()=>car.reset(checkpointPosition,checkpointHeading)` to use that recovery on R too. Heading is yaw in radians, with zero facing world -Z.

The dynamic box stays upright, uses continuous collision detection, retains gravity/airborne momentum and computes drive from actual physics velocity. `speed` is signed metres/second and `grounded` reports road contact from four probes. Chassis `size` defaults to `[1.8,.8,3.6]`. Optional tuning: `maxSpeed:32, reverseSpeed:10, acceleration:16, braking:28, coast:2, steerRate:1.8, grip:9, driftGrip:1.8`. This supports flat tracks and gentle ramps; wheel suspension, banking and rollovers require specialized physics.

The optional camera trails the interpolated chassis, retracts against collider segments and uses `cameraDistance:7, cameraHeight:3.5, lookAhead:4`. Keep it at the scene root and let the controller own its pose. Omit `camera` to author a different camera. Omit `canvas` for AI/analog-only vehicles. `setControls({throttle,steer,brake,handbrake})` replaces the analog sample; throttle/steer range -1..1, brake 0..1, positive steering is right. Unspecified fields reset to zero. Call `start()` for AI vehicles too. Pause, stop, reset and focus loss clear held controls.

Author car models, wheel animations, tracks, checkpoint sensors, lap rules, opponents, sound and HUD in the game. The controller supplies no visual meshes or asset policy. Put a feet-normalized car model at child Y=`-size[1]/2`; correct its front to local -Z and scale it to the chassis on that child. Keep procedural details and generated model subjects appropriate to the game's art direction.

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
