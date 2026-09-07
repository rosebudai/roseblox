import { createGame } from "../../build/roseblox.js";

const canvas = document.querySelector("canvas");
const scoreNode = document.querySelector("#score");
const statusNode = document.querySelector("#status");
const game = await createGame({
  canvas,
  SCENE: { BACKGROUND_COLOR: "#b8ded9" },
  LIGHTING: { AMBIENT_INTENSITY: 1.4, DIRECTIONAL_INTENSITY: 2 },
  SHADOWS: { CAMERA_SIZE: 25, MAP_SIZE: 1024 },
  onError: record => { document.querySelector("#error").textContent = record.message; },
});
game.addBox({ name: "ground", size: [40, 1, 60], position: [0, -0.5, -10], color: "#74a77c" });
game.addBox({ name: "path", size: [4, 0.08, 28], position: [0, 0.04, -8], color: "#ddc896", body: "none" });
for (const x of [-7, 7]) {
  for (let z = 4; z >= -20; z -= 6) {
    game.addBox({ name: "tree-trunk", size: [0.7, 2.4, 0.7], position: [x, 1.2, z], color: "#926c55" });
    game.addSphere({ name: "tree-crown", radius: 1.8, position: [x, 3.2, z], color: "#387a64", body: "none" });
  }
}
const player = game.addPlayer({ name: "player", position: [0, 1.2, 4], color: "#4789d1", speed: 5, cameraRelative: false });
game.followCamera(player, { offset: [0, 6, 9] });
let coins = [];
let score = 0;
function restart() {
  for (const coin of coins) game.remove(coin);
  coins = [0, -4, -8, -12, -16].map(z => game.addSphere({ name: "coin", radius: 0.45, position: [0, 1, z], color: "#ffce64", material: { emissive: "#d88913", emissiveIntensity: 0.35 }, body: "none" }));
  score = 0;
  scoreNode.textContent = "0";
  statusNode.textContent = "Follow the path ahead";
  game.teleport(player, [0, 1.2, 4]);
  canvas.focus();
}
document.querySelector("#restart").addEventListener("click", restart);
restart();
game.onUpdate(() => {
  for (const coin of [...coins]) {
    if (coin.transform.position.distanceTo(player.transform.position) < 1.1) {
      game.remove(coin);
      coins = coins.filter(candidate => candidate !== coin);
      scoreNode.textContent = String(++score);
      if (score === 5) statusNode.textContent = "You win! All five lights collected.";
    }
  }
  if (player.transform.position.y < -10) restart();
});
window.addEventListener("pagehide", () => game.dispose(), { once: true });
// The example exposes its real state for engine contract tests, not generation scoring.
window.exampleGame = { game, player, restart };
