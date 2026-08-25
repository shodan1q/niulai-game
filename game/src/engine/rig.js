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
    const { grounded = true, vy = 0, yawRate = 0, talking = 0, flying = 0 } = opts;

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

  // 落地那一下压一压，由 Actor 在 justLanded 时调
  land(force) {
    this.landT = Math.min(1, force);
  }
}
