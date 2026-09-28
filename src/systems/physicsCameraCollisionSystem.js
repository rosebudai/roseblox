/** Sync registered camera proxies after transforms and before camera-controls. */
export function physicsCameraCollisionSystem(_world, camera) {
  camera?.obstacles?.sync();
}
