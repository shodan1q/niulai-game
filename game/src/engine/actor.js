import * as THREE from 'three';
import { Rig } from './rig.js';

// 模型是静态的，一根骨头都没有。所有"动作"都是这里现算出来的：
// 呼吸、行走的挤压拉伸、转弯侧倾、落地压扁、说话点头。
// 顺带做了个"直立/四足"切换——原片里牛群在平地上直立行走是个著名吐槽点，
// 这里把它做成一个玩家可以按 P 切换的开关。

const _v = new THREE.Vector3();

// 带骨骼的模型给回来的是一个 Group（里面是骨架 + SkinnedMesh），
// 静态模型给回来的是 Mesh。两种都得能释放，所以统一遍历着来。
function disposeMesh(obj) {
  if (!obj) return;
  obj.traverse?.((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material.dispose();
  });
  if (!obj.traverse && obj.material) obj.material.dispose();
}

export class Actor {
  constructor(assets, opts = {}) {
    const {
      height = 1.2,
      tint = 0xffffff,
      flat = false,
      stance = 0,          // 0 = 四足匍匐，1 = 直立行走
      girth = 1,           // 横向胖瘦
      name = '',
      shadow = true,
      roughness = 1,
      model = 'niulai',    // 用哪个模型：niulai（带贴图）/ baola（顶点色）
      gravity = 14,        // 每秒每秒。云雀轻，给得小一点，滞空久
    } = opts;

    this.name = name;
    this.height = height;
    this.girth = girth;
    this.stance = stance;
    this.stanceTarget = stance;

    this.group = new THREE.Group();
    this.assets = assets;
    this.model = model;
    this.mesh = assets.makeMesh(model, { tint, flat, roughness });
    // 带骨骼的模型走关节动画，不参与整体挤压拉伸
    this.rig = this.mesh.userData?.rig ? new Rig(this.mesh.userData.rig) : null;
    this.pivot = new THREE.Group();       // 承担形变，与朝向解耦
    this.pivot.add(this.mesh);
    this.group.add(this.pivot);

    if (shadow) {
      const g = new THREE.CircleGeometry(0.5, 20);
      g.rotateX(-Math.PI / 2);
      this.shadow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false,
      }));
      this.shadow.position.y = 0.01;
      this.shadow.renderOrder = -1;
      this.group.add(this.shadow);
    }

    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.yawTarget = 0;
    this.yawRate = 0;

    this.grounded = true;
    this.vy = 0;
    this.gravity = gravity;
    this.squash = 0;        // 落地/起跳的瞬时形变，会自己弹回 0
    this.gait = Math.random() * 10;
    this.breath = Math.random() * 10;
    this.dynPitch = 0;      // 俯仰：起跳前倾、下落收回、快跑时也带一点
    this.talking = 0;       // >0 时点头
    this.emote = 0;         // 一次性的"惊"，会自己衰减
    this.flying = 0;        // 0~1，正在扑翼的强度（只有云雀会）
    this.dancing = null;    // 正在跳的舞，null 表示没跳
    this.danceT = 0;
    this.slide = 0;         // 滑铲剩余时间，>0 表示正在滑
    this.slideT = 0;        // 已经滑了多久，姿势按它插值

    this._applyScale();
  }

  _applyScale() {
    // 带骨骼的是双足人形，压扁拉长那套体型变换会把它捏坏，跳过
    if (this.rig) {
      this.baseScale = new THREE.Vector3(this.girth, 1, 1).multiplyScalar(this.height);
      this.basePitch = 0;
      this.pivot.rotation.x = this.dynPitch || 0;
      if (this.shadow) this.shadow.scale.setScalar(this.height * 0.62);
      return;
    }
    // 四足时压扁拉长，直立时抽高收窄
    const s = this.stance;
    const sy = THREE.MathUtils.lerp(0.78, 1.12, s);
    const sz = THREE.MathUtils.lerp(1.30, 0.95, s);
    const sx = THREE.MathUtils.lerp(1.14, 0.94, s) * this.girth;
    this.baseScale = new THREE.Vector3(sx, sy, sz).multiplyScalar(this.height);
    // 正的 rotation.x = 低头前倾（四足时本来就前倾，直立时微微仰）
    this.basePitch = THREE.MathUtils.lerp(0.16, -0.06, s);
    this.pivot.rotation.x = this.basePitch + this.dynPitch;
    if (this.shadow) {
      this.shadow.scale.setScalar(this.height * THREE.MathUtils.lerp(1.15, 0.85, s));
    }
  }

  // 换一副皮囊，位置/速度/朝向都留着——切换角色时镜头才不会跳
  setModel(modelId, opts = {}) {
    const {
      height = this.height, girth = this.girth, tint = 0xffffff,
      flat = false, roughness = 1, stance = this.stanceTarget,
    } = opts;
    this.pivot.remove(this.mesh);
    disposeMesh(this.mesh);
    this.model = modelId;
    this.mesh = this.assets.makeMesh(modelId, { tint, flat, roughness });
    this.rig = this.mesh.userData?.rig ? new Rig(this.mesh.userData.rig) : null;
    this.pivot.add(this.mesh);
    this.height = height;
    this.girth = girth;
    this.setStance(stance, true);
    this.startle();
    return this;
  }

  setStance(v, instant = false) {
    this.stanceTarget = THREE.MathUtils.clamp(v, 0, 1);
    if (instant) { this.stance = this.stanceTarget; this._applyScale(); }
  }

  faceTowards(x, z) {
    this.yawTarget = Math.atan2(x - this.position.x, z - this.position.z);
  }

  // 扑翼：长按时每帧给一点向上的加速度，到顶速和天花板就不再给。
  // 跟 jump 的区别是它可以在空中反复施加，所以能一直飞。
  flap(dt, { accel = 22, maxUp = 4.2, ceiling = 14 } = {}) {
    if (this.position.y >= ceiling) { this.vy = Math.min(this.vy, 0); return false; }
    this.grounded = false;
    this.vy = Math.min(this.vy + accel * dt, maxUp);
    return true;
  }

  jump(power = 5.2) {
    if (!this.grounded) return false;
    this.vy = power;
    this.grounded = false;
    this.squash = -0.35;      // 起跳先抽长
    return true;
  }

  startle() { this.emote = 1; }

  /**
   * 滑铲。给一记向前的冲量，然后靠摩擦自己停下来。
   * 只有站在地上、而且有速度的时候才铲得动——站着原地铲没有意义。
   */
  startSlide({ boost = 1.55, dur = 0.85, min = 2.0 } = {}) {
    if (!this.grounded || this.slide > 0) return false;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (sp < min) return false;
    this.slide = dur;
    this.slideT = 0;
    this.setDance(null);
    // 沿当前朝向加速，不是沿当前速度——铲出去的方向要跟身子一致
    const f = Math.sin(this.yaw), g = Math.cos(this.yaw);
    this.velocity.x = f * sp * boost;
    this.velocity.z = g * sp * boost;
    return true;
  }

  // 开始跳某一套；传 null 停下。返回现在跳的是哪套。
  setDance(id) {
    if (id !== this.dancing) this.danceT = 0;
    this.dancing = id;
    if (!id && !this.rig) {
      // 停下时把整体形变复位，否则会保持在最后一帧的歪姿势
      this.pivot.position.y = 0;
      this.pivot.rotation.z = 0;
      this.pivot.rotation.y = 0;
    }
    return this.dancing;
  }

  update(dt, groundY = 0) {
    this.justLanded = 0;
    // 姿态过渡
    if (Math.abs(this.stance - this.stanceTarget) > 1e-3) {
      this.stance += (this.stanceTarget - this.stance) * Math.min(1, dt * 6);
      this._applyScale();
    }

    // 重力
    if (!this.grounded) {
      this.vy -= this.gravity * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.grounded = true;
        this.justLanded = Math.min(1, Math.abs(this.vy) / 8);     // 给音效读的落地力度
        this.squash = Math.min(0.5, Math.abs(this.vy) * 0.075);   // 落地压扁
        this.vy = 0;
      }
    } else {
      this.position.y += (groundY - this.position.y) * Math.min(1, dt * 12);
    }

    // 朝向：插值 + 记录转速用于侧倾
    let d = this.yawTarget - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = d * Math.min(1, dt * 9);
    this.yaw += step;
    this.yawRate += (step / Math.max(dt, 1e-4) - this.yawRate) * Math.min(1, dt * 8);
    this.group.rotation.y = this.yaw;

    // 步频跟着水平速度走
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = speed > 0.08;
    this.gait += dt * (2.2 + speed * 2.4);
    this.breath += dt * 1.5;

    // 形变叠加
    const bob = moving ? Math.sin(this.gait * 2) : 0;
    const step2 = moving ? Math.abs(Math.sin(this.gait)) : 0;
    const breathe = Math.sin(this.breath) * 0.012;
    this.squash += (0 - this.squash) * Math.min(1, dt * 9);
    this.emote += (0 - this.emote) * Math.min(1, dt * 3.5);

    const walkSquash = moving ? (step2 - 0.5) * 0.09 * Math.min(1, speed / 3) : 0;
    const talkNod = this.talking > 0 ? Math.sin(this.gait * 5) * 0.03 : 0;
    const startle = this.emote * 0.18;

    // 有骨架的角色不做整体挤压拉伸：腿在走、身子在起伏，再叠一层整体形变
    // 就成了橡皮人。只保留落地那一下的压缩，作为冲击反馈。
    const rigged = !!this.rig;
    const sy = rigged ? 1 - this.squash * 0.45
                      : 1 - this.squash + walkSquash + breathe + talkNod + startle;
    const sxz = rigged ? 1 + this.squash * 0.25
                       : 1 + this.squash * 0.55 - walkSquash * 0.5 - breathe * 0.5 - startle * 0.4;

    this.pivot.scale.set(
      this.baseScale.x * sxz,
      this.baseScale.y * sy,
      this.baseScale.z * sxz,
    );

    // 滑铲：摩擦一路吃掉速度，慢到一定程度就自动起身
    if (this.slide > 0) {
      this.slide -= dt;
      this.slideT += dt;
      const fric = Math.pow(0.16, dt);
      this.velocity.x *= fric;
      this.velocity.z *= fric;
      if (!this.grounded || Math.hypot(this.velocity.x, this.velocity.z) < 0.5) this.slide = 0;
      if (this.slide <= 0) this.slideT = 0;
    }

    if (this.rig) {
      this.rig.setDance(this.dancing);
      this.rig.update(dt, speed, this.runSpeed || 8, {
        grounded: this.grounded, vy: this.vy, yawRate: this.yawRate,
        talking: this.talking, flying: this.flying || 0,
        slide: this.slide > 0 ? Math.min(1, this.slideT / 0.12) : 0,
      });
    } else if (this.slide > 0) {
      // 掰不动关节的，就把整个身子压平、往前扑，再侧倒一点
      const k = Math.min(1, this.slideT / 0.12);
      this.pivot.scale.set(this.baseScale.x * (1 + 0.18 * k),
                           this.baseScale.y * (1 - 0.42 * k),
                           this.baseScale.z * (1 + 0.45 * k));
      this.pivot.position.y = -0.16 * k * this.height;
      this.pivot.rotation.x = this.basePitch + 0.75 * k;
      this.pivot.rotation.z = 0.28 * k;
      this.pivot.rotation.y = 0;
    } else if (this.dancing) {
      // 没骨架的四种：掰不动关节，只能整体来。幅度给足，要的就是那个劲儿。
      this.danceT += dt * (this.dancing === 'shimmy' ? 4.6 : 3.2);
      const p = this.danceT, s2 = Math.sin(p), c2 = Math.cos(p);
      const hop = Math.abs(Math.sin(p));
      this.pivot.scale.set(
        this.baseScale.x * (1 + Math.sin(p * 2) * 0.14),
        this.baseScale.y * (1 - Math.sin(p * 2) * 0.16),
        this.baseScale.z * (1 + Math.sin(p * 2) * 0.14),
      );
      this.pivot.position.y = hop * 0.22 * this.height;
      this.pivot.rotation.z = s2 * (this.dancing === 'sway' ? 0.42 : 0.22);
      this.pivot.rotation.x = this.basePitch + c2 * 0.18;
      this.pivot.rotation.y = this.dancing === 'spin' ? p * 2 : s2 * 0.35;
    }

    // 俯仰：起跳的时候整个身子往前扑，到顶收一点，下落时微微仰头准备落地。
    // 跑起来也带一点前倾，这样起跳的前倾是接着跑姿来的，不会突然一顿。
    const speedK = Math.min(1, speed / 7);
    let wantPitch = moving ? 0.10 * speedK : 0;
    if (!this.grounded) {
      const rise = THREE.MathUtils.clamp(this.vy / 5.2, -1, 1);
      wantPitch += (rise > 0 ? 0.36 : 0.13) * rise * (0.6 + 0.4 * speedK);
    }
    this.dynPitch += (wantPitch - this.dynPitch) * Math.min(1, dt * 14);
    this.pivot.rotation.x = this.basePitch + (rigged ? this.dynPitch * 0.25 : this.dynPitch);

    // 走路时上下颠 + 左右晃；转弯时向内侧倾。
    // 这些骨架自己会做，别再从外面叠一遍。
    if (rigged) {
      this.pivot.position.y = 0;
      this.pivot.rotation.z = 0;
      this.pivot.rotation.y = 0;
    } else {
      this.pivot.position.y = moving ? Math.abs(bob) * 0.045 * this.height : 0;
      this.pivot.rotation.z = -THREE.MathUtils.clamp(this.yawRate * 0.09, -0.35, 0.35)
        + (moving ? Math.sin(this.gait) * 0.035 : 0);
      this.pivot.rotation.y = moving ? Math.sin(this.gait) * 0.05 : 0;
    }

    // 扑翼。模型一根骨头都没有，翅膀掰不动，
    // 只能靠整体的开合 + 上下颠 + 左右摇装出"在打翅膀"。
    if ((this.flying ?? 0) > 0.01) {
      this.wingT = (this.wingT ?? 0) + dt * 16;
      const w = Math.sin(this.wingT) * this.flying;
      this.pivot.position.y += w * 0.05 * this.height;
      this.pivot.rotation.z += w * 0.16;
      this.pivot.scale.x *= 1 + w * 0.13;
      this.pivot.scale.y *= 1 - w * 0.06;
    }

    if (this.shadow) {
      const air = Math.max(0, this.position.y - groundY);
      this.shadow.position.y = groundY - this.position.y + 0.012;
      // 飞起来以后影子是唯一的高度参照，衰减留个底，别彻底看不见
      this.shadow.material.opacity = Math.max(0.08, 0.16 / (1 + air * 1.6));
    }

    if (this.talking > 0) this.talking -= dt;
  }

  dispose() {
    disposeMesh(this.mesh);
    this.shadow?.material.dispose();
    this.shadow?.geometry.dispose();
  }
}

// NPC：站着轻轻晃，玩家靠近时转头看过来
export class Npc extends Actor {
  constructor(assets, opts) {
    super(assets, opts);
    this.isNpc = true;
    this.dialogueId = opts.dialogueId || null;
    this.label = opts.label || opts.name || '';
    this.radius = opts.radius ?? 2.6;
    this.homeYaw = opts.yaw ?? 0;
    this.yaw = this.yawTarget = this.homeYaw;
    this.wander = opts.wander ?? 0;
    this._t = Math.random() * 10;
  }

  update(dt, groundY = 0, player = null) {
    this._t += dt;
    if (player) {
      const dist = _v.copy(player.position).sub(this.position).length();
      if (dist < this.radius * 1.8) this.faceTowards(player.position.x, player.position.z);
      else this.yawTarget = this.homeYaw + Math.sin(this._t * 0.3) * this.wander;
    }
    super.update(dt, groundY);
  }
}
