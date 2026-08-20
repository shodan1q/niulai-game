import * as THREE from 'three';

// 昼夜。t 在 [0,1) 里绕一圈就是一天。
//
// 每个场景仍然保留自己写死的"签名氛围"（梦境是青绿的、荒漠夜是冷蓝的），
// 时间只是在那之上做调制：把场景色往当前时段的色调拉一部分，
// 太阳高度、星星、曝光则完全由时间决定。
// 这样故事该是黄昏的地方开场还是黄昏，但你站着不动天也会慢慢变。

export const PHASES = [
  {
    id: 'dawn', name: '黎明', t: 0.04,
    skyTop: 0x2f3f6e, sky: 0xe8a487, fog: 0xc9a9a0,
    sun: 0xffb98a, sunIntensity: 1.15, elev: 8,
    hemiSky: 0xc9b6d8, hemiGround: 0x4a4438, hemiIntensity: 0.85,
    ambient: 0.34, exposure: 1.04, stars: 0.35,
  },
  {
    id: 'day', name: '白天', t: 0.30,
    skyTop: 0x5b8fd0, sky: 0xc8dcec, fog: 0xbcd3e4,
    sun: 0xfff4e0, sunIntensity: 2.05, elev: 58,
    hemiSky: 0xdcecff, hemiGround: 0x5c6038, hemiIntensity: 1.0,
    ambient: 0.32, exposure: 1.06, stars: 0,
  },
  {
    id: 'dusk', name: '黄昏', t: 0.62,
    skyTop: 0x6f7fae, sky: 0xf0c48c, fog: 0xefc493,
    sun: 0xffc287, sunIntensity: 1.75, elev: 11,
    hemiSky: 0xffd9b0, hemiGround: 0x5a5230, hemiIntensity: 0.85,
    ambient: 0.30, exposure: 1.10, stars: 0.2,
  },
  {
    id: 'night', name: '夜', t: 0.84,
    skyTop: 0x090f1e, sky: 0x1b2740, fog: 0x1d2a3c,
    sun: 0x9fc4e8, sunIntensity: 0.5, elev: 34,      // 夜里这盏是月亮
    hemiSky: 0x4a5f80, hemiGround: 0x14181f, hemiIntensity: 0.55,
    ambient: 0.20, exposure: 1.16, stars: 1,
  },
];

const _a = new THREE.Color(), _b = new THREE.Color(), _o = new THREE.Color();
const wrap = (v) => ((v % 1) + 1) % 1;

// 找到 t 落在哪两个相位之间。相位表是环形的，最后一个接回第一个。
function bracket(t) {
  t = wrap(t);
  for (let i = 0; i < PHASES.length; i++) {
    const a = PHASES[i], b = PHASES[(i + 1) % PHASES.length];
    let span = b.t - a.t;
    if (span <= 0) span += 1;              // 跨过 0 点的那一段
    let d = t - a.t;
    if (d < 0) d += 1;
    if (d <= span) return [a, b, d / span];
  }
  return [PHASES[0], PHASES[1], 0];
}

const mixHex = (ha, hb, k) => {
  _a.setHex(ha); _b.setHex(hb);
  return _o.copy(_a).lerp(_b, k).getHex();
};

// 采样出某一时刻的氛围
export function sampleTime(t) {
  const [a, b, kRaw] = bracket(t);
  const k = kRaw * kRaw * (3 - 2 * kRaw);         // 平滑一下，别在相位交界处生硬
  const L = (x, y) => THREE.MathUtils.lerp(x, y, k);
  return {
    // 名字沿用"上一个相位"到大半程为止——凌晨三点该叫夜，不该叫黎明
    phase: k < 0.7 ? a : b,
    from: a, to: b, k,
    skyTop: mixHex(a.skyTop, b.skyTop, k),
    sky: mixHex(a.sky, b.sky, k),
    fog: mixHex(a.fog, b.fog, k),
    sun: mixHex(a.sun, b.sun, k),
    sunIntensity: L(a.sunIntensity, b.sunIntensity),
    elev: L(a.elev, b.elev),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, k),
    hemiGround: mixHex(a.hemiGround, b.hemiGround, k),
    hemiIntensity: L(a.hemiIntensity, b.hemiIntensity),
    ambient: L(a.ambient, b.ambient),
    exposure: L(a.exposure, b.exposure),
    stars: L(a.stars, b.stars),
  };
}

// 把场景签名色和时段色混起来
export function blendMood(sceneMood, time, amount = 0.6) {
  const m = { ...sceneMood };
  m.skyTop = mixHex(sceneMood.skyTop ?? sceneMood.sky, time.skyTop, amount);
  m.sky = mixHex(sceneMood.sky, time.sky, amount);
  m.fog = mixHex(sceneMood.fog, time.fog, amount);
  m.sun = mixHex(sceneMood.sun, time.sun, amount);
  m.hemiSky = mixHex(sceneMood.hemiSky, time.hemiSky, amount);
  m.hemiGround = mixHex(sceneMood.hemiGround, time.hemiGround, amount);
  // 亮度类的完全跟时间走，不然夜里也能亮得跟白天一样
  m.sunIntensity = THREE.MathUtils.lerp(sceneMood.sunIntensity ?? 1.6, time.sunIntensity, 0.85);
  m.hemiIntensity = THREE.MathUtils.lerp(sceneMood.hemiIntensity ?? 0.9, time.hemiIntensity, 0.85);
  m.ambient = THREE.MathUtils.lerp(sceneMood.ambient ?? 0.3, time.ambient, 0.85);
  m.exposure = THREE.MathUtils.lerp(sceneMood.exposure ?? 1.05, time.exposure, 0.7);

  // 太阳/月亮的方位角沿用场景写的，高度角交给时间
  const az = sceneMood.sunAzimuth ?? Math.atan2(
    (sceneMood.sunPos ?? [18, 26, 12])[0], (sceneMood.sunPos ?? [18, 26, 12])[2]);
  const el = THREE.MathUtils.degToRad(time.elev);
  const c = Math.cos(el);
  m.sunPos = [Math.sin(az) * c, Math.max(0.12, Math.sin(el)), Math.cos(az) * c];
  m.stars = time.stars;
  return m;
}

export class DayClock {
  constructor(t = 0.62, secondsPerDay = 300) {
    this.t = wrap(t);
    this.secondsPerDay = secondsPerDay;
    this.running = true;
    this.scale = 1;
  }

  set(t) { this.t = wrap(t); return this; }

  // 跳到下一个相位；返回跳到的那个
  nextPhase() {
    const cur = wrap(this.t);
    let best = PHASES[0], bestD = 2;
    for (const p of PHASES) {
      let d = p.t - cur;
      if (d <= 0.004) d += 1;
      if (d < bestD) { bestD = d; best = p; }
    }
    this.t = best.t;
    return best;
  }

  update(dt) {
    if (this.running) this.t = wrap(this.t + (dt * this.scale) / this.secondsPerDay);
    return this.t;
  }

  // 给 HUD 用的假时钟。偏移取 +0.2，让"白天"那个相位（t=0.30）正好落在正午：
  // 黎明 05:45 / 白天 12:00 / 黄昏 19:40 / 夜 00:57
  clockText() {
    const h = wrap(this.t + 0.2) * 24;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
