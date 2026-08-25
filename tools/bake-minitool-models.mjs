// 把 GLB 烘成可以直接内嵌进 .js 的数据。
//
// 小工具容器有两条硬约束逼着做这件事：
//   1. zip 里只允许 html/css/js/图片/字体/json —— .glb 不在名单上
//   2. fetch / XHR 全禁 —— GLTFLoader 内部就是靠 FileLoader 发请求的
// 所以模型不能作为文件存在，也不能被"加载"，只能作为常量躺在 JS 里。
//
// 顺带做量化：位置 f32→i16（按包围盒归一化）、UV f32→u16、颜色 f32→u8，
// 索引能用 u16 就不用 u32。体积大约砍掉一半，肉眼看不出来。
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// 小工具单包上限 10MB。之前砍到 0.68MB 是因为怕超，实测下来余量很大，
// 所以把面数和贴图提回来——牛来是主角、看得最近，给得最足。
const MODELS = [
  // 带 Mixamo 骨架，蒙皮数据一起烘；动作由 engine/rig.js 现算
  { id: 'niulai', file: 'game/public/niulai-rig.glb', tris: 12000, tex: 1024, skinned: true },
  { id: 'baola', file: 'game/public/baola.glb', tris: 30000, tex: 0, rot: [0, -Math.PI / 2, 0] },
  { id: 'dog', file: 'game/public/dog.glb', tris: 30000, tex: 1024, rot: [-Math.PI / 2, 0, 0] },
  { id: 'bird', file: 'game/public/bird.glb', tris: 14000, tex: 0, rot: [0, -Math.PI / 2, 0] },
];

const OUT = process.argv[2] || 'game/minitool/models.js';
const b64 = (buf) => Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('base64');
const log = (...a) => console.log('[bake]', ...a);

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = [];
let raw = 0;

for (const M of MODELS) {
  const doc = await io.read(M.file);
  const before = doc.getRoot().listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);

  // 目标面数比源文件还高时不能调 simplify，meshopt 会直接断言失败
  const ratio = Math.min(1, M.tris / before);
  const steps = [dedup(), weld({ tolerance: 0.0001 })];
  if (ratio < 0.999) {
    // 蒙皮模型减面要锁边，否则关节处的权重会被抹掉，动起来撕裂
    steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004,
                          lockBorder: !!M.skinned }));
  }
  steps.push(prune());
  if (M.tex) {
    steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [M.tex, M.tex], quality: 74 }));
  }
  await doc.transform(...steps);

  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const uvA = prim.getAttribute('TEXCOORD_0');
  const colA = prim.getAttribute('COLOR_0');
  const idx = prim.getIndices().getArray();
  const nVert = pos.length / 3;

  // 位置量化到 i16：先求包围盒，存 min/scale，运行时还原
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < mn[k]) mn[k] = pos[i + k];
      if (pos[i + k] > mx[k]) mx[k] = pos[i + k];
    }
  }
  const scale = mx.map((v, k) => (v - mn[k]) || 1);
  const qpos = new Int16Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      qpos[i + k] = Math.round(((pos[i + k] - mn[k]) / scale[k]) * 65534 - 32767);
    }
  }

  let quv = null;
  if (uvA) {
    const uv = uvA.getArray();
    quv = new Uint16Array(uv.length);
    // UV 可能超出 [0,1]（平铺），钳一下；这几个模型都是 atlas，不平铺
    for (let i = 0; i < uv.length; i++) quv[i] = Math.round(Math.min(1, Math.max(0, uv[i])) * 65535);
  }

  let qcol = null;
  if (colA) {
    const c = colA.getArray();
    qcol = new Uint8Array((c.length / colA.getElementSize()) * 3);
    const es = colA.getElementSize();
    for (let i = 0, o = 0; i < c.length; i += es, o += 3) {
      for (let k = 0; k < 3; k++) qcol[o + k] = Math.round(Math.min(1, Math.max(0, c[i + k])) * 255);
    }
  }

  const qidx = nVert <= 65535 ? new Uint16Array(idx) : new Uint32Array(idx);

  // 蒙皮：关节索引 u8（骨头不超过 255 根）、权重 u8，外加整副骨架
  let skin = null;
  if (M.skinned) {
    const jA = prim.getAttribute('JOINTS_0'), wA = prim.getAttribute('WEIGHTS_0');
    const sk = doc.getRoot().listSkins()[0];
    if (!jA || !wA || !sk) throw new Error(`${M.id} 说是蒙皮的，但没找到 JOINTS_0/WEIGHTS_0/skin`);
    const j = jA.getArray(), w = wA.getArray();
    const qj = new Uint8Array(j.length);
    for (let i = 0; i < j.length; i++) qj[i] = j[i];
    const qw = new Uint8Array(w.length);
    // 权重归一后量化到 u8，四个一组，误差摊到最大的那个上，保证和为 255
    for (let i = 0; i < w.length; i += 4) {
      let sum = w[i] + w[i+1] + w[i+2] + w[i+3] || 1;
      let acc = 0, big = 0, bigv = -1;
      for (let k = 0; k < 4; k++) {
        const v = Math.round((w[i+k] / sum) * 255);
        qw[i+k] = v; acc += v;
        if (w[i+k] > bigv) { bigv = w[i+k]; big = k; }
      }
      qw[i + big] = Math.max(0, Math.min(255, qw[i + big] + (255 - acc)));
    }

    const joints = sk.listJoints();
    const index = new Map(joints.map((n, i) => [n, i]));
    const ibm = sk.getInverseBindMatrices().getArray();
    const nodes = joints.map((n) => {
      const t = n.getTranslation(), r = n.getRotation(), c = n.getScale();
      const kids = n.listChildren().filter((x) => index.has(x)).map((x) => index.get(x));
      return { name: n.getName(), t: [t[0], t[1], t[2]], r: [r[0], r[1], r[2], r[3]],
               s: [c[0], c[1], c[2]], c: kids };
    });
    // 谁没被别人认作孩子，谁就是根
    const isChild = new Set(nodes.flatMap((n) => n.c));
    const roots = nodes.map((_, i) => i).filter((i) => !isChild.has(i));
    skin = { j: b64(qj), w: b64(qw), nodes, roots, ibm: b64(new Float32Array(ibm)) };
  }

  // 贴图：直接取压好的 WebP 字节
  let tex = null;
  const tx = doc.getRoot().listTextures()[0];
  if (M.tex && tx) {
    const img = tx.getImage();
    tex = { mime: tx.getMimeType(), data: Buffer.from(img).toString('base64') };
  }

  const entry = {
    id: M.id,
    n: nVert,
    tris: qidx.length / 3,
    mn, scale,
    pos: b64(qpos),
    uv: quv ? b64(quv) : null,
    col: qcol ? b64(qcol) : null,
    idx: b64(qidx),
    i32: qidx instanceof Uint32Array,
    rot: M.rot || null,
    tex,
    skin,
  };
  out.push(entry);

  const bytes = qpos.byteLength + (quv?.byteLength ?? 0) + (qcol?.byteLength ?? 0)
    + qidx.byteLength + (tex ? tex.data.length * 0.75 : 0)
    + (skin ? skin.j.length * 0.75 + skin.w.length * 0.75 + skin.ibm.length * 0.75 : 0);
  raw += bytes;
  log(`${M.id}: ${Math.round(before / 1000)}k → ${Math.round(entry.tris / 1000)}k 面, `
    + `${nVert.toLocaleString()} 顶点, ${(bytes / 1024).toFixed(0)} KB`
    + (tex ? ` (含 ${M.tex}px 贴图)` : ' (顶点色)')
    + (skin ? ` (蒙皮 ${skin.nodes.length} 骨)` : ''));
}

mkdirSync(dirname(OUT), { recursive: true });
// 输出成 ESM，交给 vite 打进 IIFE 包；数据本体是 base64 字符串常量
writeFileSync(OUT, `// 由 tools/bake-minitool-models.mjs 生成，请勿手改
export const BAKED = ${JSON.stringify(out)};
`);
log(`写出 ${OUT}  ${(statSync(OUT).size / 1048576).toFixed(2)} MB（原始数据 ${(raw / 1048576).toFixed(2)} MB）`);
