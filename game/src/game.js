import * as THREE from 'three';
import { Stage } from './engine/stage.js';
import { Actor } from './engine/actor.js';
import { Input } from './engine/input.js';
import { Overlay } from './ui/overlay.js';
import { DialogueRunner } from './ui/dialogue.js';
import { Audio } from './audio/audio.js';
import { DIALOGUES, SCENE_TITLES, FEATHER_NOTES, SCENES } from './data/script.js';
import { PLAYABLE, VIEWS, byId } from './data/animals.js';
import { DayClock, sampleTime, blendMood } from './engine/daynight.js';

import { prairie } from './scenes/prairie.js';
import { deep } from './scenes/deep.js';
import { forest } from './scenes/forest.js';
import { desert } from './scenes/desert.js';
import { reunion } from './scenes/reunion.js';

const SCENE_DEFS = { prairie, deep, forest, desert, reunion };

// 剧本里的说话人 → 发声预设
const SPEAKER_VOICE = {
  牛来: 'niulai', 牛妈: 'mother', 牛爸: 'father', 牛二: 'niuer',
  豹拉: 'baola', 灵蛇: 'snake', 云雀: 'lark', 狼: 'wolf',
};

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Game {
  // assets 由调用方注入。这里不 import Assets 是有意的：
  // 那条链上挂着 GLTFLoader → FileLoader → fetch，小工具容器全禁，
  // 只要 import 了就会被打进包里，扫描清单必然命中。
  constructor(canvas, uiContainer, assets) {
    this.stage = new Stage(canvas);
    this.assets = assets;
    this.input = new Input();
    this.audio = new Audio();
    this.overlay = new Overlay(uiContainer, this);
    // 输入的左右判定要跟界面用同一套尺寸，否则摇杆区和按钮区会对不上
    this.input.viewport = () => ({ w: this.overlay.vw(), h: this.overlay.vh() });
    // 浏览器要用户先动一下才准出声
    addEventListener('keydown', () => this.audio.unlock(), { once: true });

    this.state = 'boot';
    this.flags = new Set();
    this.talked = new Set();
    this.featherCount = 0;
    this.scene = null;
    this.sceneDef = null;
    this.clock = new DayClock(0.62, 300);      // 一整天 5 分钟
    this.sceneDef = null;
    this.t = 0;
    this.busy = false;          // 转场中，锁输入
    this._btnPointer = new Map();   // 触屏：哪根手指正按着哪个功能键

    this.runner = new DialogueRunner(this.overlay, {
      onFlag: (f) => this.flags.add(f),
      onTrigger: (name) => this.onTrigger(name),
      onEnd: () => { this.overlay.setHint(null); },
      // 每换一句，说话的角色先叫一声
      onLine: (who) => this.audio.speak(SPEAKER_VOICE[who] ?? null, { gain: 0.5 }),
    });
  }

  async boot(models) {
    await this.assets.load(models, (p) => { this.overlay.loadProgress = p; });
    this.overlay.loadProgress = 1;

    this.animal = byId('niulai');
    const a = this.animal;
    this.player = new Actor(this.assets, {
      model: a.model, name: a.name, height: a.height, tint: a.tint,
      girth: a.girth, stance: a.stance, gravity: a.gravity ?? 14,
    });
    this.stage.eyeHeight = a.height * 0.86;
    this.ctx = {
      assets: this.assets,
      stage: this.stage,
      player: this.player,
      audio: this.audio,
      toast: (t) => this.overlay.showToast(t),
    };

    this.state = 'title';
    this.overlay.state = 'title';
  }

  // ================================================================ 场景
  loadScene(id) {
    if (this.scene) {
      this.stage.scene.remove(this.scene.group);
      this.scene.group.traverse((o) => {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose?.();
      });
    }
    const def = SCENE_DEFS[id];
    this.sceneDef = def;
    this.scene = def.build(this.ctx);
    this.sceneDef = def;
    // 每章按剧情该有的时辰开场，之后天自己走
    if (def.startTime !== undefined) this.clock.set(def.startTime);
    this._bankSide = null;
    this.scene.id = id;
    this.stage.scene.add(this.scene.group);
    this.stage.scene.add(this.player.group);
    this.applyMood();
    this.overlay.inkBleed = def.inkBleed ?? 0;

    // 开局朝 -Z（场景纵深方向），相机在他身后的 +Z 侧
    const [sx, sz] = def.spawn;
    this.player.position.set(sx, 0, sz);
    this.player.yaw = this.player.yawTarget = Math.PI;
    this.player.velocity.set(0, 0, 0);
    // 腾空状态也要落地。转场正好发生在跳跃中途时，新场景会带着上一跳的 vy 开局，
    // 人一进去就在往下掉，而且因为 grounded 还是 false，跳也跳不起来。
    this.player.grounded = true;
    this.player.vy = 0;
    this.player.position.y = 0;
    this._bankSide = null;
    this._wasAirborne = false;
    this.stage.camYaw = 0;
    this.stage.camPitch = 0.24;
    this.stage.lookAt.set(sx, 1.4, sz);
    this.stage.camera.position.set(sx, 5, sz + 9);

    const title = SCENE_TITLES[id];
    if (title) this.overlay.showCard(title.cn, title.sub);
  }

  goToScene(id) {
    if (this.busy) return;
    this.busy = true;
    this.overlay.startTransition(() => {
      this.loadScene(id);
      this.busy = false;
    }, 1.8);
  }

  // from 可以指定起始章节：标题页选了哪一章就从那一章开始
  startGame(from = 'prairie') {
    this.state = 'play';
    this.overlay.state = 'play';
    this.overlay.featherTotal = 5;
    // 直接跳到后面的章节时，把前面章节的进度标记补上，
    // 否则那一章的出口永远不亮、玩家会困在里面
    const i = SCENES.indexOf(from);
    const PRE = ['metLark', 'metSnake', 'metBaola', 'motherGone'];
    for (let k = 0; k < i; k++) this.flags.add(PRE[k]);
    this.loadScene(SCENES[i] ?? 'prairie');
  }

  // 跑得越快跳得越高越远，力度按各自的 run 速度归一化。
  // 梦境那条河缺口 5.6 米，三种全速跑跳都过得去：
  //   牛来 9.4 米 / 豹拉 13.7 米 / 狗 10.5 米；走着跳只有 4~6 米。
  doJump() {
    const v = this.player.velocity;
    const a = this.animal;
    const k = Math.min(1, Math.hypot(v.x, v.z) / a.run);
    const ok = this.player.jump(a.jump[0] + a.jump[1] * k);
    // 跳的时候各喊各的：牛来喊「妈妈」，牛妈喊「牛来」
    if (ok) this.audio.jump(k, a.voice);
    return ok;
  }

  // 会飞的（云雀）：按住跳跃键就一直扑翼，松手滑翔落下。
  // 不会飞的按住也没用——它们的 jump() 在空中直接拒绝。
  updateFlight(dt) {
    const fly = this.animal.fly;
    const p = this.player;
    if (!fly) { p.flying = 0; return; }
    const held = this.input.jumpHeld && !this.runner.active && !this.busy;
    if (held) {
      // 站在地上按住：先起跳，再接扑翼，衔接才顺
      if (p.grounded) this.doJump();
      else p.flap(dt, fly);
    }
    // flying 给翅膀动画读：>0 表示这一帧在扑
    p.flying = held && !p.grounded ? Math.min(1, (p.flying ?? 0) + dt * 6)
                                   : Math.max(0, (p.flying ?? 0) - dt * 4);
    if (held && !p.grounded) {
      // 每 0.42 秒扑一声，别连成一片
      this._flapT = (this._flapT ?? 0) + dt;
      if (this._flapT > 0.42) { this._flapT = 0; this.audio.flap?.(); }
    } else this._flapT = 0.42;
  }

  // 换一种动物操控。位置、速度、朝向、镜头都不动，只换皮囊和手感。
  switchAnimal(dir = 1) {
    const i = PLAYABLE.findIndex((x) => x.id === this.animal.id);
    const a = PLAYABLE[(i + dir + PLAYABLE.length) % PLAYABLE.length];
    this.animal = a;
    this.player.setModel(a.model, {
      height: a.height, girth: a.girth, tint: a.tint, stance: a.stance,
    });
    this.player.gravity = a.gravity ?? 14;
    this.player.flying = 0;
    // 换成不会飞的时候人还在半空：让它正常落下就行，但别留着 held 状态
    if (!a.fly) this.input.jumpHeld = false;
    this.player.name = a.name;
    this.stage.eyeHeight = a.height * 0.86;
    this.player.mesh.visible = this.stage.view !== 'first';
    this.audio.speak(a.voice);
    // 有剧情依据的先说情节，没有的只说手感——不给没查到的角色编设定
    // kind 和 name 一样时别写成"狗（狗）"
    const tag = a.kind && a.kind !== a.name ? `（${a.kind}）` : '';
    const body = a.line ? `${a.name}　${a.line}` : `${a.name}${tag}　${a.note}`;
    this.overlay.showToast(a.hint ? `${body}\n${a.hint}` : body);
    return a;
  }

  cycleView() {
    const i = VIEWS.findIndex((v) => v.id === this.stage.view);
    const v = VIEWS[(i + 1) % VIEWS.length];
    this.stage.setView(v, this.animal.height * 0.86);
    this.player.mesh.visible = v.id !== 'first';
    this.overlay.showToast(`视角：${v.name}`);
    return v;
  }

  // 把场景签名色和当前时辰混起来，再交给渲染栈
  applyMood() {
    if (!this.sceneDef) return;
    const time = sampleTime(this.clock.t);
    this.timeNow = time;
    this.stage.setMood(blendMood(this.sceneDef.mood, time, this.sceneDef.moodBlend ?? 0.6));
  }

  // 跳到下一个时辰
  nextPhase() {
    const p = this.clock.nextPhase();
    this.applyMood();
    this.overlay.showToast(`${p.name}　${this.clock.clockText()}`);
    return p;
  }

  // 脚步、落地、环境音。环境音默认关（按 B 开）——开了才有风和水。
  updateAudio(dt) {
    const a = this.audio;
    if (!a.ready) return;
    const p = this.player;

    if (p.justLanded > 0.02) a.land(p.justLanded);

    const sp = Math.hypot(p.velocity.x, p.velocity.z);
    if (p.grounded && sp > 0.6 && !this.runner.active) a.footstep(sp / 4.6);

    let water = 0;
    const river = this.scene?.river;
    if (river) {
      const d = Math.abs(p.position.z - river.center(p.position.x));
      water = Math.max(0, 1 - Math.max(0, d - river.carveHalf) / 16) * 0.55;
    }
    const WIND = { prairie: 0.30, deep: 0.20, forest: 0.34, desert: 0.52, reunion: 0.26 };
    a.setAmbience({ wind: WIND[this.scene?.id] ?? 0.3, water }, dt);
  }

  // 河：站在地上过不去，落水了推回**出发的那一岸**。
  // 推去最近的岸是不行的——落在河心偏对岸一点就等于免费送过河，跳跃就没意义了。
  checkRiver() {
    const river = this.scene?.river;
    if (!river) return;
    const p = this.player.position;
    const dz = p.z - river.center(p.x);
    const outside = Math.abs(dz) >= river.blockHalf;
    if (outside && this.player.grounded) this._bankSide = dz >= 0 ? 1 : -1;
    if (this.player.grounded && !outside) {
      const side = this._bankSide ?? (dz >= 0 ? 1 : -1);
      p.z = river.center(p.x) + side * river.blockHalf;
      this.player.velocity.z *= 0.15;
      if (this._wasAirborne) {                       // 是跳进来的，不是走进来的
        this.player.startle();
        this.stage.addShake(0.25);
        this.audio.splash();
        this.overlay.showToast('扑通。——退后，跑起来再跳。');
      }
    }
    this._wasAirborne = !this.player.grounded;
  }

  onTrigger(name) {
    this.scene?.onTrigger?.(name);
    // 存句柄，重开时要撤销——否则上一局的定时器会把新的一局拽走
    if (name === 'wake') this._defer(() => this.goToScene('reunion'), 900);
    // 结局之后直接淡回标题。原来这里是一段我自己写的片尾旁白
    // （票房、制作团队那些），不是影片内容，去掉了。
    if (name === 'finish') this._defer(() => this.finish(), 2600);
  }

  _defer(fn, ms) {
    this._timers ??= new Set();
    const h = setTimeout(() => { this._timers.delete(h); fn(); }, ms);
    this._timers.add(h);
  }

  _clearTimers() {
    for (const h of this._timers ?? []) clearTimeout(h);
    this._timers?.clear();
  }

  // 通关。淡出，回标题。
  finish() {
    if (this.busy) return;
    this.busy = true;
    this.overlay.startTransition(() => {
      this.reset();
      this.busy = false;
    }, 2.2);
  }

  reset() {
    this._clearTimers();
    this.audio.cancelAnswer();
    this.overlay.closeDialogue();
    this.runner.active = false;
    this.runner.awaitingChoice = false;
    this.flags.clear();
    this.talked.clear();
    this.featherCount = 0;
    this.overlay.feathers = 0;
    this.overlay.setHint(null);
    this.busy = false;
    this._posedOnce = false;
    // 姿态、角色、视角都是玩家开关，重开一局要归位
    if (this.player) {
      const a = byId('niulai');
      this.animal = a;
      if (this.player.model !== a.model) {
        this.player.setModel(a.model, { height: a.height, girth: a.girth, tint: a.tint, stance: a.stance });
      }
      this.player.name = a.name;
      this.player.setStance(a.stance, true);
      this.player.mesh.visible = true;
      this.player.velocity.set(0, 0, 0);
      this.stage.setView(VIEWS[0], a.height * 0.86);
    }
    this.state = 'title';
    this.overlay.state = 'title';
    if (this.scene) { this.stage.scene.remove(this.scene.group); this.scene = null; }
  }

  // ================================================================ 输入
  onPointerDown(x, y, isTouch, id = null) {
    this.audio.unlock();
    if (this.state === 'title') {
      // 先看点没点在章节那一排上；没点中就从第一章开始
      const ch = this.overlay.chapterAt(x, y);
      this.overlay.startTransition(() => this.startGame(ch >= 0 ? SCENES[ch] : 'prairie'), 1.8);
      this.state = 'starting';
      return;
    }
    if (this.runner.active) {
      const i = this.overlay.hitChoice(x, y);
      if (i >= 0) { this.runner.choose(i); return; }
      if (!this.runner.awaitingChoice) { this.runner.advance(); return; }
      return;
    }
    // 触屏按钮要在摇杆/转视角之前判，否则按它们会顺带把镜头拖歪
    if (this.state === 'play' && !this.busy) {
      const hit = this.overlay.touchButtonAt(x, y);
      if (hit) {
        // 这根手指归按钮管，抬手之前不要交给摇杆/转视角
        this._btnPointer.set(id ?? 'mouse', hit);
        if (hit === 'jump') {
          this.doJump();
          this.input.jumpHeld = true;      // 按住不放 = 云雀一直扑翼
        }
        else if (hit === 'animal') this.switchAnimal(1);
        else if (hit === 'view') this.cycleView();
        else if (hit === 'time') this.nextPhase();
        else if (hit === 'shout') this.audio.shout(this.animal.voice, 0.9);
        return;
      }
    }
    this.input.onPointerDown(x, y, isTouch, id);
  }

  onPointerMove(x, y) {
    if (this.state === 'title') { this.overlay._chapHover = this.overlay.chapterAt(x, y); }
    if (this.runner.active) { this.overlay.hoverChoice(x, y); return; }
    this.input.onPointerMove(x, y);
  }

  onPointerUp(x, y, id = null) {
    const key = id ?? 'mouse';
    const btn = this._btnPointer.get(key);
    if (btn !== undefined) {
      this._btnPointer.delete(key);
      if (btn === 'jump') this.input.jumpHeld = false;
      return;                       // 按钮的手指不参与摇杆和点击判定
    }
    this.input.onPointerUp(x, y, id);
  }
  onWheel(dy) { if (this.state === 'play') this.stage.zoom(dy); }

  // ================================================================ 主循环
  update(dt) {
    this.t += dt;
    this.input.update();
    this.overlay.tick(dt);

    if (this.input.takeAmb()) {
      this.overlay.showToast(this.audio.toggleAmbience() ? '环境音：开' : '环境音：关');
    }
    if (this.input.takeMute()) {
      this.overlay.showToast(this.audio.toggleMute() ? '静音' : '开声音');
    }
    const vk = this.input.takeVoice();
    if (vk && this.state === 'play') {
      this.audio.shout(vk, 0.9);
    }
    if (this.input.takeView() && this.state === 'play') this.cycleView();
    if (this.input.takeAnimal() && this.state === 'play' && !this.busy && !this.runner.active) {
      this.switchAnimal(1);
    }

    if (this.state !== 'play') { this.overlay.feathers = this.featherCount; return; }

    // 天一直在走，光照每帧重算
    this.clock.update(dt);
    this.applyMood();
    if (this.input.takeTime()) this.nextPhase();

    // Shift+1~5 直接跳章，自己测的时候不用每次从头玩
    const ch = this.input.takeChapter();
    if (ch >= 0 && ch < SCENES.length && !this.busy) {
      const id = SCENES[ch];
      if (id !== this.scene?.id) {
        this.runner.active = false;
        this.overlay.closeDialogue();
        this.goToScene(id);
        return;
      }
    }

    this.updateAudio(dt);

    // ---- 对话中：只处理推进 ----
    if (this.runner.active) {
      // 说话的时候跳不起来，所以空格在这儿也当推进用（两个都要读，否则会漏一次按键到下一帧）
      const confirm = this.input.takeConfirm();
      const jump = this.input.takeJump();
      if (confirm || jump) this.runner.advance();
      const idx = this.input.takeIndex();
      if (idx >= 0 && idx < this.runner.choiceCount) this.runner.choose(idx);
      this.input.takeDrag();
      this.input.takeClick();
      this.player.velocity.set(0, 0, 0);
      this.player.talking = 0.2;
      this.stepWorld(dt);
      return;
    }

    if (this.busy) { this.stepWorld(dt); return; }

    // ---- 移动 ----
    const drag = this.input.takeDrag();
    if (drag.x || drag.y) this.stage.orbit(drag.x, drag.y);

    if (this.input.takeJump()) this.doJump();
    this.updateFlight(dt);

    if (this.input.takePose()) {
      const s = this.player.stanceTarget > 0.5 ? 0.1 : 1;
      this.player.setStance(s);
      if (!this._posedOnce) {
        this._posedOnce = true;
        this.overlay.showToast(s > 0.5 ? '牛来站起来了。牛在平地上直立行走，这事原片干过。' : '四条腿，踏实多了。');
      }
    }

    const ax = this.input.axis;
    const cy = this.stage.camYaw;
    _f.set(-Math.sin(cy), 0, -Math.cos(cy));
    _r.set(Math.cos(cy), 0, -Math.sin(cy));
    _d.set(0, 0, 0).addScaledVector(_f, -ax.y).addScaledVector(_r, ax.x);

    const moving = _d.lengthSq() > 1e-4;
    const a = this.animal;
    // 直立走得慢一点——但只罚"本来该四足却站起来"的（牛来），
    // 豹拉和狗本来就是这个姿态，不该跟着挨罚
    const uprightPenalty = (this.player.stanceTarget > 0.5 && a.stance <= 0.5) ? 0.85 : 1;
    const speed = (this.input.run ? a.run : a.walk) * uprightPenalty;
    if (moving) {
      _d.normalize();
      this.player.velocity.lerp(_d.clone().multiplyScalar(speed), Math.min(1, dt * a.accel));
      this.player.yawTarget = Math.atan2(_d.x, _d.z);
    } else {
      this.player.velocity.lerp(_d.set(0, 0, 0), Math.min(1, dt * (a.accel + 2)));
    }
    this.player.position.addScaledVector(this.player.velocity, dt);

    // 圆形边界，走到头轻轻推回来
    const b = this.sceneDef.bounds;
    const dist = Math.hypot(this.player.position.x, this.player.position.z);
    if (dist > b) {
      const k = b / dist;
      this.player.position.x *= k;
      this.player.position.z *= k;
      this.player.velocity.multiplyScalar(0.4);
    }

    this.stage.updateCamera(dt, this.player.position);
    this.stepWorld(dt);
    this.checkRiver();
    this.handleInteractions(dt);
  }

  // 场景与角色的推进（对话中也照常跑，世界不会因为有人说话就停下）
  stepWorld(dt) {
    this.player.update(dt, 0);
    if (!this.scene) return;
    for (const a of this.scene.actors) {
      if (a.isNpc) a.update(dt, 0, this.player);
      else if (a.needsCamera) a.update(dt, this.stage.camera);
      else a.update(dt);
    }
    this.scene.update?.(dt, this.t, this);
    if (this.state !== 'play') this.stage.updateCamera(dt, this.player.position);
  }

  handleInteractions(dt) {
    const p = this.player.position;

    // 羽毛
    for (const f of this.scene.feathers) {
      if (f.taken) continue;
      if (p.distanceTo(f.group.position) < 1.8) {
        f.taken = true;
        f.group.visible = false;
        this.featherCount++;
        this.overlay.feathers = this.featherCount;
        this.audio.pickup();
        this.overlay.showToast(FEATHER_NOTES[f.note] ?? '一根羽毛。');
      }
    }

    // 最近的可交互对象
    let best = null, bestD = Infinity;
    const consider = (obj, pos, radius, label, dialogueId) => {
      if (!dialogueId) return;
      const d = p.distanceTo(pos);
      if (d < radius && d < bestD) { bestD = d; best = { obj, label, dialogueId }; }
    };
    for (const n of this.scene.npcs) consider(n, n.position, n.radius, n.label, n.dialogueId);
    for (const pt of this.scene.points ?? []) {
      if (pt.hidden?.()) continue;
      consider(pt, pt.position, pt.radius, pt.label, pt.dialogueId);
    }

    // 出口
    const ex = this.scene.exit;
    const exOpen = ex && this.flags.has(ex.requires);
    const atExit = exOpen && p.distanceTo(ex.position) < ex.radius;

    if (atExit) {
      this.overlay.setHint(null);
      if (ex.to) this.goToScene(ex.to);
      else this.showCredits();
      return;
    }

    if (best) {
      const done = this.talked.has(best.dialogueId);
      const tree = DIALOGUES[best.dialogueId];
      const canRepeat = done && tree?.repeat;
      this.overlay.setHint(
        `${best.label ? `「${best.label}」 ` : ''}E / 点击${done ? (canRepeat ? '再聊聊' : '（聊过了）') : '交谈'}`,
      );
      const pressed = this.input.takeConfirm() || !!this.input.takeClick();
      if (pressed && tree) {
        const node = done ? (tree.repeat ? 'repeat' : null) : 'start';
        if (node) {
          this.player.faceTowards(best.obj.position?.x ?? p.x, best.obj.position?.z ?? p.z);
          best.obj.faceTowards?.(p.x, p.z);
          if (best.obj.talking !== undefined) best.obj.talking = 999;
          this.runner.start(tree, node);
          if (!done) this.talked.add(best.dialogueId);
          this._talkingNpc = best.obj;
        }
      }
    } else {
      // 只在真站到岸边时才提示。范围放到 6 会导致过了河还在喊"走不过去"。
      const river = this.scene.river;
      const nearRiver = river && Math.abs(p.z - river.center(p.x)) < river.blockHalf + 3.5;
      if (nearRiver && this.player.grounded) {
        this.overlay.setHint('河太宽，走不过去 —— 退后助跑，Shift 加速，空格起跳');
      } else if (exOpen) {
        const dEx = p.distanceTo(ex.position);
        this.overlay.setHint(dEx < 14 ? `${ex.label} →` : null);
      } else {
        this.overlay.setHint(null);
      }
      this.input.takeConfirm();
      this.input.takeClick();
      if (this._talkingNpc) { this._talkingNpc.talking = 0; this._talkingNpc = null; }
    }
  }

  render() { this.stage.render(); }
}
