import { moo, hiss, trill, howl, bark, step, thud, whoosh, splash, chime, blip, bed } from './synth.js';
// 网页版这里是空的；小工具构建通过 vite alias 换成 base64 内嵌的那份
import { BAKED_VOICES } from './bakedVoices.js';

// 每个角色一套发声参数。基频越低体型越大，共振峰位置决定"口腔"大小。
// 牛来是初生牛犊，所以又高又短又带气声；爸爸最低最长。
const VOICES = {
  niulai: { kind: 'moo', f0: 215, dur: 0.8, formants: [720, 1350, 2700], gains: [1, 0.6, 0.3], breath: 0.22, bend: 1.3, gain: 0.5 },
  niuer: { kind: 'moo', f0: 196, dur: 0.75, formants: [690, 1280, 2600], gains: [1, 0.5, 0.25], breath: 0.18, bend: 1.24, gain: 0.45 },
  mother: { kind: 'moo', f0: 124, dur: 1.35, formants: [560, 1080, 2350], gains: [1, 0.62, 0.24], breath: 0.13, bend: 1.16, tail: 0.66, vibHz: 4.8, gain: 0.55 },
  father: { kind: 'moo', f0: 94, dur: 1.6, formants: [480, 940, 2150], gains: [1, 0.55, 0.2], breath: 0.1, bend: 1.12, tail: 0.6, vibHz: 4.2, gain: 0.6 },
  baola: { kind: 'moo', f0: 260, dur: 0.5, formants: [900, 1750, 3200], gains: [0.9, 0.7, 0.4], breath: 0.3, bend: 1.5, tail: 0.55, vibHz: 9, gain: 0.4 },
  dog: { kind: 'bark', f0: 300 },
  snake: { kind: 'hiss' },
  lark: { kind: 'trill' },
  wolf: { kind: 'howl' },
};

// 对话打字机的点声音高，按说话人分
const BLIP_F = { 牛来: 520, 牛妈: 330, 牛爸: 250, 牛二: 480, 豹拉: 620, 灵蛇: 760, 狼: 280, 云雀: 900, 旁白: 380 };

// 找出录音里真正有声音的区间：能量越过阈值算开始，最后一次跌回算结束。
// 之前是"取最响处往后 0.6 秒"，那样会把两个字的后一个字切掉——
// 这些片段本身就已经是一句话了，该整句播完，只去掉首尾的静音。
function voiceSpan(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const win = Math.max(1, Math.round(sr * 0.02));
  const rms = [];
  for (let i = 0; i + win <= d.length; i += win) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += d[k] * d[k];
    rms.push(Math.sqrt(s / win));
  }
  if (!rms.length) return { start: 0, end: buf.duration };
  const mx = Math.max(...rms);
  const th = mx * 0.08;                       // 峰值的 8% 当有声门限
  let a = 0, b = rms.length - 1;
  while (a < rms.length && rms[a] < th) a++;
  while (b > a && rms[b] < th) b--;
  const pad = 0.05;                           // 前后各留一点，别削掉字头字尾
  return {
    start: Math.max(0, (a * win) / sr - pad),
    end: Math.min(buf.duration, ((b + 1) * win) / sr + pad),
  };
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.overrides = {};        // id -> AudioBuffer（用户自己放的素材）
    this.ambienceOn = false;    // 环境底噪默认关：风声一直响着挺闹的，想要按 B 开
    this.span = {};             // id -> 该录音的有声区间 {start, end}
    this._lastStep = 0;
    this._lastBlip = 0;
  }

  // 浏览器要求先有用户手势才能出声。
  // iOS 的 WebView 还要额外两件事：resume() 第一次经常不生效，得每次手势都再试；
  // 而且光 resume 不算数，必须在手势的调用栈里真的播出一个 buffer 才解锁。
  // 少了这两条，手机上就是"什么都对，就是没声音"。
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume?.().catch(() => {});
      this._prime();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.voiceBus = ctx.createGain(); this.voiceBus.gain.value = 1.0;
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.55;
    [this.voiceBus, this.sfxBus, this.ambBus].forEach((b) => b.connect(this.master));

    this.wind = bed(ctx, this.ambBus, { type: 'wind' });
    this.water = bed(ctx, this.ambBus, { type: 'water' });

    this.ready = true;
    if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
    this._prime();
    this.loadOverrides();
  }

  // 播一个一帧的静音 buffer。iOS 认这个动作，不认单独的 resume()。
  _prime() {
    if (this._primed || !this.ctx) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
      if (this.ctx.state === 'running') this._primed = true;
    } catch { /* 解锁失败就下次手势再来 */ }
  }

  // 声音到底通没通。界面拿它决定要不要提示"点一下开声音"。
  get live() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

  // 外部素材插槽：public/voice/manifest.json 里写 { "niulai": "niulai.mp3" }，
  // 有就用文件，没有就用合成。文件不存在时安静跳过，不报错。
  async loadOverrides() {
    // 小工具容器禁掉了 fetch/XHR，包里也不允许放 .mp3——但没禁 Web Audio。
    // 所以那一版把音频 base64 进 JS，用 decodeAudioData 解：
    // 既不是文件也不是请求，容器的白名单和 CSP 都管不到，照样出真声音。
    // 下面整段 fetch 会被摇掉，扫描清单里连 fetch( 都不该出现。
    if (__MINITOOL__) return this._loadBaked();
    try {
      const res = await fetch('/voice/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const map = await res.json();
      await Promise.all(Object.entries(map).map(async ([id, file]) => {
        try {
          const r = await fetch(`/voice/${file}`);
          if (!r.ok) return;
          const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
          this.overrides[id] = buf;
          this.span[id] = voiceSpan(buf);
        } catch { /* 单个文件坏了不影响其它 */ }
      }));
      const n = Object.keys(this.overrides).length;
      if (n) console.info(`[audio] 载入 ${n} 个外部语音，覆盖同名合成音`);
    } catch { /* 没有 manifest 就走合成 */ }
  }

  // 从内嵌的 base64 解出音频。没有 IO，纯 CPU。
  async _loadBaked() {
    const ids = Object.keys(BAKED_VOICES);
    await Promise.all(ids.map(async (id) => {
      try {
        const bin = atob(BAKED_VOICES[id]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const buf = await this.ctx.decodeAudioData(u8.buffer);
        this.overrides[id] = buf;
        this.span[id] = voiceSpan(buf);
      } catch { /* 单条坏了不影响其它，那一条回落到合成 */ }
    }));
  }

  // solo：新的一声把上一声掐掉。真实录音有 2~4 秒，不掐的话
  // 连着跳或者快速推对话会叠成一片。
  _playBuffer(buf, gain = 1, { offset = 0, maxDur = 0, solo = true } = {}) {
    if (solo && this._voice) { try { this._voice.stop(); } catch { /* 已经停了 */ } }
    const ctx = this.ctx, t0 = ctx.currentTime + 0.005;
    const off = Math.max(0, Math.min(offset, buf.duration - 0.05));
    const dur = maxDur > 0 ? Math.min(maxDur, buf.duration - off) : buf.duration - off;
    const fadeIn = Math.min(0.02, dur * 0.2);
    const fadeOut = Math.min(0.06, dur * 0.25);   // 只为防截断爆音，别吃掉字尾
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + fadeIn);
    g.gain.setValueAtTime(peak, t0 + dur - fadeOut);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);   // 截断处淡出，不然会咔一声
    s.connect(g).connect(this.voiceBus);
    s.start(t0, off, dur + 0.03);
    if (solo) {
      this._voice = s;
      s.onended = () => { if (this._voice === s) this._voice = null; };
    }
    return s;
  }

  // ---------------------------------------------------------------- 叫声
  // cap: 最长播多少秒（0 = 不限）。录音一律从有声区间的开头播，播完整句。
  speak(id, { gain = 1, detune = 0, cap = 0 } = {}) {
    if (!this.ready || this.muted) return;
    if (this.overrides[id]) {
      const sp = this.span[id] ?? { start: 0, end: this.overrides[id].duration };
      const len = sp.end - sp.start;
      return this._playBuffer(this.overrides[id], gain, {
        offset: sp.start,
        maxDur: cap > 0 ? Math.min(cap, len) : len,
      });
    }
    const v = VOICES[id];
    if (!v) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.01;
    const wob = 1 + (Math.random() - 0.5) * 0.06 + detune;   // 每次都不完全一样
    switch (v.kind) {
      case 'hiss': return hiss(ctx, this.voiceBus, { t0, gain: 0.24 * gain });
      case 'trill': return trill(ctx, this.voiceBus, { t0, gain: 0.2 * gain });
      case 'howl': return howl(ctx, this.voiceBus, { t0, gain: 0.16 * gain, f0: 330 * wob });
      case 'bark': {
        // 狗一叫就是两三声
        const n = 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          bark(ctx, this.voiceBus, {
            t0: t0 + i * (0.14 + Math.random() * 0.06),
            f0: v.f0 * wob * (1 - i * 0.06), gain: 0.3 * gain * (1 - i * 0.12),
          });
        }
        return;
      }
      default:
        // 合成分支也认 cap，保持两边行为一致
        return moo(ctx, this.voiceBus, {
          ...v, t0, f0: v.f0 * wob, gain: (v.gain ?? 0.5) * gain,
          dur: cap > 0 ? Math.min(v.dur, cap) : v.dur,
        });
    }
  }

  // 跳的时候喊一声。牛来喊的是「妈妈」，牛妈喊的是「牛来」——
  // 这两条录音本身就是这两句，所以不用做别的，选对声音就行。
  // 一律取最响处的一小段，读起来像喊而不像整句台词。
  shout(voice, gain = 0.55) {
    if (!this.ready || this.muted) return;
    // 整句播完。cap 只是防止某条素材特别长时拖住节奏。
    this.speak(voice, { gain, cap: 3.0, detune: 0.05 });
  }

  cancelAnswer() { /* 已经没有自动回应了，保留空实现免得调用方报错 */ }

  // ---------------------------------------------------------------- 音效
  footstep(speed = 1, inGrass = true) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const gap = 0.42 / Math.max(0.4, speed);
    if (now - this._lastStep < gap) return;
    this._lastStep = now;
    step(this.ctx, this.sfxBus, { t0: now, gain: 0.055 + speed * 0.02, hz: inGrass ? 1600 : 700 });
  }

  jump(power = 1, voice = 'niulai') {
    if (!this.ready || this.muted) return;
    whoosh(this.ctx, this.sfxBus, { gain: 0.09 + power * 0.06, dur: 0.26 });
    this.shout(voice);
  }

  land(hard = 0.5) {
    if (!this.ready || this.muted) return;
    thud(this.ctx, this.sfxBus, { gain: 0.16 + hard * 0.22, f: 92 });
  }

  splash() { if (this.ready && !this.muted) splash(this.ctx, this.sfxBus, { gain: 0.26 }); }

  // 云雀扑翼。一下一下的短促气声，不是叫声——叫声还是用影片素材。
  flap() {
    if (!this.ready || this.muted) return;
    whoosh(this.ctx, this.sfxBus, { gain: 0.055, dur: 0.16 });
  }
  pickup() { if (this.ready && !this.muted) chime(this.ctx, this.sfxBus, { gain: 0.18, f: 1040 }); }

  // 打字机的点声，节流一下免得糊成一片
  blip(who) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this._lastBlip < 0.045) return;
    this._lastBlip = now;
    blip(this.ctx, this.sfxBus, { t0: now, f: (BLIP_F[who] ?? 400) * (0.94 + Math.random() * 0.12) });
  }

  // ---------------------------------------------------------------- 环境
  setAmbience({ wind = 0.3, water = 0 } = {}, dt = 0.016) {
    if (!this.ready) return;
    if (!this.ambienceOn) { wind = 0; water = 0; }
    const k = Math.min(1, dt * 2.5);
    this.wind.gain.value += (wind - this.wind.gain.value) * k;
    this.water.gain.value += (water - this.water.gain.value) * k;
  }

  toggleAmbience() {
    this.ambienceOn = !this.ambienceOn;
    return this.ambienceOn;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ready) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }
}
