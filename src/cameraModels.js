import * as THREE from "three";
import { makeInstance, modelHandle } from "./modelAttachments.js";
import { estimateModelForward } from "./modelOrientation.js";
import { registerObjectCleanup } from "./resources/renderer/disposeObject.js";

/** Camera props have no ECS transform for world synchronization to overwrite. */
export function createCameraModels({ camera, assets }) {
  const models = new Set();
  let disposed = false;
  return {
    async attach(url, {
      sourceForward, sourceUp = [0, 1, 0], forwardHint = [0, 0, 1], rotation = [0, 0, 0], framing = "contained",
      screenPosition = framing === "held" ? [.5, -.76] : [.52, -.52],
      screenSize = framing === "held" ? [.72, .9] : [.76, .7], distance = .9,
    } = {}) {
      if (disposed) throw new Error("Camera model attachments are disposed.");
      if (typeof url !== "string" || !url.trim()) throw new Error("attachCameraModel requires a nonempty GLTF/GLB URL.");
      const vector = (value, length, name) => {
        if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) throw new Error(`${name} must contain ${length} finite numbers.`);
        return [...value];
      };
      rotation = vector(rotation, 3, "rotation");
      if (!["contained", "held"].includes(framing)) throw new Error("Camera model framing must be 'contained' or 'held'.");
      const automatic = sourceForward === "long-axis";
      let forward, up, hint;
      if (sourceForward !== undefined) {
        forward = automatic ? null : new THREE.Vector3(...vector(sourceForward, 3, "sourceForward"));
        up = new THREE.Vector3(...vector(sourceUp, 3, "sourceUp"));
        hint = automatic ? new THREE.Vector3(...vector(forwardHint, 3, "forwardHint")) : null;
        if (![forward ?? hint, up].every(axis => Number.isFinite(axis.lengthSq()) && axis.lengthSq() >= 1e-12)) throw new Error("Camera model source axes must have finite, nonzero length.");
        forward?.normalize(); up.normalize(); hint?.normalize();
        if (new THREE.Vector3().crossVectors(forward ?? hint, up).lengthSq() < 1e-8) throw new Error("Camera model sourceForward/forwardHint and sourceUp must not be parallel.");
      }
      screenPosition = vector(screenPosition, 2, "screenPosition");
      screenSize = vector(screenSize, 2, "screenSize");
      if (screenSize.some((size, i) => size <= 0 || screenPosition[i] + size / 2 > .96 || screenPosition[i] - size / 2 < (i === 1 && framing === "held" ? -1.35 : -.96))) {
        throw new Error("Camera model screen rectangle must fit within -0.96 to 0.96; held framing allows its bottom down to -1.35.");
      }
      if (!Number.isFinite(distance) || distance <= 0) throw new Error("Camera model distance must be positive.");
      const asset = await assets.loadGLTF(`model:${url}`, url);
      if (disposed) throw new Error(`Camera model '${url}' finished loading after disposal.`);
      let orientation;
      if (automatic) {
        orientation = estimateModelForward(asset.scene, up, hint);
        forward = new THREE.Vector3(...orientation.sourceForward);
      }
      if (forward) {
        orientation ??= { mode: "explicit", sourceForward: forward.toArray(), sourceUp: up.toArray() };
        const right = new THREE.Vector3().crossVectors(forward, up);
        right.normalize(); up.crossVectors(right, forward).normalize();
        // Invert the authored basis to place its forward/up at camera -Z/+Y.
        const alignment = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(right, up, forward.negate()).transpose(),
        );
        const pose = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
        rotation = new THREE.Euler().setFromQuaternion(pose.multiply(alignment)).toArray().slice(0, 3);
      }
      const instance = makeInstance(assets.cloneGLTF(asset), {
        maxDimension: 1, anchor: "center", rotation, offset: [0, 0, 0], castShadow: false, receiveShadow: false,
      });
      const mount = new THREE.Group();
      mount.name = "Camera model screen placement";
      mount.add(instance.mesh);
      let unregister = () => {};
      const handle = modelHandle(instance, url, () => { models.delete(entry); unregister(); mount.removeFromParent(); });
      handle.orientation = orientation ?? { mode: "rotation" };
      const entry = { handle, mount, screenPosition, screenSize, distance, projection: "" };
      try {
        fit(entry, camera);
        camera.add(mount);
        unregister = registerObjectCleanup(mount, () => handle.dispose());
        models.add(entry);
        return handle;
      } catch (error) { handle.dispose(); throw error; }
    },
    update(dt) {
      for (const entry of models) {
        fit(entry, camera);
        entry.handle.update(dt);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of [...models]) entry.handle.dispose();
    },
  };
}

function fit(entry, camera) {
  if (!camera.isPerspectiveCamera) throw new Error("Camera models require a perspective camera.");
  const p = camera.projectionMatrix.elements;
  const projection = [p[0], p[5], p[8], p[9], camera.near, camera.far].join(",");
  if (projection === entry.projection) return;
  const distance = Math.max(entry.distance, camera.near * 2);
  if (distance >= camera.far || p[0] <= 0 || p[5] <= 0) throw new Error("Camera model needs a valid projection with space beyond the near plane.");
  const { min, max } = entry.handle.bounds;
  let scale = Infinity;
  const constrain = (coefficient, allowance) => { if (coefficient > 0) scale = Math.min(scale, allowance / coefficient); };
  // Project all eight rest-pose bounds corners. Perspective depth affects the
  // screen rectangle as well as the near/far limits, so a width-only fit clips.
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    for (let axis = 0; axis < 2; axis++) {
      const center = entry.screenPosition[axis], half = entry.screenSize[axis] / 2;
      const coordinate = axis === 0 ? x : y, focal = p[axis === 0 ? 0 : 5], offset = p[8 + axis];
      constrain(focal * coordinate + (center + half + offset) * z, half * distance);
      constrain(-focal * coordinate - (center - half + offset) * z, half * distance);
    }
    constrain(z, distance - camera.near * 1.1);
    constrain(-z, camera.far - distance);
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Camera model has no finite screen fit.");
  entry.mount.scale.setScalar(scale * .995);
  entry.mount.position.set((entry.screenPosition[0] + p[8]) * distance / p[0], (entry.screenPosition[1] + p[9]) * distance / p[5], -distance);
  entry.projection = projection;
}
