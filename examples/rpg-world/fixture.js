import * as THREE from "three";
import { createRpgGame } from "../../build/rpgTemplate.js";
import { createUI } from "../rpg-template/ui.js";

const box = (size, position, color) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color }));
  mesh.position.fromArray(position); mesh.castShadow = true; return mesh;
};
window.fixture = await createRpgGame({
  title: "Solid scenery fixture", description: "Walk into the trunk, pass through the doorway, and jump onto the rock. This is an engineering fixture, not a generated game.",
  assets: { hero: { type: "model", url: "../rpg-template/fixture.gltf" } },
  player: { model: "hero", feet: [0, .1, 6], yaw: 0 },
  // Reproduces the real generated color-as-intensity failure.
  visuals: { ambient: 0x9ecf95, background: "#a5d4e6" }, createUI,
  buildWorld(game) {
    const floor = box([40, 1, 40], [0, -.5, 0], "#638348"); floor.receiveShadow = true;
    game.addSurface(floor);
    const tree = new THREE.Group();
    tree.add(box([1, 3, 1], [0, 1.5, 0], "#735232"));
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), new THREE.MeshStandardMaterial({ color: "#367543" }));
    crown.position.y = 4; crown.userData.rpgCollider = false; tree.add(crown);
    game.scene.add(tree, box([2, 1, 2], [-5, .5, 0], "#929a9b"));
    const arch = new THREE.Group(); arch.position.x = 5;
    arch.add(box([1, 4, 1], [-2, 2, 0], "#bba581"), box([1, 4, 1], [2, 2, 0], "#bba581"), box([5, 1, 1], [0, 4, 0], "#bba581"));
    game.scene.add(arch);
    game.addDecoration(box([1, 2, 1], [-8, 1, 0], "#bc83bd"));
  },
});
