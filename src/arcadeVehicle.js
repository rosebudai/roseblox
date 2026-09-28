import * as THREE from "three";

const up = new THREE.Vector3(0, 1, 0);
const approach = (value, target, amount) => value + Math.sign(target - value) * Math.min(Math.abs(target - value), amount);

export function arcadeVehicleOptions(config) {
  if (config.onReset !== undefined && typeof config.onReset !== "function") throw new Error("Vehicle onReset must be a function.");
  const values = { maxSpeed: 32, reverseSpeed: 10, acceleration: 16, braking: 28, coast: 2, steerRate: 1.8, grip: 9, driftGrip: 1.8, cameraDistance: 7, cameraHeight: 3.5, lookAhead: 4, heading: 0 };
  for (const name of Object.keys(values)) {
    values[name] = config[name] ?? values[name];
    if (!Number.isFinite(values[name]) || (name !== "heading" && values[name] <= 0)) throw new Error(`Invalid vehicle ${name}.`);
  }
  return values;
}

/** Upright arcade chassis, not a wheel/suspension simulator. Owns no art or race rules. */
export function createArcadeVehicle({ entry, config, size, input, castRay, castSegment, requireLive, release }) {
  const { body, collider, handle } = entry;
  const { canvas, camera } = config, options = arcadeVehicleOptions(config);
  const spawn = entry.position.clone(), initialHeading = options.heading;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), velocity = new THREE.Vector3();
  const origin = new THREE.Vector3(), target = new THREE.Vector3(), eye = new THREE.Vector3(), direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  let enabled = false, active = false, grounded = false;
  let controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  const listeners = [];
  const listen = (object, type, fn) => { object?.addEventListener(type, fn); listeners.push(() => object?.removeEventListener(type, fn)); };
  const clear = () => { controls = { throttle: 0, steer: 0, brake: 0, handbrake: false }; input?.reset(); };
  const pause = () => { active = false; clear(); };
  const basis = q => { forward.set(0, 0, -1).applyQuaternion(q); right.crossVectors(forward, up); };
  body.setEnabledRotations(false, true, false, true);
  body.enableCcd(true);
  // The motor supplies directional tire grip; contact friction would brake the
  // chassis in every direction, including its forward axis.
  collider.setFriction(0);

  const controller = {
    get active() { return active; },
    get enabled() { return enabled; },
    get grounded() { return grounded; },
    get speed() { requireLive(); basis(body.rotation()); return velocity.copy(body.linvel()).dot(forward); },
    start() { requireLive(); if (!active) clear(); enabled = active = true; canvas?.focus({ preventScroll: true }); },
    stop() { enabled = false; pause(); },
    setControls(next = {}) {
      requireLive();
      const value = {};
      for (const name of ["throttle", "steer", "brake"]) {
        const n = next[name] ?? 0;
        if (!Number.isFinite(n)) throw new Error(`Vehicle ${name} must be finite.`);
        value[name] = THREE.MathUtils.clamp(n, name === "brake" ? 0 : -1, 1);
      }
      controls = { ...value, handbrake: Boolean(next.handbrake) };
    },
    reset(position = spawn, heading = initialHeading) {
      requireLive();
      if (!Number.isFinite(heading)) throw new Error("Vehicle heading must be finite.");
      handle.setRotation(quaternion.setFromAxisAngle(up, heading));
      handle.teleport(position);
    },
    resetMotion() { clear(); grounded = false; },
    clear,
    step(dt) {
      basis(body.rotation());
      const p = body.translation();
      grounded = false;
      // Four inset probes support ramps and track edges. Side walls and sensors
      // cannot masquerade as road; airborne cars retain their physical momentum.
      for (const x of [-.42, .42]) for (const z of [-.4, .4]) {
        origin.copy(p).addScaledVector(right, x * size.x).addScaledVector(forward, z * size.z);
        const hit = castRay(origin, [0, -1, 0], { maxDistance: size.y / 2 + .16, exclude: handle, collisionGroups: config.collisionGroups });
        if (hit && hit.normal.y > .45) grounded = true;
      }
      velocity.copy(body.linvel());
      let speed = velocity.dot(forward), lateral = velocity.dot(right);
      const keys = input?.getMovementVector() ?? { x: 0, z: 0 };
      const throttle = active ? THREE.MathUtils.clamp(controls.throttle - keys.z, -1, 1) : 0;
      const steer = active ? THREE.MathUtils.clamp(controls.steer + keys.x, -1, 1) : 0;
      const brake = active ? controls.brake : 0;
      const handbrake = active && (controls.handbrake || input?.isActionActive("handbrake"));
      let yawRate = 0;
      if (grounded) {
        if (brake || handbrake) speed = approach(speed, 0, (brake * options.braking + (handbrake ? options.braking * .3 : 0)) * dt);
        else if (throttle && speed * throttle < -.25) speed = approach(speed, 0, options.braking * Math.abs(throttle) * dt);
        else if (throttle) speed = approach(speed, throttle * (throttle > 0 ? options.maxSpeed : options.reverseSpeed), options.acceleration * Math.abs(throttle) * dt);
        else speed = approach(speed, 0, options.coast * dt);
        lateral *= Math.exp(-(handbrake ? options.driftGrip : options.grip) * dt);
        // Local -Z is forward. Positive steer turns right; reversing flips it.
        yawRate = -steer * options.steerRate * Math.min(Math.abs(speed) / 6, 1) / (1 + Math.abs(speed) * .015) * Math.sign(speed);
        const vertical = velocity.y;
        velocity.copy(forward).multiplyScalar(speed).addScaledVector(right, lateral); velocity.y = vertical;
        body.setLinvel(velocity, true);
      }
      body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);
    },
    updateCamera() {
      if (!camera) return;
      basis(entry.renderRotation);
      target.copy(entry.renderPosition); target.y += size.y / 2;
      eye.copy(target).addScaledVector(forward, -options.cameraDistance); eye.y += options.cameraHeight;
      const hit = castSegment(target, eye, { exclude: handle, collisionGroups: config.collisionGroups });
      if (hit) { direction.copy(eye).sub(target).normalize(); eye.copy(target).addScaledVector(direction, Math.max(0, hit.distance - .25)); }
      // Interpolated chassis pose already supplies smoothing, once per frame.
      camera.position.copy(eye);
      target.addScaledVector(forward, options.lookAhead);
      camera.up.copy(up); camera.lookAt(target); camera.updateMatrixWorld();
    },
    dispose() { controller.stop(); for (const off of listeners) off(); release(); },
  };
  listen(canvas?.ownerDocument.defaultView, "blur", pause);
  listen(canvas?.ownerDocument.defaultView, "keydown", event => {
    // setupInput has already applied its focus/editable-element checks. Ignore
    // key repeat so holding R cannot keep teleporting the chassis.
    if (active && event.code === "KeyR" && !event.repeat && input?.isKeyDown("KeyR")) {
      if (config.onReset) config.onReset(); else controller.reset();
    }
    if (active && event.code === "Escape" && input?.isKeyDown("Escape")) pause();
  });
  listen(canvas, "blur", pause);
  listen(canvas?.ownerDocument, "visibilitychange", () => { if (canvas.ownerDocument.hidden) pause(); });
  listen(canvas, "mousedown", () => { if (enabled && !active) controller.start(); });
  return controller;
}
