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

// 带骨骼的模型。静态模型是把世界矩阵烘进几何然后丢掉场景图，蒙皮不能这么干，
// 骨头的层级本身就是动画数据。所以这里整棵留着，每次要实例就克隆一份，
// 克隆时必须重建骨架绑定，否则所有实例会共用同一副骨头、一起抽搐。
class RiggedModel {
  constructor(scene, proportions, lift) {
    this.rigged = true;
    this.scene = scene;
    this.proportions = proportions;
    this.lift = lift;          // 让脚底落到 y=0 需要抬多少（已按高度 1 归一）
  }

  makeMesh({ tint = 0xffffff, roughness = 1 } = {}) {
    const root = cloneSkinned(this.scene);
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false;      // 骨骼动起来会超出绑定姿势的包围盒
      const m = o.material.clone();
      m.color = new THREE.Color(tint);
      m.roughness = roughness;
      o.material = m;
    });
    root.position.y = this.lift;
    // 外面按 height 缩放整体，这里先归一到高度 1
    const g = new THREE.Group();
    g.add(root);
    g.userData.rig = collectBones(root);
    return g;
  }
}

// three 的 Object3D.clone 不会重连蒙皮，得自己把 skeleton 指到克隆出来的骨头上
function cloneSkinned(src) {
  const root = src.clone(true);
  const map = new Map();
  src.traverse((o) => { if (o.isBone) map.set(o.name, o); });
  const mine = new Map();
  root.traverse((o) => { if (o.isBone) mine.set(o.name, o); });
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const srcMesh = [...srcMeshes(src)].find((m) => m.name === o.name) || null;
    const skel = (srcMesh || o).skeleton;
    const bones = skel.bones.map((b) => mine.get(b.name) || b);
    o.bind(new THREE.Skeleton(bones, skel.boneInverses), new THREE.Matrix4());
  });
  return root;
}

function* srcMeshes(src) {
  const out = [];
  src.traverse((o) => { if (o.isSkinnedMesh) out.push(o); });
  yield* out;
}

// 按 Mixamo 的命名把常用骨头挑出来，动画那边直接按名字用
function collectBones(root) {
  const b = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    const k = o.name.replace(/^mixamorig:?/, '').replace(/\s*Model$/, '');
    b[k] = o;
    o.userData.rest = { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z };
  });
  return b;
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
      let skinned = null;
      gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
      this.models[id] = skinned ? this._prepareRigged(gltf, skinned, rot)
                                : this._prepare(gltf, rot);
    }
    this.ready = true;
    return this;
  }

  // 蒙皮模型：不能把矩阵烘进几何，只能整体缩放，所以在场景图上做归一化
  _prepareRigged(gltf, skinned, rot = null) {
    const scene = gltf.scene;
    if (rot) scene.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    scene.updateMatrixWorld(true);

    // 绑定姿势下的实际占位。蒙皮网格的几何包围盒还在绑定空间，
    // 直接拿它算高度会偏，所以用骨头的世界坐标兜一遍再并上几何盒。
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const s = 1 / Math.max(size.y, 1e-6);
    scene.scale.multiplyScalar(s);
    scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    scene.updateMatrixWorld(true);
    return new RiggedModel(scene, { w: size.x * s, h: 1, d: size.z * s }, 0);
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
