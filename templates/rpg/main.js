import { createRpgGame } from './rosie/rpg/runtime.js';
import { assets } from './game/assets.js';
import { adventure } from './game/content.js';
import { buildWorld } from './game/world.js';
const theme = document.createElement('link');
theme.rel = 'stylesheet'; theme.href = './game/theme.css'; document.head.append(theme);
window.rpg = await createRpgGame({ ...adventure, assets, buildWorld });
