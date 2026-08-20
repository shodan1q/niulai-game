// 豹拉流水线：GooFstore 打印用 OBJ（198 万面 / 96MB，无 UV、带顶点色）-> 网页 GLB
//
// 这个 OBJ 是给 3D 打印用的：没有贴图坐标，颜色直接烘在顶点上（v x y z r g b）。
// 所以不走 obj2gltf，自己解析，产出 POSITION + COLOR_0 的单一 primitive，再减面。
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2];
const OUT = process.argv[3];
const RATIO = Number(process.argv[4] ?? 0.02);
const log = (...a) => console.log('[baola]', ...a);
const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + ' MB';

// Blender 的 OBJ 扩展顶点色是 sRGB 编码的，glTF 的 COLOR_0 要线性值
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

log('1/4 解析 OBJ ...');
const pos = [], col = [], idx = [];
{
  const rl = createInterface({ input: createReadStream(SRC), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.charCodeAt(0) === 118 /* v */ && line.charCodeAt(1) === 32) {
      const t = line.split(' ');
      pos.push(+t[1], +t[2], +t[3]);
      if (t.length >= 7) col.push(toLinear(+t[4]), toLinear(+t[5]), toLinear(+t[6]));
    } else if (line.charCodeAt(0) === 102 /* f */ && line.charCodeAt(1) === 32) {
      const t = line.split(' ');
      // 只可能是 "f a b c"（已确认全是三角面、无 UV/法线索引）
      idx.push(+t[1] - 1, +t[2] - 1, +t[3] - 1);
    }
  }
}
const vCount = pos.length / 3;
log(`   顶点 ${vCount.toLocaleString()}  三角面 ${(idx.length / 3).toLocaleString()}  顶点色 ${col.length ? '有' : '无'}`);

log('2/4 建 glTF ...');
const doc = new Document();
const buf = doc.createBuffer();
const prim = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf))
  .setMaterial(doc.createMaterial('baola').setRoughnessFactor(1).setMetallicFactor(0));
if (col.length === pos.length) {
  prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buf));
}
const mesh = doc.createMesh('baola').addPrimitive(prim);
doc.createScene().addChild(doc.createNode('baola').setMesh(mesh));

const tris = (d) => d.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);

log('3/4 焊接 + 减面 ...');
await MeshoptSimplifier.ready;
await doc.transform(
  dedup(),
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.003, lockBorder: false }),
  prune(),
);
log(`   减面后 ${Math.round(tris(doc)).toLocaleString()} 面`);

log('4/4 写 GLB ...');
mkdirSync(dirname(OUT), { recursive: true });
await new NodeIO().write(OUT, doc);
log('完成:', OUT, mb(OUT));
