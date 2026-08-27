import * as THREE from 'three';

// 骨骼驱动的程序化动作。
//
// 模型是 Mixamo 骨架的 T-Pose，一帧动画都没带，所以走路、待机、起跳全是这里现算的。
// 没用 AnimationMixer：那需要预先烘好的关键帧，而这个模型没有；
// 直接写关节角度反而更省事，也更好跟速度、转向、腾空这些状态挂上钩。
//
// 一条约定：所有角度都是相对绑定姿势的增量，写进 bone.rotation 之前先加回
// userData.rest。这样 T-Pose 那对平举的手臂只在 REST 里减一次，
// 后面的摆臂不用每处都去补偿。

const lerp = THREE.MathUtils.lerp;
const damp = (a, b, k, dt) => a + (b - a) * Math.min(1, k * dt);

// 从 T-Pose 掰到自然站姿。
//
// 这些轴不是猜的，是在浏览器里逐根骨头试出来的：给某根骨头单轴 +0.9 弧度，
// 量它末端（手/脚）往哪儿动，结果如下——
//   Arm      x+ 手往下（左右同号）      z+ 左臂往前 / 右臂往后（镜像）
//   ForeArm  x+ 小臂往下前（左右同号）
//   UpLeg    x+ 脚往后（左右同号）      所以往前迈是 x 负
//   Leg      x+ 脚往前                  所以屈膝是 x 负
// 一开始按人形直觉写的"绕 Z 反号"全是错的，手臂会一条放下一条平举。
const REST = {
  LeftArm:       [1.30, 0, 0],
  RightArm:      [1.30, 0, 0],
  LeftForeArm:   [0.28, 0, 0],
  RightForeArm:  [0.28, 0, 0],
  Spine:         [0.04, 0, 0],
  Spine1:        [0.03, 0, 0],
  Neck:          [-0.06, 0, 0],
  Head:          [0.02, 0, 0],
};


// ---------------------------------------------------------------- 鬼畜
//
// 四套循环动作，按上面那张实测的轴向表写：
//   Arm     x+ 手往下      z+ 左臂往前 / 右臂往后
//   ForeArm x+ 小臂往下前
//   UpLeg   x+ 脚往后      Leg x+ 脚往前
//
// 没配音乐——原曲有版权，游戏里只给一条自己合成的鼓点当节拍。
export const DANCES = ['basket', 'sway', 'shimmy', 'spin', 'lie'];
export const DANCE_NAME = {
  basket: '打篮球', sway: '左右摇', shimmy: '抖肩', spin: '转圈', lie: '躺平',
};

// bpm 决定每套的节奏，相位 ph 一拍走 2π
const DANCE_BPM = { basket: 116, sway: 100, shimmy: 128, spin: 92, lie: 26 };

function danceBasket(set, ph, T) {
  // 招牌的那套：一手在低位拍球，另一手甩开，重心一下一下颠，中间穿插抬腿
  const beat = Math.sin(ph);
  const bounce = Math.abs(Math.sin(ph));
  const bar = Math.floor(T / 4) % 4;        // 每四拍换一个花样

  set('Hips', 0.08 + bounce * 0.10, Math.sin(ph * 0.5) * 0.30, Math.sin(ph * 0.5) * 0.10);
  set('Spine', 0.10 - bounce * 0.06, Math.sin(ph * 0.5) * 0.16, 0);
  set('Spine1', 0.06, 0, Math.sin(ph) * 0.06);
  set('Neck', -0.10 + bounce * 0.10, Math.sin(ph * 0.5) * 0.20, 0);
  set('Head', bounce * 0.12, Math.sin(ph * 0.5) * 0.18, 0);

  if (bar === 0 || bar === 2) {
    // 拍球：右手在低位一上一下，左手横着张开
    set('RightArm', -0.30 + bounce * 0.55, 0, 0.15);
    set('RightForeArm', 0.75 - bounce * 0.45, 0, 0);
    set('LeftArm', -0.55, 0, -0.95);
    set('LeftForeArm', 0.35, 0, 0);
  } else if (bar === 1) {
    // 两手交替往上甩
    set('RightArm', -1.35 - Math.max(0, beat) * 0.45, 0, 0.30);
    set('LeftArm', -1.35 - Math.max(0, -beat) * 0.45, 0, -0.30);
    set('RightForeArm', 0.55, 0, 0);
    set('LeftForeArm', 0.55, 0, 0);
  } else {
    // 双手侧平举画圈
    set('RightArm', -0.85 + Math.sin(ph) * 0.35, 0, 0.55 + Math.cos(ph) * 0.30);
    set('LeftArm', -0.85 + Math.sin(ph + 1) * 0.35, 0, -0.55 - Math.cos(ph) * 0.30);
    set('RightForeArm', 0.30 + Math.max(0, beat) * 0.5, 0, 0);
    set('LeftForeArm', 0.30 + Math.max(0, -beat) * 0.5, 0, 0);
  }

  // 腿：交替抬膝，抬的那条屈得深
  const up = Math.max(0, beat), dn = Math.max(0, -beat);
  set('LeftUpLeg', -up * 0.95, 0, 0);
  set('RightUpLeg', -dn * 0.95, 0, 0);
  set('LeftLeg', -up * 1.30 - 0.08, 0, 0);
  set('RightLeg', -dn * 1.30 - 0.08, 0, 0);
  set('LeftFoot', up * 0.35, 0, 0);
  set('RightFoot', dn * 0.35, 0, 0);
}

function danceSway(set, ph) {
  const s = Math.sin(ph), c = Math.cos(ph);
  set('Hips', 0.05, 0, s * 0.28);
  set('Spine', 0.06, s * 0.20, -s * 0.16);
  set('Spine1', 0.04, 0, -s * 0.10);
  set('Neck', -0.06, s * 0.24, 0);
  set('Head', 0.04, s * 0.20, s * 0.12);
  // 双手举过头顶来回摆
  set('LeftArm', -1.75, 0, -0.25 + s * 0.45);
  set('RightArm', -1.75, 0, 0.25 + s * 0.45);
  set('LeftForeArm', 0.40 + c * 0.25, 0, 0);
  set('RightForeArm', 0.40 - c * 0.25, 0, 0);
  // 脚下小碎步
  const st = Math.max(0, s), st2 = Math.max(0, -s);
  set('LeftUpLeg', -st * 0.30, 0, 0);
  set('RightUpLeg', -st2 * 0.30, 0, 0);
  set('LeftLeg', -st * 0.45 - 0.06, 0, 0);
  set('RightLeg', -st2 * 0.45 - 0.06, 0, 0);
}

function danceShimmy(set, ph) {
  const fast = Math.sin(ph * 2);
  set('Hips', 0.06, fast * 0.10, 0);
  set('Spine', 0.05, fast * 0.22, 0);
  set('Spine1', 0.03, -fast * 0.26, 0);
  set('Spine2', 0, fast * 0.20, 0);
  set('Neck', -0.05, -fast * 0.18, 0);
  set('Head', 0.02, fast * 0.14, fast * 0.10);
  // 手肘夹住身体，靠肩膀抖
  set('LeftArm', -0.55, 0, -0.30 + fast * 0.20);
  set('RightArm', -0.55, 0, 0.30 + fast * 0.20);
  set('LeftForeArm', 1.25, 0, 0);
  set('RightForeArm', 1.25, 0, 0);
  const bob = Math.abs(Math.sin(ph));
  set('LeftUpLeg', -bob * 0.16, 0, 0);
  set('RightUpLeg', -bob * 0.16, 0, 0);
  set('LeftLeg', -bob * 0.30 - 0.10, 0, 0);
  set('RightLeg', -bob * 0.30 - 0.10, 0, 0);
}

function danceSpin(set, ph) {
  // 身子自己转由 Actor 那边加 yaw，这里只管姿势
  const s = Math.sin(ph);
  set('Hips', 0.04, 0, s * 0.12);
  set('Spine', 0.05, 0, -s * 0.10);
  set('LeftArm', -1.45, 0, -0.75);
  set('RightArm', -1.45, 0, 0.75);
  set('LeftForeArm', 0.20, 0, 0);
  set('RightForeArm', 0.20, 0, 0);
  const lift = Math.max(0, s);
  set('LeftUpLeg', -lift * 0.55, 0, 0);
  set('LeftLeg', -lift * 0.85 - 0.06, 0, 0);
  set('RightUpLeg', 0.05, 0, 0);
  set('RightLeg', -0.10, 0, 0);
}

function danceLie(set, ph) {
  // 摆烂。仰面躺着，四肢摊开，只剩呼吸和偶尔抖一下脚。
  // Hips 绕 x 转 -π/2 就把整个人放倒了，后面全是躺着的微调。
  const br = Math.sin(ph) * 0.05;
  set('Hips', -1.52, 0, 0.06);
  set('Spine', -0.10 + br, 0, 0);
  set('Spine1', -0.06 - br * 0.5, 0, 0);
  set('Spine2', -0.04, 0, 0);
  set('Neck', 0.30, 0, 0);
  set('Head', 0.22, Math.sin(ph * 0.4) * 0.18, 0);
  // 手脚摊开
  set('LeftArm', -0.95, 0, -0.75);
  set('RightArm', -0.95, 0, 0.75);
  set('LeftForeArm', 0.30, 0, 0);
  set('RightForeArm', 0.30, 0, 0);
  set('LeftUpLeg', 0.20, 0, 0.24);
  set('RightUpLeg', 0.20, 0, -0.24);
  set('LeftLeg', -0.18 + Math.max(0, Math.sin(ph * 1.7)) * 0.14, 0, 0);
  set('RightLeg', -0.14, 0, 0);
}

const DANCE_FN = { basket: danceBasket, sway: danceSway, shimmy: danceShimmy,
                   spin: danceSpin, lie: danceLie };

// 滑铲的姿势。k 是 0~1 的进入程度，Actor 那边按滑了多久算好再传进来。
// 一条腿伸出去、一条收着，上身往后仰，手往后甩——标准的铲球姿势。
function poseSlide(set, k, ph) {
  set('Hips', -0.70 * k, 0, 0.30 * k);
  set('Spine', -0.35 * k, 0, 0.16 * k);
  set('Spine1', -0.22 * k, 0, 0.10 * k);
  set('Neck', 0.45 * k, 0, 0);
  set('Head', 0.25 * k, 0, 0);
  // 前腿蹬直，后腿收在身下
  set('LeftUpLeg', -1.05 * k, 0, 0.10 * k);
  set('LeftLeg', 0.10 * k, 0, 0);
  set('LeftFoot', -0.30 * k, 0, 0);
  set('RightUpLeg', -0.30 * k, 0, -0.20 * k);
  set('RightLeg', -1.55 * k, 0, 0);
  // 手往后撑
  set('LeftArm', 0.55 * k, 0, 0.65 * k);
  set('RightArm', 0.55 * k, 0, -0.35 * k);
  set('LeftForeArm', 0.45 * k, 0, 0);
  set('RightForeArm', 0.70 * k, 0, 0);
}

export class Rig {
  constructor(bones) {
    this.b = bones || {};
    this.t = 0;             // 步态相位
    this.breath = Math.random() * 10;
    this.blend = 0;         // 走跑动作的强度，跟速度走
    this.air = 0;           // 腾空强度
    this.lean = 0;
    this.look = 0;
    this.idle = Math.random() * 6;
    this.dance = null;      // 正在跳的那套的 id
    this.danceT = 0;        // 已经跳了几拍
    this.danceMix = 0;      // 0~1，进出舞蹈的过渡，免得姿势瞬间跳变
    this.ok = !!(this.b.Hips && this.b.LeftUpLeg && this.b.RightUpLeg);
    // 把站姿并进 rest：后面写的每一个角度都是"相对自然站姿"的增量，
    // T-Pose 那对平举的手臂只在这里减一次
    for (const [name, r] of Object.entries(REST)) {
      const o = this.b[name];
      if (!o || !o.userData.rest) continue;
      o.userData.rest = { x: o.userData.rest.x + r[0],
                          y: o.userData.rest.y + r[1],
                          z: o.userData.rest.z + r[2] };
    }
    if (this.b.Hips) this.b.Hips.userData.baseY = this.b.Hips.position.y;
  }

  // 把一根骨头设成「绑定姿势 + 增量」
  _set(name, x, y, z) {
    const o = this.b[name];
    if (!o) return;
    const r = o.userData.rest || { x: 0, y: 0, z: 0 };
    o.rotation.set(r.x + x, r.y + y, r.z + z);
  }

  /**
   * @param speed  水平速度（米/秒）
   * @param run    这一档的全速，用来把 speed 归一化
   * @param opts   { grounded, vy, yawRate, talking, flying }
   */
  update(dt, speed, run, opts = {}) {
    if (!this.ok) return;
    const { grounded = true, vy = 0, yawRate = 0, talking = 0, flying = 0, slide = 0 } = opts;

    // 滑铲优先级最高：正在铲的时候不管走跑也不管跳舞
    if (slide > 0.01) {
      const set = (name, x, y, z) => this._set(name, x, y, z);
      this.b.Hips.position.y = this.b.Hips.userData.baseY * (1 - 0.30 * slide);
      poseSlide(set, slide, this.t);
      return;
    }

    // 跳舞的时候整套姿势由舞蹈接管，走跑那套完全不参与
    this.danceMix = damp(this.danceMix, this.dance ? 1 : 0, 6, dt);
    if (this.dance && this.danceMix > 0.02) {
      const bpm = DANCE_BPM[this.dance] || 110;
      this.danceT += dt * (bpm / 60);
      const ph = this.danceT * Math.PI * 2;
      // 起手先把手臂从站姿抬起来，避免第一帧从垂手瞬间弹到举手
      const mix = this.danceMix;
      const set = (name, x, y, z) => this._set(name, x * mix, y * mix, z * mix);
      this.b.Hips.position.y = this.b.Hips.userData.baseY
        * (1 + Math.abs(Math.sin(ph)) * 0.06 * mix);
      DANCE_FN[this.dance](set, ph, this.danceT);
      return;
    }

    const k = Math.min(1, speed / Math.max(run, 0.001));   // 0 站着，1 全速
    const moving = speed > 0.15;
    this.blend = damp(this.blend, moving ? Math.min(1, speed / 2.2) : 0, 9, dt);
    this.air = damp(this.air, grounded ? 0 : 1, 8, dt);
    this.lean = damp(this.lean, THREE.MathUtils.clamp(yawRate * 0.10, -0.45, 0.45), 7, dt);
    this.breath += dt * (1.4 + k * 2.2);
    this.idle += dt;

    // 步频跟着速度走：走路两步一秒，全速跑接近四步
    this.t += dt * (3.0 + k * 5.5);
    const ph = this.t;
    const A = this.blend;                    // 摆幅
    const sw = Math.sin(ph), sw2 = Math.sin(ph + Math.PI);
    const bounce = Math.abs(Math.sin(ph)) ;

    // ---- 腿：大腿前后摆（x 负 = 往前迈），小腿在后摆时屈起来 ----
    const legA = (0.50 + k * 0.34) * A;
    const kneeA = (0.50 + k * 0.60) * A;
    this._set('LeftUpLeg',  -sw * legA, 0, 0);
    this._set('RightUpLeg', -sw2 * legA, 0, 0);
    // 屈膝只能朝一个方向，用 max(0,·) 把反向那半周期切掉，否则膝盖会反折
    this._set('LeftLeg',  -(Math.max(0, -sw) * kneeA + 0.06 * A), 0, 0);
    this._set('RightLeg', -(Math.max(0, -sw2) * kneeA + 0.06 * A), 0, 0);
    this._set('LeftFoot',  Math.max(0, sw) * 0.30 * A, 0, 0);
    this._set('RightFoot', Math.max(0, sw2) * 0.30 * A, 0, 0);

    // ---- 手臂：绕 z 摆，跟腿反相。左臂 z+ 往前、右臂 z+ 往后，
    //      所以左腿在前时两条手臂都取 -sw，正好一前一后 ----
    const armA = (0.38 + k * 0.40) * A;
    this._set('LeftArm',  Math.abs(sw) * 0.10 * A, 0, -sw * armA);
    this._set('RightArm', Math.abs(sw) * 0.10 * A, 0, -sw * armA);
    this._set('LeftForeArm',  Math.max(0, -sw) * 0.40 * A, 0, 0);
    this._set('RightForeArm', Math.max(0, sw) * 0.40 * A, 0, 0);

    // ---- 躯干：呼吸 + 跑起来前倾 + 转弯侧倾 + 走路时左右轻晃 ----
    const breathe = Math.sin(this.breath) * 0.022;
    const lean = k * 0.22 * A;
    this._set('Hips', lean * 0.30, Math.sin(ph) * 0.05 * A, this.lean * 0.45);
    this._set('Spine',  lean * 0.40 + breathe, Math.sin(ph) * 0.05 * A, this.lean * 0.28);
    this._set('Spine1', lean * 0.26 - breathe * 0.6, 0, this.lean * 0.18);
    this._set('Spine2', lean * 0.12, Math.sin(ph + 0.8) * 0.04 * A, 0);

    // 髋部随步伐上下颠，一步一个来回
    const hb = this.b.Hips;
    hb.position.y = hb.userData.baseY * (1 + (bounce - 0.5) * 0.05 * A);

    // ---- 头：说话点头，平时偶尔看一眼别处 ----
    const nod = talking > 0 ? Math.sin(this.t * 6) * 0.10 : 0;
    if (this.idle > 4.5) { this.look = (Math.random() - 0.5) * 1.2; this.idle = 0; }
    const lookY = damp(this.b.Head?.rotation.y ?? 0, this.look * (1 - A), 2.2, dt);
    this._set('Neck', -lean * 0.45 + nod, lookY * 0.5, -this.lean * 0.22);
    this._set('Head', nod * 0.6 - lean * 0.20, lookY * 0.5, -this.lean * 0.18);

    // ---- 腾空：起跳收腿，下落伸腿准备着地 ----
    if (this.air > 0.01) {
      const rise = THREE.MathUtils.clamp(vy / 5.5, -1, 1);
      // 起跳收腿（大腿往前 = x 负、屈膝 = x 负），下落把腿伸出去准备着地
      const tuck = this.air * (rise > 0 ? 1 : 0.30);
      this._set('LeftUpLeg',  -0.85 * tuck, 0, 0);
      this._set('RightUpLeg', -0.85 * tuck, 0, 0);
      this._set('LeftLeg',  -1.25 * tuck, 0, 0);
      this._set('RightLeg', -1.25 * tuck, 0, 0);
      // 手臂往上甩（x 负 = 抬起来）
      const raise = this.air * (0.8 + rise * 0.5);
      this._set('LeftArm',  -0.85 * raise, 0, -0.25 * raise);
      this._set('RightArm', -0.85 * raise, 0,  0.25 * raise);
      this._set('LeftForeArm',  0.35 * raise, 0, 0);
      this._set('RightForeArm', 0.35 * raise, 0, 0);
      this._set('Spine', rise * 0.20 * this.air, 0, 0);
    }

    // ---- 扑翼：云雀用不上这副骨架，留个接口给以后 ----
    if (flying > 0.01) {
      const w = Math.sin(this.t * 3.2) * flying;
      // 抬平再上下扇：x 负把手臂抬到水平，w 做扇动
      this._set('LeftArm',  -1.20 * flying + w * 0.40, 0, 0);
      this._set('RightArm', -1.20 * flying + w * 0.40, 0, 0);
    }
  }

  // 开始／停止跳舞。传 null 就是停。
  setDance(id) {
    if (id && !DANCE_FN[id]) return this.dance;
    if (id && id !== this.dance) this.danceT = 0;
    this.dance = id;
    return this.dance;
  }

  // 落地那一下压一压，由 Actor 在 justLanded 时调
  land(force) {
    this.landT = Math.min(1, force);
  }
}
