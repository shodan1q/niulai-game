import * as THREE from 'three';
import { SANS } from '../ui/fonts.js';

// 场景里除了主角，全部是程序化拼出来的低多边形。
// 面数刻意压得很低、棱角刻意留着——原片被吐槽"4399 小游戏画质"，
// 这里把那个质感当成美术方向，而不是当成事故。

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const lerp = THREE.MathUtils.lerp;

// ---------------------------------------------------------------- 地面
export function makeGround({ size = 240, seg = 48, colorA = 0x6f8a3f, colorB = 0x8fa552, seed = 7 } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const r = rng(seed);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(colorA), b = new THREE.Color(colorB), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // 地面保持水平（原片的"平地"是个梗），只用顶点色做斑驳
    const t = (Math.sin(pos.getX(i) * 0.13) * Math.cos(pos.getZ(i) * 0.11) * 0.5 + 0.5) * 0.7 + r() * 0.3;
    c.copy(a).lerp(b, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// 远处的山，纯装饰，走不过去。
// 用扁球而不是圆锥——圆锥在低多边形下会变成埃及金字塔。
export function makeHills({ radius = 105, count = 22, color = 0x4a5f38, height = 22, seed = 3, rings = 2 } = {}) {
  const r = rng(seed);
  const group = new THREE.Group();
  const near = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const far = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.22), flatShading: true,
  });

  for (let ring = 0; ring < rings; ring++) {
    const n = Math.round(count * (1 + ring * 0.5));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const h = height * (0.5 + r() * 0.8) * (1 + ring * 0.45);
      const rad = h * (1.1 + r() * 0.9);
      const geo = new THREE.SphereGeometry(1, 7 + Math.floor(r() * 3), 4);
      geo.scale(rad, h, rad * (0.7 + r() * 0.6));
      // 削掉下半球，只留山形
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) if (pos.getY(v) < 0) pos.setY(v, pos.getY(v) * 0.06);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, ring ? far : near);
      const dist = radius * (1.05 + r() * 0.35) * (1 + ring * 0.5);
      m.position.set(Math.cos(ang) * dist, -h * 0.06, Math.sin(ang) * dist);
      m.rotation.y = r() * Math.PI;
      group.add(m);
    }
  }
  return group;
}

// ---------------------------------------------------------------- 草
// 成丛长，不是均匀撒；细而密，才像草不像插在地上的锥子。顶点着色器里加了风。
export function makeGrass({
  count = 900, area = 70, color = 0x7d9a45, height = 0.7, seed = 11, inner = 0,
  clump = 5, wind = 1, reject = null,
} = {}) {
  const geo = new THREE.ConeGeometry(0.085, 1, 3, 1, true);
  geo.translate(0, 0.5, 0);
  // 法线统一朝上：草只接天光，不按锥面各自受光，
  // 否则背光的那半边会黑成一根根钉子。
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  nrm.needsUpdate = true;
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });

  if (wind > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWind = { value: wind };
      shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           float sway = transformed.y * 0.3 * uWind;
           vec3 wp = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
           transformed.x += sin(uTime * 1.5 + wp.x * 0.32 + wp.z * 0.18) * sway;
           transformed.z += cos(uTime * 1.2 + wp.z * 0.28) * sway * 0.55;
         }`,
      );
      mat.userData.shader = shader;
    };
  }

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const r = rng(seed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const base = new THREE.Color(color);

  let i = 0, guard = 0;
  while (i < count && guard++ < count * 20) {
    // 一丛的中心
    let cx, cz, d, tries = 0;
    do {
      cx = (r() - 0.5) * area * 2; cz = (r() - 0.5) * area * 2;
      d = Math.hypot(cx, cz);
    } while ((d < inner || d > area || (reject && reject(cx, cz))) && tries++ < 30);
    if (reject && reject(cx, cz)) continue;
    const n = Math.min(count - i, 2 + Math.floor(r() * clump));
    const spread = 0.35 + r() * 0.7;
    const clumpH = 0.7 + r() * 0.7;
    for (let k = 0; k < n && i < count; k++, i++) {
      p.set(cx + (r() - 0.5) * spread * 2, 0, cz + (r() - 0.5) * spread * 2);
      const h = height * clumpH * (0.7 + r() * 0.6);
      s.set(0.75 + r() * 0.6, h, 0.75 + r() * 0.6);
      e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
      q.setFromEuler(e);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      col.copy(base).offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.15, (r() - 0.5) * 0.17);
      mesh.setColorAt(i, col);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.userData.tick = (dt, t) => {
    const sh = mat.userData.shader;
    if (sh) sh.uniforms.uTime.value = t;
  };
  return mesh;
}

// ---------------------------------------------------------------- 草
// 弹幕的「草」直接长在草地里。黄色泡沫方块，正反上下六面都是那个字。
// 贴图用 canvas 现画，不引外部资源；字体复用 UI 那套本机字体探测。
let _caoTex = null;
function caoTexture() {
  if (_caoTex) return _caoTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');

  x.fillStyle = '#cf9f14';
  x.fillRect(0, 0, S, S);
  // 上亮下暗，做出泡沫块的厚度感
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(255,248,205,0.20)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  // 一圈压痕
  x.strokeStyle = 'rgba(70,50,4,0.34)';
  x.lineWidth = S * 0.05;
  x.strokeRect(0, 0, S, S);

  x.fillStyle = '#100f0b';
  x.font = `700 ${Math.round(S * 0.66)}px "${SANS}"`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('草', S / 2, S * 0.545);

  _caoTex = new THREE.CanvasTexture(c);
  _caoTex.colorSpace = THREE.SRGBColorSpace;
  _caoTex.anisotropy = 4;
  return _caoTex;
}

export function makeCaoBlocks({
  count = 40, area = 46, size = 0.95, seed = 3, inner = 3, reject = null, stack = 0.3,
} = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ map: caoTexture() });

  // 轻轻上下浮一点。取 instanceMatrix 的平移当相位，每块的节奏都不一样。
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
         transformed.y += sin(uTime * 1.1 + ph) * 0.05;
         float tilt = sin(uTime * 0.8 + ph * 1.3) * 0.035;
         transformed.xz += vec2(tilt, -tilt) * transformed.y;
       #endif`,
    );
    mat.userData.shader = shader;
  };

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const r = rng(seed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  // 记下已经摆过的位置，新的一丛离得太近就换个地方——
  // 只避开河是不够的，丛和丛之间也会撞。
  const placed = [];
  let i = 0, guard = 0;
  while (i < count && guard++ < count * 30) {
    let cx, cz, ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      cx = (r() - 0.5) * area * 2; cz = (r() - 0.5) * area * 2;
      const d = Math.hypot(cx, cz);
      if (d < inner || d > area) continue;
      if (reject && reject(cx, cz)) continue;
      ok = placed.every((p) => Math.hypot(p[0] - cx, p[1] - cz) > p[2]);
    }
    if (!ok) continue;

    // 大部分是单块躺在草里，少数垒成两三块
    const n = Math.min(count - i, r() < stack ? 2 + (r() < 0.35 ? 1 : 0) : 1);
    const sz = size * (0.65 + r() * 0.7);
    placed.push([cx, cz, sz * 2.2 + 1.2]);

    const yaw = r() * Math.PI * 2;
    let y = 0;
    for (let k = 0; k < n && i < count; k++, i++) {
      const ss = sz * (1 - k * 0.1);
      if (n === 1) {
        // 单块：可以歪着躺，看起来像被丢在那儿的
        p.set(cx, 0, cz);
        e.set((r() - 0.5) * 0.2, yaw, (r() - 0.5) * 0.2);
      } else {
        // 一摞：必须放平。带俯仰的话棱角会扎进下面那块，
        // 只靠转 yaw 做出手垒的错落感就够了。
        p.set(cx + (r() - 0.5) * ss * 0.14, y, cz + (r() - 0.5) * ss * 0.14);
        e.set(0, yaw + k * 0.45 + (r() - 0.5) * 0.3, 0);
      }
      q.setFromEuler(e);
      s.set(ss, ss, ss);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      y += ss;                    // 严丝合缝地摞上去，不留重叠也不留缝
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.tick = (dt, t) => {
    const sh = mat.userData.shader;
    if (sh) sh.uniforms.uTime.value = t;
  };
  return mesh;
}

// ---------------------------------------------------------------- 天上的鸟
// 用真模型（GooFstore 打印件，顶点色）在天上绕圈飞。
// 翅膀是静态的，所以扇翅靠整体的滚转 + 上下起伏来演——
// 远看是有的，近看也不至于穿帮，因为它本来就飞得高。
export class BirdFlock {
  constructor(assets, {
    count = 7, radius = 46, height = 22, spread = 9, size = 1.5,
    model = 'bird', speed = 0.06, seed = 5,
  } = {}) {
    this.group = new THREE.Group();
    this.birds = [];
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const mesh = assets.makeMesh(model, { roughness: 1 });
      mesh.castShadow = false;
      const pivot = new THREE.Group();
      pivot.add(mesh);
      pivot.scale.setScalar(size * (0.7 + r() * 0.6));
      this.group.add(pivot);
      this.birds.push({
        o: pivot,
        rad: radius * (0.45 + r() * 0.75),
        y: height + (r() - 0.5) * spread * 2,
        ph: r() * Math.PI * 2,
        sp: speed * (0.7 + r() * 0.7) * (r() < 0.35 ? -1 : 1),   // 有的反向飞
        flap: 5 + r() * 3,
        bob: 0.5 + r() * 1.1,
        cx: (r() - 0.5) * 22,
        cz: (r() - 0.5) * 22,
      });
    }
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    for (const b of this.birds) {
      const a = b.ph + this.t * b.sp;
      const fwd = b.sp > 0 ? 1 : -1;
      b.o.position.set(
        b.cx + Math.cos(a) * b.rad,
        b.y + Math.sin(this.t * 0.7 + b.ph) * b.bob,
        b.cz + Math.sin(a) * b.rad,
      );
      // 模型正面已经转到 +Z，圆周运动的切线方向就是 -a（反向飞则是 π-a）
      b.o.rotation.y = fwd > 0 ? -a : Math.PI - a;
      // 翅膀是收着的模型，扇不了；用横滚的周期摆动在远处冒充振翅
      b.o.rotation.z = -fwd * 0.22 + Math.sin(this.t * b.flap + b.ph) * 0.20;
      // 稍微低头，读起来才像在滑翔而不是悬着
      b.o.rotation.x = 0.06 + Math.sin(this.t * b.flap * 0.5 + b.ph) * 0.04;
    }
  }
}

// ---------------------------------------------------------------- 小河
// 地面是平的，所以河不能靠"压低地形"来做——大地面每格 6 米多，压不出一条 5 米宽的河。
// 改成把两岸各生成一片贴着河道边缘的网格，中间真的留空，再往下垫河床和水面。
export function makeRiver({
  center = () => 0,          // 河心 z 随 x 变化，做出蜿蜒
  halfW = 2.2,               // 水面半宽
  slope = 0.9,               // 岸坡半宽（地面到水面之间的斜坡）
  depth = 1.15,
  xMin = -95, xMax = 95, segX = 150,
  out = 95, segOut = 20,     // 岸往外铺多远
  groundA = 0x3d5a44, groundB = 0x587a53,
  bedColor = 0x6a5f47, waterColor = 0x2f6f7a,
  seed = 5,
} = {}) {
  const group = new THREE.Group();
  const carveHalf = halfW + slope;
  const r = rng(seed);

  // ---- 两岸 ----
  const bankMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const cA = new THREE.Color(groundA), cB = new THREE.Color(groundB), tmp = new THREE.Color();
  for (const side of [1, -1]) {
    const pos = [], col = [], idx = [];
    for (let i = 0; i <= segX; i++) {
      const x = lerp(xMin, xMax, i / segX);
      const zEdge = center(x) + side * carveHalf;
      for (let j = 0; j <= segOut; j++) {
        const t = j / segOut;
        const z = zEdge + side * (t * t * out);   // 靠岸密、远处疏
        pos.push(x, 0, z);
        const k = (Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.5 + 0.5) * 0.7 + r() * 0.3;
        tmp.copy(cA).lerp(cB, k);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    const W = segOut + 1;
    for (let i = 0; i < segX; i++) {
      for (let j = 0; j < segOut; j++) {
        // 绕序要按 z 的增减翻过来，否则法线朝下，整片地面会被从下面打光、黑掉
        const a = i * W + j, b = a + W;
        if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, bankMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- 河床：从岸沿抛物线下到河心 ----
  {
    const segZ = 14, pos = [], idx = [];
    for (let i = 0; i <= segX; i++) {
      const x = lerp(xMin, xMax, i / segX);
      const cz = center(x);
      for (let j = 0; j <= segZ; j++) {
        const u = j / segZ * 2 - 1;                       // -1..1
        const y = -depth * (1 - u * u) - r() * 0.06;
        pos.push(x, y, cz + u * carveHalf);
      }
    }
    const W = segZ + 1;
    for (let i = 0; i < segX; i++) {
      for (let j = 0; j < segZ; j++) {
        const a = i * W + j, b = a + W;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const bed = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: bedColor, flatShading: true }));
    bed.receiveShadow = true;
    group.add(bed);
  }

  // ---- 水面 ----
  const waterY = -depth * 0.42;
  const waterMat = new THREE.MeshStandardMaterial({
    color: waterColor, transparent: true, opacity: 0.72,
    roughness: 0.18, metalness: 0.15, flatShading: true,
    side: THREE.DoubleSide, depthWrite: false,
  });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(position.x * 0.55 + uTime * 1.7) * 0.05
                      + sin(position.z * 1.1 - uTime * 1.25) * 0.035
                      + sin(position.x * 0.17 + position.z * 0.3 + uTime * 0.7) * 0.03;`,
    );
    waterMat.userData.shader = sh;
  };
  {
    const segZ = 10, pos = [], idx = [];
    for (let i = 0; i <= segX; i++) {
      const x = lerp(xMin, xMax, i / segX);
      const cz = center(x);
      for (let j = 0; j <= segZ; j++) pos.push(x, waterY, cz + (j / segZ * 2 - 1) * halfW);
    }
    const W = segZ + 1;
    for (let i = 0; i < segX; i++) {
      for (let j = 0; j < segZ; j++) {
        const a = i * W + j, b = a + W;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const water = new THREE.Mesh(geo, waterMat);
    water.renderOrder = 2;
    group.add(water);
  }

  return {
    group,
    center,
    halfW,
    carveHalf,
    waterY,
    blockHalf: carveHalf * 0.94,          // 站着能走到的最近处
    inside: (x, z, pad = 0) => Math.abs(z - center(x)) < carveHalf * 0.94 + pad,
    tick: (dt, t) => {
      const sh = waterMat.userData.shader;
      if (sh) sh.uniforms.uTime.value = t;
    },
  };
}

// ---------------------------------------------------------------- 树木石头
export function makeTree({ h = 5, trunk = 0x5a4326, leaf = 0x3f6b30, seed = 1, dead = false } = {}) {
  const r = rng(seed);
  const g = new THREE.Group();
  const th = h * (dead ? 0.75 : 0.45);
  const t = new THREE.Mesh(
    new THREE.CylinderGeometry(h * 0.045, h * 0.09, th, 5),
    new THREE.MeshLambertMaterial({ color: trunk, flatShading: true }),
  );
  t.position.y = th / 2;
  t.castShadow = true;
  g.add(t);

  if (dead) {
    // 光秃秃的枝杈
    const bm = new THREE.MeshLambertMaterial({ color: trunk, flatShading: true });
    for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
      const bl = h * (0.2 + r() * 0.25);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.012, h * 0.03, bl, 4), bm);
      b.position.y = th * (0.5 + r() * 0.45);
      b.rotation.z = (r() - 0.5) * 1.6;
      b.rotation.y = r() * Math.PI * 2;
      b.translateY(bl / 2);
      g.add(b);
    }
  } else {
    const lm = new THREE.MeshLambertMaterial({ color: leaf, flatShading: true });
    const layers = 2 + Math.floor(r() * 2);
    for (let i = 0; i < layers; i++) {
      const k = 1 - i / (layers + 0.6);
      const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.42 * k, h * 0.42, 5 + Math.floor(r() * 2)), lm);
      c.position.y = th + h * 0.16 * i + h * 0.14;
      c.rotation.y = r() * Math.PI;
      c.castShadow = true;
      g.add(c);
    }
  }
  return g;
}

export function makeStump({ r: rad = 0.7, h = 0.8, color = 0x6b5334, ring = 0xa98b5e } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(rad, rad * 1.15, h, 8),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(rad, 8),
    new THREE.MeshLambertMaterial({ color: ring }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = h + 0.002;
  g.add(top);
  return g;
}

export function makeRock({ s = 1, color = 0x8b8579, seed = 5 } = {}) {
  const r = rng(seed);
  const geo = new THREE.IcosahedronGeometry(s, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) * (0.7 + r() * 0.6),
      pos.getY(i) * (0.5 + r() * 0.5),
      pos.getZ(i) * (0.7 + r() * 0.6));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  m.position.y = s * 0.35;
  m.castShadow = true;
  return m;
}

export function makeDune({ w = 20, h = 3, color = 0xc9a86d, seed = 9 } = {}) {
  const r = rng(seed);
  const geo = new THREE.SphereGeometry(w * 0.5, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * (h / (w * 0.5)) * (0.7 + r() * 0.6));
    pos.setX(i, pos.getX(i) * (0.8 + r() * 0.5));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

export function makeBones({ seed = 2, color = 0xd9d2c0 } = {}) {
  const r = rng(seed);
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const l = 0.5 + r() * 1.1;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, l, 4), mat);
    b.rotation.set(Math.PI / 2, r() * Math.PI, (r() - 0.5) * 1.2);
    b.position.set((r() - 0.5) * 1.8, 0.07, (r() - 0.5) * 1.8);
    g.add(b);
  }
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), mat);
  skull.position.set(0, 0.28, 0);
  skull.scale.set(1, 0.8, 1.35);
  g.add(skull);
  return g;
}

// ---------------------------------------------------------------- 会动的东西
// 灵蛇。分节硬转折，不是平滑的管子——
// 跟狼一样用方块拼，faceted、有明显棱角，跟全场的低多边形对得上。
// 每节是上一节的子节点，只转 yaw，所以扭动是一节一节传下去的，
// 看起来是硬的、机械的，不是柔顺的蛇。顺带还省掉了每帧重建几何。
export class Snake {
  constructor({ color = 0x5f8f6b, belly = 0x9ec4a4, segs = 14, length = 5, radius = 0.17 } = {}) {
    this.group = new THREE.Group();
    this.segLen = length / segs;
    this.amp = 1;
    this.t = 0;
    this.joints = [];

    const body = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const bellyMat = new THREE.MeshLambertMaterial({ color: belly, flatShading: true });

    let parent = this.group;
    for (let i = 0; i < segs; i++) {
      const k = 1 - (i / segs) * 0.72;               // 越往尾越细
      const j = new THREE.Group();
      j.position.z = i === 0 ? 0 : this.segLen;      // 接在上一节的末端
      parent.add(j);

      // 六棱柱当身子：横截面是多边形，转起来棱线看得见
      const geo = new THREE.CylinderGeometry(radius * k, radius * k * 0.94, this.segLen * 1.04, 6, 1);
      geo.rotateX(Math.PI / 2);                      // 让柱子躺着，沿 Z 延伸
      const m = new THREE.Mesh(geo, body);
      m.position.z = this.segLen * 0.5;
      m.rotation.z = i * 0.5;                        // 每节转一点，棱线错开
      m.castShadow = true;
      j.add(m);

      // 肚皮：贴在下面的一条窄板，浅色
      const bl = new THREE.Mesh(
        new THREE.BoxGeometry(radius * k * 1.1, radius * 0.12, this.segLen * 1.02), bellyMat);
      bl.position.set(0, -radius * k * 0.78, this.segLen * 0.5);
      j.add(bl);

      this.joints.push({ o: j, phase: i * 0.55, k });
      parent = j;
    }

    // 头：楔形，比身子粗一圈
    const head = new THREE.Group();
    head.position.z = this.segLen;
    parent.add(head);
    const skull = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 0.9, radius * 2.6, 6, 1), body);
    skull.rotation.x = Math.PI / 2;
    skull.position.z = radius * 1.1;
    skull.castShadow = true;
    head.add(skull);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.95, radius * 1.5, 6), body);
    snout.rotation.x = Math.PI / 2;
    snout.position.z = radius * 3.0;
    head.add(snout);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf5d020 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.34, radius * 0.34, radius * 0.34), eyeMat);
      e.position.set(sx * radius * 0.78, radius * 0.42, radius * 1.5);
      head.add(e);
    }
    // 信子，会一伸一缩
    this.tongue = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.09, radius * 0.06, radius * 1.5),
      new THREE.MeshBasicMaterial({ color: 0xc2405a }));
    this.tongue.position.z = radius * 4.0;
    head.add(this.tongue);
    this.head = head;
  }

  update(dt) {
    this.t += dt * 1.7;
    for (const j of this.joints) {
      // 只转 yaw，且量化到 3 度一档——硬转折的来源就在这儿，
      // 连续插值的话又会变回一条柔顺的蛇。
      const raw = Math.sin(this.t + j.phase) * 0.30 * this.amp * j.k;
      const STEP = Math.PI / 60;
      j.o.rotation.y = Math.round(raw / STEP) * STEP;
    }
    // 信子每隔一会儿弹一下
    const f = (this.t * 0.5) % 3;
    this.tongue.visible = f < 0.35;
    this.tongue.scale.z = f < 0.35 ? 0.6 + Math.sin(f * 18) * 0.4 : 1;
  }
}

// 云雀：小小一只，扇翅膀，可以沿路径飞
export class Lark {
  constructor({ color = 0x9b8a72 } = {}) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat);
    body.scale.set(1, 0.85, 1.5);
    this.group.add(body);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), mat);
    head.position.set(0, 0.08, 0.2);
    this.group.add(head);

    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.12, 4),
      new THREE.MeshLambertMaterial({ color: 0xd8a13c, flatShading: true }),
    );
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.07, 0.32);
    this.group.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 4), mat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.02, -0.26);
    this.group.add(tail);

    this.wings = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      const w = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 3), mat);
      w.rotation.z = Math.PI / 2 * sx;
      w.position.x = sx * 0.21;
      pivot.add(w);
      pivot.position.set(0, 0.05, 0);
      this.group.add(pivot);
      this.wings.push({ pivot, sx });
    }
    this.t = Math.random() * 10;
    this.flying = false;
    this.speed = 1;
    this.path = null;
    this.u = 0;
  }

  flyAlong(curve, speed = 0.12) { this.path = curve; this.speed = speed; this.u = 0; this.flying = true; }

  update(dt) {
    this.t += dt;
    const flap = this.flying ? 16 : 2.4;
    const a = Math.sin(this.t * flap);
    for (const { pivot, sx } of this.wings) {
      pivot.rotation.z = a * (this.flying ? 0.85 : 0.12) * sx;
    }
    if (!this.flying) {
      this.group.position.y += Math.sin(this.t * 2) * 0.0008;
      this.group.rotation.y += Math.sin(this.t * 0.7) * 0.002;
      return;
    }
    if (this.path) {
      this.u += dt * this.speed;
      if (this.u >= 1) { this.u = 1; }
      const p = this.path.getPoint(this.u);
      const tan = this.path.getTangent(Math.min(0.999, this.u));
      this.group.position.copy(p);
      this.group.lookAt(p.clone().add(tan));
      this.group.rotation.z = -tan.x * 0.6;
    }
  }
}

// 狼：低多边形四足，跑起来腿会摆
export class Wolf {
  constructor({ color = 0x6b7280, scale = 1 } = {}) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a5058, flatShading: true });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 1.5), mat);
    body.position.y = 0.85;
    body.castShadow = true;
    this.group.add(body);
    this.body = body;

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.5), mat);
    neck.position.set(0, 1.0, 0.8);
    this.group.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.44), mat);
    head.position.set(0, 1.06, 1.14);
    this.group.add(head);
    this.head = head;

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.34), dark);
    snout.position.set(0, -0.04, 0.32);
    head.add(snout);

    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 4), mat);
      ear.position.set(sx * 0.13, 0.24, -0.04);
      head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
      eye.position.set(sx * 0.12, 0.05, 0.2);
      head.add(eye);
    }

    this.legs = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * 0.24, 0.62, sz * 0.5);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.16), dark);
        leg.position.y = -0.31;
        pivot.add(leg);
        this.group.add(pivot);
        this.legs.push({ pivot, phase: (sx * sz > 0 ? 0 : Math.PI) });
      }
    }

    const tail = new THREE.Group();
    tail.position.set(0, 0.92, -0.76);
    const tm = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 5), mat);
    tm.rotation.x = Math.PI / 2;
    tm.position.z = -0.32;
    tail.add(tm);
    this.group.add(tail);
    this.tail = tail;

    this.group.scale.setScalar(scale);
    this.t = Math.random() * 10;
    this.speed = 0;
    this.position = this.group.position;
  }

  update(dt) {
    this.t += dt * (2 + this.speed * 1.6);
    const run = Math.min(1, this.speed / 4);
    for (const { pivot, phase } of this.legs) {
      pivot.rotation.x = Math.sin(this.t * 2 + phase) * (0.15 + run * 0.75);
    }
    this.body.position.y = 0.85 + Math.abs(Math.sin(this.t * 2)) * 0.05 * run;
    this.head.rotation.x = Math.sin(this.t * 2) * 0.06;
    this.tail.rotation.y = Math.sin(this.t * 1.4) * 0.35;
    this.tail.rotation.x = -0.2 - run * 0.3;
  }
}

// 羽毛：收集物，浮着转
export class Feather {
  constructor({ color = 0xf0ead8 } = {}) {
    this.group = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.34);
    shape.quadraticCurveTo(0.14, 0.05, 0.05, -0.3);
    shape.quadraticCurveTo(0, -0.34, -0.05, -0.3);
    shape.quadraticCurveTo(-0.14, 0.05, 0, 0.34);
    const geo = new THREE.ShapeGeometry(shape, 8);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 0.9;
    this.group.add(this.mesh);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    this.group.add(glow);
    this.glow = glow;

    this.t = Math.random() * 10;
    this.taken = false;
    this.needsCamera = true;
  }

  update(dt, camera) {
    this.t += dt;
    this.mesh.position.y = 0.9 + Math.sin(this.t * 1.6) * 0.14;
    this.mesh.rotation.z = Math.sin(this.t * 1.1) * 0.35;
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
    this.glow.material.opacity = 0.1 + Math.sin(this.t * 2.4) * 0.05;
    this.glow.scale.setScalar(1 + Math.sin(this.t * 2.4) * 0.12);
  }
}
