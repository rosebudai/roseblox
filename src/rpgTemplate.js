import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { createRpgWorld, fitRpgModel, queryMeleeTargets, queryRangedTarget } from "./rpg.js";
import { createRpgSession, createRpgProgress } from "./rpgSession.js";
import { RPG_BINDINGS, RPG_MOVEMENT_DEFAULTS, rpgBindings, rpgControlScheme } from "./rpgProfile.js";
import { bindRpgUI } from "./rpgUI.js";
import { stalkerSenses, stepStalker } from "./rpgStalker.js";
import { resolveRpgLighting } from "./rpgLighting.js";
import { createRpgScenery } from "./rpgScenery.js";

export const RPG_TEMPLATE_VERSION = "0.4.0-experiment";
/** Packaged with the template; the scheme actually used still follows view and abilities (rpgControlScheme). */
export const RPG_TEMPLATE_CONTROL_PROFILE = "wow_classic_desktop";
export { RPG_BINDINGS, rpgBindings, rpgControlScheme, createRpgSession, createRpgProgress };

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
  let renderer, world, scenery, player, session, disposed = false, selected = null, dialogue = null, time = 0, uiTime = 0, lastTime = null;
  let health = config.player?.health ?? 100, noticeUntil = 0, dialogueSerial = 0, noticeText = "", hidden = false, hideSpot = null, hideFeet = null, sneaking = false;
  let presentation, loading = true, loadError = null, previousFocusKey, restartPromise;
  const listeners = [], assets = new Map(), actors = new Map(), mixers = [], cooldowns = new Map(), cleanups = [], combatHealth = new Map();
  const characterIds = new Set((config.characters ?? []).map(def => def.id));
  const interactionIds = new Set([
    ...characterIds,
    ...(config.quests ?? []).flatMap(q => [q.giver, ...(q.objectives ?? []).filter(o => ["talk", "deliver"].includes(o.type)).map(o => o.target)]),
  ]);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(config.visuals?.fov ?? 60, 1, .1, config.visuals?.far ?? 700);
  const spawn = config.player?.feet ?? [0, 1, 0];
  const view = config.player?.view ?? "third", playerHeight = config.player?.height ?? 1.8;
  const kit = config.attacks ?? config.abilities ?? [];
  const kindOf = ability => ability.kind ?? (ability.heal ? "heal" : "melee");
  for (const ability of kit) {
    if (!["melee", "ranged", "heal"].includes(kindOf(ability))) throw new Error(`Ability ${ability.name} kind must be melee, ranged or heal.`);
    if (ability.ammo && !(Number.isInteger(ability.ammo.clip) && ability.ammo.clip > 0)) throw new Error(`Ability ${ability.name} ammo.clip must be a positive integer.`);
    if (kindOf(ability) === "heal" && !(Number.isFinite(ability.heal) && ability.heal > 0)) throw new Error(`Ability ${ability.name} heal must be a positive number.`);
  }
  const ammoDefaults = () => new Map(kit.flatMap((ability, slot) => kindOf(ability) === "ranged" && ability.ammo
    ? [[slot, { clip: ability.ammo.clip, reserve: ability.ammo.reserve ?? Infinity, reloadUntil: 0 }]] : []));
  let ammo = ammoDefaults();
  const stalkers = (config.characters ?? []).some(def => def.enemy === "stalker"), walkSpeed = config.player?.speed ?? 5, runSpeed = config.player?.runSpeed ?? 8;
  const features = { reload: ammo.size > 0, sneak: stalkers };
  const scheme = rpgControlScheme(config), bindings = rpgBindings(scheme).filter(b => !b.feature || features[b.feature]);
  // Stalkers default to unkillable, the usual horror case.
  const maxHealthOf = def => def.health ?? (def.enemy === "stalker" ? Infinity : 30);
  const calm = () => ({ mode: "patrol", threat: 0, searchLeft: 0 });
  /** Every stalker mode change, including a provoked chase and a respawn, reaches onAlert. */
  function setStalk(actor, next) {
    const before = actor.stalk.mode; actor.stalk = next;
    if (next.mode !== before) config.onAlert?.(actor, { chase: "hunted", search: "searching" }[next.mode] ?? next.mode, api);
  }
  const crosshair = view === "first" || kit.some(ability => kindOf(ability) === "ranged");
  const effects = [], shots = [], tracerGeometry = new THREE.BoxGeometry(.035, .035, 1).translate(0, 0, .5), shotGeometry = new THREE.SphereGeometry(.12, 10, 8);
  // Buttons and keyboard input share the same slot without UI-side index arithmetic.
  const abilities = kit.map((ability, slot) => Object.freeze({
    name: ability.name, slot, key: bindings.find(b => b.slot === slot && b.code)?.label, activate: () => attack(slot),
  }));
  function createControlsLegend() {
    const legend = document.createElement("dl"); legend.setAttribute("aria-label", "Controls");
    for (const binding of bindings) {
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
    const maxHealth = maxHealthOf(actor.def);
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
    const nearby = phase === "playing" ? (hidden ? hideSpot : nearestInteraction()) : null;
    const hunting = [...actors.values()].filter(actor => actor.stalk && !actor.dead).map(actor => actor.stalk);
    const alert = ["chase", "search", "suspicious"].find(mode => hunting.some(stalk => stalk.mode === mode));
    presentation.update({ phase, reasons, title: config.title ?? "Adventure", description: config.description ?? "",
      health, maxHealth: config.player?.health ?? 100, currency: progress.currency, quests: progress.quests,
      target: combatTargets.at(-1) ?? targetState(actors.get(selected)), combatTargets,
      interaction: nearby && { id: nearby.def.id, name: nearby.def.name ?? nearby.def.id,
        action: nearby.def.hide ? (hidden ? "Leave" : "Hide in") : nearby.def.item ? "Collect" : characterIds.has(nearby.def.id) ? "Talk to" : "Interact with" },
      threat: Math.max(0, ...hunting.map(stalk => stalk.threat)), alert: { chase: "hunted", search: "searching" }[alert] ?? alert ?? "", hidden, sneaking,
      abilities: abilities.map(ability => {
        const rounds = ammo.get(ability.slot);
        return { ...ability, remaining: Math.max(0, (cooldowns.get(ability.slot) ?? 0) - time, (rounds?.reloadUntil ?? 0) - time),
          ...(rounds && { ammo: rounds.clip, reserve: Number.isFinite(rounds.reserve) ? rounds.reserve : null, reloading: rounds.reloadUntil > 0 }) };
      }),
      bindings, crosshair, notice: noticeText, error: loadError, deathText: config.deathText ?? "",
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
  /** Rejects content that would only fail mid-game, or an objective no play can complete. */
  function validateContent() {
    const targets = new Map(), count = value => Number.isInteger(value) && value > 0;
    for (const def of [...(config.characters ?? []), ...(config.objects ?? [])]) {
      if (!def.id || targets.has(def.id)) throw new Error("Target IDs must be unique.");
      targets.set(def.id, def);
      if (def.item !== undefined && !count(def.count ?? 1)) throw new Error(`${def.id} count must be a positive integer.`);
      for (const [item, n] of Object.entries(def.drops ?? {})) if (!count(n)) throw new Error(`${def.id} drops of ${item} must be a positive integer.`);
    }
    // Enemies, hiding spots and opted-out targets never reach the talk/deliver path of interact().
    const talkable = def => def && !def.enemy && !def.hide && def.interactable !== false;
    for (const q of progress.quests) {
      if (q.giver && !targets.has(q.giver)) throw new Error(`Quest ${q.id} has unknown giver ${q.giver}.`);
      if (q.giver && !talkable(targets.get(q.giver))) throw new Error(`Quest ${q.id} giver ${q.giver} must be a character the player can talk to, not an enemy or hiding spot.`);
      for (const [item, n] of Object.entries(q.reward?.items ?? {})) if (!count(n)) throw new Error(`Quest ${q.id} reward of ${item} must be a positive integer.`);
      for (const o of q.objectives) {
        const target = targets.get(o.target);
        if (["talk", "defeat", "deliver"].includes(o.type) && !target) throw new Error(`Unknown objective target ${o.target}.`);
        if (["talk", "deliver"].includes(o.type) && !talkable(target)) throw new Error(`Quest ${q.id} ${o.type} target ${o.target} must be a character or object the player can interact with, not an enemy or hiding spot.`);
        if (o.type === "defeat" && !(target.enemy && Number.isFinite(maxHealthOf(target)))) throw new Error(`Quest ${q.id} defeat target ${o.target} must be an enemy that can die (give a stalker health).`);
        if (o.type === "defeat" && (o.count ?? 1) !== 1) throw new Error(`Quest ${q.id} defeat ${o.target} needs count 1: each enemy is defeated once, so add one objective per enemy.`);
        if (o.type === "visit" && !(config.zones ?? []).some(z => z.id === o.target)) throw new Error(`Unknown visit zone ${o.target}.`);
      }
    }
  }
  function play() {
    if (disposed || loading || loadError) return;
    for (const reason of ["ready", "pause", "focus"]) session.release(reason);
    // Prime audio the browser has not started loading (iOS waits for a gesture); load() on
    // anything further along would restart music that is already playing.
    for (const value of assets.values()) if (value instanceof HTMLAudioElement && value.readyState === HTMLMediaElement.HAVE_NOTHING && value.networkState !== HTMLMediaElement.NETWORK_LOADING) value.load();
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
    if (hidden) { setHidden(null); return; }
    const actor = nearestInteraction();
    if (!actor) { notice("Move closer to someone or something you can interact with."); return; }
    const def = actor.def;
    if (def.hide) { setHidden(actor); return; }
    progress.event("talk", def.id); progress.deliver(def.id);
    if (def.item) { progress.collect(def.item, def.count ?? 1); actor.dead = true; actor.root.visible = false; actor.body?.remove(); if (selected === def.id) select(null); notice(`Collected ${def.name ?? def.item}`); return; }
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
  function applySpeed() {
    const walk = hidden ? 0 : sneaking ? walkSpeed * .5 : walkSpeed;
    player.setMoveSpeed(walk, hidden || sneaking ? walk : runSpeed);
  }
  /** Hiding holds the player in place beside the spot; only stalkers are fooled by it. */
  function setHidden(spot) {
    hidden = !!spot; hideSpot = spot; hideFeet = spot ? player.position : null;
    if (view !== "first") player.visual.visible = !hidden;
    applySpeed(); refresh();
  }
  function setSneak(on) {
    if (!stalkers || sneaking === on || !player) return;
    sneaking = on; applySpeed(); refresh();
  }
  function nearestInteraction() {
    if (!player) return null;
    let nearest = null, distance = Infinity;
    const position = player.position;
    for (const actor of actors.values()) {
      if (!actor.interactable || actor.def.enemy || actor.dead) continue;
      const next = actor.position().distanceTo(position);
      // Stable registration order breaks ties; selection never overrides proximity.
      if (next < distance && reachable(actor, actor.def.interactRange ?? 3)) { nearest = actor; distance = next; }
    }
    return nearest;
  }
  function damage(amount) {
    if (!session.playing) return;
    health = Math.max(0, health - Math.max(0, amount)); config.onDamage?.(amount, api);
    if (!health) { closeDialogue(); session.hold("dead"); } refresh();
  }
  const livingEnemies = () => [...actors.values()].filter(actor => actor.def.enemy && !actor.dead);
  const chest = actor => actor.position().add(new THREE.Vector3(0, (actor.def.height ?? 1.8) * .55, 0));
  function hitEnemy(actor, ability, alert = false) {
    // A shot from beyond aggro range still provokes; melee keeps its proximity rules.
    if (actor.stalk) { setStalk(actor, stepStalker({ mode: "chase" }, { seen: true }, 0, actor.def)); actor.lastKnown = player.position; }
    if (!Number.isFinite(actor.health)) { config.onHit?.(actor, ability, api); return; }
    actor.health = Math.max(0, actor.health - (ability.damage ?? 10)); if (alert) actor.alertUntil = time + 8;
    combatHealth.delete(actor.def.id); combatHealth.set(actor.def.id, time + 5);
    if (!actor.health) {
      actor.dead = true; actor.root.visible = false; actor.body.remove();
      progress.event("defeat", actor.def.id);
      for (const [id, count] of Object.entries(actor.def.drops ?? {})) progress.collect(id, count);
      notice(`Defeated ${actor.def.name ?? actor.def.id}`);
    }
    config.onHit?.(actor, ability, api);
  }
  function tracer(from, to, color) {
    const mesh = new THREE.Mesh(tracerGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false }));
    mesh.position.copy(from); mesh.lookAt(to); mesh.scale.z = Math.max(.01, from.distanceTo(to));
    scene.add(mesh); effects.push({ mesh, until: time + .09 });
  }
  function removeMesh(mesh) { mesh.removeFromParent(); mesh.material.dispose(); }
  function shoot(ability) {
    const range = ability.range ?? 40, first = view === "first", exclude = [player.body];
    camera.updateMatrixWorld();
    const eye = camera.getWorldPosition(new THREE.Vector3()), aim = camera.getWorldDirection(new THREE.Vector3());
    const from = first ? eye.clone() : player.position.add(new THREE.Vector3(0, playerHeight * .7, 0));
    // Soft lock: generated games stay playable without precise mouse aim.
    const target = queryRangedTarget(eye, aim, from, livingEnemies().map(actor => ({ actor, position: chest(actor) })), {
      range, cone: ability.aimAssist ?? (first ? .06 : .44),
      visible: ({ actor, position }) => { const hit = world.castSegment(from, position, { exclude }); return !hit || hit.body === actor.body; },
    });
    let to = target?.position;
    if (!to) {
      // Otherwise shoot from the muzzle at whatever the crosshair ray meets.
      const reach = range + eye.distanceTo(from), sight = world.castSegment(eye, eye.clone().addScaledVector(aim, reach), { exclude });
      to = eye.clone().addScaledVector(aim, sight ? sight.distance : reach);
      if (to.distanceTo(from) > range) to = from.clone().add(to.clone().sub(from).setLength(range));
    }
    // Reach slightly past a surface point so the final segment does not stop just short of it.
    const hit = world.castSegment(from, to.clone().add(to.clone().sub(from).setLength(.1)), { exclude });
    const end = hit ? from.clone().add(to.clone().sub(from).setLength(hit.distance)) : to;
    const up = camera.up.clone(), right = aim.clone().cross(up).normalize();
    const muzzle = first ? eye.clone().addScaledVector(right, .18).addScaledVector(up, -.14).addScaledVector(aim, .4) : from.clone().addScaledVector(player.forward, .35);
    tracer(muzzle, end, ability.tracer ?? "#ffe29a");
    const actor = actors.get(hit?.body.data?.rpgId);
    if (actor?.def.enemy && !actor.dead) hitEnemy(actor, ability, true);
  }
  function reload(slot) {
    if (disposed || !session?.playing) return;
    for (const [index, rounds] of ammo) {
      if ((slot !== undefined && index !== slot) || rounds.reloadUntil || rounds.clip >= kit[index].ammo.clip || !rounds.reserve) continue;
      rounds.reloadUntil = time + (kit[index].reload ?? 1.2);
    }
    refresh();
  }
  function addAmmo(slot, count) {
    const rounds = ammo.get(slot); if (!rounds) throw new Error(`Ability ${slot} has no ammo.`);
    rounds.reserve += Math.max(0, count); refresh();
  }
  function attack(index = 0) {
    if (disposed || !session?.playing) return;
    const ability = kit[index]; if (!ability || hidden) return;
    const kind = kindOf(ability), rounds = ammo.get(index);
    // Held-down firing retries often, so ranged attacks recover silently.
    if ((cooldowns.get(index) ?? 0) > time || rounds?.reloadUntil) { if (kind !== "ranged") notice("Ability is recovering."); return; }
    if (rounds && !rounds.clip) { if (rounds.reserve) reload(index); else notice(`${ability.name ?? "Ability"} is out of ammo.`); return; }
    cooldowns.set(index, time + (ability.cooldown ?? (kind === "ranged" ? .25 : .6)));
    if (kind === "heal") {
      health = Math.min(config.player?.health ?? 100, health + ability.heal);
    } else if (kind === "ranged") {
      if (rounds) rounds.clip--;
      shoot(ability);
      if (rounds && !rounds.clip) reload(index);
    } else {
      const candidates = livingEnemies().map(actor => ({ actor, position: actor.position() }));
      const from = player.position.add(new THREE.Vector3(0, .9, 0));
      // A wide swing can hit several enemies; other enemies are not walls.
      const exclude = [player.body, ...candidates.map(({ actor }) => actor.body)];
      const hits = queryMeleeTargets(player.position, player.forward, candidates, {
        range: ability.range ?? 3, arc: ability.arc ?? Math.PI * 2 / 3,
        visible: ({ actor, position }) => !world.castSegment(from, position.clone().add(new THREE.Vector3(0, Math.min(actor.def.height ?? 1.5, .9), 0)), { exclude }),
      });
      for (const { actor } of hits) hitEnemy(actor, ability);
    }
    ability.effect?.(api); refresh();
  }
  function respawn() {
    combatHealth.clear(); ammo = ammoDefaults(); sneaking = false; setHidden(null);
    for (const shot of shots.splice(0)) removeMesh(shot.mesh);
    player.teleport(config.checkpoint ?? spawn); health = config.player?.health ?? 100;
    for (const actor of actors.values()) if (actor.npc && !actor.dead) { actor.npc.teleport(actor.home.toArray()); actor.npc.setVelocity([0, 0, 0]); actor.health = maxHealthOf(actor.def); actor.alertUntil = 0; if (actor.stalk) { setStalk(actor, calm()); actor.lastKnown = null; } }
    session.release("dead"); session.hold("pause"); refresh();
  }
  // dispose()/restart() may run while setup awaits; each await then checks before building more.
  function alive() { if (disposed) throw new Error("RPG game was disposed while loading."); }
  function restart() { if (!restartPromise) { dispose(); restartPromise = createRpgGame(config); } return restartPromise; }
  function model(id) {
    const value = assets.get(id); if (!value?.scene) throw new Error(`Missing model asset: ${id}`);
    return cloneSkeleton(value.scene);
  }
  const addSurface = mesh => scenery.addSurface(mesh);
  const addProp = (object, options) => scenery.addProp(object, options);
  const addDecoration = (object, options) => scenery.addDecoration(object, options);
  const removeProp = object => scenery.removeProp(object);
  function dispose() {
    if (disposed) return; disposed = true;
    renderer?.setAnimationLoop(null); session?.dispose(); world?.dispose();
    presentation?.dispose?.(); tracerGeometry.dispose(); shotGeometry.dispose();
    for (const cleanup of [...listeners, ...cleanups]) cleanup();
    const resources = new Set();
    scene.traverse(n => { if (n.geometry) resources.add(n.geometry); for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : []) { resources.add(m); for (const v of Object.values(m)) if (v?.isTexture) resources.add(v); } });
    for (const a of assets.values()) { if (a?.isTexture) resources.add(a); if (a instanceof HTMLAudioElement) { a.pause(); a.src = ""; } }
    for (const resource of resources) resource.dispose(); renderer?.dispose(); root.remove();
  }
  const api = { scene, camera, root, assets, actors, progress, model, addSurface, addProp, addDecoration, removeProp, select, interact, attack, reload, addAmmo, damage, showDialogue, closeDialogue, notice, dispose, restart,
    get player() { return player; }, get world() { return world; }, get renderer() { return renderer; }, get session() { return session; }, get selected() { return selected; }, get health() { return health; }, get hidden() { return hidden; },
    onDispose: fn => cleanups.push(fn),
  };
  try {
    const actions = Object.freeze({ play, pause: () => session?.hold("pause"), restart, respawn, interact, attack, reload, closeDialogue, chooseDialogue });
    const uiContext = { root: ui, game: api, actions, bindAction, createControlsLegend };
    presentation = config.createUI({ ...uiContext, bindUI: options => bindRpgUI(uiContext, options) });
    if (!presentation || typeof presentation.update !== "function") throw new Error("createUI must return {update(state), dispose?()}.");
    // UI key presses must not become movement/ability input. Escape still closes or pauses.
    listen(ui, "keydown", event => { if (event.code !== "Escape") event.stopPropagation(); });
    refresh();
    validateContent();
    const lighting = resolveRpgLighting(config.visuals);
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = config.visuals?.shadows !== false; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = lighting.exposure;
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
    alive();
    if (config.skybox) { const sky = assets.get(config.skybox); if (!sky?.isTexture) throw new Error("Skybox must reference a texture asset."); sky.mapping = THREE.EquirectangularReflectionMapping; scene.background = sky; if (config.visuals?.environment !== false) scene.environment = sky; }
    else scene.background = new THREE.Color(config.visuals?.background ?? "#97b8d2");
    if (config.visuals?.fog) scene.fog = new THREE.Fog(...config.visuals.fog);
    const hemi = new THREE.HemisphereLight(config.visuals?.skyColor ?? 0xe7f3ff, config.visuals?.groundColor ?? 0x635f52, lighting.ambientIntensity); scene.add(hemi);
    const sun = new THREE.DirectionalLight(config.visuals?.sunColor ?? 0xffe6b5, lighting.sunIntensity); sun.position.fromArray(config.visuals?.sunPosition ?? [20, 35, 15]);
    sun.castShadow = renderer.shadowMap.enabled; sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .035;
    const extent = config.visuals?.shadowExtent ?? 45; Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .5, far: 160 }); sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
    const physics = await createRpgWorld();
    if (disposed) physics.dispose();
    alive();
    scenery = createRpgScenery(scene, physics);
    world = { ...physics, addStaticMesh: scenery.addStaticMesh };
    await config.buildWorld?.(api);
    alive();
    scenery.finalize();
    if (!world.getDiagnostics().bodies) throw new Error("World requires a walkable collision surface in buildWorld.");
    const p = config.player ?? {};
    player = await world.addPlayer({ model: model(p.model), feet: spawn, height: p.height ?? 1.8, radius: p.radius ?? .35, modelYaw: p.modelYaw ?? 0,
      speed: p.speed ?? 5, runSpeed: p.runSpeed ?? 8, jumpSpeed: p.jumpSpeed ?? RPG_MOVEMENT_DEFAULTS.jumpSpeed, distance: p.distance ?? 6, yaw: p.yaw ?? 0, pitch: p.pitch ?? (p.view === "first" ? 0 : .3),
      canvas: renderer.domElement, camera, view: p.view ?? "third", ...(scheme === "mmo"
        ? { controlMode: "mmo", keyboardLayout: "classic", facing: "camera", onSelect: ({ hit }) => select(hit?.body.data?.rpgId ?? null) }
        : { controlMode: "pointer", facing: "camera", onAttack: () => attack(0) }) });
    alive();
    scene.add(player.root);
    function animate(actor, def, gone = () => false) {
      const clips = assets.get(def.model)?.animations ?? [];
      if (!clips.length || !def.animations) return;
      const mixer = new THREE.AnimationMixer(actor.visual ?? actor.root), actions = {};
      for (const [state, name] of Object.entries(def.animations)) { const clip = clips.find(c => c.name === name); if (clip) actions[state] = mixer.clipAction(clip); }
      mixers.push({ mixer, actions, actor, gone, current: null });
    }
    animate(player, p);
    for (const equipment of p.equipment ?? []) {
      const obj = fitRpgModel(model(equipment.model), { height: equipment.height ?? .8, yaw: equipment.modelYaw ?? 0 });
      obj.position.fromArray(equipment.position ?? [0, 0, 0]); player.visual.add(obj);
    }
    for (const def of [...(config.characters ?? []), ...(config.objects ?? [])]) {
      const home = new THREE.Vector3(...(def.feet ?? [0, 0, 0])); let body, visual, npc;
      if (def.enemy || def.patrol) {
        npc = world.addNpc({ model: model(def.model), feet: home.toArray(), height: def.height ?? 1.8, radius: def.radius ?? .35, modelYaw: def.modelYaw ?? 0, data: { rpgId: def.id } });
        body = npc.body; visual = npc.root; animate(npc, def, () => actors.get(def.id)?.dead);
      } else {
        visual = fitRpgModel(model(def.model), { height: def.height ?? 1.8, yaw: def.modelYaw ?? 0 }); visual.position.copy(home);
        body = world.addBody({ type: "fixed", position: home.clone().add(new THREE.Vector3(0, (def.height ?? 1.8) / 2, 0)).toArray(), shape: { type: "box", size: [def.width ?? .8, def.height ?? 1.8, def.width ?? .8] }, data: { rpgId: def.id } });
      }
      visual.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } }); scene.add(visual);
      const interactable = def.interactable ?? !!(interactionIds.has(def.id) || def.item || def.dialogue || def.onInteract || def.hide);
      actors.set(def.id, { def, body, root: visual, npc, home, position: () => npc ? npc.position : home.clone(), health: maxHealthOf(def), dead: false, interactable, nextAttack: 0, alertUntil: 0, waypoint: 0, ...(def.enemy === "stalker" && { stalk: calm(), lastKnown: null }) });
    }
    for (const q of progress.quests) if (q.autoStart) progress.accept(q.id);
    session = createRpgSession({ suspend: () => { player.pause(); setSneak(false); }, resume: () => player.resume(), changed: refresh });
    function resize() { camera.aspect = root.clientWidth / Math.max(1, root.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(root.clientWidth, root.clientHeight); }
    listen(window, "resize", resize); resize();
    listen(window, "blur", () => session.hold("focus"));
    listen(document, "visibilitychange", () => { if (document.hidden) session.hold("focus"); });
    listen(window, "keydown", event => {
      if (event.target?.closest?.("input,textarea,[contenteditable=true]") || event.repeat) return;
      if (event.code === "Escape") { event.preventDefault(); if (dialogue) closeDialogue(); else session.hold("pause"); return; }
      if (!session.playing) return;
      if (event.code === "KeyF") { event.preventDefault(); interact(); }
      if (event.code === "KeyR" && ammo.size) { event.preventDefault(); reload(); }
      if (event.code === "KeyC") setSneak(true);
      const action = bindings.find(b => b.code === event.code && b.slot !== undefined); if (action) { event.preventDefault(); attack(action.slot); }
    });
    listen(window, "keyup", event => { if (event.code === "KeyC") setSneak(false); });
    const zones = new Set(), lastPlayer = player.position;
    let moving = false, running = false, captured = false, capturing = 0;
    function patrolGoal(actor, pos) {
      if (!actor.def.patrol?.length) return actor.home;
      const goal = new THREE.Vector3(...actor.def.patrol[actor.waypoint]);
      if (pos.distanceTo(goal) < .7) actor.waypoint = (actor.waypoint + 1) % actor.def.patrol.length;
      return goal;
    }
    /** Returns a movement goal, or null when the stalker stands still this step. */
    function stalk(actor, dt, pos, delta, distance) {
      const def = actor.def, flat = new THREE.Vector3(delta.x, 0, delta.z), before = actor.stalk.mode;
      const bearing = flat.lengthSq() > 1e-8 ? actor.npc.forward.angleTo(flat.normalize()) : 0;
      const eye = player.position.add(new THREE.Vector3(0, playerHeight * .6, 0)), sight = distance <= Math.max(def.sight ?? 14, def.hearing ?? 6) + 1
        && world.castSegment(eye, chest(actor), { exclude: player.body });
      const clear = sight === false ? false : !sight || sight.body === actor.body;
      const senses = stalkerSenses({ distance, bearing, clear, hidden, moving, running, sneaking, mode: before }, def);
      setStalk(actor, stepStalker(actor.stalk, senses, dt, def));
      if (senses.seen || senses.heard) actor.lastKnown = player.position;
      const mode = actor.stalk.mode, still = () => { actor.npc.setVelocity([0, 0, 0]); return null; };
      if (mode === "chase") {
        const reach = def.attackRange ?? 1.6;
        if (senses.seen && distance <= reach && reachable(actor, reach)) {
          still(); actor.npc.faceDirection(delta.toArray());
          if (time >= actor.nextAttack) { actor.nextAttack = time + (def.attackCooldown ?? 1.5); damage(def.damage ?? 25); if (hidden && health) setHidden(null); }
          return null;
        }
        return { goal: actor.lastKnown, speed: def.chaseSpeed ?? 4.5 };
      }
      if (mode === "search") {
        if (actor.lastKnown && pos.distanceTo(actor.lastKnown) > 1) return { goal: actor.lastKnown, speed: (def.speed ?? 2) * 1.3 };
        still(); actor.npc.faceDirection([Math.sin(time * 1.5), 0, Math.cos(time * 1.5)]); return null;
      }
      if (mode === "suspicious") { still(); if (actor.lastKnown) actor.npc.faceDirection(actor.lastKnown.clone().sub(pos).toArray()); return null; }
      return { goal: patrolGoal(actor, pos), speed: def.speed ?? 2 };
    }
    function fireAt(actor) {
      const def = actor.def, from = chest(actor), speed = def.projectileSpeed ?? 14;
      const mesh = new THREE.Mesh(shotGeometry, new THREE.MeshBasicMaterial({ color: def.projectileColor ?? "#ff7a45" }));
      mesh.position.copy(from); scene.add(mesh);
      // Aimed at where the player is now, so moving dodges it.
      const velocity = player.position.add(new THREE.Vector3(0, playerHeight * .6, 0)).sub(from).setLength(speed);
      shots.push({ mesh, velocity, left: (def.attackRange ?? 14) * 1.5 / speed, damage: def.damage ?? 6 });
    }
    function step(dt) {
      const now = player.position, speed = dt > 0 ? Math.hypot(now.x - lastPlayer.x, now.z - lastPlayer.z) / dt : 0; lastPlayer.copy(now);
      moving = speed > .5; running = speed > walkSpeed * 1.15;
      for (const [index, rounds] of ammo) if (rounds.reloadUntil && time >= rounds.reloadUntil) {
        const moved = Math.min(kit[index].ammo.clip - rounds.clip, rounds.reserve);
        rounds.clip += moved; rounds.reserve -= moved; rounds.reloadUntil = 0;
      }
      const enemyBodies = livingEnemies().map(actor => actor.body);
      for (let i = shots.length - 1; i >= 0; i--) {
        const shot = shots[i], from = shot.mesh.position.clone(), travel = shot.velocity.clone().multiplyScalar(dt);
        const hit = world.castSegment(from, from.clone().add(travel), { exclude: enemyBodies });
        shot.left -= dt;
        if (hit || shot.left <= 0) { shots.splice(i, 1); removeMesh(shot.mesh); if (hit?.body === player.body) damage(shot.damage); }
        else shot.mesh.position.add(travel);
      }
      for (const actor of actors.values()) {
        if (!actor.npc || actor.dead) continue;
        const pos = actor.position(), delta = player.position.sub(pos), distance = delta.length(), ranged = actor.def.enemy === "ranged";
        const range = actor.def.attackRange ?? (ranged ? 14 : 2);
        let goal = actor.home, speed = actor.def.speed ?? 2.5;
        if (actor.stalk) {
          const plan = stalk(actor, dt, pos, delta, distance); if (!plan) continue;
          ({ goal, speed } = plan);
        } else if (actor.def.enemy && (distance < (actor.def.aggroRange ?? (ranged ? 16 : 10)) || actor.alertUntil > time) && pos.distanceTo(actor.home) < (actor.def.leash ?? 20)) {
          if (distance <= range && reachable(actor, range)) {
            actor.npc.setVelocity([0, 0, 0]); actor.npc.faceDirection(delta.toArray());
            if (time >= actor.nextAttack) {
              actor.nextAttack = time + (actor.def.attackCooldown ?? (ranged ? 2 : 1.5));
              if (ranged) fireAt(actor); else damage(actor.def.damage ?? 8);
            }
            continue;
          }
          goal = player.position;
        } else goal = patrolGoal(actor, pos);
        const direction = goal.clone().sub(pos); direction.y = 0;
        if (direction.length() > .4) direction.normalize().multiplyScalar(speed); else direction.set(0, 0, 0);
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
    // Hiding also rules out jumping. The engine has no per-player jump switch, so a hop out of
    // hiding is undone in the same fixed step, before it is ever rendered.
    function holdHidden() { if (hidden && player.position.y > hideFeet.y + .05) player.teleport(hideFeet.toArray()); }
    renderer.setAnimationLoop(now => {
      // Allow the fixed-step motor to catch up below 20 FPS; a 50ms cap made
      // jumps and cooldowns take longer in wall time on slower renderers.
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(8 / 60, (now - lastTime) / 1000)); lastTime = now;
      // Mouse capture is granted asynchronously and reads as inactive until then. Pause when an
      // active round loses it, or when a request never settles (the engine falls back within 0.7s).
      if (!session.playing) { captured = false; capturing = 0; }
      else if (player.active) { captured = true; capturing = 0; }
      else if (captured || (capturing += dt) > 1.5) session.hold("pause");
      if (session.playing) time += dt;
      world.advance(dt, { paused: !session.playing, beforeStep: step, afterStep: holdHidden });
      if (session.playing) {
        for (let i = mixers.length - 1; i >= 0; i--) {
          const item = mixers[i];
          // A defeated or collected actor has no body left to read a position from.
          if (item.gone()) { item.mixer.stopAllAction(); mixers.splice(i, 1); continue; }
          // Body velocity, not rendered-frame displacement: above 60 Hz some frames have no physics step.
          // The gap between the walk and idle thresholds keeps a slowing actor from flickering.
          const velocity = item.actor.body.velocity, speed = Math.hypot(velocity.x, velocity.z);
          const next = !item.actor.grounded ? "jump" : speed > (item.current === "walk" ? .1 : .3) ? "walk" : "idle";
          if (next !== item.current && item.actions[next]) {
            const action = item.actions[next]; item.actions[item.current]?.fadeOut(.15);
            // A clip still fading out continues from where it is instead of restarting.
            if (!action.isRunning()) action.reset();
            action.fadeIn(.15).play(); item.current = next;
          }
          item.mixer.update(dt);
        }
        if (noticeUntil && time > noticeUntil) { noticeText = ""; noticeUntil = 0; }
        for (let i = effects.length - 1; i >= 0; i--) {
          const left = effects[i].until - time;
          if (left > 0) effects[i].mesh.material.opacity = .9 * left / .09; else removeMesh(effects.splice(i, 1)[0].mesh);
        }
      }
      uiTime += dt; if (uiTime > .1) { refresh(); uiTime = 0; }
      renderer.render(scene, camera);
    });
    loading = false; refresh(); config.onReady?.(api); return api;
  } catch (error) {
    // A superseded load is not a failure; a restart's caller gets the replacement game.
    if (disposed) return restartPromise ?? api;
    renderer?.setAnimationLoop(null); session?.dispose();
    loadError = error.message ?? String(error); loading = false; refresh(); throw error;
  }
}
