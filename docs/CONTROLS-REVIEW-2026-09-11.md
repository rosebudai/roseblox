# RPG and racing controls follow-up

The corrected-prompt one-shots still fail the product quality bar. Restoring the normal art prompt did not establish visual parity or reliable non-FPS integration. This follow-up repairs shared mechanics and adds separate authored integration checks; it does not replace or re-score any original one-shot.

## Shared defects and fixes

- The adapter exposed a complete FPS player but only an input-free NPC capsule for RPGs. There was no third-person player API or public generic-character jump. Both corrected RPGs omitted jumping and authored restricted drag cameras. `addThirdPersonPlayer` now supplies camera-relative WASD, run, Space jump, no-button mouse orbit, wheel zoom, obstruction checks, camera-facing or movement-facing roots, attack callback and the existing pointer-capture/fallback lifecycle. `addCharacter().jump()` supports custom actors. Short input presses survive until a physics step consumes them.
- Input focus loss previously paused the controller but could leave the physics callbacks running. Enabled desktop controllers now pause the mechanics clock on capture/focus loss. Hosts still need to reflect `.active` in UI and gate any timers outside the fixed callbacks. `autoPause:false` remains available for hosts that manage multiple input surfaces explicitly.
- The public body API only offered boxes, spheres and capsules. That makes custom curved/elevated roads unnecessarily awkward. `addStaticMesh` snapshots the host's authored collision mesh with its final transforms, without changing geometry, materials, lighting or rendering. `surfaceUp` establishes the support side for open road/terrain meshes, including downward-wound double-sided Three.js art. Mirrored transforms retain outward collision winding. Detailed scenery should use simplified collision proxies.
- A single Rapier CCD pass discards remaining travel at road-mesh contacts. In a flat-road reproduction, the vehicle traveled 43.445 m rather than 53.093 m in four seconds while reporting the same top speed (about 18% lost travel). Four bounded CCD passes restore travel; thin-wall collision coverage remains in place. Seam correction also needs consistently oriented collision triangles: downward-wound roads failed the first integration test and now have regression coverage through `surfaceUp`.
- Racing recovery now accepts `onReset` so R invokes the game's checkpoint reset instead of subsequently overriding it with the initial spawn.

The API uses Rapier's triangle-mesh and edge-correction facilities; see [collider documentation](https://rapier.rs/docs/user_guides/javascript/colliders/) and [TriMeshFlags](https://rapier.rs/javascript3d/enums/TriMeshFlags.html). Behavior above was reproduced against the pinned 0.20.0 runtime.

## Separate integration checks

[Playable checks](https://roseblox-three-way-review.pai286861.chatgpt.site/integration-checks/) retain links to their untouched originals.

- **Amberwild:** a copy of corrected RPG sample 2 uses the new third-person player. Space jumps; Q retains a moving dodge; stamina/blocking adjust controller speed. Camera and root-facing code no longer compete with the controller. Child model/sword alignment was adapted to -Z forward. Existing world, generated art, enemies and quest are retained.
- **Neon Apex:** a copy of normal racing sample 1 retains its skybox, road geometry, generated cars/barriers, lighting, HUD and custom camera presentation. Player movement uses the arcade controller; road/shoulder collision uses the same visible surface, barriers and hazards have collision, and pause/countdown/recovery use the controller lifecycle. The integration also converts the +Z visual root convention, corrects displayed km/h, and applies the existing drift boost as a one-time velocity change. Rivals and race rules remain game-authored.

These are mechanics-isolation checks with authored integration edits, not new one-shots or proof of generation quality. The racer can still be driven off the track, and rival behavior remains inherited game logic.

## Validation and limits

- 175 engine tests pass in the Roseblox workstation, including quick Space taps in FPS/TPS, jump/landing, full yaw rotation without snaps, broad pitch, camera-relative motion, separate model-child transforms, movement-facing mode, pause/resume, transformed road collision, upward/downward road winding, slopes, mesh seams, braking/reverse and checkpoint reset.
- Browser-input QA of the authored RPG observed a 1.34 m rise at the sampled point after Space, landing, mouse-relative travel and preserved aim after pause/resume. Browser-input QA of the racer observed acceleration to 35.2 m/s, a right turn, braking, frozen timer/pose during pause and reset near current track progress. Neither a complete RPG quest nor a complete race was tested in this follow-up.
- Pointer-lock acquisition was unavailable in the controlled browser, including the separately opened Chrome tab (`WrongDocumentError`). No-button fallback look was exercised in the browser; native acquisition/loss semantics have automated controller coverage but still need a foreground human Chrome pass.
- Original corrected racing generations still contain road/visual mismatches, incomplete model replacement or integration, and race-rule errors. Original RPGs still lack jump. Those files remain frozen as evidence. Visual regression across future Rosie one-shots is unresolved; this work establishes a usable shared contract for the next comparison.
- No new Rosie or media-generation calls. No active-play feedback was added to generation. No Gateway production routing changes or deployment. The engine PR remains draft.
