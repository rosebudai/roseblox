# Action/RPG template · 0.4.0-experiment

This project already contains a playable application foundation for a character in a 3D world: exploration, quests and dialogue, with optional melee, shooting or stealth. Author `/game/assets.js`, `/game/world.js`, `/game/content.js`, `/game/ui.js` and `/game/theme.css`. Keep index.html's existing main.js entry. `/main.js` and `/rosie/rpg/*` are managed, versioned files; file tools protect them. You do not need to read the runtime source.

The template owns renderer/frame loop, player/camera/physics, selection, interaction, dialogue, pause/focus, quest progress, combat, inventory, UI state/focus, death/respawn and restart. You own UI markup, layout, styling and animation in ui.js/theme.css. Do not recreate these or attach movement/mouse listeners.

Your world and presentation remain freely authored: use normal generated skyboxes, models for meaningful characters/props, surface textures, terrain and distinctive lighting/composition. The template does not impose a biome, plot, objective count or art style. Generate enough content for the requested playable loop; every introduced objective must be attainable. Match the prompt, mixing freely:
- Exploration, cozy or story: omit abilities and enemies.
- Sword/magic action: melee and heal abilities, `enemy:true`.
- Shooter: a ranged ability, `enemy:'ranged'`; `player.view:'first'` only when the prompt asks for first-person.
- Horror or stealth: `enemy:'stalker'` and `hide:true` spots, usually no attacks.

Controls are fixed. Melee-only third person: W/S move, A/D turn (strafe with RMB), Q/E strafe, mouse drag camera, wheel zoom. First person or any ranged ability: WASD, mouse look (click to capture), LMB ability 1, R reload. All: Space jump, Shift run, F interact, 1/2/3 abilities, Esc pause; C (hold) sneaks when stalkers exist. Present them with `data-rpg-controls` or state `bindings`.

## Files

`assets.js` exports `assets`: a map of IDs to `{type:'model'|'texture'|'audio',url}`. Textures support `repeat:[u,v]`; audio supports `volume`. URLs are normal asset-tool results. Models are GLTF/GLB; each use is independently cloned. Critical model/texture loads finish before Play.

`world.js` exports `async function buildWorld(game)`. Use Three.js freely with `game.scene`, `game.camera`, `game.renderer`, `game.assets.get(id)` (loaded texture/GLTF) and `game.model(id)` (model clone). Static meshes in this scene get fixed colliders when buildWorld finishes, including direct scene.add calls; transformed geometry preserves slopes and doorways. `game.addProp(object,{position:[x,y,z],rotation:[x,y,z],scale:1})` adds solid scenery; `game.addSurface(mesh)` registers walkable terrain. Keep tree trunks, rocks, walls and steps solid. Use `game.addDecoration(object,options)` or `collider:false` for non-solid visuals; mark individual foliage meshes with `mesh.userData.rpgCollider=false` to exclude them inside a solid group. Lights/particles are ignored. Build terrain and props before returning; use addProp/removeProp for later additions/removal. Static colliders snapshot geometry: moving objects need an explicit game.world body with their visual opted out. game.world also exposes addStaticMesh and ray queries; meshes already registered are not duplicated. Place actor feet above visible terrain, with reachable paths and room to settle.

`content.js` exports `adventure`, an object with:

- `title`, `description`: adventure identity/presentation text; `skybox`: texture asset ID (equirectangular panorama).
- `visuals`: optional `{background,exposure:1,ambientIntensity:1.5,sunIntensity:2.5,sunColor,skyColor,groundColor,sunPosition:[x,y,z],shadowExtent,fog:[color,near,far],fov,far,shadows,environment}`. Intensities are numbers from 0–100, exposure 0–10; colors are separate CSS/hex values. Set intensity to 0 to disable a template light; world code can add local lights. environment:false disables skybox lighting. Choose these values for the requested mood.
- `player`: `{view:'third',model,feet:[x,y,z],height:1.8,radius:.35,modelYaw:0,speed:5,runSpeed:8,jumpSpeed:6.25,distance:6,yaw:0,pitch:.3,health:100}`. Models are fitted to height at feet origin; +Z is forward. Use modelYaw only for an asset whose front differs. Optional `animations:{idle:'clip name',walk:'clip name',jump:'clip name'}` uses existing GLTF clips. Optional `equipment:[{model,height,modelYaw,position:[x,y,z]}]` attaches independently fitted gear under player.visual. The default jump rises about one unit with gravity -20 and allows air steering; keep these defaults. Never transform player.root directly. `view:'first'` hides the body, puts the camera at eye height and ignores distance.
- `characters` and `objects`: arrays of `{id,name,model,feet,height,modelYaw,width,description,dialogue,interactRange}`. IDs are stable and unique across both arrays. F interacts with the nearest living, non-enemy NPC or usable object within its `interactRange` (default 3) and clear line of sight, without selection or facing requirements. Usable objects have `item`, `dialogue`, `onInteract` or a quest giver/talk/deliver role; plain scenery is ignored. `interactable:false` opts out a character/object; `interactable:true` enables description-only objects. Click selection remains optional and never overrides proximity. Stationary targets use fixed colliders and cannot be pushed. `dialogue` can be a string, `{title,text,choices}` or `game=>definition`. A choice is `{label,accept:questId}` or `{label,claim:questId}` or `{label,action:game=>{...}}`. For custom interaction use `onInteract(game)` and `game.showDialogue(definition)`.
- Gatherable object: add `item:itemId,count:1`; interaction adds items and removes the object once.
- Hiding spot: add `hide:true` (closet, bush). F hides the player in place, unable to move or attack, until F again. Only stalkers are fooled.
- `enemy`, `abilities` and `onAlert`: see Combat and stealth.
- `quests`: array `{id,title,giver:targetId,autoStart:false,requires:[questId],ordered:false,objectives:[...],reward:{currency:20,items:{itemId:1}}}`. Giver conversations automatically add available accept/claim choices. Objectives are `{type:'talk'|'visit'|'defeat',target:id,count:1,label}`, `{type:'collect',item:id,count:1,label}`, `{type:'deliver',target:id,item:id,count:1,label}`, or `{type:'custom',target:id,count:1,label}`. Delivery consumes items when interacting with its target. Rewards can be claimed once. Prerequisites require claimed quests. Objectives count events after acceptance; place sufficient items/enemies and avoid requiring the same item after it has already been consumed. `ordered:true` requires earlier objectives first.
- `zones`: `[{id,position:[x,y,z],radius:3,onEnter(game)}]` emits visit events when entered.
- `checkpoint:[x,y,z]` (default initial spawn), `rescueY:-30`, `deathText`. Respawn restores health and keeps quest/inventory progress; Restart resets the entire adventure.
- Hooks: `onReady(game)`, `update(dt,game)` for custom effects/unique rules (called on fixed simulation steps while playing), `onProgress(game)`, `onSelect(id,game)`. Do not create another render loop. `game.onDispose(cleanup)` registers cleanup for custom resources/listeners. `game.notice(text)` shows feedback; `game.progress.quests` is an array of snapshots `{...questDefinition,state:'available'|'active'|'completed'|'claimed',progress:number[]}`; find a quest by its `id` and inspect `state`. `game.progress` also exposes `currency`, `count(item)`, `collect(item,count)`, `accept(id)`, `claim(id)`, `event(type,target,count)` for extensions. `game.actors.get(id)` exposes `{root,body,npc,health,dead,def}`. Avoid recursive onProgress mutations.

## Combat and stealth

Up to three abilities; the kind is melee unless `kind:'ranged'` or `heal` is set. `effect(game)` runs on every use, including misses.
```js
abilities: [
  { name: 'Cleave', damage: 10, range: 3, cooldown: .6 },
  { name: 'Rifle', kind: 'ranged', damage: 10, range: 40, cooldown: .25, ammo: { clip: 12, reserve: 36 }, reload: 1.2, tracer: '#ffe29a' },
  { name: 'Mend', heal: 20, cooldown: 5 },
]
```
- Melee swings through a 120-degree forward arc (optional `arc` in radians) within `range`, hitting each reachable enemy once without selection. Facing follows the character even during camera orbit.
- Ranged fires an instant shot with a tracer at the enemy nearest the crosshair. Omit `ammo` for unlimited fire or `reserve` for unlimited reloads; `game.addAmmo(slot,count)` adds reserve (e.g. pickups).
- Walls block hits and shots. Put `onHit(actor,ability,game)` and `onDamage(amount,game)` on the adventure for feedback.

Enemies are characters with `enemy` set, shown here with their defaults; damage, death, `drops:{itemId:1}` loot, health bars and defeat events are supplied. Any character may add `patrol:[[x,y,z],...]`. Movement has no pathfinding; keep routes open.
```js
{ enemy: true, health: 30, damage: 8, speed: 2.5, aggroRange: 10, leash: 20, attackRange: 2, attackCooldown: 1.5 }
{ enemy: 'ranged', health: 30, damage: 6, aggroRange: 16, attackRange: 14, attackCooldown: 2, projectileSpeed: 14, projectileColor: '#ff7a45' }
{ enemy: 'stalker', damage: 25, speed: 2, chaseSpeed: 4.5, sight: 14, fov: 100, hearing: 6, notice: 1.5, loseAfter: 6 }
```
- `true` chases, attacks within reach and returns home beyond `leash`.
- `'ranged'` stops at range and fires dodgeable shots while it can see the player. A shot provokes any enemy.
- `'stalker'` patrols, grows suspicious while it sees (cone of `fov` degrees) or hears the player, chases at full threat, then searches the last known spot. It is unkillable unless `health` is set. Running is louder; sneaking is slower and quieter; a chaser within 2 m finds a hiding player. `onAlert(actor,state,game)` on the adventure fires on suspicious/hunted/searching/patrol changes.

`ui.js` exports `createUI({root, bindUI, game, actions, bindAction, createControlsLegend})`. Author your own HTML and CSS, then prefer `return bindUI()` to connect it to state. The helper supplies no markup, layout, colors or typography. Keep the HUD compact, reuse styles, and put detail in context instead of adding permanent panels. `theme.css` is fully yours; the canvas remains the main visual. The root has pointer-events:none; enable pointer events on interactive regions and avoid an invisible full-screen input blocker while playing.

## UI bindings

Use these attributes on your authored elements. Paths are dot-separated property names, not expressions. Text is escaped automatically.

- `data-rpg-text="path"` sets a leaf element's text. `data-rpg-show="path"` shows it when the value is truthy, including correctly hiding flex/grid containers.
- `data-rpg-value="health"` / `data-rpg-max="maxHealth"` set a native meter. `data-rpg-fill="healthFraction"` sets a custom bar's width from a 0–1 fraction. `data-rpg-disabled="path"` sets a button's disabled state.
- `data-rpg-action="actions.pause"` binds an action through the runtime's pending/error/focus safeguards. `data-rpg-controls` inserts the actual unstyled controls legend; place/style it in your menu or help.
- `data-rpg-list="path"` repeats its direct child `<template>`, which must contain one root element. Inside the template, binding paths refer to the item. Nested lists work. Rows use `id` as their stable key. Do not implement your own repeated DOM replacement or click wiring for these bindings.

The bound view includes the ordinary state below plus:
- `healthText`, `healthFraction`, `playing`, `menu` (ready/paused), `interactionText` (contextual F prompt, empty when no nearby usable target).
- `questLog`: active/completed quests with `title`, `completed` and `objectives:[{id,text,progress,goal,completed}]`. Render objective text/progress, not only quest titles.
- `abilities`: `{id,key,name,remaining,cooldownText,ammoText,disabled,action}`. Bind buttons to `action`; this matches the keyboard slot directly.
- `combatTargets`: recently hit living enemies `{id,name,health,maxHealth,healthFraction}`. Show these health bars without requiring selection.
- `panel`: null while playing; otherwise `{title,body,actions:[{id,label,action,disabled}]}` for loading, errors/retry, start, pause/resume, dialogue/choices/close and death/respawn/restart. One authored presentation can cover these states without writing a phase switch. Render `panel.actions` so lifecycle actions remain available.
- `threatText`: Hidden, Hunted, Searching, Suspicious or empty; with `threat` (0–1) it drives a stealth meter.
- `crosshair`: true in first person or with a ranged ability; then draw a small centred crosshair while playing.
- `actions`: `play`, `pause`, `restart`, `respawn`, `interact`, `reload`, `closeDialogue`, `chooseDialogue`. Interaction always rechecks proximity, never requires selection.

For example, an authored dialogue/menu region can contain:
```html
<section data-rpg-show="panel">
  <h1 data-rpg-text="panel.title"></h1><p data-rpg-text="panel.body"></p>
  <nav data-rpg-list="panel.actions"><template>
    <button data-rpg-text="label" data-rpg-action="action" data-rpg-disabled="disabled"></button>
  </template></nav>
</section>
```

Customize wording with `bindUI({labels:{play:'Begin adventure',resume:'Return',loading:'Loading…'}})`. Other label keys: error, retry, dead, respawn, restart, close. `extend(state,view)` may return extra view fields for unique UI or custom callbacks; it need not rebuild the standard fields. Use normal CSS and your own HTML for icons, artwork, layout and effects. Keep the authoritative controls legend available.

Advanced custom presentation remains supported: return `{update(state),focus?(phase),dispose?()}` instead of using bindUI. Raw state has `phase` (loading/error/ready/playing/paused/dialogue/dead), `title`, `description`, `health`, `maxHealth`, `currency`, `notice`, `error`, `deathText`, `quests` (progress snapshots), `interaction` (null or `{id,name,action}`), `target`, `combatTargets`, `abilities` (ranged ones add `ammo`, `reserve`, `reloading`), `bindings`, `crosshair`, `threat`, `alert`, `hidden`, `sneaking` and `dialogue` (null or `{id,title,text,busy,choices:[{id,label}]}`). Raw abilities use `activate`; bound abilities use `action`. Bind custom buttons with `bindAction(element,callback)`, preserve them between updates (~10 Hz), and return a visible enabled focus element if needed. The runtime owns all pause/focus/dialogue transitions; never call player.stop/start for UI. Dispose custom resources through `game.onDispose(cleanup)`.
