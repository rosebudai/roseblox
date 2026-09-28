import { createGame, createVoxelKit } from '../../build/roseblox.js';

const game = await createGame({ canvas: document.querySelector('canvas') });
const theme = new URLSearchParams(location.search).get('theme') || 'woodland';
const kit = createVoxelKit(game, { theme, seed: 7 });
kit.ground({ size: [54, 3, 76], position: [0, -1.5, -22] });
// Separate raised land remains independent physics, useful for platformers.
for (const x of [-15, 15]) kit.ground({ size: [16, 5, 38], position: [x, -0.4, -25] });
kit.scatter('trees', { count: 58, bounds: [-25, 25, -56, 13], exclude: [-5, 5, -50, 14] });
kit.scatter('flowers', { count: 100, bounds: [-24, 24, -50, 12], exclude: [-2, 2, -16, 5] });
kit.scatter('rocks', { count: 35, bounds: [-24, 24, -50, 12], exclude: [-3, 3, -20, 8] });
kit.scatter('clouds', { count: 14, bounds: [-38, 38, -65, -12] });
kit.blocks(Array.from({ length: 18 }, (_, i) => ({ position: [0, 0.015, 4 - i * 2], size: [3, 0.03, 1.94], color: i % 2 ? '#ae925b' : '#b59a63' })));
const player = kit.avatar(game.addPlayer({ position: [0, 1.1, 2], speed: 5 }));
player.player.enabled = false;
game.followCamera(player, { offset: [0, 5, 9] });
let coins = [], score = 0, playing = false;
const hud = kit.hud({ title: 'BLOCKWOOD', objective: 'Find the three trail treasures', onStart: reset, onRestart: reset });
hud.setScore(0, 3);
function reset() {
  for (const coin of coins) game.remove(coin);
  coins = [-4, -8, -12].map(z => kit.pickup({ position: [0, 1, z] }));
  score = 0; playing = true; player.player.enabled = true;
  game.teleport(player, [0, 1.1, 2]);
  hud.setScore(score, 3); hud.setState('playing');
}
game.onUpdate(() => {
  if (!playing) return;
  if (player.transform.position.y < -12) game.teleport(player, [0, 1.1, 2]);
  for (const coin of [...coins]) if (player.transform.position.distanceTo(coin.transform.position) < 1.2) {
    kit.burst(coin.transform.position); game.remove(coin); coins.splice(coins.indexOf(coin), 1);
    hud.setScore(++score, 3);
    if (score === 3) { playing = false; player.player.enabled = false; hud.setState('won'); }
  }
});
window.addEventListener('pagehide', () => game.dispose(), { once: true });
window.voxelExample = { game, kit, player, hud, get coins() { return coins; } };
