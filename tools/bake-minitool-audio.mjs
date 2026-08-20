// 把 public/voice/ 里登记过的音频烘成可内嵌的 JS。
//
// 小工具容器：zip 里不允许 .mp3，fetch/XHR 也全禁。
// 但 Web Audio 的 decodeAudioData 吃的是 ArrayBuffer——
// 只要音频以 base64 常量的形式躺在 JS 里，就既不是"文件"也不是"请求"，
// 容器的文件类型白名单和 CSP 都管不到，可以正常出声。
//
// 用法: node tools/bake-minitool-audio.mjs [输出路径]
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VOICE_DIR = 'game/public/voice';
const OUT = process.argv[2] || 'game/minitool/voices.js';
const log = (...a) => console.log('[voice]', ...a);

const manifestPath = join(VOICE_DIR, 'manifest.json');
if (!existsSync(manifestPath)) {
  log('没有 manifest.json，产出空表（小工具版将回落到合成音）');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, 'export const BAKED_VOICES = {};\n');
  process.exit(0);
}

const MIME = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
const map = JSON.parse(readFileSync(manifestPath, 'utf8'));
const out = {};
let total = 0;

for (const [id, file] of Object.entries(map)) {
  const p = join(VOICE_DIR, file);
  if (!existsSync(p)) { log(`跳过 ${id}：找不到 ${file}`); continue; }
  const buf = readFileSync(p);
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (!MIME[ext]) { log(`跳过 ${id}：不认识的格式 ${ext}`); continue; }
  out[id] = buf.toString('base64');
  total += buf.length;
  log(`${id.padEnd(7)} ${file.padEnd(16)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `// 由 tools/bake-minitool-audio.mjs 生成，请勿手改
export const BAKED_VOICES = ${JSON.stringify(out)};
`);
log(`${Object.keys(out).length} 条，原始 ${(total / 1024).toFixed(0)} KB`);
log(`写出 ${OUT}  ${(statSync(OUT).size / 1024).toFixed(0)} KB（base64 后）`);
