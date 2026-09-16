import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { createRpgWorld, fitRpgModel } from "./rpg.js";
import { createRpgSession, createRpgProgress } from "./rpgSession.js";
import { RPG_BINDINGS } from "./rpgProfile.js";

export const RPG_TEMPLATE_VERSION = "0.1.1-experiment";
export { RPG_BINDINGS, createRpgSession, createRpgProgress };

const css = `
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111;color:#eee}
.rpg{position:fixed;inset:0;font:15px system-ui;color:var(--rpg-text,#f3eee0)}
.rpg canvas{display:block;width:100%;height:100%;outline:none}
.rpg-ui{position:absolute;inset:0;pointer-events:none}
.rpg button{cursor:pointer;color:inherit;font:inherit;border:1px solid var(--rpg-accent,#bba477);background:var(--rpg-panel,#202126ed);padding:.6em 1em;border-radius:var(--rpg-radius,3px);pointer-events:auto}
.rpg-panel{background:var(--rpg-panel,#202126ed);padding:1em;border:1px solid var(--rpg-accent,#bba477);border-radius:var(--rpg-radius,3px)}
.rpg-status{position:absolute;top:18px;left:18px}.rpg-target{margin-top:.6em}
.rpg-objectives{position:absolute;right:18px;top:18px;max-width:300px;white-space:pre-line}
.rpg-actions{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:8px}
.rpg-notice{position:absolute;bottom:85px;left:50%;transform:translateX(-50%);text-align:center;text-shadow:0 2px 3px #000}
.rpg-modal{position:absolute;inset:0;display:grid;place-items:center;background:#0005;pointer-events:auto}
.rpg-modal[hidden]{display:none}.rpg-modal>.rpg-panel{max-width:520px;width:calc(100% - 80px)}
.rpg-choices{display:flex;gap:10px;flex-wrap:wrap}.rpg-help{font-size:13px;opacity:.85;line-height:1.7}.rpg-modal p{white-space:pre-line}
`;

/** A complete application shell; generated code supplies content and art hooks. */
export async function createRpgGame(config) {
  const host = config.container ?? document.body;
  const root = document.createElement("div"); root.className = "rpg";
  // Generated themes stay unlayered so their author styles outrank these defaults.
  const style = document.createElement("style"); style.textContent = `@layer rpg-base { ${css} }`; root.append(style); host.append(root);
  const ui = document.createElement("div"); ui.className = "rpg-ui";
  const node = (tag, className, parent = ui) => { const n = document.createElement(tag); n.className = className; parent.append(n); return n; };
  const status = node("div", "rpg-status rpg-panel");
  const healthUI = node("div", "rpg-health", status), targetUI = node("div", "rpg-target", status);
  const objectivesUI = node("div", "rpg-objectives rpg-panel"), actionsUI = node("div", "rpg-actions"), noticeUI = node("div", "rpg-notice");
  const modal = node("div", "rpg-modal"), panel = node("div", "rpg-panel", modal);
  const titleUI = node("h2", "", panel), textUI = node("p", "", panel), choicesUI = node("div", "rpg-choices", panel), helpUI = node("p", "rpg-help", panel);
  root.append(ui);
  let renderer, world, player, session, disposed = false, selected = null, dialogue = null, time = 0, uiTime = 0, lastTime = null;
  let health = config.player?.health ?? 100, noticeUntil = 0, dialogueSerial = 0;
  const listeners = [], assets = new Map(), actors = new Map(), mixers = [], cooldowns = new Map(), cleanups = [];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(config.visuals?.fov ?? 60, 1, .1, config.visuals?.far ?? 700);
  const spawn = config.player?.feet ?? [0, 1, 0];
  function listen(target, type, handler) { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); }
  function button(label, callback, parent = choicesUI) { const b = node("button", "", parent); b.type = "button"; b.textContent = label; b.onmousedown = event => event.preventDefault();
    const refocus = () => { if (!disposed && session?.playing) renderer.domElement.focus({ preventScroll: true }); };
    b.onclick = () => { try { const result = callback(); if (result?.then) result.catch(failure).finally(refocus); else refocus(); } catch (error) { failure(error); refocus(); } }; return b; }
  function notice(message) { noticeUI.textContent = String(message); noticeUntil = time + 4; }
  function failure(error) { console.error(error); notice(error.message ?? error); }
  function view(title, text, choices, help = false) {
    modal.hidden = false; titleUI.textContent = title; textUI.textContent = text; choicesUI.replaceChildren();
    helpUI.textContent = help ? RPG_BINDINGS.map(b => `${b.label}: ${b.description}`).join(" · ") : "";
    for (const [label, action] of choices) button(label, action);
  }
  function refresh() {
    if (!session) return;
    healthUI.textContent = `${config.title ?? "Adventure"} · ${Math.ceil(health)}/${config.player?.health ?? 100} HP · ${progress.currency} coins`;
    const target = actors.get(selected);
    targetUI.textContent = target && !target.dead ? `${target.def.name ?? target.def.id}${target.def.enemy ? ` · ${Math.ceil(target.health)} HP` : ""} · F interact` : "Click a character or object to select";
    objectivesUI.textContent = progress.quests.filter(q => ["active", "completed"].includes(q.state)).map(q => `${q.title ?? q.id}${q.state === "completed" ? " — return for reward" : ""}\n${q.objectives.map((o, i) => `${o.label ?? o.type}: ${q.progress[i]}/${o.count ?? 1}`).join("\n")}`).join("\n\n");
    objectivesUI.hidden = !objectivesUI.textContent;
    if (dialogue) return;
    if (session.playing) { modal.hidden = true; return; }
    if (session.reasons.includes("dead")) view("Defeated", config.deathText ?? "Return to your checkpoint and try again.", [["Respawn", respawn], ["Restart", restart]]);
    else if (session.reasons.includes("ready")) view(config.title ?? "Adventure", config.description ?? "Explore, meet characters and discover the world.", [["Play", play]], true);
    else view("Paused", "Resume when you are ready.", [["Resume", play], ["Restart", restart]], true);
  }
  const progress = createRpgProgress(config.quests, { changed: () => { refresh(); config.onProgress?.(api); } });
  function play() {
    for (const reason of ["ready", "pause", "focus"]) session.release(reason);
    for (const value of assets.values()) if (value instanceof HTMLAudioElement) value.load();
  }
  function closeDialogue() {
    dialogueSerial++; dialogue = null; session.release("dialogue"); refresh();
  }
  function showDialogue(definition) {
    if (session.reasons.includes("dead")) return;
    dialogue = definition; const serial = ++dialogueSerial;
    session.hold("dialogue");
    const choices = (definition.choices ?? []).map(choice => [choice.label, async () => {
      if (serial !== dialogueSerial) return;
      dialogueSerial++; for (const b of choicesUI.querySelectorAll("button")) b.disabled = true;
      try {
        if (choice.accept) progress.accept(choice.accept);
        if (choice.claim) progress.claim(choice.claim);
        await choice.action?.(api);
      } catch (error) { failure(error); }
      finally { if (dialogueSerial === serial + 1) closeDialogue(); }
    }]);
    view(definition.title ?? "Conversation", definition.text ?? "", [...choices, ["Close", closeDialogue]]);
    choicesUI.querySelector("button")?.focus();
  }
  function select(id) {
    if (id !== null && !actors.has(id)) throw new Error(`Unknown target ${id}.`);
    selected = id; refresh(); config.onSelect?.(id, api);
  }
  function reachable(actor, range = 3) {
    if (!actor || actor.dead || actor.position().distanceTo(player.position) > range) return false;
    const from = player.position.add(new THREE.Vector3(0, .9, 0));
    const to = actor.position().add(new THREE.Vector3(0, Math.min(actor.def.height ?? 1.5, .9), 0));
    const hit = world.castSegment(from, to, { exclude: player.body });
    return !hit || hit.body === actor.body;
  }
  function interact() {
    if (!session.playing) return;
    const actor = actors.get(selected);
    if (!reachable(actor, actor?.def.interactRange ?? 3)) { notice("Select a nearby target to interact."); return; }
    const def = actor.def;
    progress.event("talk", def.id); progress.deliver(def.id);
    if (def.item) { progress.collect(def.item, def.count ?? 1); actor.dead = true; actor.root.visible = false; actor.body?.remove(); select(null); notice(`Collected ${def.name ?? def.item}`); return; }
    if (def.onInteract) { try { def.onInteract(api); } catch (error) { failure(error); } return; }
    const content = typeof def.dialogue === "function" ? def.dialogue(api) : def.dialogue;
    const options = progress.quests.filter(q => q.giver === def.id && ["available", "completed"].includes(q.state) && (q.requires ?? []).every(id => progress.quests.find(other => other.id === id)?.state === "claimed"));
    if (content || options.length) showDialogue({
      title: def.name ?? def.id,
      ...(typeof content === "string" ? { text: content } : content),
      choices: [...(typeof content === "object" ? content?.choices ?? [] : []), ...options.map(q => q.state === "completed"
        ? { label: `Claim: ${q.title ?? q.id}`, claim: q.id }
        : { label: `Accept: ${q.title ?? q.id}`, accept: q.id })],
    });
    else notice(def.description ?? def.name ?? def.id);
  }
  function damage(amount) {
    if (!session.playing) return;
    health = Math.max(0, health - Math.max(0, amount)); config.onDamage?.(amount, api);
    if (!health) { closeDialogue(); session.hold("dead"); } refresh();
  }
  function attack(index = 0) {
    if (!session.playing) return;
    const ability = config.abilities?.[index]; if (!ability) return;
    if ((cooldowns.get(index) ?? 0) > time) { notice("Ability is recovering."); return; }
    if (ability.heal) {
      health = Math.min(config.player?.health ?? 100, health + ability.heal);
    } else {
      const actor = actors.get(selected);
      if (!actor?.def.enemy || !reachable(actor, ability.range ?? 3)) { notice("Select an enemy within reach."); return; }
      actor.health = Math.max(0, actor.health - (ability.damage ?? 10));
      if (!actor.health) {
        actor.dead = true; actor.root.visible = false; actor.body.remove();
        progress.event("defeat", actor.def.id);
        for (const [id, count] of Object.entries(actor.def.drops ?? {})) progress.collect(id, count);
        notice(`Defeated ${actor.def.name ?? actor.def.id}`);
      }
      config.onHit?.(actor, ability, api);
    }
    cooldowns.set(index, time + (ability.cooldown ?? .6)); ability.effect?.(api); refresh();
  }
  function respawn() {
    player.teleport(config.checkpoint ?? spawn); health = config.player?.health ?? 100;
    for (const actor of actors.values()) if (actor.npc && !actor.dead) { actor.npc.teleport(actor.home.toArray()); actor.npc.setVelocity([0, 0, 0]); actor.health = actor.def.health ?? 30; }
    session.release("dead"); session.hold("pause"); refresh();
  }
  async function restart() { dispose(); return createRpgGame(config); }
  function model(id) {
    const value = assets.get(id); if (!value?.scene) throw new Error(`Missing model asset: ${id}`);
    return cloneSkeleton(value.scene);
  }
  function addSurface(mesh) { scene.add(mesh); mesh.receiveShadow = true; return world.addStaticMesh(mesh); }
  function addProp(object, options = {}) {
    scene.add(object); if (options.position) object.position.fromArray(options.position);
    if (options.rotation) object.rotation.set(...options.rotation);
    if (options.scale) object.scale.setScalar(options.scale);
    object.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    if (options.collider) object.traverse(n => { if (n.isMesh) world.addStaticMesh(n); });
    return object;
  }
  function dispose() {
    if (disposed) return; disposed = true;
    renderer?.setAnimationLoop(null); session?.dispose(); world?.dispose();
    for (const cleanup of [...listeners, ...cleanups]) cleanup();
    const resources = new Set();
    scene.traverse(n => { if (n.geometry) resources.add(n.geometry); for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : []) { resources.add(m); for (const v of Object.values(m)) if (v?.isTexture) resources.add(v); } });
    for (const a of assets.values()) { if (a?.isTexture) resources.add(a); if (a instanceof HTMLAudioElement) { a.pause(); a.src = ""; } }
    for (const resource of resources) resource.dispose(); renderer?.dispose(); root.remove();
  }
  const api = { scene, camera, root, assets, actors, progress, model, addSurface, addProp, select, interact, attack, damage, showDialogue, closeDialogue, notice, dispose, restart,
    get player() { return player; }, get world() { return world; }, get renderer() { return renderer; }, get session() { return session; }, get selected() { return selected; }, get health() { return health; },
    onDispose: fn => cleanups.push(fn),
  };
  view("Loading", "Preparing your adventure…", []);
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = config.visuals?.shadows !== false; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = config.visuals?.exposure ?? 1;
    root.prepend(renderer.domElement); renderer.domElement.tabIndex = 0;
    const gltf = new GLTFLoader(), textures = new THREE.TextureLoader();
    await Promise.all(Object.entries(config.assets ?? {}).map(async ([id, def]) => {
      let value;
      if (def.type === "model") value = await gltf.loadAsync(def.url);
      else if (def.type === "texture") {
        value = await textures.loadAsync(def.url); value.colorSpace = THREE.SRGBColorSpace;
        if (def.repeat) { value.wrapS = value.wrapT = THREE.RepeatWrapping; value.repeat.set(...def.repeat); }
      } else if (def.type === "audio") { value = new Audio(def.url); value.volume = def.volume ?? .5; }
      else throw new Error(`Unknown asset type for ${id}.`);
      assets.set(id, value);
    }));
    if (config.skybox) { const sky = assets.get(config.skybox); if (!sky?.isTexture) throw new Error("Skybox must reference a texture asset."); sky.mapping = THREE.EquirectangularReflectionMapping; scene.background = sky; if (config.visuals?.environment !== false) scene.environment = sky; }
    else scene.background = new THREE.Color(config.visuals?.background ?? "#97b8d2");
    if (config.visuals?.fog) scene.fog = new THREE.Fog(...config.visuals.fog);
    const hemi = new THREE.HemisphereLight(config.visuals?.skyColor ?? 0xe7f3ff, config.visuals?.groundColor ?? 0x635f52, config.visuals?.ambient ?? 1.5); scene.add(hemi);
    const sun = new THREE.DirectionalLight(config.visuals?.sunColor ?? 0xffe6b5, config.visuals?.sunIntensity ?? 2.5); sun.position.fromArray(config.visuals?.sunPosition ?? [20, 35, 15]);
    sun.castShadow = renderer.shadowMap.enabled; sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .035;
    const extent = config.visuals?.shadowExtent ?? 45; Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .5, far: 160 }); sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
    world = await createRpgWorld();
    await config.buildWorld?.(api);
    if (!world.getDiagnostics().bodies) throw new Error("World requires a registered walkable surface via addSurface(mesh).");
    const p = config.player ?? {};
    player = await world.addPlayer({ model: model(p.model), feet: spawn, height: p.height ?? 1.8, radius: p.radius ?? .35, modelYaw: p.modelYaw ?? 0,
      speed: p.speed ?? 5, runSpeed: p.runSpeed ?? 8, jumpSpeed: p.jumpSpeed ?? 7, distance: p.distance ?? 6, yaw: p.yaw ?? 0, pitch: p.pitch ?? .3,
      canvas: renderer.domElement, camera, controlMode: "mmo", keyboardLayout: "classic", facing: "camera",
      onSelect: ({ hit }) => select(hit?.body.data?.rpgId ?? null) });
    scene.add(player.root);
    function animate(actor, def) {
      const clips = assets.get(def.model)?.animations ?? [];
      if (!clips.length || !def.animations) return;
      const mixer = new THREE.AnimationMixer(actor.visual ?? actor.root), actions = {};
      for (const [state, name] of Object.entries(def.animations)) { const clip = clips.find(c => c.name === name); if (clip) actions[state] = mixer.clipAction(clip); }
      mixers.push({ mixer, actions, actor, previous: actor.position.clone(), current: null });
    }
    animate(player, p);
    for (const equipment of p.equipment ?? []) {
      const obj = fitRpgModel(model(equipment.model), { height: equipment.height ?? .8, yaw: equipment.modelYaw ?? 0 });
      obj.position.fromArray(equipment.position ?? [0, 0, 0]); player.visual.add(obj);
    }
    for (const def of [...(config.characters ?? []), ...(config.objects ?? [])]) {
      if (!def.id || actors.has(def.id)) throw new Error("Target IDs must be unique.");
      const home = new THREE.Vector3(...(def.feet ?? [0, 0, 0])); let body, visual, npc;
      if (def.enemy || def.patrol) {
        npc = world.addNpc({ model: model(def.model), feet: home.toArray(), height: def.height ?? 1.8, radius: def.radius ?? .35, modelYaw: def.modelYaw ?? 0, data: { rpgId: def.id } });
        body = npc.body; visual = npc.root; animate(npc, def);
      } else {
        visual = fitRpgModel(model(def.model), { height: def.height ?? 1.8, yaw: def.modelYaw ?? 0 }); visual.position.copy(home);
        body = world.addBody({ type: "fixed", position: home.clone().add(new THREE.Vector3(0, (def.height ?? 1.8) / 2, 0)).toArray(), shape: { type: "box", size: [def.width ?? .8, def.height ?? 1.8, def.width ?? .8] }, data: { rpgId: def.id } });
      }
      visual.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } }); scene.add(visual);
      actors.set(def.id, { def, body, root: visual, npc, home, position: () => npc ? npc.position : home.clone(), health: def.health ?? 30, dead: false, nextAttack: 0, waypoint: 0 });
    }
    for (const q of progress.quests) {
      if (q.giver && !actors.has(q.giver)) throw new Error(`Quest ${q.id} has unknown giver ${q.giver}.`);
      for (const o of q.objectives) {
        if (["talk", "defeat", "deliver"].includes(o.type) && !actors.has(o.target)) throw new Error(`Unknown objective target ${o.target}.`);
        if (o.type === "visit" && !(config.zones ?? []).some(z => z.id === o.target)) throw new Error(`Unknown visit zone ${o.target}.`);
      }
      if (q.autoStart) progress.accept(q.id);
    }
    session = createRpgSession({ suspend: () => player.pause(), resume: () => player.resume(), changed: refresh });
    function resize() { camera.aspect = root.clientWidth / Math.max(1, root.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(root.clientWidth, root.clientHeight); }
    listen(window, "resize", resize); resize();
    listen(window, "blur", () => session.hold("focus"));
    listen(document, "visibilitychange", () => { if (document.hidden) session.hold("focus"); });
    listen(window, "keydown", event => {
      if (event.target?.closest?.("input,textarea,[contenteditable=true]") || event.repeat) return;
      if (event.code === "Escape") { event.preventDefault(); if (dialogue) closeDialogue(); else session.hold("pause"); return; }
      if (!session.playing) return;
      if (event.code === "KeyF") { event.preventDefault(); interact(); }
      const action = RPG_BINDINGS.find(b => b.code === event.code && b.slot !== undefined); if (action) { event.preventDefault(); attack(action.slot); }
    });
    button("F · Interact", interact, actionsUI);
    for (const binding of RPG_BINDINGS.filter(b => b.slot !== undefined)) if (config.abilities?.[binding.slot]) button(`${binding.label} · ${config.abilities[binding.slot].name}`, () => attack(binding.slot), actionsUI);
    const zones = new Set();
    function step(dt) {
      for (const actor of actors.values()) {
        if (!actor.npc || actor.dead) continue;
        const pos = actor.position(), delta = player.position.sub(pos), distance = delta.length();
        let goal = actor.home;
        if (actor.def.enemy && distance < (actor.def.aggroRange ?? 10) && pos.distanceTo(actor.home) < (actor.def.leash ?? 20)) {
          if (distance <= (actor.def.attackRange ?? 2) && reachable(actor, actor.def.attackRange ?? 2)) {
            actor.npc.setVelocity([0, 0, 0]); actor.npc.faceDirection(delta.toArray());
            if (time >= actor.nextAttack) { actor.nextAttack = time + (actor.def.attackCooldown ?? 1.5); damage(actor.def.damage ?? 8); } continue;
          }
          goal = player.position;
        } else if (actor.def.patrol?.length) {
          goal = new THREE.Vector3(...actor.def.patrol[actor.waypoint]);
          if (pos.distanceTo(goal) < .7) actor.waypoint = (actor.waypoint + 1) % actor.def.patrol.length;
        }
        const direction = goal.clone().sub(pos); direction.y = 0;
        if (direction.length() > .4) direction.normalize().multiplyScalar(actor.def.speed ?? 2.5); else direction.set(0, 0, 0);
        actor.npc.setVelocity(direction.toArray());
      }
      for (const z of config.zones ?? []) {
        const inside = player.position.distanceTo(new THREE.Vector3(...z.position)) <= (z.radius ?? 3);
        if (inside && !zones.has(z.id)) { progress.event("visit", z.id); z.onEnter?.(api); }
        if (inside) zones.add(z.id); else zones.delete(z.id);
      }
      if (player.position.y < (config.rescueY ?? -30)) damage(health);
      config.update?.(dt, api);
    }
    renderer.setAnimationLoop(now => {
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(.05, (now - lastTime) / 1000)); lastTime = now;
      if (session.playing && !player.active) session.hold("pause");
      if (session.playing) time += dt;
      world.advance(dt, { paused: !session.playing, beforeStep: step });
      if (session.playing) {
        for (const item of mixers) {
          const pos = item.actor.position, speed = pos.distanceTo(item.previous) / Math.max(dt, .001); item.previous.copy(pos);
          const next = !item.actor.grounded ? "jump" : speed > .1 ? "walk" : "idle";
          if (next !== item.current && item.actions[next]) { item.actions[item.current]?.fadeOut(.15); item.actions[next].reset().fadeIn(.15).play(); item.current = next; } item.mixer.update(dt);
        }
        if (noticeUntil && time > noticeUntil) { noticeUI.textContent = ""; noticeUntil = 0; }
      }
      uiTime += dt; if (uiTime > .1) { refresh(); uiTime = 0; }
      renderer.render(scene, camera);
    });
    refresh(); config.onReady?.(api); return api;
  } catch (error) {
    renderer?.setAnimationLoop(null); session?.dispose();
    view("Unable to start", error.message ?? String(error), [["Retry", restart]]); throw error;
  }
}
