// Physics transforms stay authoritative. Only presentation reads the delayed pose.
const poses = new WeakMap();

export function capturePhysicsPose(entity) {
  const { transform, physicsBody } = entity;
  if (physicsBody.rigidBody.isFixed?.()) { poses.delete(entity); return; }
  let pose = poses.get(entity);
  if (!pose || pose.body !== physicsBody.rigidBody) {
    pose = {
      body: physicsBody.rigidBody,
      previousPosition: transform.position.clone(), previousRotation: transform.rotation.clone(),
      currentPosition: transform.position.clone(), currentRotation: transform.rotation.clone(),
      position: transform.position.clone(), rotation: transform.rotation.clone(),
    };
    poses.set(entity, pose);
  }
  pose.previousPosition.copy(transform.position);
  pose.previousRotation.copy(transform.rotation);
  return pose;
}

export function resetPresentationTransform(entity) { poses.delete(entity); }

export function getPresentationTransform(entity, alpha = 1) {
  const pose = poses.get(entity);
  const transform = entity.transform;
  // A teleport or caller-authored transform must be visible immediately.
  if (!pose || pose.body !== entity.physicsBody?.rigidBody
    || !pose.currentPosition.equals(transform.position) || !pose.currentRotation.equals(transform.rotation)) return transform;
  pose.position.lerpVectors(pose.previousPosition, pose.currentPosition, alpha);
  pose.rotation.copy(pose.previousRotation).slerp(pose.currentRotation, alpha);
  return pose;
}
