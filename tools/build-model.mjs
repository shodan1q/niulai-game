// 牛来模型流水线：Tripo OBJ (193万面 / 133MB) -> 网页可用 GLB
// 步骤：obj2gltf -> weld -> simplify -> 贴图降采样/WebP -> meshopt 压缩
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import obj2gltf from 'obj2gltf';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const RAW = process.argv[2];
const OUT = process.argv[3];
const TARGET_RATIO = Number(process.argv[4] ?? 0.03); // 193万 * 0.03 ≈ 5.8万面
const TEX_SIZE = Number(process.argv[5] ?? 1024);

const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + ' MB';
const log = (...a) => console.log('[build]', ...a);

mkdirSync(dirname(OUT), { recursive: true });

log('1/5 OBJ -> glTF ...');
const gltf = await obj2gltf(RAW, {
  unlit: false,
  metallicRoughness: true,
  packOcclusion: false,
  secure: false,
});

// 中间文件放系统临时目录。放在输出目录旁边的话，
// 输出目录正好是 vite 的 public/，55MB 的中间产物会被整个打进 dist。
const tmpDir = mkdtempSync(join(tmpdir(), 'niulai-'));
const tmp = join(tmpDir, 'stage.gltf');
writeFileSync(tmp, JSON.stringify(gltf));
log('   中间文件', mb(tmp));

log('2/5 读入 glTF ...');
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(tmp);

const triCount = (d) =>
  d.getRoot().listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

log('   原始三角面', Math.round(triCount(doc)).toLocaleString());

log('3/5 焊接顶点 + 减面 ...');
await doc.transform(
  dedup(),
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_RATIO, error: 0.002, lockBorder: false }),
  prune(),
);
log('   减面后三角面', Math.round(triCount(doc)).toLocaleString());

log(`4/5 贴图 -> ${TEX_SIZE}px WebP ...`);
await doc.transform(
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [TEX_SIZE, TEX_SIZE],
    quality: 82,
  }),
  resample(),
);

log('5/5 meshopt 压缩 + 写出 GLB ...');
await doc.transform((d) => {
  for (const mesh of d.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setMode(4);
  }
});
await io.write(OUT, doc);
rmSync(tmpDir, { recursive: true, force: true });
log('完成:', OUT, mb(OUT));
