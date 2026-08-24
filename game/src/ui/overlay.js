import p5 from 'p5';
import { makePaper, wetBlob, farMountains, groundWash, inkBull, inkLark, seal, mulberry } from './ink.js';
import { SERIF, SANS } from './fonts.js';
import { SCENES, SCENE_TITLES } from '../data/script.js';

// p5 层。铺在 three.js 上面，负责一切二维的东西：
// 水墨标题、转场、对话框、章节卡、片尾、以及触屏摇杆的绘制。
export class Overlay {
  constructor(container, game) {
    this.game = game;
    this.state = 'boot';        // boot | title | play
    this.loadProgress = 0;

    // 转场
    this.trans = null;          // {t, dur, phase, cb, seeds}
    // 章节卡
    this.card = null;           // {t, dur, cn, sub}
    // 对话
    this.dlg = null;            // {who, text, shown, choices, sel, color, done}
    this.hint = null;           // 交互提示文字
    this.toast = null;          // {text, t}
    this.feathers = 0;
    this.featherTotal = 5;

    this.p = new p5((p) => this._sketch(p), container);
  }

  // ================================================================ p5
  _sketch(p) {
    p.setup = () => {
      const c = p.createCanvas(p.windowWidth, p.windowHeight);
      c.elt.style.position = 'absolute';
      c.elt.style.inset = '0';
      c.elt.style.zIndex = '10';
      p.pixelDensity(Math.min(devicePixelRatio, 2));
      this.paper = makePaper(p, 700, 700, 3);
      this._bindPointer(p, c.elt);
    };

    p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

    p.draw = () => {
      p.clear();
      const dt = Math.min(0.05, p.deltaTime / 1000);
      // 操作说明只在自由探索时显示：别压住海报的题字，也别压住对话框
      const wantHelp = this.state === 'play' && !this.dlg;
      if (this._helpShown !== wantHelp) {
        this._helpShown = wantHelp;
        const el = document.getElementById('help');
        if (el) el.style.opacity = wantHelp ? '1' : '0';
      }
      switch (this.state) {
        case 'boot': this._drawBoot(p); break;
        case 'title': this._drawTitle(p, dt); break;
        case 'play': this._drawPlay(p, dt); break;
      }
      this._drawTransition(p);
    };
  }

  _bindPointer(p, el) {
    // 指针给的是 CSS 坐标，界面画在画布坐标系里。两者只要不是 1:1
    //（画布被拉伸、缩放、或者 density 把 CSS 尺寸改了），按钮就会点不中。
    // 所以一律按画布的实际显示尺寸换算一次。
    let box = null;
    const rebox = () => { box = el.getBoundingClientRect(); };
    addEventListener('resize', rebox);
    addEventListener('orientationchange', rebox);
    const pos = (e) => {
      const t = e.touches?.[0] ?? e.changedTouches?.[0] ?? e;
      if (!box || !box.width || !box.height) rebox();
      const sx = box.width ? p.width / box.width : 1;
      const sy = box.height ? p.height / box.height : 1;
      return [(t.clientX - box.left) * sx, (t.clientY - box.top) * sy];
    };
    el.addEventListener('pointerdown', (e) => {
      // 捕获失败不能连累后面——setPointerCapture 对"不活跃"的 pointerId 会抛
      // NotFoundError，抛出去整个 pointerdown 就没了，手指按下等于没按。
      rebox();      // 按下这一刻的画布位置最准
      try { el.setPointerCapture?.(e.pointerId); } catch { /* 捕获不到就算了 */ }
      this.game.onPointerDown(...pos(e), e.pointerType === 'touch', e.pointerId);
    });
    el.addEventListener('pointermove', (e) => this.game.onPointerMove(...pos(e)));
    el.addEventListener('pointerup', (e) => this.game.onPointerUp(...pos(e), e.pointerId));
    el.addEventListener('pointercancel', (e) => this.game.onPointerUp(...pos(e), e.pointerId));
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.game.onWheel(e.deltaY); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 计时器走游戏主循环，不走 p5 的 draw。
  // 否则标签页被节流时打字机永远打不完，对话就卡死在那儿了。
  tick(dt) {
    const d = this.dlg;
    if (d) {
      d.t = (d.t ?? 0) + dt;
      if (d.shown < d.text.length) {
        const before = Math.floor(d.shown);
        d.shown = Math.min(d.text.length, d.shown + dt * d.speed);
        // 每蹦出一个字响一下，音高按说话人分
        if (Math.floor(d.shown) > before) this.game.audio?.blip(d.who || '旁白');
      }
      if (d.shown >= d.text.length) d.done = true;
    }
    if (this.card) {
      this.card.t += dt;
      if (this.card.t >= this.card.dur) this.card = null;
    }
    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t > 4) this.toast = null;
    }
    // 转场也走主循环。挂在 draw 上的话，标签页一被节流就永久 busy 死锁。
    const tr = this.trans;
    if (tr) {
      tr.t += dt;
      const k = tr.t / tr.dur;
      if (k >= 0.5 && !tr.fired) { tr.fired = true; tr.cb?.(); }
      if (k >= 1) this.trans = null;
    }
  }

  // ================================================================ 通用
  // 界面尺度。所有字号都按这个基准缩。
  // 桌面横屏时 min(W,H) 是高度（800 上下），字号正好；
  // 手机竖屏时 min(W,H) 变成宽度（375 上下），照缩的话所有字都小一半——
  // 所以窄屏乘一个补偿系数。
  _S(p) {
    const S = Math.min(p.width, p.height);
    return p.width < 620 ? S * 1.6 : S;
  }

  _narrow(p) { return p.width < 620; }

  _paperFill(p, x, y, w, h, alpha = 255) {
    p.push();
    p.tint(255, alpha);
    for (let ix = 0; ix < w; ix += 700) {
      for (let iy = 0; iy < h; iy += 700) {
        p.image(this.paper, x + ix, y + iy, Math.min(700, w - ix), Math.min(700, h - iy),
          0, 0, Math.min(700, w - ix), Math.min(700, h - iy));
      }
    }
    p.pop();
  }

  // CJK 按字断行
  _wrap(p, text, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      if (p.textWidth(cur + ch) > maxW && cur) { lines.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ================================================================ 加载
  _drawBoot(p) {
    p.background(24, 23, 21);
    p.fill(226, 220, 205);
    p.textFont(SERIF);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(Math.min(72, p.width * 0.12));
    p.text('牛　来', p.width / 2, p.height / 2 - 30);
    p.textFont(SANS);
    p.textSize(13);
    p.fill(226, 220, 205, 150);
    p.text('正在把一头牛搬进浏览器', p.width / 2, p.height / 2 + 30);

    const w = Math.min(280, p.width * 0.6), x = (p.width - w) / 2, y = p.height / 2 + 58;
    p.noFill(); p.stroke(226, 220, 205, 70); p.strokeWeight(1);
    p.rect(x, y, w, 3);
    p.noStroke(); p.fill(200, 168, 90);
    p.rect(x, y, w * this.loadProgress, 3);
  }

  // ================================================================ 标题（水墨海报）
  _drawTitle(p, dt) {
    this._titleT = (this._titleT ?? 0) + dt;
    const t = this._titleT;
    const W = p.width, H = p.height;

    this._paperFill(p, 0, 0, W, H);

    // 淡淡的水渍
    if (!this._titleWash || this._washW !== W || this._washH !== H) {
      this._washW = W; this._washH = H;
      this._titleWash = p.createGraphics(W, H);
      const g = this._titleWash;
      const r = mulberry(17);
      g.noStroke();
      for (let i = 0; i < 14; i++) {
        g.fill(122, 128, 134, 3 + r() * 4);
        g.ellipse(r() * W, r() * H, 300 + r() * 700, 220 + r() * 480);
      }
    }
    p.image(this._titleWash, 0, 0);

    const S = this._S(p);
    const horizon = H * 0.76;
    farMountains(p, -W * 0.05, horizon, W * 1.1, H * 0.26, { seed: 5, layers: 3, alpha: 54 });

    // 墨牛，慢慢往前走一点点
    const bx = W * 0.36 + Math.sin(t * 0.25) * 6;
    const bs = S * 0.155;
    groundWash(p, bx, horizon - bs * 0.02, bs * 2.6, { seed: 3, alpha: 30 });
    inkBull(p, bx, horizon - bs * 0.78, bs, { seed: 12, alpha: 212 });
    // 云雀绕着飞
    inkLark(p, W * 0.52 + Math.cos(t * 0.5) * 26, H * 0.3 + Math.sin(t * 0.7) * 14, S * 0.06,
      { seed: 21, flap: 0.5 + 0.5 * Math.sin(t * 3.4) });

    // 题字：大标题竖排在右，副题在其左侧，印章压在底下
    const colX = W > H ? W * 0.8 : W * 0.74;
    const ts = Math.min(S * 0.17, W * 0.15);
    const topY = H * 0.2;

    p.push();
    p.textFont(SERIF);
    p.textAlign(p.CENTER, p.CENTER);
    p.fill(22, 20, 18, 238);
    p.textSize(ts);
    p.text('牛', colX, topY);
    p.text('来', colX, topY + ts * 1.06);
    p.pop();

    p.push();
    p.textFont(SERIF);
    p.textAlign(p.CENTER, p.CENTER);
    p.fill(48, 46, 42, 185);
    const ss = Math.max(13, S * 0.028);
    p.textSize(ss);
    const sub = '梦醒之前';
    for (let i = 0; i < sub.length; i++) {
      p.text(sub[i], colX - ts * 0.78, topY + ts * 0.35 + i * ss * 1.35);
    }
    p.pop();

    seal(p, colX - S * 0.036, topY + ts * 1.72, S * 0.072, '牛来');

    // 章节选择：五个可点的章名，横排在底部。
    // 点这一排选章，点画面其它任何地方从第一章开始。
    this._chapterHits = [];
    {
      const cs = Math.max(11, S * 0.019);
      p.push();
      p.textFont(SERIF);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(cs);
      const names = SCENES.map((id) => SCENE_TITLES[id].cn);
      const pad = cs * 1.5;
      const widths = names.map((n) => p.textWidth(n) + pad);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = (W - total) / 2;
      const y = H * 0.885;
      for (let i = 0; i < names.length; i++) {
        const w = widths[i];
        const cx = x + w / 2;
        const hov = this._chapHover === i;
        p.noStroke();
        p.fill(60, 56, 48, hov ? 26 : 0);
        p.rect(x + pad * 0.18, y - cs * 1.0, w - pad * 0.36, cs * 2.0, cs * 0.3);
        p.fill(46, 43, 38, hov ? 235 : 150);
        p.text(names[i], cx, y);
        this._chapterHits.push({ i, x: x + pad * 0.18, y: y - cs * 1.0, w: w - pad * 0.36, h: cs * 2.0 });
        x += w;
      }
      p.pop();
    }

    // 开始提示
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    p.push();
    p.textFont(SANS);
    p.textAlign(p.CENTER, p.CENTER);
    p.fill(30, 28, 24, 120 + pulse * 120);
    p.textSize(Math.max(this._narrow(p) ? 14 : 12, S * 0.021));
    p.text('点击任意处进入', W / 2, H * 0.955);
    p.pop();
  }

  // 标题页的章节命中判定。Game 的指针分发会先问这里。
  chapterAt(x, y) {
    for (const r of this._chapterHits ?? []) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.i;
    }
    return -1;
  }

  // ================================================================ 游戏中 HUD
  _drawPlay(p, dt) {
    const W = p.width, H = p.height;

    if (this.card) this._drawCard(p, dt, W, H);
    if (this.dlg) this._drawDialogue(p, dt, W, H);
    else if (this.hint) this._drawHint(p, W, H);

    this._drawFeathers(p, W, H);
    if (this.toast) this._drawToast(p, dt, W, H);
    if (this.game.input.touchMode && !this.dlg) {
      this._drawStickBase(p);
      if (this.game.input.stick.active) this._drawStick(p);
      this._drawTouchUI(p);
    }

    // 梦境里让水墨渗回来一点：屏幕四角压一层墨色
    if (this.inkBleed > 0.01) {
      p.push();
      p.noStroke();
      const a = this.inkBleed * 70;
      for (let i = 0; i < 5; i++) {
        p.fill(38, 42, 48, a / (i + 2));
        const m = i * Math.min(W, H) * 0.05;
        p.rect(0, 0, W, m); p.rect(0, H - m, W, m);
        p.rect(0, 0, m, H); p.rect(W - m, 0, m, H);
      }
      p.pop();
    }
  }

  _drawCard(p, dt, W, H) {
    const c = this.card;
    const k = Math.min(1, c.t / c.dur);
    const a = k < 0.18 ? k / 0.18 : k > 0.78 ? (1 - k) / 0.22 : 1;
    const S = this._S(p);
    p.push();
    p.textFont(SERIF);
    p.textAlign(p.CENTER, p.CENTER);
    p.fill(0, 0, 0, 90 * a);
    p.noStroke();
    p.rect(0, H * 0.36, W, S * 0.2);
    p.fill(242, 236, 222, 245 * a);
    p.textSize(S * 0.062);
    p.text(c.cn, W / 2, H * 0.42);
    p.fill(242, 236, 222, 170 * a);
    p.textFont(SANS);
    p.textSize(S * 0.021);
    p.text(c.sub, W / 2, H * 0.485);
    p.pop();
  }

  _drawHint(p, W, H) {
    const S = this._S(p);
    p.push();
    p.textFont(SANS);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(Math.max(12, S * 0.02));
    const tw = p.textWidth(this.hint) + 34;
    const y = H * 0.86;
    p.noStroke();
    p.fill(16, 15, 13, 165);
    p.rect(W / 2 - tw / 2, y - 17, tw, 34, 17);
    p.fill(238, 232, 216, 235);
    p.text(this.hint, W / 2, y);
    p.pop();
  }

  _drawDialogue(p, dt, W, H) {
    const d = this.dlg;
    const S = this._S(p);
    const pad = Math.max(16, S * 0.032);
    const boxW = Math.min(980, W - pad * 1.2);
    // 盒子按内容算高，不写死。竖屏手机上写死的话，
    // 一句"牛来。"也要占掉屏幕四分之一，剩下全是空白纸。
    const bodySize = Math.max(16, S * 0.031);
    const lh = Math.max(24, bodySize * 1.5);
    const chH = Math.max(30, S * 0.044);
    p.push();
    p.textFont(SERIF);
    p.textSize(bodySize);
    const nLines = Math.max(1, this._wrap(p, this.dlg.text, boxW - pad * 2).length);
    p.pop();
    const nCh = this.dlg.choices?.length ?? 0;
    const boxH = Math.min(H * 0.5,
      pad * 2.1 + nLines * lh + (nCh ? nCh * chH + pad * 0.4 : pad * 0.2));
    const x = (W - boxW) / 2;
    const y = H - boxH - pad;

    // 底板
    p.push();
    p.noStroke();
    p.fill(0, 0, 0, 60);
    p.rect(x + 5, y + 6, boxW, boxH, 6);
    p.pop();
    this._paperFill(p, x, y, boxW, boxH, 246);
    p.push();
    p.noFill();
    p.stroke(38, 34, 28, 120);
    p.strokeWeight(1.5);
    p.rect(x + 0.5, y + 0.5, boxW - 1, boxH - 1, 4);
    p.pop();

    // 说话人标签
    if (d.who) {
      p.push();
      p.textFont(SERIF);
      p.textSize(Math.max(14, S * 0.026));
      const nw = p.textWidth(d.who) + 30;
      p.noStroke();
      const col = p.color(d.color || '#3b352c');
      p.fill(col);
      p.rect(x + pad * 0.7, y - Math.max(15, S * 0.021), nw, Math.max(30, S * 0.042), 4);
      p.fill(250, 246, 238);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(d.who, x + pad * 0.7 + nw / 2, y + Math.max(0, S * 0.0005));
      p.pop();
    }

    // 正文
    p.push();
    p.textFont(SERIF);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(bodySize);
    p.fill(28, 25, 21, 240);
    const innerW = boxW - pad * 2;
    const visible = d.text.slice(0, Math.floor(d.shown));
    const lines = this._wrap(p, visible, innerW);
    let ty = y + pad * 1.15;
    for (const ln of lines) { p.text(ln, x + pad, ty); ty += lh; }
    p.pop();

    // 选项 / 继续
    d.hit = [];
    if (d.done && d.choices?.length) {
      p.push();
      p.textFont(SANS);
      p.textSize(Math.max(this._narrow(p) ? 15 : 13, S * 0.023));
      const ch = chH;
      let cy = y + boxH - pad * 0.85 - ch * d.choices.length;
      d.choices.forEach((c, i) => {
        const hovered = i === d.sel;
        p.noStroke();
        p.fill(hovered ? 176 : 60, hovered ? 42 : 56, hovered ? 36 : 50, hovered ? 30 : 14);
        p.rect(x + pad * 0.8, cy, innerW + pad * 0.4, ch - 5, 3);
        p.fill(hovered ? 150 : 90, hovered ? 34 : 84, hovered ? 30 : 76, 255);
        p.textAlign(p.LEFT, p.CENTER);
        p.text(`${i + 1}. ${c.text}`, x + pad * 1.35, cy + (ch - 5) / 2);
        if (hovered) {
          p.fill(176, 42, 36);
          p.rect(x + pad * 0.8, cy, 3, ch - 5);
        }
        d.hit.push({ x: x + pad * 0.8, y: cy, w: innerW + pad * 0.4, h: ch - 5, i });
        cy += ch;
      });
      p.pop();
    } else if (d.done) {
      const bl = 0.5 + 0.5 * Math.sin(d.t * 4);
      p.push();
      p.noStroke();
      p.fill(60, 54, 46, 100 + bl * 140);
      const ax = x + boxW - pad, ay = y + boxH - pad * 0.75;
      p.triangle(ax - 7, ay - 4, ax + 7, ay - 4, ax, ay + 5);
      p.pop();
    }
  }

  _drawFeathers(p, W, H) {
    const S = this._S(p);
    p.push();
    p.textFont(SANS);
    p.textAlign(p.RIGHT, p.CENTER);
    p.textSize(Math.max(this._narrow(p) ? 14 : 11, S * 0.019));
    const y = Math.max(24, S * 0.045);
    p.fill(255, 255, 255, 200);
    p.text(`羽毛 ${this.feathers} / ${this.featherTotal}`, W - Math.max(18, S * 0.03), y);
    p.noStroke();
    for (let i = 0; i < this.featherTotal; i++) {
      const fx = W - Math.max(18, S * 0.03) - 96 - i * 15;
      p.fill(255, 255, 255, i < this.feathers ? 235 : 60);
      p.ellipse(fx, y, 6, 13);
    }

    // 时辰：左上角一个跟着天色转的小圆点 + 时间
    const g = this.game;
    if (g.timeNow) {
      const x = Math.max(18, S * 0.03), r = Math.max(5, S * 0.008);
      const c = g.timeNow.phase;
      p.noStroke();
      // 白天画太阳、夜里画月牙
      const night = g.timeNow.stars;
      p.fill(255, 245, 220, 230 - night * 90);
      p.circle(x + r, y, r * 2);
      if (night > 0.5) {
        p.fill(20, 26, 40, 235);
        p.circle(x + r * 1.7, y - r * 0.35, r * 1.7);
      }
      p.fill(255, 255, 255, 190);
      p.textAlign(p.LEFT, p.CENTER);
      p.text(`${c.name}　${g.clock.clockText()}`, x + r * 2.8, y);
    }
    p.pop();
  }

  _drawToast(p, dt, W, H) {
    const t = this.toast;
    const a = t.t < 0.3 ? t.t / 0.3 : t.t > 3.4 ? (4 - t.t) / 0.6 : 1;
    const S = this._S(p);
    p.push();
    p.textFont(SERIF);
    p.textAlign(p.CENTER, p.CENTER);
    const fs = Math.max(this._narrow(p) ? 15 : 13, S * 0.023);
    p.textSize(fs);
    // 换行自己拆，canvas 的 fillText 不认 \n。
    // 太长的还要按宽度折行，不然超出屏幕直接被切掉，中间那段字就没了。
    const maxW = W * 0.88 - 44;
    const lines = [];
    for (const seg of String(t.text).split('\n')) {
      if (p.textWidth(seg) <= maxW) { lines.push(seg); continue; }
      let cur = '';
      for (const ch of seg) {
        if (p.textWidth(cur + ch) > maxW && cur) { lines.push(cur); cur = ch; }
        else cur += ch;
      }
      if (cur) lines.push(cur);
    }
    const lh = fs * 1.55;
    const tw = Math.min(W * 0.9, Math.max(...lines.map((l) => p.textWidth(l))) + 44);
    const bh = lines.length * lh + 16;
    const y = H * 0.16;
    p.noStroke();
    p.fill(20, 18, 16, 175 * a);
    p.rect(W / 2 - tw / 2, y - bh / 2, tw, bh, 5);
    lines.forEach((l, i) => {
      // 第二行是操作提示，压暗一点，别跟正文抢
      p.fill(240, 232, 210, (i === 0 ? 245 : 190) * a);
      p.text(l, W / 2, y - bh / 2 + 8 + lh * (i + 0.5));
    });
    p.pop();
  }

  // ---------------------------------------------------------------- 触屏控件
  // 尺寸一律取自 p5 画布，不用 innerWidth——面板重排时 innerWidth 会瞬时归零，
  // 按钮坐标会算成负数、摇杆判定也会失效。画布尺寸始终是上一帧的有效值。
  vw() { return this.p?.width || innerWidth || 360; }
  vh() { return this.p?.height || innerHeight || 640; }

  // 摇杆在右手边，功能键在左手边。
  // 字号和间距要一起定：字塞在两个键中间，间距不留够就会挤成一团。
  touchButtons() {
    const W = this.vw(), H = this.vh();
    const S = Math.min(W, H);
    const narrow = W < 620;
    const r = Math.max(narrow ? 26 : 23, S * 0.058);
    const cs = Math.max(narrow ? 15 : 11, S * (narrow ? 0.040 : 0.026));   // 键面小字
    const jr = r * 1.34;
    const m = S * 0.06;
    const jx = jr + m, jy = H - jr - m * 1.4 - cs;   // 跳：左下角最大的那个，底下给小字留位
    const cx = r + m * 1.2;
    const gap = r * 2 + cs * 1.8;                    // 圆到圆的距离 = 两个半径 + 一行字
    const top = jy - jr - r - cs * 2.1;   // 跳跃键更大，上面那个要多让开一点
    const mk = (id, icon, cap, y) => ({ id, icon, cap, x: cx, y, r, cs });
    return [
      // 云雀按住不放能一直飞，键面就直接写"飞"
      { id: 'jump', icon: 'jump', cap: this.game?.animal?.fly ? '飞' : '跳',
        x: jx, y: jy, r: jr, cs, big: true },
      mk('shout', 'shout', '叫', top),
      mk('animal', 'swap', '换', top - gap),
      mk('view', 'eye', '视角', top - gap * 2),
      mk('time', 'sun', '时辰', top - gap * 3),
    ];
  }

  // 摇杆的感应区，右下角一块。这块之外的拖拽全部归转视角。
  stickZone() {
    const h = this.stickHome();
    const pad = h.r * 2.3;
    return { x: Math.max(this.vw() * 0.42, h.x - pad), y: Math.max(0, h.y - pad) };
  }

  stickHome() {
    const W = this.vw(), H = this.vh();
    const S = Math.min(W, H);
    const r = Math.max(44, S * 0.112);
    return { x: W - r - S * 0.075, y: H - r - S * 0.08, r };
  }

  touchButtonAt(x, y) {
    for (const b of this.touchButtons()) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) return b.id;
    }
    return null;
  }

  jumpButtonRect() { return this.touchButtons()[0]; }

  // 图标全部用直线和圆画，主版本和垫片都吃得下
  _icon(p, kind, x, y, r) {
    const s = r * 0.46;
    p.push();
    p.translate(x, y);
    p.noFill();
    p.strokeWeight(Math.max(1.8, r * 0.1));
    p.stroke(248, 245, 238, 240);
    switch (kind) {
      case 'jump':                                  // 向上的箭头 + 地面
        p.line(0, s * 0.55, 0, -s * 0.65);
        p.line(-s * 0.5, -s * 0.12, 0, -s * 0.7);
        p.line(s * 0.5, -s * 0.12, 0, -s * 0.7);
        p.line(-s * 0.62, s * 0.85, s * 0.62, s * 0.85);
        break;
      case 'shout':                                 // 张口 + 两道声波
        p.noStroke(); p.fill(248, 245, 238, 240);
        p.circle(-s * 0.5, 0, s * 0.5);
        p.noFill(); p.stroke(248, 245, 238, 220);
        p.arc(-s * 0.5, 0, s * 1.5, s * 1.5, -0.9, 0.9);
        p.stroke(248, 245, 238, 140);
        p.arc(-s * 0.5, 0, s * 2.4, s * 2.4, -0.85, 0.85);
        break;
      case 'swap':                                  // 上下两个反向箭头
        p.line(-s * 0.7, -s * 0.35, s * 0.7, -s * 0.35);
        p.line(s * 0.35, -s * 0.72, s * 0.7, -s * 0.35);
        p.line(s * 0.35, s * 0.02, s * 0.7, -s * 0.35);
        p.line(s * 0.7, s * 0.45, -s * 0.7, s * 0.45);
        p.line(-s * 0.35, s * 0.08, -s * 0.7, s * 0.45);
        p.line(-s * 0.35, s * 0.82, -s * 0.7, s * 0.45);
        break;
      case 'eye':                                   // 眼睛
        p.beginShape();
        for (let i = 0; i <= 12; i++) {
          const t = i / 12, a = -Math.PI + t * Math.PI;
          p.vertex(Math.cos(a) * s, Math.sin(a) * s * 0.62);
        }
        for (let i = 0; i <= 12; i++) {
          const t = i / 12, a = t * Math.PI;
          p.vertex(Math.cos(a) * -s, Math.sin(a) * -s * 0.62);
        }
        p.endShape(p.CLOSE);
        p.noStroke(); p.fill(248, 245, 238, 240);
        p.circle(0, 0, s * 0.52);
        break;
      case 'sun':                                   // 半日半月
        p.circle(0, 0, s * 1.35);
        p.noStroke(); p.fill(248, 245, 238, 230);
        p.arc(0, 0, s * 1.35, s * 1.35, Math.PI * 0.5, Math.PI * 1.5);
        break;
    }
    p.pop();
  }

  _drawTouchUI(p) {
    const air = !this.game.player?.grounded;
    const canFly = !!this.game.animal?.fly;
    const S = Math.min(this.vw(), this.vh());
    const H = this.vh();
    p.push();
    for (const b of this.touchButtons()) {
      // 在空中时跳跃键压暗表示"按了也没用"——但会飞的按住就是有用的，别压
      const dim = b.id === 'jump' && air && !canFly;
      const lit = b.id === 'jump' && air && canFly;
      // 深色底 + 浅色环：亮草地和黑夜里都读得出来，比纯白半透明干净
      p.noStroke();
      p.fill(26, 24, 21, dim ? 60 : lit ? 140 : 108);
      p.circle(b.x, b.y, b.r * 2);
      p.noFill();
      p.stroke(250, 247, 240, dim ? 70 : lit ? 235 : 165);
      p.strokeWeight(b.big ? 2.4 : 1.8);
      p.circle(b.x, b.y, b.r * 2);
      this._icon(p, b.icon, b.x, b.y, b.r * (b.big ? 1.05 : 1));

      p.noStroke();
      p.fill(250, 247, 240, dim ? 90 : 190);
      p.textFont(SANS);
      p.textAlign(p.CENTER, p.CENTER);
      const fs = b.cs ?? Math.max(10, S * 0.026);
      p.textSize(fs);
      // 贴着屏幕底的那个键，字放下面会被切掉，改放上面
      const gap = b.r + Math.max(9, fs);
      const below = b.y + gap + fs * 0.6 <= H - 2;
      p.text(b.cap, b.x, b.y + (below ? gap : -gap));
    }
    p.pop();
  }

  _drawStickBase(p) {
    if (this.game.input.stick.active) return;   // 手指按着的时候画真摇杆，不画底座
    const h = this.stickHome();
    p.push();
    p.noStroke();
    p.fill(255, 255, 255, 22);
    p.circle(h.x, h.y, h.r * 2);
    p.noFill();
    p.stroke(255, 255, 255, 72);
    p.strokeWeight(2);
    p.circle(h.x, h.y, h.r * 2);
    p.noStroke();
    p.fill(255, 255, 255, 60);
    p.circle(h.x, h.y, h.r * 0.78);
    p.pop();
  }

  _drawStick(p) {
    const inp = this.game.input;
    const s = inp.stick;
    const running = inp.run && inp.stickDriven;
    p.push();
    p.noFill();
    // 推到跑的幅度就把外圈点亮，玩家得知道自己现在到底在走还是在跑
    p.stroke(255, 255, 255, running ? 180 : 70);
    p.strokeWeight(running ? 3.4 : 2);
    p.ellipse(s.ox, s.oy, 140);
    p.noStroke();
    const kx = s.ox + s.x * 70, ky = s.oy + s.y * 70;
    p.fill(255, 255, 255, running ? 190 : 110);
    p.ellipse(kx, ky, running ? 60 : 52);
    // 「跑」写在拨片里，跟着手指走，不会跟拨片撞在一起
    if (running) {
      p.fill(30, 28, 24, 220);
      p.textFont(SANS);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(Math.max(15, Math.min(this.vw(), this.vh()) * 0.042));
      p.text('跑', kx, ky);
    }
    p.pop();
  }

  // ================================================================ 转场
  startTransition(cb, dur = 1.5) {
    if (this.trans) return;
    const r = mulberry((Math.random() * 1e9) | 0);
    this.trans = {
      t: 0, dur, cb, fired: false,
      seeds: Array.from({ length: 9 }, () => ({ x: r(), y: r(), s: 0.5 + r() * 0.9, sd: (r() * 1e6) | 0 })),
    };
  }

  _drawTransition(p) {
    const tr = this.trans;
    if (!tr) return;
    const k = tr.t / tr.dur;
    const W = p.width, H = p.height;
    const D = Math.hypot(W, H);

    // 0 -> 0.5 墨扩散盖住；0.5 -> 1 退开
    let grow = k < 0.5 ? k / 0.5 : 1 - (k - 0.5) / 0.5;
    grow = Math.pow(Math.max(0, Math.min(1, grow)), 0.75);

    p.push();
    for (const s of tr.seeds) {
      wetBlob(p, s.x * W, s.y * H, grow * D * 0.42 * s.s, { seed: s.sd, alpha: 235, color: [20, 19, 17], layers: 2 });
    }
    if (grow > 0.92) { p.noStroke(); p.fill(20, 19, 17, (grow - 0.92) / 0.08 * 255); p.rect(0, 0, W, H); }
    p.pop();
  }

  // ================================================================ 外部接口
  showCard(cn, sub, dur = 3.2) { this.card = { t: 0, dur, cn, sub }; }
  showToast(text) { this.toast = { text, t: 0 }; }
  setHint(h) { this.hint = h; }

  showLine(who, text, color, speed = 34) {
    this.dlg = { who, text, color, shown: 0, speed, choices: null, sel: -1, done: false, t: 0, hit: [] };
  }
  setChoices(choices) { if (this.dlg) { this.dlg.choices = choices; this.dlg.sel = 0; } }
  skipTyping() { if (this.dlg) { this.dlg.shown = this.dlg.text.length; this.dlg.done = true; } }
  closeDialogue() { this.dlg = null; }
  get dialogueDone() { return this.dlg?.done ?? false; }

  hitChoice(x, y) {
    if (!this.dlg?.hit) return -1;
    for (const h of this.dlg.hit) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.i;
    }
    return -1;
  }
  hoverChoice(x, y) {
    const i = this.hitChoice(x, y);
    if (i >= 0 && this.dlg) this.dlg.sel = i;
  }
}
