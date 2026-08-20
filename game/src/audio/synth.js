// Web Audio 合成。游戏里其余一切都是程序化生成的，声音也一样——
// 不用采样，全部现场算出来，所以是原创音频，也不用额外下载体积。

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    const n = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    // 粉红噪声（Kellett 近似）。之前写成一阶低通，截止只有 140Hz 左右，
    // 高频全被砍掉——蛇的嘶声取在 3.6~5.2kHz，于是几乎没有声音。
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.34;
      b6 = w * 0.115926;
    }
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  return s;
}

const env = (p, t0, a, d, s, r, dur, peak = 1) => {
  p.setValueAtTime(0.0001, t0);
  p.exponentialRampToValueAtTime(peak, t0 + a);
  p.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t0 + a + d);
  p.setValueAtTime(Math.max(0.0001, peak * s), t0 + dur - r);
  p.exponentialRampToValueAtTime(0.0001, t0 + dur);
};

// ---------------------------------------------------------------- 叫声
// 牛叫的骨架：锯齿波做声带，三个带通做共振峰（口腔），
// 基频先扬后抑，尾巴上加颤音，再混一点气声。
export function moo(ctx, dest, {
  t0 = ctx.currentTime, f0 = 160, dur = 1.0,
  formants = [620, 1180, 2500], q = [7, 9, 10], gains = [1, 0.55, 0.22],
  bend = 1.22, tail = 0.72, vibHz = 5.6, vibDepth = 0.035,
  breath = 0.16, gain = 0.5, tone = 2600,
} = {}) {
  const out = ctx.createGain();
  out.connect(dest);
  env(out.gain, t0, 0.07 * dur, 0.18 * dur, 0.72, 0.42 * dur, dur, gain);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const f = osc.frequency;
  f.setValueAtTime(f0 * 0.82, t0);
  f.exponentialRampToValueAtTime(f0 * bend, t0 + dur * 0.22);
  f.exponentialRampToValueAtTime(f0 * tail, t0 + dur);

  // 颤音
  const lfo = ctx.createOscillator();
  lfo.frequency.value = vibHz;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0.0001, t0);
  lg.gain.linearRampToValueAtTime(f0 * vibDepth, t0 + dur * 0.55);
  lfo.connect(lg).connect(f);

  // 共振峰
  const pre = ctx.createGain();
  pre.gain.value = 0.9;
  osc.connect(pre);
  formants.forEach((hz, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hz;
    bp.Q.value = q[i] ?? 8;
    const g = ctx.createGain();
    g.gain.value = gains[i] ?? 0.4;
    pre.connect(bp).connect(g).connect(out);
  });

  // 一点直通，免得只剩共振峰听着发空
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = tone;
  const dry = ctx.createGain();
  dry.gain.value = 0.22;
  pre.connect(lp).connect(dry).connect(out);

  // 气声
  if (breath > 0) {
    const n = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1400;
    hp.Q.value = 0.8;
    const ng = ctx.createGain();
    env(ng.gain, t0, 0.1 * dur, 0.3 * dur, 0.5, 0.4 * dur, dur, breath);
    n.connect(hp).connect(ng).connect(out);
    n.start(t0); n.stop(t0 + dur + 0.05);
  }

  osc.start(t0); osc.stop(t0 + dur + 0.05);
  lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  return out;
}

// 蛇：一段带通噪声，频率来回游走
export function hiss(ctx, dest, { t0 = ctx.currentTime, dur = 1.1, gain = 0.22 } = {}) {
  const out = ctx.createGain();
  out.connect(dest);
  env(out.gain, t0, 0.12, 0.2, 0.75, 0.4, dur, gain);
  const n = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(3600, t0);
  bp.frequency.linearRampToValueAtTime(5200, t0 + dur * 0.45);
  bp.frequency.linearRampToValueAtTime(3000, t0 + dur);
  n.connect(bp).connect(out);
  n.start(t0); n.stop(t0 + dur + 0.05);
  return out;
}

// 云雀：几个快速上扬的短音，像打了个滚
export function trill(ctx, dest, { t0 = ctx.currentTime, gain = 0.2, notes = 6, base = 2100 } = {}) {
  for (let i = 0; i < notes; i++) {
    const t = t0 + i * 0.055;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = base * (1 + 0.14 * Math.sin(i * 1.9)) * (1 + i * 0.045);
    o.frequency.setValueAtTime(f * 0.82, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.035);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * (0.6 + 0.4 * Math.random()), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + 0.06);
  }
}

// 狗叫：又短又炸，基频往下掉，噪声成分比牛叫重得多
export function bark(ctx, dest, { t0 = ctx.currentTime, f0 = 300, gain = 0.3, dur = 0.17 } = {}) {
  const out = ctx.createGain();
  out.connect(dest);
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  out.gain.exponentialRampToValueAtTime(gain * 0.35, t0 + dur * 0.45);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0 * 1.45, t0);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t0 + dur);

  [420, 1500, 2600].forEach((hz, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hz;
    bp.Q.value = [4, 6, 7][i];
    const g = ctx.createGain();
    g.gain.value = [1, 0.7, 0.35][i];
    o.connect(bp).connect(g).connect(out);
  });

  const n = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2400, t0);
  bp.frequency.exponentialRampToValueAtTime(900, t0 + dur);
  bp.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.5, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
  n.connect(bp).connect(ng).connect(out);

  o.start(t0); o.stop(t0 + dur + 0.05);
  n.start(t0); n.stop(t0 + dur + 0.05);
  return out;
}

// 狼：长滑音，尾巴上抖
export function howl(ctx, dest, { t0 = ctx.currentTime, dur = 1.9, f0 = 330, gain = 0.16 } = {}) {
  const out = ctx.createGain();
  out.connect(dest);
  env(out.gain, t0, 0.22, 0.25, 0.85, 0.7, dur, gain);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f = o.frequency;
  f.setValueAtTime(f0 * 0.55, t0);
  f.exponentialRampToValueAtTime(f0, t0 + dur * 0.28);
  f.setValueAtTime(f0, t0 + dur * 0.62);
  f.exponentialRampToValueAtTime(f0 * 0.72, t0 + dur);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6.5;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0.0001, t0);
  lg.gain.linearRampToValueAtTime(f0 * 0.05, t0 + dur * 0.7);
  lfo.connect(lg).connect(f);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 3.5;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  o.connect(bp).connect(out);
  o.connect(lp).connect(out);
  o.start(t0); o.stop(t0 + dur + 0.05);
  lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  return out;
}

// ---------------------------------------------------------------- 音效
export function step(ctx, dest, { t0 = ctx.currentTime, gain = 0.1, hz = 900 } = {}) {
  const n = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hz * (0.75 + Math.random() * 0.5);
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  n.connect(bp).connect(g).connect(dest);
  n.start(t0); n.stop(t0 + 0.12);
}

export function thud(ctx, dest, { t0 = ctx.currentTime, gain = 0.35, f = 95 } = {}) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f * 2.1, t0);
  o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  o.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + 0.25);
  step(ctx, dest, { t0, gain: gain * 0.5, hz: 550 });
}

export function whoosh(ctx, dest, { t0 = ctx.currentTime, gain = 0.13, dur = 0.3 } = {}) {
  const n = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(400, t0);
  bp.frequency.exponentialRampToValueAtTime(1900, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  n.connect(bp).connect(g).connect(dest);
  n.start(t0); n.stop(t0 + dur + 0.05);
}

export function splash(ctx, dest, { t0 = ctx.currentTime, gain = 0.4 } = {}) {
  const n = noise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(5200, t0);
  lp.frequency.exponentialRampToValueAtTime(420, t0 + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  n.connect(lp).connect(g).connect(dest);
  n.start(t0); n.stop(t0 + 0.6);
  // 几滴水珠
  for (let i = 0; i < 5; i++) {
    const t = t0 + 0.06 + Math.random() * 0.35;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(700 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(1800 + Math.random() * 1200, t + 0.05);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(gain * 0.22, t);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(dg).connect(dest);
    o.start(t); o.stop(t + 0.09);
  }
}

export function chime(ctx, dest, { t0 = ctx.currentTime, gain = 0.2, f = 880 } = {}) {
  [1, 1.5, 2.25].forEach((m, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * m;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain / (i + 1.4), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1 + i * 0.3);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + 1.5);
  });
}

// 对话打字机的小点声，按说话人换音高
export function blip(ctx, dest, { t0 = ctx.currentTime, gain = 0.045, f = 420 } = {}) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f, t0);
  o.frequency.exponentialRampToValueAtTime(f * 0.82, t0 + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  o.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + 0.08);
}

// ---------------------------------------------------------------- 环境床
// 一直循环、只调增益的噪声层：风、水。
export function bed(ctx, dest, { type = 'wind' } = {}) {
  const n = noise(ctx);
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  g.gain.value = 0;
  if (type === 'wind') {
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 300;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
  } else {
    f.type = 'bandpass'; f.frequency.value = 1250; f.Q.value = 0.9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.31;
    const lg = ctx.createGain(); lg.gain.value = 380;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
  }
  n.connect(f).connect(g).connect(dest);
  n.start();
  return g;
}
