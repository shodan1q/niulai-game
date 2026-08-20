import * as THREE from 'three';
import { Npc } from '../engine/actor.js';
import { makeGround, makeHills, makeGrass, makeTree, makeRock, Lark, makeCaoBlocks, BirdFlock } from '../engine/props.js';
import { scatter, makeExitGate, placeFeather, makeMotes, addRiver, addWildlife, tickWildlife } from './common.js';

// 和第一章是同一条河，只是天亮了。
const RIVER_C = (x) => -22 + Math.sin(x * 0.045) * 5;

// 终章 · 醒来。有据可查的情节：牛来发现一切是梦，与父亲的牛群团聚。

export const reunion = {
  id: 'reunion',
  bounds: 42,
  spawn: [0, 16],
  inkBleed: 0.12,
  startTime: 0.06,        // 天刚亮
  moodBlend: 0.72,
  mood: {
    sky: 0xbcd8ea, skyTop: 0x74abdd, fog: 0xcfe2ee, fogNear: 45, fogFar: 160,
    sun: 0xfff2d8, sunIntensity: 1.9, sunPos: [22, 20, 16],
    hemiSky: 0xdcecff, hemiGround: 0x54602e, hemiIntensity: 0.95,
    ambient: 0.32, exposure: 1.12,
  },

  build(ctx) {
    const { assets } = ctx;
    const g = new THREE.Group();

    const river = addRiver(g, {
      center: RIVER_C, halfW: 2.15, slope: 0.83, seed: 5,
      groundA: 0x7d9646, groundB: 0xa3b25c,
      bedColor: 0x8a7a55, waterColor: 0x5896ae, rockColor: 0x94907e,
      reedColor: 0x9cba60, reedH: 1.2,
    });
    const inWater = (x, z) => river.inside(x, z, 0.8);

    g.add(makeHills({ radius: 102, count: 15, color: 0x6f7c48, height: 12, seed: 19 }));
    const grass = makeGrass({ count: 4200, area: 58, color: 0x94af53, height: 0.48, seed: 47, inner: 1.5, reject: inWater });
    g.add(grass);
    // 弹幕长进草里了
    const cao = makeCaoBlocks({ count: 42, area: 42, size: 1.0, seed: 13, inner: 4, stack: 0.18, reject: inWater });
    g.add(cao);

    const avoid = [[0, 16], [4, 2], [-8, 8]];
    scatter(g, (i, r) => makeTree({ h: 4.5 + r() * 3, leaf: 0x568238, trunk: 0x63492a, seed: i + 13 }),
      { count: 8, inner: 18, outer: 42, seed: 141, avoid, avoidR: 6, reject: inWater });
    scatter(g, (i, r) => makeRock({ s: 0.4 + r() * 0.9, color: 0x94907e, seed: i + 17 }),
      { count: 9, inner: 10, outer: 38, seed: 151, avoid, avoidR: 4, reject: inWater });

    const motes = makeMotes({ count: 150, area: 46, height: 10, color: 0xffffff, size: 0.09, opacity: 0.4, seed: 21 });
    g.add(motes);

    // ---- 爸爸 ----
    const father = new Npc(assets, {
      name: '牛爸', label: '牛爸', dialogueId: 'father',
      height: 2.15, tint: 0xe8c886, girth: 1.3, stance: 0.2, yaw: Math.PI, wander: 0.2, radius: 3.4,
    });
    father.position.set(4, 0, 2);
    g.add(father.group);

    const niuer = new Npc(assets, {
      name: '牛二', label: '牛二', dialogueId: 'niuer_end',
      height: 1.2, tint: 0xf0e0b0, girth: 1.05, stance: 0.15, yaw: -1.2, wander: 0.5,
    });
    niuer.position.set(-8, 0, 8);
    g.add(niuer.group);

    // 背景牛群：不能交谈，就是一群在吃草的牛
    const herd = [];
    // 只留三头。牛爸和牛二本身也是牛，再站一片就全是同一个模型了。
    const spots = [[-15, -7], [12, -10], [-3, -15]];
    spots.forEach(([x, z], i) => {
      const c = new Npc(assets, {
        name: '', height: 1.4 + (i % 3) * 0.28, tint: [0xe0cc9a, 0xf2e2ba, 0xd6bc8c][i % 3],
        girth: 1.1 + (i % 2) * 0.15, stance: 0.08 + (i % 3) * 0.05, yaw: (i * 1.7) % 6.28, wander: 0.4,
      });
      c.position.set(x, 0, z);
      g.add(c.group);
      herd.push(c);
    });

    // 云雀还在背上
    const lark = new Lark({ color: 0xa8977c });
    g.add(lark.group);

    const feather = placeFeather(g, -24, -18, 'reunion');

    // 醒来之后，梦里的那些也在：一条狗跟着牛群，一只豹子远远站在河对岸
    // 每种一只，都在河边
    const wild = addWildlife(g, assets, [
      { model: 'dog', x: -6, z: RIVER_C(-6) + 5, height: 0.82, stance: 0.72, yaw: 1.1, roam: 3.5, speed: 1.7 },
      { model: 'baola', x: 18, z: RIVER_C(18) - 4, height: 1.15, stance: 0.85, yaw: 2.9, roam: 2 },
    ]);

    // 天上一直有鸟在绕
    const birds = new BirdFlock(ctx.assets, { count: 11, radius: 54, height: 22, size: 1.6, seed: 21, speed: 0.065 });
    g.add(birds.group);

    const gate = makeExitGate({ color: 0xfff0c0 });
    gate.position.set(0, 0, -30);
    g.add(gate);

    const st = { flown: false };

    return {
      group: g,
      actors: [father, niuer, ...herd, lark, feather],
      npcs: [father, niuer],
      feathers: [feather],
      points: [],
      gate,
      river,
      exit: { position: new THREE.Vector3(0, 0, -30), radius: 2.6, requires: 'ending', to: null, label: '跟上牛群' },

      onTrigger(name) {
        if (name !== 'finish' || st.flown) return;
        st.flown = true;
        const from = lark.group.position.clone();
        lark.flyAlong(new THREE.CatmullRomCurve3([
          from,
          from.clone().add(new THREE.Vector3(6, 8, -14)),
          from.clone().add(new THREE.Vector3(18, 18, -38)),
          from.clone().add(new THREE.Vector3(44, 26, -78)),
        ]), 0.13);
      },

      update(dt, t, gs) {
        motes.userData.tick(dt, t);
        grass.userData.tick(dt, t);
        cao.userData.tick(dt, t);
        river.tickAll(dt, t);
        tickWildlife(wild, dt, river);
        gate.userData.tick(dt);
        birds.update(dt);
        // 没飞走之前，云雀一直待在牛来背上
        if (!st.flown) {
          const p = ctx.player;
          lark.group.position.set(
            p.position.x - Math.sin(p.yaw) * 0.25,
            p.position.y + p.height * 0.95,
            p.position.z - Math.cos(p.yaw) * 0.25,
          );
          lark.group.rotation.y = p.yaw;
        }
        gate.userData.open = gs.flags.has('ending');
      },
    };
  },
};
