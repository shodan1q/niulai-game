import * as THREE from 'three';
import { BAKED } from './models.js';

// 小工具版的资源层：模型不是"加载"进来的，是躺在 JS 里的常量。
// 容器禁掉了 fetch/XHR，而 GLTFLoader 内部就靠 FileLoader 发请求，所以整条都不能用。
// 这里直接从量化过的定型数组建 BufferGeometry，一次网络请求都不发。

const decode = (b64) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};
const asTyped = (b64, Ctor) => {
  const u8 = decode(b64);
  return new Ctor(u8.buffer, 0, u8.byteLength / Ctor.BYTES_PER_ELEMENT);
};

class BakedModel {
  constructor(geometry, map, vertexColors, proportions) {
    this.geometry = geometry;
    this.maps = { map, normalMap: null, roughnessMap: null, metalnessMap: null };
    this.vertexColors = vertexColors;
    this.proportions = proportions;
  }

  makeMaterial({ tint = 0xffffff, roughness = 1, metalness = 0, flat = false,
    emissive = 0x000000, emissiveIntensity = 0 } = {}) {
    return new THREE.MeshStandardMaterial({
      color: tint, map: this.maps.map, vertexColors: this.vertexColors,
      roughness, metalness, flatShading: flat, emissive, emissiveIntensity,
    });
  }

  makeMesh(opts = {}) {
    const mesh = new THREE.Mesh(this.geometry, this.makeMaterial(opts));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }
}

// 蒙皮版。几何不能像静态模型那样把归一化矩阵烘进顶点——顶点在绑定姿势空间，
// 烘了就跟骨头对不上。所以缩放和位移放在包裹节点上做。
class BakedRigged {
  constructor(geo, map, skin, proportions, fit) {
    this.rigged = true;
    this.geo = geo; this.map = map; this.skin = skin;
    this.proportions = proportions;
    this.fit = fit;                 // { s, dx, dy, dz }
  }

  makeMesh({ tint = 0xffffff, roughness = 1 } = {}) {
    // 每个实例都要一副自己的骨头，不然所有牛会一起抽搐
    const bones = this.skin.nodes.map((n) => {
      const b = new THREE.Bone();
      b.name = n.name;
      b.position.set(n.t[0], n.t[1], n.t[2]);
      b.quaternion.set(n.r[0], n.r[1], n.r[2], n.r[3]);
      b.scale.set(n.s[0], n.s[1], n.s[2]);
      return b;
    });
    this.skin.nodes.forEach((n, i) => n.c.forEach((k) => bones[i].add(bones[k])));

    const inv = [];
    for (let i = 0; i < bones.length; i++) {
      inv.push(new THREE.Matrix4().fromArray(this.skin.ibm, i * 16));
    }
    const mesh = new THREE.SkinnedMesh(this.geo, new THREE.MeshStandardMaterial({
      color: tint, map: this.map, roughness, metalness: 0,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;      // 骨骼动起来会超出绑定姿势的包围盒

    const root = new THREE.Group();
    for (const k of this.skin.roots) root.add(bones[k]);
    root.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());

    const f = this.fit;
    root.scale.setScalar(f.s);
    root.position.set(f.dx, f.dy, f.dz);

    const g = new THREE.Group();
    g.add(root);
    const rig = {};
    for (const b of bones) {
      const key = b.name.replace(/^mixamorig:?/, '').replace(/\s*Model$/, '');
      rig[key] = b;
      b.userData.rest = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
    }
    g.userData.rig = rig;
    return g;
  }
}

export class BakedAssets {
  constructor() {
    this.models = {};
    this.ready = false;
  }

  // 没有 IO，纯 CPU 解码。给个 onProgress 只是为了跟原来的接口一致。
  async load(_list, onProgress) {
    for (let i = 0; i < BAKED.length; i++) {
      const b = BAKED[i];
      const geo = new THREE.BufferGeometry();

      // 位置：i16 反量化回真实坐标
      const q = asTyped(b.pos, Int16Array);
      const pos = new Float32Array(q.length);
      for (let k = 0; k < q.length; k += 3) {
        for (let c = 0; c < 3; c++) {
          pos[k + c] = ((q[k + c] + 32767) / 65534) * b.scale[c] + b.mn[c];
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

      if (b.uv) {
        const u = asTyped(b.uv, Uint16Array);
        const uv = new Float32Array(u.length);
        for (let k = 0; k < u.length; k++) uv[k] = u[k] / 65535;
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      if (b.col) {
        const c = decode(b.col);
        const col = new Float32Array(c.length);
        for (let k = 0; k < c.length; k++) col[k] = c[k] / 255;
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      geo.setIndex(new THREE.BufferAttribute(asTyped(b.idx, b.i32 ? Uint32Array : Uint16Array), 1));

      if (b.skin) {
        // 关节索引 u8、权重 u8，还原成 three 要的形状
        const j = decode(b.skin.j);
        const ji = new Uint16Array(j.length);
        for (let k = 0; k < j.length; k++) ji[k] = j[k];
        geo.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4));
        const w = decode(b.skin.w);
        const wf = new Float32Array(w.length);
        for (let k = 0; k < w.length; k++) wf[k] = w[k] / 255;
        geo.setAttribute('skinWeight', new THREE.BufferAttribute(wf, 4));
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();

        // 归一化只算出参数，不动顶点
        const bb0 = geo.boundingBox;
        const sz = new THREE.Vector3(); bb0.getSize(sz);
        const ct = new THREE.Vector3(); bb0.getCenter(ct);
        const sc = 1 / Math.max(sz.y, 1e-6);
        this.models[b.id] = new BakedRigged(geo, null, {
          ...b.skin, ibm: asTyped(b.skin.ibm, Float32Array),
        }, { w: sz.x * sc, h: 1, d: sz.z * sc },
          { s: sc, dx: -ct.x * sc, dy: -bb0.min.y * sc, dz: -ct.z * sc });

        if (b.tex) {
          const img = new Image();
          img.src = `data:${b.tex.mime};base64,${b.tex.data}`;
          const t = new THREE.Texture(img);
          t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false;
          if (img.complete) t.needsUpdate = true; else img.onload = () => { t.needsUpdate = true; };
          this.models[b.id].map = t;
        }
        onProgress?.((i + 1) / BAKED.length);
        continue;
      }

      if (b.rot) {
        if (b.rot[0]) geo.rotateX(b.rot[0]);
        if (b.rot[1]) geo.rotateY(b.rot[1]);
        if (b.rot[2]) geo.rotateZ(b.rot[2]);
      }

      // 归一化：底面贴地、水平居中、高度缩到 1（跟主版本一致）
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const size = new THREE.Vector3(); bb.getSize(size);
      const center = new THREE.Vector3(); bb.getCenter(center);
      const s = 1 / Math.max(size.y, 1e-6);
      geo.translate(-center.x, -bb.min.y, -center.z);
      geo.scale(s, s, s);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // 贴图走 data: URI —— 容器允许 data: 图片，而且 ImageLoader 用 <img> 不用 fetch
      let map = null;
      if (b.tex) {
        const img = new Image();
        img.src = `data:${b.tex.mime};base64,${b.tex.data}`;
        map = new THREE.Texture(img);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        map.flipY = false;                  // glTF 的 UV 原点在左上
        if (img.complete) map.needsUpdate = true;
        else img.onload = () => { map.needsUpdate = true; };
      }

      this.models[b.id] = new BakedModel(geo, map, !!b.col,
        { w: size.x * s, h: 1, d: size.z * s });
      onProgress?.((i + 1) / BAKED.length);
    }
    this.ready = true;
    return this;
  }

  get(id) {
    const m = this.models[id] ?? this.models.niulai;
    if (!m) throw new Error(`模型 ${id} 没有烘进包里`);
    return m;
  }

  makeMesh(id, opts) { return this.get(id).makeMesh(opts); }
  proportionsOf(id) { return this.get(id).proportions; }
}
