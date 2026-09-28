# Rosie character controls

`/rosie/roseblox.js` gives a 3D game a working base for its player: physics, collision,
movement, jump, third- or first-person camera, pointer lock, pause, and on-screen touch
controls. Start from it for a player that walks, runs or jumps, then build on it: tune
the numbers and add whatever moves, forces and mechanics make the game look, play and
feel right, using the hooks below. It is a starting point, not a limit. Skip it for
vehicles, flying, top-down, fixed-camera, puzzle or menu games. You own the scene,
renderer, art, UI, game rules and the animation loop.

```js
import { createWorld, fitModel } from './rosie/roseblox.js';

const world = await createWorld();
world.addStaticMesh(groundMesh);            // every walkable surface and solid prop, after placing it
const player = await world.addPlayer({
  camera, canvas: renderer.domElement, model: heroGltf.scene,
  feet: [0, 0, 0], height: 1.8,             // world-space feet position and total height in meters
  view: 'third',                            // or 'first'
});
scene.add(player.root);
playButton.onclick = () => player.start(); // must run inside a real click or tap
const timer = new THREE.Timer();
renderer.setAnimationLoop(time => {
  timer.update(time);
  world.advance(Math.max(0, timer.getDelta()), {
    paused: !player.active,
    afterStep: step => updateGame(step),    // fixed-step game logic, in seconds
  });
  renderer.render(scene, camera);
});
```

## Controls

- Desktop: WASD or arrows move relative to the camera, mouse looks (the pointer is
  captured after `start()`; if capture is refused, free-mouse look with edge turning
  takes over), Shift runs, Space jumps, wheel zooms in third person.
- Any touchscreen, including touch laptops, gets on-screen controls automatically while
  the player is active: drag on the left half for an analog joystick, drag on the right
  half to look, and tap Jump. Leave `touch` unset; only a mobile game passes `touch: true`
  so desktop previews show them too (a mouse keeps working normally). Add game actions as
  `touchButtons: [{label:'Attack', onPress, onRelease}]` or `{label:'Run', action:'run'}`.
  Jump and these buttons stack up from the bottom-right corner (about 100px wide and 90px
  per button, `z-index: 50`), so keep HUD buttons such as pause or mute out of that corner;
  top corners are free. Touches on your own buttons and links go to them, not the controls.
- Escape, window blur and hidden tabs pause. Show pause UI when `player.active` is false
  and call `player.start()` from a button to resume. On touch, add a visible pause button
  in a top corner.
- For dialogue, menus and cutscenes call `player.pause()`, then `player.resume()`.

Options: `speed` (5), `runSpeed` (8), `jumpSpeed` (6.25, 0 disables jumping and the Jump
button), `radius` (.35), `facing` ('movement' turns the hero toward travel; 'camera'
keeps it facing the view, for shooters), `distance`/`minDistance`/`maxDistance` (third
person), `yaw`/`pitch`, `sensitivity`, `onAttack(event)` (left click while captured).

Player: `start()`, `stop()`, `pause()`, `resume()`, `jump()`, `teleport([x,y,z])` (feet),
`setMoveSpeed(walk, run)`, `setVelocity([x,y,z])`, `setAction(name, down)` for
`forward/backward/left/right/run/jump`, `setAxis(x, z)`, `look(dx, dy)`, `remove()`. Read
`active`, `locked`, `grounded`, `touch`, `position` (feet), `forward`, `velocity`,
`jumpHeld`, `jumpPressed`, and `body` (its collider, for queries). `position`, `velocity`
and `forward` are fresh `THREE.Vector3`s that also read as `v[0]`, `v[1]`, `v[2]`.

## Extending movement

- Gravity is 20 m/s². A jump rises about `jumpSpeed² / 40` metres (about 1 m by default)
  and covers about `runSpeed × jumpSpeed / 10` metres of flat ground at a run. The player
  steps up ledges of 0.3 m on the ground, not in the air. Size climbs and gaps from these
  numbers, or change the numbers.
- `setVelocity([x,y,z])` sets the player's velocity now. Gravity keeps acting, and walking
  input takes the horizontal part back as it fades, so the player keeps control. Use it
  for any impulse the game needs; `player.velocity` reads the current one.
- Read input in `afterStep`. `jumpPressed` is true for one step when Jump is pressed and
  the engine did not use it for a ground jump (for example in mid-air); `jumpHeld` is true
  while it is down.
- Kinematic bodies carry a player standing on them, whether moved with `moveTo` or
  `teleport`.

## Models

Models use local +Z as forward (generated assets do); pass `modelYaw` only for another
axis. `addPlayer` fits a detached model to `height` with its feet on the ground. Never
move or rotate `player.root` yourself; animate children of `player.visual`, and add
equipment there: `const sword = fitModel(swordGltf.scene, {height: .8}); player.visual.add(sword);`.
First person hides the hero model.

## World

- `addStaticMesh(mesh, {data})`: a fixed collider from a placed mesh's triangles, including
  terrain. Spawn feet slightly above the surface. Recreate the body if geometry changes.
  Decorations the player may pass through need no collider.
- `addBody({type:'fixed'|'dynamic'|'kinematic', position, shape, sensor, data})`: shapes
  `{type:'box', size:[x,y,z]}`, `{type:'sphere', radius}`, `{type:'capsule', radius, height}`;
  `position` is the collider center. Handles have `bindObject(mesh)`, `teleport`, `remove`,
and for kinematic bodies `moveTo([x,y,z])`, which moves smoothly over the next step.
- `addNpc({model, feet, height})`: a walking character; `setVelocity([vx,0,vz])`,
  `faceDirection([dx,0,dz])`, `teleport`, `remove`. AI and combat are your code.
- `castRay(origin, direction, {maxDistance, exclude: player.body})` and
  `castSegment(from, to, {exclude})` return `{body, point, normal, distance}` or null.
- `onCollision(({type, a, b}) => ...)` reports `start`/`end` contacts with your `data`.
- Call `advance` exactly once per frame. `dispose()` releases physics and input.
