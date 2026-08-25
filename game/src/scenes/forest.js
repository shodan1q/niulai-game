import * as THREE from 'three';
import { Npc } from '../engine/actor.js';
import { makeGround, makeHills, makeGrass, makeForest, makeStump, makeRock, makeCaoBlocks, BirdFlock } from '../engine/props.js';
import { scatter, makeExitGate, placeFeather, makeMotes, point, addRiver, addWildlife, tickWildlife } from './common.js';

// 溪从林子中间穿过，把出生点和豹拉隔开
const RIVER_C = (x) => 14 + Math.sin(x * 0.06) * 4;

// 第三章 · 梦·林子。有据可查的情节：牛来顺着一个果子找到小豹子豹拉，
// 先当成毒蛇、认出是豹后松一口气；豹拉佯装饥饿讨奶，牛妈最终同意。
// 林子是被人破坏过的地点。

export const forest = {
  id: 'forest',
  bounds: 40,
  spawn: [0, 24],
  inkBleed: 0.4,
  startTime: 0.34,        // 断林是白天看的，看得清才刺眼
  moodBlend: 0.6,
  mood: {
    sky: 0x8f9c7a, skyTop: 0x7d94a8, fog: 0xa3ae90, fogNear: 22, fogFar: 92,
    sun: 0xffe8c0, sunIntensity: 1.5, sunPos: [20, 24, 8],
    hemiSky: 0xd8e0bc, hemiGround: 0x3a3222, hemiIntensity: 0.8,
    ambient: 0.28, exposure: 1.05,
  },

  build(ctx) {
    const { assets } = ctx;
    const g = new THREE.Group();

    const river = addRiver(g, {
      center: RIVER_C, halfW: 2.0, slope: 0.8, depth: 1.0, seed: 29,
      groundA: 0x6a6340, groundB: 0x84794c,
      bedColor: 0x5f5638, waterColor: 0x3f6a5e, rockColor: 0x77736a,
      reedColor: 0x6f8a46, reedH: 1.1,
    });
    const inWater = (x, z) => river.inside(x, z, 0.8);

    g.add(makeHills({ radius: 88, count: 15, color: 0x4c5638, height: 15, seed: 12, rings: 3 }));
    const grass = makeGrass({ count: 2200, area: 50, color: 0x7d8348, height: 0.42, seed: 27, inner: 2, reject: inWater });
    g.add(grass);
    // 弹幕长进草里了
    const cao = makeCaoBlocks({ count: 34, area: 38, size: 1.05, seed: 11, inner: 4, stack: 0.22, reject: inWater });
    g.add(cao);

    const avoid = [[0, 24], [-6, 4], [10, 10]];

    // 满地树桩——这场戏的主角其实是这些切口
    scatter(g, (i, r) => makeStump({ r: 0.5 + r() * 0.6, h: 0.5 + r() * 0.7, color: 0x6b5334, ring: 0xb59668 }),
      { count: 34, inner: 6, outer: 40, seed: 51, avoid, avoidR: 4, reject: inWater });

    // 边缘还剩几棵活的，中间全是死的
    // 还活着的那些：针叶为主，混白桦和垂柳
    g.add(makeForest({
      count: 20, inner: 12, outer: 46, seed: 31, avoid, avoidR: 5, reject: inWater,
      kinds: { pine: 4, birch: 3, willow: 2, broadleaf: 2 },
      h: [5, 9], leaf: 0x527a38, trunk: 0x5c4327,
    }));
    // 被锯断之后剩下的枯木
    g.add(makeForest({
      count: 10, inner: 14, outer: 44, seed: 61, avoid, avoidR: 5, reject: inWater,
      kinds: { dead: 1 }, h: [4, 7.5], trunk: 0x6d5638,
    }));

    // 几根倒在地上的原木
    scatter(g, (i, r) => {
      const l = 4 + r() * 5;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.4, l, 6),
        new THREE.MeshLambertMaterial({ color: 0x644d30, flatShading: true }),
      );
      m.rotation.z = Math.PI / 2;
      m.castShadow = true;
      const w = new THREE.Group();
      m.position.y = 0.4;
      w.add(m);
      return w;
    }, { count: 8, inner: 10, outer: 36, seed: 81, avoid, avoidR: 5, reject: inWater });

    scatter(g, (i, r) => makeRock({ s: 0.4 + r() * 0.9, color: 0x877f6e, seed: i + 11 }),
      { count: 10, inner: 8, outer: 38, seed: 91, avoid, avoidR: 4, reject: inWater });

    // 阳光穿过断林的浮尘
    const motes = makeMotes({ count: 260, area: 42, height: 12, color: 0xfff0c8, size: 0.1, opacity: 0.5, seed: 9 });
    g.add(motes);

    // ---- 豹拉 ----
    // 豹拉用自己的模型（GooFstore 打印件，颜色烘在顶点上，所以 tint 保持白色不去乘它）。
    // 它本来就是站姿，stance 给高一点，别再压成四足。
    const baola = new Npc(assets, {
      model: 'baola', name: '豹拉', label: '豹拉', dialogueId: 'baola',
      height: 1.15, tint: 0xffffff, girth: 1.0, stance: 0.85, yaw: 1.2, wander: 0.6, radius: 3,
    });
    // 就站在对岸水边，从出生点一眼能看见——它是隔着水朝你喊的那句
    // "哎——！别过来！这边全是断的树！"
    baola.position.set(-5, 0, 7.5);
    g.add(baola.group);

    // 那根被单独拎出来的树桩：年轮数到第四十七圈
    const bigStump = makeStump({ r: 1.1, h: 0.9, color: 0x6b5334, ring: 0xc0a071 });
    bigStump.position.set(10, 0, 10);
    g.add(bigStump);

    const feather = placeFeather(g, 18, -14, 'forest');

    // 走了的那些里还剩两个：一条狗在溪边，一头牛在林子边上
    // 每种一只，都在河边
    const wild = addWildlife(g, assets, [
      { model: 'dog', x: 8, z: RIVER_C(8) + 4.5, height: 0.82, stance: 0.72, yaw: -1.4, roam: 3, speed: 1.5 },
      { model: 'niulai', x: -20, z: RIVER_C(-20) + 5, height: 1.55, tint: 0xe6d3a4, girth: 1.1, stance: 0.1, yaw: 0.9, roam: 2.5 },
    ]);

    // 天上一直有鸟在绕
    const birds = new BirdFlock(ctx.assets, { count: 7, radius: 46, height: 23, size: 1.5, seed: 13, speed: 0.06 });
    g.add(birds.group);

    const gate = makeExitGate({ color: 0xffd090 });
    gate.position.set(-20, 0, -24);
    g.add(gate);

    const st = { called: false };

    return {
      group: g,
      actors: [baola, feather],
      npcs: [baola],
      feathers: [feather],
      points: [point(10, 10, 'stump', '断树桩', 2.8)],
      gate,
      river,
      exit: { position: new THREE.Vector3(-20, 0, -24), radius: 2.4, requires: 'metBaola', to: 'desert', label: '跟上牛群' },

      update(dt, t, state) {
        motes.userData.tick(dt, t);
        grass.userData.tick(dt, t);
        cao.userData.tick(dt, t);
        river.tickAll(dt, t);
        tickWildlife(wild, dt, river);
        gate.userData.tick(dt);
        birds.update(dt);

        // 树桩太密，豹拉站在对岸容易被看漏。原片里牛来是顺着一个果子找过去的，
        // 这里就用果子把视线引过去。
        if (!st.called && ctx.player.position.distanceTo(baola.position) < 17) {
          st.called = true;
          ctx.audio?.speak('baola');
          ctx.toast('一个果子从对岸的坡上滚下来。');
          baola.startle();
        }
        gate.userData.open = state.flags.has('metBaola');
      },
    };
  },
};
