import { Game } from '../src/game.js';
import { BakedAssets } from './bakedAssets.js';

// 小工具版入口。和主版本的区别只有两点：
//   1. 资源层换成 BakedAssets（模型内嵌，零网络请求）
//   2. 打成 IIFE 经典脚本，页面里用 <script src> 引，不用 type="module"

const canvas = document.getElementById('gl');
const ui = document.getElementById('ui');
const game = new Game(canvas, ui, new BakedAssets());

game.boot(null).catch((e) => {
  const el = document.getElementById('fatal');
  el.style.display = 'block';
  el.textContent = '初始化失败：' + e.message;
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 留个调试入口，跟主版本一致
window.game = game;
