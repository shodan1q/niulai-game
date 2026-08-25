import * as THREE from 'three';
import { Npc } from '../engine/actor.js';
import { makeGround, makeHills, makeGrass, makeForest, makeRock, Lark, Wolf, makeCaoBlocks, BirdFlock } from '../engine/props.js';
import { scatter, makeExitGate, placeFeather, makeMotes, addRiver, addWildlife, tickWildlife } from './common.js';

// 河横在南边，不挡故事——羽毛在对岸，想拿就得先学会助跑起跳。
const RIVER_C = (x) => -20 + Math.sin(x * 0.045) * 5;

// 第一章 · 草原黄昏。现实层。
// 有据可查的情节：牛来刚出生站不起来，牛妈喊"牛，来"给它取了名字；
// 云雀从荒漠飞来落在它背上，被一起带进梦里。

export const prairie = {
  id: 'prairie',
  bounds: 44,
  spawn: [0, 10],
  inkBleed: 0,
  startTime: 0.62,        // 开场是黄昏，之后天会自己走
  moodBlend: 0.7,
  mood: {
    sky: 0xf0c48c, skyTop: 0x8ea8cc, fog: 0xefc493, fogNear: 45, fogFar: 165,
    sun: 0xffd9a0, sunIntensity: 2.1, sunPos: [-26, 16, -18],
    hemiSky: 0xffd9b0, hemiGround: 0x5a5230, hemiIntensity: 0.85,
    ambient: 0.3, exposure: 1.1,
  },

  build(ctx) {
    const { assets } = ctx;
    const g = new THREE.Group();

    const river = addRiver(g, {
      center: RIVER_C, halfW: 2.15, slope: 0.83, seed: 5,
      groundA: 0x71883c, groundB: 0x9aa851,
      bedColor: 0x8a7a55, waterColor: 0x4a86a0, rockColor: 0x8f8a76,
      reedColor: 0x8fae5c, reedH: 1.2,
    });
    const inWater = (x, z) => river.inside(x, z, 0.8);

    g.add(makeHills({ radius: 100, count: 16, color: 0x6b7040, height: 13, seed: 3, rings: 3 }));
    const grass = makeGrass({ count: 4200, area: 60, color: 0x87a349, height: 0.5, seed: 11, inner: 1.5, reject: inWater });
    g.add(grass);
    // 弹幕长进草里了
    const cao = makeCaoBlocks({ count: 46, area: 44, size: 1.0, seed: 3, inner: 4, stack: 0.18, reject: inWater });
    g.add(cao);

    const avoid = [[0, 10], [-9, 2], [8, -4], [3, 18]];
    // 温带草甸：阔叶为主，夹几棵松和灌木
    g.add(makeForest({
      count: 16, inner: 16, outer: 44, seed: 21, avoid, avoidR: 6, reject: inWater,
      kinds: { broadleaf: 4, pine: 2, shrub: 2, birch: 1 },
      h: [4, 7.5], leaf: 0x4a7a34, trunk: 0x63492a,
    }));
    scatter(g, (i, r) => makeRock({ s: 0.5 + r() * 1.1, color: 0x8f8a76, seed: i + 5 }),
      { count: 12, inner: 8, outer: 40, seed: 33, avoid, avoidR: 4, reject: inWater });

    const motes = makeMotes({ count: 130, area: 46, height: 9, color: 0xffe6b0, size: 0.1, opacity: 0.45, seed: 4 });
    g.add(motes);

    // ---- 角色 ----
    const niuer = new Npc(assets, {
      name: '牛二', label: '牛二', dialogueId: 'niuer',
      height: 1.15, tint: 0xf0e0b0, girth: 1.05, stance: 0.15, yaw: -0.5, wander: 0.5,
    });
    niuer.position.set(-9, 0, 2);
    g.add(niuer.group);

    const mother = new Npc(assets, {
      name: '牛妈', label: '牛妈', dialogueId: 'mother',
      height: 1.85, tint: 0xffeec6, girth: 1.2, stance: 0.1, yaw: 2.4, wander: 0.25, radius: 3.2,
    });
    mother.position.set(8, 0, -6);
    g.add(mother.group);

    // 云雀停在一块石头上，聊完妈妈之后才出现
    const lark = new Lark({ color: 0xa8977c });
    lark.group.position.set(3, 1.35, 18);
    lark.group.visible = false;
    g.add(lark.group);
    const perch = makeRock({ s: 0.9, color: 0x9a9482, seed: 12 });
    perch.position.set(3, 0, 18);
    g.add(perch);

    // 羽毛放在河对岸——第一次需要跑起来跳的地方，在这儿学会，梦里那条河就不慌
    const feather = placeFeather(g, -21, -30, 'prairie');

    // 溜达的动物：一条狗跟着牛二，远处两头牛在啃草。
    // 河对岸站着豹拉和一只狼——梦里才会正式认识的两位，先在这儿露个面。
    // 每种只放一只，都在河边。北岸一狗一牛，南岸豹拉和狼。
    const bank = (x, side, off = 4.5) => RIVER_C(x) + side * off;
    const wild = addWildlife(g, assets, [
      { model: 'dog', x: -14, z: bank(-14, 1), height: 0.82, stance: 0.72, yaw: 0.8, roam: 3.5, speed: 1.6 },
      // 在对岸低头喝水
      { model: 'baola', x: 4.5, z: bank(4.5, -1, 2.6), height: 1.15, stance: 0.85, yaw: 0.3, roam: 1.6, speed: 0.7 },
    ]);

    // 狼站在更远一点的对岸，不动，就是看着你
    const wolf = new Wolf({ color: 0x6b7280, scale: 1 });
    wolf.group.position.set(-9, 0, RIVER_C(-9) - 4);
    g.add(wolf.group);

    // 天上一直有鸟在绕
    const birds = new BirdFlock(ctx.assets, { count: 9, radius: 52, height: 24, size: 1.6, seed: 5, speed: 0.055 });
    g.add(birds.group);

    // 出口刻意跟云雀落脚的石头分开，不然刚聊完就被传走，羽毛都来不及捡
    const gate = makeExitGate({ color: 0xffe0a0 });
    gate.position.set(-4, 0, 25);
    g.add(gate);

    const st = { sawThem: false };

    return {
      group: g,
      actors: [niuer, mother, lark, feather],
      npcs: [niuer, mother],
      feathers: [feather],
      points: [{ position: lark.group.position, radius: 3, dialogueId: 'lark_intro', label: '云雀', hidden: () => !lark.group.visible }],
      gate,
      river,
      exit: { position: new THREE.Vector3(-4, 0, 25), radius: 2.4, requires: 'metLark', to: 'deep', label: '找块软地方躺下' },

      update(dt, t, state) {
        motes.userData.tick(dt, t);
        grass.userData.tick(dt, t);
        cao.userData.tick(dt, t);
        river.tickAll(dt, t);
        tickWildlife(wild, dt, river);
        gate.userData.tick(dt);
        birds.update(dt);

        // 狼不动，只是一直把脸转向你
        wolf.speed = 0;
        wolf.update(dt);
        const px = ctx.player.position;
        wolf.group.lookAt(px.x, 0, px.z);

        // 走到河边第一次看见对岸那两个
        if (!st.sawThem && Math.abs(px.z - RIVER_C(px.x)) < 14) {
          st.sawThem = true;
          ctx.toast('对岸有两个影子。一个在喝水，一个在看你。');
        }
        // 妈妈聊完，云雀才从荒漠飞过来
        if (state.flags.has('metMother') && !lark.group.visible) {
          lark.group.visible = true;
          lark.group.position.set(60, 22, 40);
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(60, 22, 40),
            new THREE.Vector3(30, 12, 30),
            new THREE.Vector3(10, 6, 24),
            new THREE.Vector3(3, 1.35, 18),
          ]);
          lark.flyAlong(curve, 0.22);
          ctx.toast('一只鸟从荒漠那边飞过来了。');
        }
        if (lark.flying && lark.u >= 1) lark.flying = false;
        gate.userData.open = state.flags.has('metLark');
      },
    };
  },
};
