import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 模型库。每个模型都归一化成"底面贴地、水平居中、高度 1"，
// 这样 Actor 只要给一个 height 就能摆出正确的体型。
//
// 两个来源的模型走不同的着色路径：
//   牛来  Tripo 生成，有 UV 和 PBR 贴图 -> 用贴图
//   豹拉  GooFstore 打印件，没有 UV，颜色烘在顶点上 -> 用顶点色
// 所以 Model 记下自己是哪种，makeMaterial 照着配。

class Model {
  constructor(geometry, maps, vertexColors, proportions) {
    this.geometry = geometry;
    this.maps = maps;
    this.vertexColors = vertexColors;
    this.proportions = proportions;
  }

  // tint 乘在 material.color 上：牛来本体是金黄的，往冷色乘就变灰蓝，往暖色乘更黄
  makeMaterial({ tint = 0xffffff, roughness = 1, metalness = 0, flat = false,
    emissive = 0x000000, emissiveIntensity = 0 } = {}) {
    return new THREE.MeshStandardMaterial({
      color: tint,
      map: this.maps.map,
      normalMap: this.maps.normalMap,
      roughnessMap: this.maps.roughnessMap,
      metalnessMap: this.maps.metalnessMap,
      vertexColors: this.vertexColors,
      roughness,
      metalness,
      flatShading: flat,
      emissive,
      emissiveIntensity,
    });
  }

  makeMesh(opts = {}) {
    const mesh = new THREE.Mesh(this.geometry, this.makeMaterial(opts));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }
}

export class Assets {
  constructor() {
    this.models = {};
    this.ready = false;
  }

  // list: [{ id, url, rot: [x, y, z] }]，按顺序加载，进度是整体的
  async load(list, onProgress) {
    const loader = new GLTFLoader();
    for (let i = 0; i < list.length; i++) {
      const { id, url, rot } = list[i];
      const gltf = await loader.loadAsync(url, (e) => {
        if (!onProgress) return;
        const inner = e.lengthComputable ? e.loaded / e.total : 0;
        onProgress((i + inner) / list.length);
      });
      this.models[id] = this._prepare(gltf, rot);
    }
    this.ready = true;
    return this;
  }

  _prepare(gltf, rot = null) {
    gltf.scene.updateMatrixWorld(true);
    let src = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    if (!src) throw new Error('GLB 里没有找到网格');

    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);

    // 各家模型的朝向都不一样：牛来朝 +Z 站着，豹拉朝 +X，狗整个是竖着躺的。
    // 在这里一次转正，运行时的朝向逻辑才能一视同仁。
    if (rot) {
      if (rot[0]) geo.rotateX(rot[0]);
      if (rot[1]) geo.rotateY(rot[1]);
      if (rot[2]) geo.rotateZ(rot[2]);
    }

    // 归一化：底面贴地、水平居中、高度缩到 1
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

    const m = src.material;
    const maps = {
      map: m.map || null,
      normalMap: m.normalMap || null,
      roughnessMap: m.roughnessMap || null,
      metalnessMap: m.metalnessMap || null,
    };
    for (const t of Object.values(maps)) {
      if (t) { t.anisotropy = 4; t.needsUpdate = true; }
    }

    return new Model(geo, maps, !!geo.getAttribute('color'), { w: size.x * s, h: 1, d: size.z * s });
  }

  get(id) {
    const m = this.models[id] ?? this.models.niulai;
    if (!m) throw new Error(`模型 ${id} 没有加载`);
    return m;
  }

  makeMesh(id, opts) { return this.get(id).makeMesh(opts); }
  proportionsOf(id) { return this.get(id).proportions; }
}
