import * as THREE from 'three';
import { makeHills, makeGrass, makeRock, makeRiver, Snake, makeCaoBlocks, BirdFlock } from '../engine/props.js';
import { scatter, makeExitGate, placeFeather, makeMotes, point, addWildlife, tickWildlife } from './common.js';

// 第二章 · 梦·草丛。有据可查的情节：牛来玩耍时碰到蛇，
// 因为眼神不好，把它当成一截会动的绳子头。
// 一条小河横在中间，站着走不过去——得退后助跑。

// 河心随 x 蜿蜒。玩家从 z=22 往南走，在 z≈11 处到岸。
const RIVER_C = (x) => 8 + Math.sin(x * 0.05) * 4.5;
// 灵蛇就卧在对岸水边
const SNAKE_Z = 3.4;
const HALF_W = 2.15;     // 水面半宽，水面宽 4.3 米
const SLOPE = 0.83;      // 岸坡，所以站得住的两岸之间是 5.6 米
                         // 全速跑跳飞 9.4 米，走着跳只有 4.3 米——必须先跑起来

export const deep = {
  id: 'deep',
  bounds: 40,
  spawn: [0, 22],
  inkBleed: 0.55,
  startTime: 0.87,        // 梦是夜里做的
  moodBlend: 0.42,        // 梦境保留更多自己的青绿，少跟着时间跑
  mood: {
    sky: 0x3d6470, skyTop: 0x1c4652, fog: 0x497784, fogNear: 18, fogFar: 82,
    sun: 0xbfeee0, sunIntensity: 1.5, sunPos: [10, 20, -14],
    hemiSky: 0x9fd8d0, hemiGround: 0x2a3c34, hemiIntensity: 1.05,
    ambient: 0.42, exposure: 1.08,
  },

  build(ctx) {
    const g = new THREE.Group();

    // 河自带两岸地面，所以这一章不铺整块大地面
    const river = makeRiver({
      center: RIVER_C, halfW: HALF_W, slope: SLOPE, depth: 1.15,
      xMin: -110, xMax: 110, segX: 170, out: 110, segOut: 22,
      groundA: 0x3d5a44, groundB: 0x587a53,
      bedColor: 0x6b6048, waterColor: 0x357c88, seed: 13,
    });
    g.add(river.group);
    g.add(makeHills({ radius: 84, count: 14, color: 0x27383a, height: 17, seed: 8, rings: 3 }));

    const inWater = (x, z) => river.inside(x, z, 0.8);

    // 深草，避开河道
    const grassA = makeGrass({ count: 4500, area: 52, color: 0x5b8a55, height: 0.78, seed: 17, inner: 1.2, wind: 1.4, reject: inWater });
    const grassB = makeGrass({ count: 1400, area: 52, color: 0x7ba05e, height: 1.25, seed: 19, inner: 8, wind: 1.8, reject: inWater });
    g.add(grassA); g.add(grassB);
    // 弹幕长进草里了
    const cao = makeCaoBlocks({ count: 38, area: 38, size: 0.95, seed: 7, inner: 4, stack: 0.2, reject: inWater });
    g.add(cao);

    scatter(g, (i, r) => makeRock({ s: 1.2 + r() * 2.2, color: 0x4a5450, seed: i + 9 }),
      { count: 10, inner: 12, outer: 36, seed: 41, avoid: [[0, 22], [0, SNAKE_Z]], avoidR: 7, reject: inWater });

    // ---- 河边的石头：沿着河道两侧摆，半泡在水里 ----
    const bankRock = (x, side, s, seed) => {
      const z = RIVER_C(x) + side * (HALF_W + SLOPE * (0.15 + Math.random() * 0.5));
      const m = makeRock({ s, color: 0x6d7370, seed });
      m.position.set(x, -0.35 + s * 0.1, z);
      m.rotation.y = seed;
      g.add(m);
    };
    const rockSpots = [-34, -27, -19, -12.5, -6, 3.5, 9, 15.5, 23, 30, 37];
    rockSpots.forEach((x, i) => {
      bankRock(x, i % 2 ? 1 : -1, 0.5 + (i % 3) * 0.35, i + 3);
      if (i % 3 === 0) bankRock(x + 2.2, i % 2 ? -1 : 1, 0.42 + (i % 2) * 0.3, i + 40);
    });
    // 河心几块踏石，纯装饰——踩不住，还是得跳
    [-22, -4, 12, 28].forEach((x, i) => {
      const m = makeRock({ s: 0.55 + i * 0.08, color: 0x7b817c, seed: i + 60 });
      m.position.set(x, -0.62, RIVER_C(x) + (i % 2 ? 0.5 : -0.6));
      g.add(m);
    });

    // ---- 河边芦苇 ----
    const reeds = [];
    for (let x = -46; x <= 46; x += 5.6) {
      for (const side of [1, -1]) {
        const cz = RIVER_C(x) + side * (HALF_W + SLOPE * 0.95);
        const clump = makeGrass({
          count: 14, area: 1.3, color: side > 0 ? 0x84a860 : 0x769a58,
          height: 1.25 + (x % 3) * 0.12, seed: Math.abs(Math.round(x * 7)) + 1, clump: 5, wind: 2.2,
        });
        clump.position.set(x, 0, cz);
        g.add(clump);
        reeds.push(clump);
      }
    }

    const motes = makeMotes({ count: 220, area: 44, height: 10, color: 0xbff0d8, size: 0.11, opacity: 0.55, seed: 6 });
    g.add(motes);

    // ---- 灵蛇：卧在对岸河边的石头堆里 ----
    const snake = new Snake({ color: 0x6ea87e, length: 3.4, radius: 0.19 });
    snake.group.position.set(0, 0.22, SNAKE_Z);
    // 顺着河岸躺，别指着水里——河沿 X 走，蛇也沿 X 摆
    snake.group.rotation.y = Math.PI / 2 + 0.25;
    g.add(snake.group);
    for (const [dx, dz, s] of [[-1.9, 0.6, 0.75], [1.7, -0.5, 0.6], [0.4, 1.9, 0.5]]) {
      const m = makeRock({ s, color: 0x5f665f, seed: Math.round(s * 100) });
      m.position.set(dx, 0, SNAKE_Z + dz);
      g.add(m);
    }

    // 蛇蜕 + 压在下面的羽毛，也在对岸
    const slough = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.09, 5, 14, Math.PI * 1.4),
      new THREE.MeshLambertMaterial({ color: 0xd8d0b8, flatShading: true, transparent: true, opacity: 0.75 }),
    );
    slough.rotation.x = Math.PI / 2;
    slough.position.set(-20, 0.1, 2);
    g.add(slough);
    const feather = placeFeather(g, -20, 2, 'deep');

    // 对岸远处站着一只豹子，一直背对着你——梦里先见到的是它的影子
    // 每种一只，都在河边
    const wild = addWildlife(g, ctx.assets, [
      { model: 'baola', x: -14, z: RIVER_C(-14) - 4.5, height: 1.15, stance: 0.85, yaw: 2.6, roam: 2.5 },
      { model: 'dog', x: 13, z: RIVER_C(13) + 4.5, height: 0.82, stance: 0.72, yaw: -2.2, roam: 3, speed: 1.4 },
    ]);

    // 天上一直有鸟在绕
    const birds = new BirdFlock(ctx.assets, { count: 6, radius: 44, height: 20, size: 1.5, seed: 9, speed: 0.045 });
    g.add(birds.group);

    const gate = makeExitGate({ color: 0xa8e8c8 });
    gate.position.set(2, 0, -26);
    g.add(gate);

    return {
      group: g,
      actors: [snake, feather],
      npcs: [],
      feathers: [feather],
      points: [point(0, SNAKE_Z, 'snake', '灵蛇', 3.4)],
      river,
      gate,
      exit: { position: new THREE.Vector3(2, 0, -26), radius: 2.4, requires: 'metSnake', to: 'forest', label: '往林子那边走' },

      update(dt, t, state) {
        motes.userData.tick(dt, t);
        grassA.userData.tick(dt, t);
        grassB.userData.tick(dt, t);
        cao.userData.tick(dt, t);
        for (const c of reeds) c.userData.tick(dt, t);
        river.tick(dt, t);
        tickWildlife(wild, dt, river);
        gate.userData.tick(dt);
        birds.update(dt);
        snake.update(dt);
        // 玩家靠近时蛇立起来
        const d = ctx.player.position.distanceTo(snake.group.position);
        snake.amp = THREE.MathUtils.lerp(snake.amp, d < 6 ? 0.35 : 1, Math.min(1, dt * 3));
        snake.group.position.y = 0.22 + (d < 6 ? 0.35 : 0) * Math.sin(t * 2) * 0.1;
        gate.userData.open = state.flags.has('metSnake');
      },
    };
  },
};
