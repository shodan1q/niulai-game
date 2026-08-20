import * as THREE from 'three';
import { rng, Feather, makeRiver, makeGrass, makeRock } from '../engine/props.js';
import { Actor } from '../engine/actor.js';

// 场景之间共用的零件。

// 给场景加一条河：河本身 + 两岸的石头 + 水边的芦苇。
// 每个场景都有水，但样子不一样——草原是清的，断林是发绿的，荒漠只剩一道细流。
export function addRiver(g, {
  center, halfW = 2.15, slope = 0.83, depth = 1.15,
  groundA, groundB, bedColor, waterColor, seed = 5,
  rocks = 11, rockColor = 0x6d7370, reeds = true, reedColor = 0x84a860, reedH = 1.25,
  xMin = -110, xMax = 110, out = 110,
} = {}) {
  const river = makeRiver({
    center, halfW, slope, depth, seed,
    xMin, xMax, segX: 170, out, segOut: 22,
    groundA, groundB, bedColor, waterColor,
  });
  g.add(river.group);

  const r = rng(seed + 17);
  // 岸边石头，一部分半泡在水里
  for (let i = 0; i < rocks; i++) {
    const x = xMin * 0.36 + (i / Math.max(1, rocks - 1)) * (xMax - xMin) * 0.36 + (r() - 0.5) * 4;
    const side = i % 2 ? 1 : -1;
    const s = 0.42 + r() * 0.75;
    const m = makeRock({ s, color: rockColor, seed: i + seed });
    m.position.set(x, -0.34 + s * 0.1, center(x) + side * (halfW + slope * (0.15 + r() * 0.5)));
    m.rotation.y = r() * 6.28;
    g.add(m);
  }
  // 河心几块踏石，纯装饰——踩不住，还是得跳
  for (let i = 0; i < 4; i++) {
    const x = -30 + i * 19 + r() * 6;
    const m = makeRock({ s: 0.5 + r() * 0.25, color: rockColor, seed: i + seed + 60 });
    m.position.set(x, -depth * 0.55, center(x) + (r() - 0.5) * 1.2);
    g.add(m);
  }

  const clumps = [];
  if (reeds) {
    for (let x = -46; x <= 46; x += 5.6) {
      for (const side of [1, -1]) {
        const c = makeGrass({
          count: 14, area: 1.3, color: reedColor,
          height: reedH + (x % 3) * 0.12, seed: Math.abs(Math.round(x * 7)) + seed, clump: 5, wind: 2.2,
        });
        c.position.set(x, 0, center(x) + side * (halfW + slope * 0.95));
        g.add(c);
        clumps.push(c);
      }
    }
  }

  river.reeds = clumps;
  river.tickAll = (dt, t) => {
    river.tick(dt, t);
    for (const c of clumps) c.userData.tick(dt, t);
  };
  return river;
}

// 场景里溜达的动物。不参与对话，只是让世界不空。
export function addWildlife(g, assets, list) {
  const made = [];
  for (const o of list) {
    const a = new Actor(assets, {
      model: o.model, height: o.height ?? 1.1, tint: o.tint ?? 0xffffff,
      girth: o.girth ?? 1, stance: o.stance ?? 0.3, name: o.name ?? '',
    });
    a.position.set(o.x, 0, o.z);
    a.yaw = a.yawTarget = o.yaw ?? 0;
    a._home = new THREE.Vector3(o.x, 0, o.z);
    a._roam = o.roam ?? 0;              // 0 就是站着不动，只呼吸
    a._t = Math.random() * 10;
    a._speed = o.speed ?? 1.1;
    g.add(a.group);
    made.push(a);
  }
  return made;
}

// 让 addWildlife 造出来的动物慢慢晃悠
export function tickWildlife(list, dt, river = null) {
  for (const a of list) {
    a._t += dt;
    if (a._roam > 0) {
      // 绕着自己的窝走一个慢圈，遇到河就折回去
      const ang = a._t * 0.16 + a._home.x;
      let tx = a._home.x + Math.cos(ang) * a._roam;
      let tz = a._home.z + Math.sin(ang * 0.8) * a._roam;
      if (river && river.inside(tx, tz, 1.5)) {
        tz = a._home.z - Math.sin(ang * 0.8) * a._roam;
      }
      const dx = tx - a.position.x, dz = tz - a.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.35) {
        const s = Math.min(a._speed, d * 2);
        a.velocity.set((dx / d) * s, 0, (dz / d) * s);
        a.position.x += a.velocity.x * dt;
        a.position.z += a.velocity.z * dt;
        a.yawTarget = Math.atan2(dx, dz);
      } else {
        a.velocity.multiplyScalar(0.9);
      }
    }
    a.update(dt, 0);
  }
}

// 在环形区域里撒东西，避开中心和已占用的点
export function scatter(group, factory, {
  count = 10, inner = 6, outer = 40, seed = 1, avoid = [], avoidR = 4, y = 0, reject = null,
} = {}) {
  const r = rng(seed);
  const made = [];
  for (let i = 0; i < count; i++) {
    let x, z, ok = false, tries = 0;
    while (!ok && tries++ < 24) {
      const a = r() * Math.PI * 2;
      const d = inner + r() * (outer - inner);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      ok = avoid.every((p) => Math.hypot(p[0] - x, p[1] - z) > avoidR)
        && !(reject && reject(x, z));
    }
    if (!ok) continue;
    const o = factory(i, r);
    if (!o) continue;
    o.position.set(x, y, z);
    o.rotation.y = r() * Math.PI * 2;
    group.add(o);
    made.push(o);
  }
  return made;
}

// 出口：一圈慢慢转的光，只有条件满足了才亮
export function makeExitGate({ color = 0xffe6a0 } = {}) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2.1, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);

  const pillars = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 3),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    const a = (i / 7) * Math.PI * 2;
    m.position.set(Math.cos(a) * 1.85, 1.5, Math.sin(a) * 1.85);
    m.lookAt(0, 1.5, 0);
    g.add(m);
    pillars.push(m);
  }

  g.visible = false;
  g.userData.open = false;
  g.userData.t = 0;
  g.userData.tick = (dt) => {
    g.userData.t += dt;
    const t = g.userData.t;
    const target = g.userData.open ? 1 : 0;
    g.userData.a = THREE.MathUtils.lerp(g.userData.a ?? 0, target, Math.min(1, dt * 2.2));
    const a = g.userData.a;
    g.visible = a > 0.01;
    ring.material.opacity = a * (0.4 + Math.sin(t * 2) * 0.12);
    ring.rotation.z = t * 0.35;
    pillars.forEach((m, i) => {
      m.material.opacity = a * (0.16 + Math.abs(Math.sin(t * 1.6 + i)) * 0.3);
      m.scale.y = 0.8 + Math.sin(t * 2 + i * 0.7) * 0.22;
    });
    g.rotation.y = t * 0.15;
  };
  return g;
}

// 一个纯逻辑的交互点（比如蛇、树桩这种不是 Actor 的东西）
export function point(x, z, dialogueId, label, radius = 3) {
  return { position: new THREE.Vector3(x, 0, z), radius, dialogueId, label };
}

export function placeFeather(group, x, z, note) {
  const f = new Feather();
  f.group.position.set(x, 0, z);
  f.note = note;
  group.add(f.group);
  return f;
}

// 飘在空中的尘埃 / 萤火 / 雪，看场景给不同颜色
export function makeMotes({ count = 160, area = 50, height = 12, color = 0xffffff, size = 0.09, opacity = 0.5, seed = 4 } = {}) {
  const r = rng(seed);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const spd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (r() - 0.5) * area * 2;
    pos[i * 3 + 1] = r() * height;
    pos[i * 3 + 2] = (r() - 0.5) * area * 2;
    spd[i] = 0.2 + r() * 0.8;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.tick = (dt, t) => {
    const a = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] += spd[i] * dt * 0.35;
      a[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.15;
      if (a[i * 3 + 1] > height) a[i * 3 + 1] = 0;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}
