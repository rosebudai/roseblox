import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { createRpgWorld, fitRpgModel, queryMeleeTargets } from "./rpg.js";
import { createRpgSession, createRpgProgress } from "./rpgSession.js";
import { RPG_BINDINGS, RPG_MOVEMENT_DEFAULTS } from "./rpgProfile.js";

export const RPG_TEMPLATE_VERSION = "0.2.1-experiment";
export { RPG_BINDINGS, createRpgSession, createRpgProgress };

const css = `
html,body{margin:0;width:100%;height:100%;overflow:hidden}
.rpg{position:fixed;inset:0}
.rpg canvas{display:block;width:100%;height:100%;outline:none}
`;

/** A complete application shell; generated code supplies content and art hooks. */
export async function createRpgGame(config) {
  const host = config.container ?? document.body;
  const root = document.createElement("div"); root.className = "rpg";
  // Generated themes stay unlayered so their author styles outrank these defaults.
  const style = document.createElement("style"); style.textContent = `@layer rpg-base { ${css} }`; root.append(style); host.append(root);
  const ui = document.createElement("div");
  Object.assign(ui.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  root.append(ui);
  let renderer, world, player, session, disposed = false, selected = null, dialogue = null, time = 0, uiTime = 0, lastTime = null;
  let health = config.player?.health ?? 100, noticeUntil = 0, dialogueSerial = 0, noticeText = "";
  let presentation, loading = true, loadError = null, previousFocusKey, restartPromise;
  const listeners = [], assets = new Map(), actors = new Map(), mixers = [], cooldowns = new Map(), cleanups = [], combatHealth = new Map();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(config.visuals?.fov ?? 60, 1, .1, config.visuals?.far ?? 700);
  const spawn = config.player?.feet ?? [0, 1, 0];
  // Buttons and keyboard input share the same slot without UI-side index arithmetic.
  const abilities = (config.abilities ?? []).map((ability, slot) => Object.freeze({
    name: ability.name, slot, key: RPG_BINDINGS.find(b => b.slot === slot)?.label, activate: () => attack(slot),
  }));
  function createControlsLegend() {
    const legend = document.createElement("dl"); legend.setAttribute("aria-label", "Controls");
    for (const binding of RPG_BINDINGS) {
      if (binding.slot !== undefined && !abilities[binding.slot]) continue;
      const term = document.createElement("dt"), key = document.createElement("kbd"), description = document.createElement("dd");
      key.textContent = binding.label; term.append(key);
      description.textContent = abilities[binding.slot]?.name ?? binding.description;
      legend.append(term, description);
    }
    return legend;
  }
  function listen(target, type, handler) { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); }
  function refocus() { if (!disposed && session?.playing) renderer.domElement.focus({ preventScroll: true }); }
  function bindAction(element, callback) {
    element.style.pointerEvents = "auto";
    let pending = false;
    element.addEventListener("click", async event => {
      event.preventDefault(); event.stopPropagation();
      if (disposed || pending) return;
      pending = true;
      try { await callback(event); } catch (error) { failure(error); }
      finally { pending = false; refocus(); }
    });
    return element;
  }
  function notice(message) { noticeText = String(message); noticeUntil = time + 4; refresh(); }
  function failure(error) { console.error(error); notice(error.message ?? error); }
  function targetState(actor) {
    if (!actor || actor.dead) return null;
    const maxHealth = actor.def.health ?? 30;
    return { id: actor.def.id, name: actor.def.name ?? actor.def.id, enemy: !!actor.def.enemy, health: actor.health,
      maxHealth, healthFraction: maxHealth > 0 ? Math.max(0, Math.min(1, actor.health / maxHealth)) : 0 };
  }
  function refresh() {
    if (!presentation || disposed) return;
    const reasons = session?.reasons ?? ["ready"];
    const phase = loadError ? "error" : loading ? "loading" : reasons.includes("dead") ? "dead"
      : dialogue ? "dialogue" : reasons.includes("ready") ? "ready" : session.playing ? "playing" : "paused";
    for (const [id, until] of combatHealth) if (until <= time || actors.get(id)?.dead) combatHealth.delete(id);
    const combatTargets = [...combatHealth.keys()].map(id => targetState(actors.get(id))).filter(Boolean);
    presentation.update({ phase, reasons, title: config.title ?? "Adventure", description: config.description ?? "",
      health, maxHealth: config.player?.health ?? 100, currency: progress.currency, quests: progress.quests,
      target: combatTargets.at(-1) ?? targetState(actors.get(selected)), combatTargets,
      abilities: abilities.map(ability => ({ ...ability, remaining: Math.max(0, (cooldowns.get(ability.slot) ?? 0) - time) })),
      bindings: RPG_BINDINGS, notice: noticeText, error: loadError, deathText: config.deathText ?? "",
      dialogue: dialogue && { id: dialogue.id, title: dialogue.title, text: dialogue.text, busy: dialogue.busy,
        choices: dialogue.choices.map((choice, index) => ({ id: `${dialogue.id}:${index}`, label: choice.label })) },
    });
    const focusKey = `${phase}:${dialogue?.id ?? ""}`;
    const available = element => element && ui.contains(element) && !element.disabled && !element.closest("[hidden],[inert]") && element.getClientRects().length;
    if (phase !== "playing" && (focusKey !== previousFocusKey || !available(document.activeElement))) {
      const before = document.activeElement;
      const destination = presentation.focus?.(phase);
      if (available(destination) && typeof destination.focus === "function") destination.focus({ preventScroll: true });
      // Preserve imperative focus callbacks used by earlier presentations.
      else if (document.activeElement === before || !available(document.activeElement)) {
        [...ui.querySelectorAll("button,[href],input,select,textarea,[tabindex='0']")]
          .find(available)?.focus({ preventScroll: true });
      }
    }
    previousFocusKey = focusKey;
  }
  const progress = createRpgProgress(config.quests, { changed: () => { refresh(); config.onProgress?.(api); } });
  function play() {
    if (disposed || loading || loadError) return;
    for (const reason of ["ready", "pause", "focus"]) session.release(reason);
    for (const value of assets.values()) if (value instanceof HTMLAudioElement) value.load();
  }
  function closeDialogue() {
    dialogueSerial++; dialogue = null; session.release("dialogue"); refresh();
  }
  function showDialogue(definition) {
    if (disposed || session.reasons.includes("dead")) return;
    dialogue = { ...definition, id: ++dialogueSerial, title: definition.title ?? "Conversation", text: definition.text ?? "", choices: definition.choices ?? [], busy: false };
    session.hold("dialogue");
    refresh();
  }
  async function chooseDialogue(id) {
    if (disposed || !dialogue || dialogue.busy) return;
    const current = dialogue, choice = current.choices.find((_, i) => id === `${current.id}:${i}`);
    if (!choice) return;
    current.busy = true; refresh();
    try {
      if (choice.accept) progress.accept(choice.accept);
      if (choice.claim) progress.claim(choice.claim);
      await choice.action?.(api);
    } catch (error) { failure(error); }
    finally { if (!disposed && dialogue === current) closeDialogue(); }
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
    if (disposed || !session?.playing) return;
    const ability = config.abilities?.[index]; if (!ability) return;
    if ((cooldowns.get(index) ?? 0) > time) { notice("Ability is recovering."); return; }
    cooldowns.set(index, time + (ability.cooldown ?? .6));
    if (ability.heal) {
      health = Math.min(config.player?.health ?? 100, health + ability.heal);
    } else {
      const candidates = [...actors.values()].filter(actor => actor.def.enemy && !actor.dead).map(actor => ({ actor, position: actor.position() }));
      const from = player.position.add(new THREE.Vector3(0, .9, 0));
      // A wide swing can hit several enemies; other enemies are not walls.
      const exclude = [player.body, ...candidates.map(({ actor }) => actor.body)];
      const hits = queryMeleeTargets(player.position, new THREE.Vector3(0, 0, 1).applyQuaternion(player.body.quaternion), candidates, {
        range: ability.range ?? 3, arc: ability.arc ?? Math.PI * 2 / 3,
        visible: ({ actor, position }) => !world.castSegment(from, position.clone().add(new THREE.Vector3(0, Math.min(actor.def.height ?? 1.5, .9), 0)), { exclude }),
      });
      for (const { actor } of hits) {
        actor.health = Math.max(0, actor.health - (ability.damage ?? 10));
        combatHealth.delete(actor.def.id); combatHealth.set(actor.def.id, time + 5);
        if (!actor.health) {
          actor.dead = true; actor.root.visible = false; actor.body.remove();
          progress.event("defeat", actor.def.id);
          for (const [id, count] of Object.entries(actor.def.drops ?? {})) progress.collect(id, count);
          notice(`Defeated ${actor.def.name ?? actor.def.id}`);
        }
        config.onHit?.(actor, ability, api);
      }
    }
    ability.effect?.(api); refresh();
  }
  function respawn() {
    combatHealth.clear();
    player.teleport(config.checkpoint ?? spawn); health = config.player?.health ?? 100;
    for (const actor of actors.values()) if (actor.npc && !actor.dead) { actor.npc.teleport(actor.home.toArray()); actor.npc.setVelocity([0, 0, 0]); actor.health = actor.def.health ?? 30; }
    session.release("dead"); session.hold("pause"); refresh();
  }
  function restart() { if (!restartPromise) { dispose(); restartPromise = createRpgGame(config); } return restartPromise; }
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
    presentation?.dispose?.();
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
  try {
    const actions = Object.freeze({ play, pause: () => session?.hold("pause"), restart, respawn, interact, attack, closeDialogue, chooseDialogue });
    presentation = config.createUI({ root: ui, game: api, actions, bindAction, createControlsLegend });
    if (!presentation || typeof presentation.update !== "function") throw new Error("createUI must return {update(state), dispose?()}.");
    // UI key presses must not become movement/ability input. Escape still closes or pauses.
    listen(ui, "keydown", event => { if (event.code !== "Escape") event.stopPropagation(); });
    refresh();
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
      speed: p.speed ?? 5, runSpeed: p.runSpeed ?? 8, jumpSpeed: p.jumpSpeed ?? RPG_MOVEMENT_DEFAULTS.jumpSpeed, distance: p.distance ?? 6, yaw: p.yaw ?? 0, pitch: p.pitch ?? .3,
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
        if (noticeUntil && time > noticeUntil) { noticeText = ""; noticeUntil = 0; }
      }
      uiTime += dt; if (uiTime > .1) { refresh(); uiTime = 0; }
      renderer.render(scene, camera);
    });
    loading = false; refresh(); config.onReady?.(api); return api;
  } catch (error) {
    renderer?.setAnimationLoop(null); session?.dispose();
    loadError = error.message ?? String(error); loading = false; refresh(); throw error;
  }
}
