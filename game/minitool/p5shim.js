// p5.js 的最小替身，只实现 ui/ 里真正用到的那些 API。
//
// 换掉它的理由有两条，都跟小工具容器有关：
//   1. p5 的包里带着 fetch / WebAssembly / requestFullscreen / Function()——
//      我一处都没调用，但它们是死代码，扫描清单照样命中。
//   2. p5 minified 有 1 MB 上下，占了整包一大半，而建议体积是 2 MB。
//
// 这些 API 本来就是 Canvas2D 的薄封装，自己实现反而更直白。
// 主版本仍然用真的 p5，只有小工具构建通过 vite alias 换成这个。

const CENTER = 'center', LEFT = 'left', RIGHT = 'right';
const TOP = 'top', BOTTOM = 'bottom', BASELINE = 'alphabetic', CLOSE = 'close';

// p5 的颜色参数：(gray) / (gray,a) / (r,g,b) / (r,g,b,a) / (cssString)
function css(args) {
  if (args.length === 1) {
    const v = args[0];
    return typeof v === 'string' ? v : `rgb(${v},${v},${v})`;
  }
  if (args.length === 2) return `rgba(${args[0]},${args[0]},${args[0]},${args[1] / 255})`;
  if (args.length === 3) return `rgb(${args[0]},${args[1]},${args[2]})`;
  return `rgba(${args[0]},${args[1]},${args[2]},${args[3] / 255})`;
}

class Ctx2D {
  constructor(canvas, density = 1) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._density = density;
    this._fill = '#000';
    this._stroke = '#000';
    this._doFill = true;
    this._doStroke = false;
    this._shape = null;
    this._textSize = 12;
    this._textFont = 'sans-serif';
    this._alignH = LEFT;
    this._alignV = BASELINE;
    this._syncFont();
  }

  get drawingContext() { return this.ctx; }
  get width() { return this.canvas.width / this._density; }
  get height() { return this.canvas.height / this._density; }

  _syncFont() {
    this.ctx.font = `${this._textSize}px "${this._textFont}"`;
    this.ctx.textAlign = this._alignH;
    this.ctx.textBaseline = this._alignV;
  }

  _paint() {
    if (this._doFill) { this.ctx.fillStyle = this._fill; this.ctx.fill(); }
    if (this._doStroke) { this.ctx.strokeStyle = this._stroke; this.ctx.stroke(); }
  }

  // ---- 状态 ----
  push() { this.ctx.save(); return this; }
  pop() { this.ctx.restore(); return this; }
  translate(x, y) { this.ctx.translate(x, y); return this; }
  rotate(a) { this.ctx.rotate(a); return this; }
  scale(x, y = x) { this.ctx.scale(x, y); return this; }

  fill(...a) { this._fill = css(a); this._doFill = true; return this; }
  noFill() { this._doFill = false; return this; }
  stroke(...a) { this._stroke = css(a); this._doStroke = true; return this; }
  noStroke() { this._doStroke = false; return this; }
  strokeWeight(w) { this.ctx.lineWidth = w; this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round'; this._doStroke = true; return this; }
  color(...a) { return css(a); }
  tint(...a) { this.ctx.globalAlpha = (a.length >= 2 ? a[1] : 255) / 255; return this; }

  // ---- 清屏 ----
  clear() { this.ctx.clearRect(0, 0, this.width, this.height); return this; }
  background(...a) {
    this.ctx.save();
    this.ctx.setTransform(this._density, 0, 0, this._density, 0, 0);
    this.ctx.fillStyle = css(a);
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.restore();
    return this;
  }

  // ---- 图元 ----
  rect(x, y, w, h, r = 0) {
    this.ctx.beginPath();
    if (r > 0 && this.ctx.roundRect) this.ctx.roundRect(x, y, w, h, r);
    else this.ctx.rect(x, y, w, h);
    this._paint();
    return this;
  }

  ellipse(x, y, w, h = w) {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    this._paint();
    return this;
  }

  circle(x, y, d) { return this.ellipse(x, y, d, d); }

  line(x1, y1, x2, y2) {
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.strokeStyle = this._stroke;
    this.ctx.stroke();
    return this;
  }

  // p5 的 arc(x, y, w, h, start, stop)
  // p5 的 arc 默认是 PIE：填充时要连回圆心，不然半月形填不出来
  arc(x, y, w, h, a0, a1) {
    this.ctx.beginPath();
    if (this._doFill) this.ctx.moveTo(x, y);
    this.ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, a0, a1);
    if (this._doFill) {
      this.ctx.closePath();
      this.ctx.fillStyle = this._fill;
      this.ctx.fill();
    }
    if (this._doStroke) { this.ctx.strokeStyle = this._stroke; this.ctx.stroke(); }
    return this;
  }

  triangle(x1, y1, x2, y2, x3, y3) {
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.lineTo(x3, y3);
    this.ctx.closePath();
    this._paint();
    return this;
  }

  beginShape() { this._shape = []; return this; }
  vertex(x, y) { this._shape?.push([x, y]); return this; }
  endShape(mode) {
    const s = this._shape;
    this._shape = null;
    if (!s || s.length < 2) return this;
    this.ctx.beginPath();
    this.ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) this.ctx.lineTo(s[i][0], s[i][1]);
    if (mode === CLOSE) this.ctx.closePath();
    this._paint();
    return this;
  }

  // ---- 文字 ----
  textSize(n) { this._textSize = n; this._syncFont(); return this; }
  textFont(f) { this._textFont = f; this._syncFont(); return this; }
  textAlign(h, v) {
    this._alignH = h;
    if (v !== undefined) this._alignV = v === CENTER ? 'middle' : v;
    this._syncFont();
    return this;
  }
  textWidth(s) { return this.ctx.measureText(s).width; }
  text(str, x, y) {
    if (this._doFill) { this.ctx.fillStyle = this._fill; this.ctx.fillText(str, x, y); }
    if (this._doStroke) { this.ctx.strokeStyle = this._stroke; this.ctx.strokeText(str, x, y); }
    return this;
  }

  // ---- 图像 ----
  // p5 签名：image(img, dx, dy, dw, dh, sx, sy, sw, sh)
  image(img, dx = 0, dy = 0, dw, dh, sx, sy, sw, sh) {
    const src = img?.canvas ?? img;
    if (!src || !(src.width || src.naturalWidth)) return this;
    if (sw !== undefined) this.ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    else if (dw !== undefined) this.ctx.drawImage(src, dx, dy, dw, dh);
    else this.ctx.drawImage(src, dx, dy);
    return this;
  }
}

// 离屏画布。p5 里 createGraphics().get() 返回 p5.Image，
// 这里直接返回 canvas 元素——drawImage 一样吃。
class Graphics extends Ctx2D {
  constructor(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    super(c, 1);
  }
  // 必须返回副本。真 p5 的 get() 给的是 p5.Image（独立像素缓冲），
  // 调用方拿完常常紧接着 remove()——直接返回本体的话图会被一起清掉。
  get() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c;
  }
  remove() { this.canvas.width = this.canvas.height = 0; }
}

// 跟 p5 的 instance mode 对齐：new P5(sketch, container)
export default class P5 extends Ctx2D {
  constructor(sketch, container) {
    const c = document.createElement('canvas');
    (container || document.body).appendChild(c);
    super(c, 1);
    this.elt = c;

    this.CENTER = CENTER; this.LEFT = LEFT; this.RIGHT = RIGHT;
    this.TOP = TOP; this.BOTTOM = BOTTOM; this.BASELINE = BASELINE; this.CLOSE = CLOSE;

    this.setup = null;
    this.draw = null;
    this.windowResized = null;
    this.deltaTime = 16.7;
    this._start = performance.now();
    this._last = this._start;

    sketch(this);
    this.setup?.();

    addEventListener('resize', () => this.windowResized?.());

    const loop = (now) => {
      this.deltaTime = now - this._last;
      this._last = now;
      this.ctx.setTransform(this._density, 0, 0, this._density, 0, 0);
      this.draw?.();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get windowWidth() { return innerWidth; }
  get windowHeight() { return innerHeight; }
  millis() { return performance.now() - this._start; }
  // 先按旧密度读出 CSS 尺寸再改密度——反过来的话 width 的 getter
  // （canvas.width / _density）会用新密度去除，画布 CSS 尺寸直接减半，
  // 画面被拉伸盖住全屏、但触摸坐标和绘制坐标差一倍，按钮就点不中了。
  pixelDensity(d) {
    const w = this.width, h = this.height;
    this._density = d;
    this._resize(w, h);
    return this;
  }

  _resize(w, h) {
    this.canvas.width = Math.round(w * this._density);
    this.canvas.height = Math.round(h * this._density);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this._syncFont();
  }

  // p5 的 createCanvas 返回带 .elt 的包装对象
  createCanvas(w, h) {
    this._resize(w, h);
    return { elt: this.canvas };
  }
  resizeCanvas(w, h) { this._resize(w, h); return this; }
  createGraphics(w, h) { return new Graphics(w, h); }
}
