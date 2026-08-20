import * as THREE from 'three';
import { Npc } from '../engine/actor.js';
import { makeGround, makeHills, makeDune, makeRock, makeBones, makeTree, Wolf, BirdFlock } from '../engine/props.js';
import { scatter, makeExitGate, placeFeather, makeMotes, point, addRiver, addWildlife, tickWildlife } from './common.js';

// 这条是快干了的河：河床很宽，水只剩中间细细一道。
const RIVER_C = (x) => 10 + Math.sin(x * 0.04) * 6;

// 第四章 · 梦·迁徙。有据可查的情节：狼群袭击，牛群被迫迁徙，
// 途中牛妈为保护牛来牺牲。这一章只演这件事。

export const desert = {
  id: 'desert',
  bounds: 46,
  spawn: [0, 30],
  inkBleed: 0.75,
  startTime: 0.95,        // 后半夜
  moodBlend: 0.5,
  mood: {
    sky: 0x2b3d5e, skyTop: 0x121b32, fog: 0x36486d, fogNear: 20, fogFar: 98,
    sun: 0xb2ccf2, sunIntensity: 1.75, sunPos: [-16, 20, -12],
    hemiSky: 0x93aede, hemiGround: 0x4c4638, hemiIntensity: 1.0,
    ambient: 0.46, exposure: 1.14, shadows: true,
  },

  build(ctx) {
    const { assets } = ctx;
    const g = new THREE.Group();

    // 河床照样宽，水只剩中间一道——所以缺口还是要跑起来才跳得过
    const river = addRiver(g, {
      center: RIVER_C, halfW: 1.05, slope: 1.95, depth: 1.5, seed: 37,
      groundA: 0x8b7c5e, groundB: 0xa89572,
      bedColor: 0xb0a07c, waterColor: 0x2e4a52, rockColor: 0x736b5c,
      reeds: true, reedColor: 0x7a7550, reedH: 0.8,
    });
    const inWater = (x, z) => river.inside(x, z, 1.2);

    g.add(makeHills({ radius: 96, count: 13, color: 0x36415c, height: 20, seed: 15 }));

    scatter(g, (i, r) => makeDune({ w: 14 + r() * 22, h: 2 + r() * 4, color: 0x9c8a66, seed: i + 3 }),
      { count: 14, inner: 14, outer: 46, seed: 101, avoid: [[0, 30], [0, -18]], avoidR: 9, reject: inWater });
    scatter(g, (i, r) => makeRock({ s: 0.5 + r() * 1.4, color: 0x736b5c, seed: i + 2 }),
      { count: 12, inner: 10, outer: 42, seed: 111, reject: inWater });
    scatter(g, (i, r) => makeBones({ seed: i + 1, color: 0xe2dbc8 }),
      { count: 5, inner: 12, outer: 38, seed: 121, reject: inWater });
    scatter(g, (i, r) => makeTree({ h: 3 + r() * 2.5, trunk: 0x6d5844, seed: i + 5, dead: true }),
      { count: 7, inner: 16, outer: 42, seed: 131, reject: inWater });

    // 夜里被风卷起来的沙
    const motes = makeMotes({ count: 300, area: 48, height: 8, color: 0xc8c0a0, size: 0.09, opacity: 0.35, seed: 14 });
    g.add(motes);

    // 月亮
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(6, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8eeff, transparent: true, opacity: 0.9 }),
    );
    moon.position.set(-40, 38, -70);
    moon.lookAt(0, 4, 0);
    g.add(moon);

    // ---- 狼 ----
    const wolves = [];
    const lead = new Wolf({ color: 0x76808f, scale: 1.05 });
    lead.group.position.set(0, 0, -18);
    lead.group.rotation.y = Math.PI;
    g.add(lead.group);
    wolves.push(lead);

    for (let i = 0; i < 2; i++) {
      const w = new Wolf({ color: 0x656e7c, scale: 0.95 });
      w.group.position.set(-9 + i * 18, 0, -26 - i * 4);
      w.group.visible = false;
      g.add(w.group);
      wolves.push(w);
    }

    // ---- 妈妈：追逐开始后才出现 ----
    const mother = new Npc(assets, {
      name: '牛妈', label: '牛妈', dialogueId: 'mother_end',
      height: 1.85, tint: 0xf0dcb0, girth: 1.2, stance: 0.1, yaw: Math.PI, radius: 3.4,
    });
    mother.position.set(0, 0, 34);
    mother.group.visible = false;
    g.add(mother.group);

    const feather = placeFeather(g, 26, -8, 'desert');

    // 河这边还有活的：一条狗守在水边，一头牛在更远处
    // 每种一只，都在河边
    const wild = addWildlife(g, assets, [
      { model: 'dog', x: -11, z: RIVER_C(-11) + 5, height: 0.82, stance: 0.72, yaw: 2.4, roam: 3, speed: 1.5 },
    ]);

    // 天上一直有鸟在绕
    const birds = new BirdFlock(ctx.assets, { count: 5, radius: 50, height: 26, size: 1.7, seed: 17, speed: 0.04 });
    g.add(birds.group);

    const gate = makeExitGate({ color: 0xdce6ff });
    gate.position.set(0, 0, 38);
    g.add(gate);

    const state = { chasing: false, chaseT: 0 };
    const _v = new THREE.Vector3();

    return {
      group: g,
      actors: [mother, feather],
      npcs: [mother],
      feathers: [feather],
      points: [point(0, -18, 'wolf', '狼', 4)],
      gate,
      river,
      exit: { position: new THREE.Vector3(0, 0, 38), radius: 2.4, requires: 'motherGone', to: 'reunion', label: '醒过来' },

      onTrigger(name) {
        if (name !== 'chase') return;
        state.chasing = true;
        state.chaseT = 0;
        wolves.forEach((w) => { w.group.visible = true; });
        mother.group.visible = true;
        ctx.player.startle();
        ctx.stage.addShake(0.8);
        ctx.toast('跑。别回头。');
      },

      update(dt, t, gs) {
        motes.userData.tick(dt, t);
        river.tickAll(dt, t);
        tickWildlife(wild, dt, river);
        gate.userData.tick(dt);
        birds.update(dt);
        moon.lookAt(ctx.stage.camera.position);

        const px = ctx.player.position;

        if (!state.chasing) {
          // 追逐前，头狼只是站在那儿看着你
          lead.speed = 0;
          lead.update(dt);
          lead.group.lookAt(px.x, 0, px.z);
        } else {
          state.chaseT += dt;
          wolves.forEach((w, i) => {
            _v.copy(px).sub(w.group.position);
            _v.y = 0;
            const dist = _v.length();
            // 咬不到，只是一直贴着——这是剧情，不是失败判定
            const want = 3.2 + i * 2.2;
            const spd = dist > want ? Math.min(7.5, 3 + (dist - want) * 1.2) : -1.2;
            _v.normalize();
            w.group.position.addScaledVector(_v, spd * dt);
            w.group.rotation.y = Math.atan2(_v.x, _v.z);
            w.speed = Math.abs(spd);
            w.update(dt);
            if (dist < 2.4) { ctx.player.startle(); ctx.stage.addShake(0.35); }
          });
          ctx.stage.addShake(dt * 0.25);
        }

        gate.userData.open = gs.flags.has('motherGone');
      },
    };
  },
};
