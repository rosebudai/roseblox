import { createGame } from './roseblox.js';
import { night, restartEnabled } from './stage.js';

const canvas = document.querySelector('#game-canvas');
const scoreNode = document.querySelector('#score');
const statusNode = document.querySelector('#status');
const startButton = document.querySelector('#start');
const restartButton = document.querySelector('#restart');
document.querySelector('#course-title').textContent = night ? 'Night course' : 'Coin course';
restartButton.hidden = !restartEnabled;

const game = await createGame({
  canvas,
  SCENE: { BACKGROUND_COLOR: night ? '#101d45' : '#87ceeb' },
  LIGHTING: { AMBIENT_INTENSITY: night ? 0.65 : 1.2, DIRECTIONAL_INTENSITY: night ? 1.3 : 2 },
  SHADOWS: { CAMERA_SIZE: 25, MAP_SIZE: 1024 },
});
game.addBox({ name:'ground', size:[30,1,50], position:[0,-0.5,-12], color:'#427648' });
game.addBox({ name:'track', size:[6,0.04,25], position:[0,0.02,-10], color:'#73a768', body:'none' });
for (const x of [-3.4,3.4]) {
  for (let z=2; z>=-18; z-=2) {
    game.addBox({ name:'track-marker', size:[0.22,0.8,0.22], position:[x,0.4,z], color:'#c4ddcf' });
    if (night) {
      game.addSphere({ name:'track-light', radius:0.15, position:[x,0.94,z], color:'#ffe9aa',
        material:{emissive:'#ffd681',emissiveIntensity:2}, body:'none' });
    }
  }
}
const player = game.addPlayer({ name:'player', position:[0,1,0], speed:4, cameraRelative:false, color:'#318ee8' });
game.followCamera(player, {offset:[0,5,8],lookOffset:[0,0,-2]});
player.player.enabled = false;
let coins = [];
let score = 0;
let active = false;
function restoreCoins() {
  for (const coin of coins) game.remove(coin);
  coins = [-4,-8,-12].map(z=>game.addSphere({name:'gold-coin',radius:0.55,position:[0,1,z],
    color:'#ffd139',material:{emissive:'#ffc327',emissiveIntensity:night?0.8:0.1},body:'none'}));
}
function begin() {
  active = true;
  player.player.enabled = true;
  startButton.disabled = true;
  statusNode.textContent = 'Follow the green track.';
  canvas.focus();
}
function restart() {
  restoreCoins();
  score = 0;
  scoreNode.textContent = 'Score: 0';
  game.teleport(player,[0,1,0]);
  begin();
}
restoreCoins();
startButton.addEventListener('click',begin);
restartButton.addEventListener('click',restart);
game.onUpdate(()=>{
  if (!active) return;
  for (const coin of [...coins]) {
    // Collection depends on world-space contact, not elapsed input or the HUD.
    if (coin.transform.position.distanceTo(player.transform.position) < 1) {
      game.remove(coin);
      coins = coins.filter(candidate=>candidate!==coin);
      scoreNode.textContent = `Score: ${++score}`;
      if (score===3) {
        statusNode.textContent = 'You won';
        active = false;
        player.player.enabled = false;
      }
    }
  }
  if (player.transform.position.y < -10) restart();
});
window.addEventListener('pagehide',()=>game.dispose(),{once:true});
