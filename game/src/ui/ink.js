// 水墨绘制工具。全部跑在 p5 的 2D canvas 上。
//
// 这部分存在的理由：《牛来》上映前只放出过一张水墨国风海报，
// 进影院看到的却是粗糙的三维。游戏把这个落差做成主动的设计——
// 标题画面是真的水墨，点开始的瞬间被墨"烧穿"，露出底下的低多边形世界。

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 宣纸：底色 + 纤维噪点。画一次存成 graphics，别每帧算。
export function makePaper(p, w, h, seed = 3) {
  const g = p.createGraphics(w, h);
  const r = mulberry(seed);
  g.noStroke();
  g.background(241, 234, 220);
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = r() * w, y = r() * h;
    const v = r();
    g.fill(v > 0.55 ? 255 : 205, v > 0.55 ? 252 : 196, v > 0.55 ? 240 : 176, 18 + r() * 26);
    g.rect(x, y, 1 + r() * 2.5, 1 + r() * 1.6);
  }
  // 几道很淡的折痕
  g.noFill();
  for (let i = 0; i < 3; i++) {
    g.stroke(180, 168, 148, 16);
    g.strokeWeight(1 + r());
    const x0 = r() * w;
    g.beginShape();
    for (let y = 0; y <= h; y += 24) g.vertex(x0 + Math.sin(y * 0.01 + i) * 12, y);
    g.endShape();
  }
  // 转成 p5.Image 再返回：p5 2.x 的 image() 收 Graphics 会每帧刷一条友好提示，很吵
  const img = g.get();
  g.remove();
  return img;
}

// 低频抖动。逐点白噪声会让笔画长毛，所以先生成几个控制值再平滑插值。
function smoothWobble(r, n, ctrl = 5, amount = 0.3) {
  const k = Array.from({ length: ctrl + 1 }, () => (r() - 0.5) * 2);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * ctrl;
    const i0 = Math.floor(t), f = t - i0;
    const s = f * f * (3 - 2 * f);
    out[i] = 1 + (k[i0] * (1 - s) + k[Math.min(ctrl, i0 + 1)] * s) * amount;
  }
  return out;
}

// 毛笔笔触：沿路径生成一个中间粗两头细的多边形，叠几层半透明模拟洇墨。
export function inkStroke(p, pts, {
  weight = 20, alpha = 190, color = [26, 24, 22], layers = 3,
  taperIn = 0.18, taperOut = 0.32, jitter = 0.22, seed = 1, wet = 1, dry = 0.5,
} = {}) {
  if (pts.length < 2) return;
  const r = mulberry(seed);
  const n = pts.length;
  const wob = smoothWobble(r, n, 5, jitter);

  for (let L = 0; L < layers; L++) {
    const k = 1 - L / layers;                 // 外层更宽更淡
    const w = weight * (1 + (1 - k) * 0.55 * wet);
    const a = alpha * (0.32 + k * 0.68) / layers * 1.6;
    p.noStroke();
    p.fill(color[0], color[1], color[2], a);
    p.beginShape();
    const half = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let taper = 1;
      if (t < taperIn) taper = t / taperIn;
      if (t > 1 - taperOut) taper = (1 - t) / taperOut;
      taper = Math.pow(Math.max(0, taper), 0.55);
      half.push((w * 0.5) * taper * wob[i]);
    }
    // 上沿
    for (let i = 0; i < n; i++) {
      const a0 = pts[Math.max(0, i - 1)], b0 = pts[Math.min(n - 1, i + 1)];
      const ang = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]) + Math.PI / 2;
      p.vertex(pts[i][0] + Math.cos(ang) * half[i], pts[i][1] + Math.sin(ang) * half[i]);
    }
    // 下沿
    for (let i = n - 1; i >= 0; i--) {
      const a0 = pts[Math.max(0, i - 1)], b0 = pts[Math.min(n - 1, i + 1)];
      const ang = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]) - Math.PI / 2;
      p.vertex(pts[i][0] + Math.cos(ang) * half[i], pts[i][1] + Math.sin(ang) * half[i]);
    }
    p.endShape(p.CLOSE);
  }

  // 飞白：笔锋擦过纸面留下的空隙。只擦笔画内部，不往外溅，否则笔画会长毛。
  if (dry <= 0) return;
  const r2 = mulberry(seed + 77);
  p.noStroke();
  p.fill(241, 234, 220, 95 * dry);
  for (let i = 0; i < n * 0.35 * dry; i++) {
    const idx = Math.floor(r2() * (n - 1));
    const t = idx / (n - 1);
    let taper = 1;
    if (t < taperIn) taper = t / taperIn;
    if (t > 1 - taperOut) taper = (1 - t) / taperOut;
    const room = weight * 0.5 * Math.pow(Math.max(0, taper), 0.55) * 0.55;
    const a0 = pts[Math.max(0, idx - 1)], b0 = pts[Math.min(n - 1, idx + 1)];
    const ang = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]) + Math.PI / 2;
    const off = (r2() - 0.5) * 2 * room;
    p.push();
    p.translate(pts[idx][0] + Math.cos(ang) * off, pts[idx][1] + Math.sin(ang) * off);
    p.rotate(ang - Math.PI / 2);
    p.ellipse(0, 0, weight * (0.1 + r2() * 0.3), weight * 0.05);
    p.pop();
  }
}

// 由控制点插值出平滑路径
export function smoothPath(anchors, steps = 26) {
  const out = [];
  const n = anchors.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = anchors[Math.max(0, i - 1)], p1 = anchors[i], p2 = anchors[i + 1], p3 = anchors[Math.min(n - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(anchors[n - 1]);
  return out;
}

// 墨团。半径用几个低频谐波叠出来——逐点随机会得到一颗尖角星，不是墨。
export function wetBlob(p, x, y, radius, { seed = 1, alpha = 150, color = [24, 22, 20], layers = 4 } = {}) {
  const r = mulberry(seed);
  const harm = [
    { k: 2, a: 0.09 + r() * 0.09, ph: r() * 6.2832 },
    { k: 3, a: 0.06 + r() * 0.07, ph: r() * 6.2832 },
    { k: 5, a: 0.035 + r() * 0.045, ph: r() * 6.2832 },
    { k: 8, a: 0.015 + r() * 0.025, ph: r() * 6.2832 },
  ];
  const squash = 0.88 + r() * 0.2;
  const N = 64;
  const base = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let v = 1;
    for (const h of harm) v += Math.sin(a * h.k + h.ph) * h.a;
    base[i] = v;
  }
  for (let L = layers - 1; L >= 0; L--) {
    const k = 1 + L * 0.13;
    p.noStroke();
    p.fill(color[0], color[1], color[2], alpha / (1 + L * 1.6));
    p.beginShape();
    for (let i = 0; i <= N; i++) {
      const a = (i % N) / N * Math.PI * 2;
      const rr = radius * base[i % N] * k;
      p.vertex(x + Math.cos(a) * rr, y + Math.sin(a) * rr * squash);
    }
    p.endShape(p.CLOSE);
  }
}

// 远山：淡墨横扫，山脊是圆的不是尖的。
// 所有层共用一条基线（baseY），否则各层底边会在画面上留下横带。
export function farMountains(p, x, baseY, w, h, { seed = 5, layers = 3, alpha = 70 } = {}) {
  const STEP = Math.max(4, w / 220);
  for (let L = layers - 1; L >= 0; L--) {
    const r = mulberry(seed + L * 31);
    const k = 0.5 + L * 0.28;                       // 越远的层越高
    const a = alpha * (0.45 + (1 - L / layers) * 0.55);

    // 先摆几个山头，再用余弦把山脊连圆
    const peaks = [];
    let px = x - w * 0.08;
    while (px < x + w * 1.08) {
      const pw = w * (0.13 + r() * 0.17);
      peaks.push({ x: px + pw * 0.5, w: pw, h: h * (0.32 + r() * 0.68) * k });
      px += pw * (0.6 + r() * 0.36);
    }

    // 用垂直渐变填，山脚化进纸里，不然各层会在画面上留下平底的横带
    const ctx = p.drawingContext;
    const top = baseY - h * k;
    const c = `${58 + L * 26},${62 + L * 26},${68 + L * 24}`;
    const grad = ctx.createLinearGradient(0, top, 0, baseY);
    grad.addColorStop(0, `rgba(${c},${(a / 255).toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(${c},${(a / 255 * 0.8).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${c},0)`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.1, baseY);
    for (let sx = x - w * 0.1; sx <= x + w * 1.1; sx += STEP) {
      let hh = 0;
      for (const pk of peaks) {
        const d = Math.abs(sx - pk.x) / pk.w;
        if (d < 1) hh = Math.max(hh, pk.h * (0.5 + 0.5 * Math.cos(d * Math.PI)));
      }
      ctx.lineTo(sx, baseY - hh);
    }
    ctx.lineTo(x + w * 1.1, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// 主体脚下的一笔淡墨，给画面一个落脚点，不然东西是飘着的
export function groundWash(p, cx, y, w, { seed = 3, alpha = 34 } = {}) {
  const r = mulberry(seed);
  p.noStroke();
  for (let i = 0; i < 3; i++) {
    p.fill(64, 68, 72, alpha / (i + 1.2));
    const ww = w * (0.55 + i * 0.35) * (0.9 + r() * 0.25);
    p.ellipse(cx + (r() - 0.5) * w * 0.14, y + i * w * 0.012, ww, w * (0.035 + i * 0.02));
  }
}

// 墨牛。躯干是一块填出来的剪影（写意画牛就是一笔墨压下去），
// 腿、角、尾巴才用笔触。整体叠三层轻微错位，模拟墨在纸上洇开。
const BULL_BODY = [
  [-0.86, -0.16], [-0.60, -0.28], [-0.26, -0.33], [0.06, -0.34],
  [0.30, -0.39], [0.46, -0.48], [0.62, -0.40], [0.78, -0.31],
  [0.95, -0.33], [1.13, -0.27], [1.25, -0.15], [1.26, -0.03],
  [1.13, 0.03], [0.93, 0.03], [0.78, 0.10], [0.60, 0.18],
  [0.32, 0.22], [-0.04, 0.24], [-0.40, 0.22], [-0.68, 0.17],
  [-0.88, 0.05], [-0.94, -0.06], [-0.86, -0.16],
];

const BULL_LEGS = [
  { x: 0.50, y: 0.14, bend: 0.05, len: 0.62, w: 0.10 },    // 前左
  { x: 0.33, y: 0.19, bend: -0.04, len: 0.60, w: 0.088 },  // 前右
  { x: -0.55, y: 0.19, bend: -0.05, len: 0.60, w: 0.10 },  // 后左
  { x: -0.72, y: 0.14, bend: 0.04, len: 0.62, w: 0.088 },  // 后右
];

export function inkBull(p, cx, cy, s, { seed = 12, alpha = 205 } = {}) {
  const P = (x, y) => [cx + x * s, cy + y * s];
  const ink = (a) => p.fill(24, 22, 20, a);

  // 腿先画，压在身子底下
  BULL_LEGS.forEach((L, i) => {
    inkStroke(p, smoothPath([
      P(L.x, L.y - 0.06), P(L.x + L.bend, L.y + L.len * 0.55), P(L.x + L.bend * 1.7, L.y + L.len),
    ]), { weight: L.w * s, alpha: alpha * 0.95, seed: seed + 20 + i, layers: 2, taperIn: 0.05, taperOut: 0.28, jitter: 0.14, dry: 0.3 });
    // 蹄
    p.noStroke(); ink(alpha);
    p.ellipse(cx + (L.x + L.bend * 1.7) * s, cy + (L.y + L.len + 0.01) * s, L.w * 1.3 * s, L.w * 0.7 * s);
  });

  // 尾巴
  inkStroke(p, smoothPath([P(-1.02, -0.12), P(-1.22, 0.14), P(-1.14, 0.46)]),
    { weight: 0.055 * s, alpha: alpha * 0.9, seed: seed + 31, layers: 2, taperOut: 0.6, jitter: 0.18, dry: 0.2 });
  p.noStroke(); ink(alpha * 0.9);
  p.ellipse(cx - 1.14 * s, cy + 0.52 * s, 0.09 * s, 0.14 * s);

  // 躯干剪影，三层错位
  const body = smoothPath(BULL_BODY, 14);
  for (let L = 2; L >= 0; L--) {
    const k = 1 + L * 0.018;
    p.noStroke();
    ink(L === 0 ? alpha : alpha * 0.3);
    p.push();
    p.translate(cx, cy);
    p.scale(k);
    p.beginShape();
    for (const [x, y] of body) p.vertex(x * s, y * s);
    p.endShape(p.CLOSE);
    p.pop();
  }

  // 墨分五色：把腹部提亮，背脊压深，身子才有厚薄
  const ctx = p.drawingContext;
  ctx.save();
  ctx.beginPath();
  body.forEach(([x, y], i) => {
    const X = cx + x * s, Y = cy + y * s;
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  });
  ctx.closePath();
  ctx.clip();
  p.noStroke();
  p.fill(238, 231, 216, 46);
  p.ellipse(cx + 0.05 * s, cy + 0.30 * s, 1.9 * s, 0.52 * s);
  p.fill(238, 231, 216, 30);
  p.ellipse(cx - 0.34 * s, cy + 0.20 * s, 1.1 * s, 0.34 * s);
  p.fill(238, 231, 216, 22);
  p.ellipse(cx + 0.72 * s, cy + 0.02 * s, 0.5 * s, 0.3 * s);
  ink(70);
  p.ellipse(cx - 0.1 * s, cy - 0.34 * s, 1.5 * s, 0.24 * s);
  ctx.restore();

  // 牛角
  for (const [dir, sd] of [[1, 11], [-1, 13]]) {
    inkStroke(p, smoothPath([
      P(0.98, -0.34), P(1.02 + dir * 0.04, -0.52), P(1.16 + dir * 0.14, -0.60),
    ]), { weight: 0.075 * s, alpha, seed: seed + sd, layers: 2, taperIn: 0.02, taperOut: 0.55, jitter: 0.12, dry: 0 });
  }
  // 耳朵
  p.noStroke(); ink(alpha * 0.95);
  p.push();
  p.translate(cx + 0.9 * s, cy - 0.33 * s);
  p.rotate(-0.5);
  p.ellipse(0, 0, 0.19 * s, 0.09 * s);
  p.pop();

  // 眼睛：留一点纸白
  p.fill(238, 231, 216, 210);
  p.ellipse(cx + 1.11 * s, cy - 0.19 * s, 0.045 * s, 0.035 * s);

  // 背脊上压一笔更浓的墨，让身子有厚度
  inkStroke(p, smoothPath([P(-0.86, -0.27), P(-0.3, -0.34), P(0.24, -0.36)]),
    { weight: 0.12 * s, alpha: 90, seed: seed + 3, layers: 1, taperIn: 0.35, taperOut: 0.45, jitter: 0.1, dry: 0.8 });
}

// 云雀：一只在飞的小鸟。flap 0..1 控制翅膀开合。
export function inkLark(p, cx, cy, s, { seed = 21, alpha = 195, flap = 0.5 } = {}) {
  const P = (x, y) => [cx + x * s, cy + y * s];
  const k = 0.55 + flap * 0.6;

  // 翅膀先画，压在身子底下
  inkStroke(p, smoothPath([P(0.06, -0.04), P(-0.16, -0.34 * k), P(-0.58, -0.60 * k)]), {
    weight: 0.17 * s, alpha: alpha * 0.95, seed, layers: 2, taperIn: 0.06, taperOut: 0.55, jitter: 0.14, dry: 0.2,
  });
  inkStroke(p, smoothPath([P(0.04, 0.03), P(-0.14, 0.26 * k), P(-0.5, 0.46 * k)]), {
    weight: 0.13 * s, alpha: alpha * 0.75, seed: seed + 4, layers: 2, taperIn: 0.06, taperOut: 0.6, jitter: 0.14, dry: 0.2,
  });

  p.noStroke();
  p.fill(26, 24, 22, alpha);
  // 身子
  p.push();
  p.translate(cx, cy);
  p.rotate(-0.14);
  p.ellipse(0, 0, 0.86 * s, 0.32 * s);
  p.pop();
  // 尾
  p.push();
  p.translate(cx - 0.4 * s, cy + 0.04 * s);
  p.rotate(0.18);
  p.triangle(0, 0, -0.38 * s, -0.11 * s, -0.36 * s, 0.11 * s);
  p.pop();
  // 头与喙
  p.ellipse(cx + 0.45 * s, cy - 0.07 * s, 0.28 * s, 0.25 * s);
  p.triangle(cx + 0.56 * s, cy - 0.11 * s, cx + 0.56 * s, cy - 0.03 * s, cx + 0.78 * s, cy - 0.07 * s);
  // 眼睛留白
  p.fill(238, 231, 216, 200);
  p.ellipse(cx + 0.5 * s, cy - 0.1 * s, 0.055 * s, 0.045 * s);
}

// 印章
export function seal(p, x, y, s, text = '牛来') {
  p.push();
  p.noStroke();
  p.fill(176, 42, 36, 232);
  p.rect(x, y, s, s, s * 0.06);
  p.fill(241, 234, 220, 236);
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(s * 0.36);
  const chars = [...text];
  if (chars.length === 2) {
    p.text(chars[0], x + s * 0.5, y + s * 0.3);
    p.text(chars[1], x + s * 0.5, y + s * 0.71);
  } else {
    p.text(text, x + s * 0.5, y + s * 0.5);
  }
  // 印泥缺口
  const r = mulberry(9);
  p.fill(241, 234, 220, 150);
  for (let i = 0; i < 16; i++) {
    p.ellipse(x + r() * s, y + r() * s, r() * s * 0.1, r() * s * 0.08);
  }
  p.pop();
}
