import { Game } from './game.js';
import { Assets } from './engine/assets.js';

const canvas = document.getElementById('gl');
const ui = document.getElementById('ui');
const game = new Game(canvas, ui, new Assets());

game.boot([
  { id: 'niulai', url: '/niulai.glb' },   // Tripo 生成，带 UV + PBR 贴图
  // GooFstore 打印件，无 UV，顶点色；模型正面朝 +X，转 -90° 对齐到 +Z
  { id: 'baola', url: '/baola.glb', rot: [0, -Math.PI / 2, 0] },
  // 从 FBX 抽的，带 UV + 贴图；模型是竖着躺的（尾巴朝天），绕 X 放平
  { id: 'dog', url: '/dog.glb', rot: [-Math.PI / 2, 0, 0] },
  // 同样是打印件、顶点色；张着翅膀，翼展在 X 上
  // 站姿的鸟：头朝 +X，翅膀是收着的；转 -90° 让它朝 +Z
  { id: 'bird', url: '/bird.glb', rot: [0, -Math.PI / 2, 0] },
]).catch((e) => {
  console.error(e);
  document.getElementById('fatal').style.display = 'block';
  document.getElementById('fatal').textContent = '模型加载失败：' + e.message;
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

// 调试用：控制台里可以直接摸到 game
window.game = game;
