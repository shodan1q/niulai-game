// 输入：键盘 + 指针（鼠标/触屏）+ 虚拟摇杆
// p5 的 canvas 铺在最上层，所有指针事件都落在它身上，由 Game 分发。

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

const CONFIRM_KEYS = new Set(['Enter', 'KeyE', 'NumpadEnter']);
const JUMP_KEYS = new Set(['Space']);
const DEAD = 0.12;      // 摇杆死区

export class Input {
  constructor() {
    this.keys = new Set();
    this.axis = { x: 0, y: 0 };   // -1..1，已归一化
    this.run = false;
    this.mag = 0;                 // 推杆幅度 0~1，键盘时为 1
    this.stickDriven = false;     // 这一帧是摇杆在开车，不是键盘
    this._stickRun = false;
    this.stickZone = null;        // 由 Game 注入，取自界面里摇杆底座的位置

    // 一次性事件，读完即清
    this.confirmPressed = false;
    this.jumpPressed = false;
    // 跳跃键的"按住"状态。云雀要靠它一直扑翼，所以除了一次性的
    // jumpPressed，还得知道这一帧手指/空格到底还按着没有。
    this.jumpHeld = false;
    this.pressedIndex = -1;       // 数字键 1-4 选对话选项

    // 指针
    this.pointer = { x: 0, y: 0, down: false, id: null };
    this.dragDelta = { x: 0, y: 0 };
    this.clickPos = null;         // 抬手且没拖动过 -> 记一次点击

    // 虚拟摇杆（触屏，右半屏按下时激活——功能键在左边）
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    // 视口尺寸由 Game 注入，取自 p5 画布。
    // 直接用 innerWidth 不行：窗口重排时它会瞬时归零，判定跟着失效。
    this.viewport = null;

    // 一进来就判断是不是触屏设备，别等玩家先摸一下——
    // 不然按钮和摇杆在第一次触摸之前都是隐形的，等于不存在。
    this.touchMode = matchMedia?.('(pointer: coarse)')?.matches
      || navigator.maxTouchPoints > 0;

    this._dragged = 0;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const a = KEY_MAP[e.code];
      if (a) { this.keys.add(a); e.preventDefault(); }
      if (CONFIRM_KEYS.has(e.code)) { this.confirmPressed = true; e.preventDefault(); }
      if (JUMP_KEYS.has(e.code)) { this.jumpPressed = true; this.jumpHeld = true; e.preventDefault(); }
      // 数字键选对话选项；按住 Shift 则是直接跳章（自己调试用）
      const n = /^Digit([1-5])$/.exec(e.code);
      if (n) {
        if (e.shiftKey) this.chapterKey = Number(n[1]) - 1;
        else if (Number(n[1]) <= 4) this.pressedIndex = Number(n[1]) - 1;
      }
      if (e.code === 'KeyP') this.togglePose = true;
      if (e.code === 'KeyM') this.toggleMute = true;
      if (e.code === 'KeyQ') this.switchAnimal = true;
      if (e.code === 'KeyV') this.switchView = true;
      if (e.code === 'KeyT') this.nextTime = true;
      if (e.code === 'KeyB') this.toggleAmb = true;
      if (e.code === 'KeyJ') this.danceKey = true;      // 换一套舞
      if (e.code === 'KeyK') this.danceStop = true;     // 不跳了
      if (e.code === 'KeyL') this.slideKey = true;      // 滑铲
      // 叫一声：Z 是牛来，X 是妈妈，C 是豹拉
      if (e.code === 'KeyZ') this.voiceKey = 'niulai';
      if (e.code === 'KeyX') this.voiceKey = 'mother';
      if (e.code === 'KeyC') this.voiceKey = 'baola';
    });
    addEventListener('keyup', (e) => {
      const a = KEY_MAP[e.code];
      if (a) this.keys.delete(a);
      if (JUMP_KEYS.has(e.code)) this.jumpHeld = false;
    });
    // 切走的时候手是松开的，别让它一直飞
    addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; });
  }

  // 由 p5 的指针回调调用 -------------------------------------------------
  onPointerDown(x, y, isTouch, id = null) {
    if (isTouch) this.touchMode = true;      // 摸过屏幕才画摇杆和跳跃键
    this.pointer.x = x; this.pointer.y = y; this.pointer.down = true;
    this.pointer.id = id;
    this._dragged = 0;
    this._lastX = x; this._lastY = y;
    if (isTouch && this._inStickZone(x, y)) {
      this.stick.active = true;
      this.stick.id = id;
      this.stick.ox = x; this.stick.oy = y;
      this.stick.x = 0; this.stick.y = 0;
    }
  }

  _vw() { return this.viewport?.().w || innerWidth || 360; }
  _vh() { return this.viewport?.().h || innerHeight || 640; }

  // 摇杆区。原来是"右半屏随便按"，结果整块屏幕都被摇杆吃掉，
  // 转视角没地方落手。现在只圈右下角拇指够得着的一块。
  _inStickZone(x, y) {
    const z = this.stickZone?.();
    if (!z) return x > this._vw() * 0.42 && y > this._vh() * 0.45;   // 没注入时的退路
    return x >= z.x && y >= z.y;
  }

  onPointerMove(x, y) {
    if (!this.pointer.down) { this.pointer.x = x; this.pointer.y = y; return; }
    const dx = x - this._lastX, dy = y - this._lastY;
    this._lastX = x; this._lastY = y;
    this._dragged += Math.abs(dx) + Math.abs(dy);
    this.pointer.x = x; this.pointer.y = y;
    if (this.stick.active) {
      const R = Math.max(52, Math.min(this._vw(), this.viewport?.().h ?? innerHeight ?? 640) * 0.15);
      let sx = x - this.stick.ox, sy = y - this.stick.oy;
      const len = Math.hypot(sx, sy);
      if (len > R) { sx = sx / len * R; sy = sy / len * R; }
      this.stick.x = sx / R; this.stick.y = sy / R;
    } else {
      this.dragDelta.x += dx;
      this.dragDelta.y += dy;
    }
  }

  // 抬手。多点触控时只认自己那根手指——另一根还按着按钮的不该把摇杆归零。
  onPointerUp(x, y, id = null) {
    if (id !== null && this.pointer.id !== null && id !== this.pointer.id
        && !(this.stick.active && this.stick.id === id)) return;
    if (this.pointer.down && this._dragged < 8) this.clickPos = { x, y };
    this.pointer.down = false;
    this.pointer.id = null;
    this.stick.active = false;
    this.stick.id = null;
    this.stick.x = 0; this.stick.y = 0;
  }

  // 每帧开头调用 ---------------------------------------------------------
  update() {
    let x = 0, y = 0;
    if (this.keys.has('left')) x -= 1;
    if (this.keys.has('right')) x += 1;
    if (this.keys.has('up')) y -= 1;
    if (this.keys.has('down')) y += 1;
    const keyed = x !== 0 || y !== 0;
    if (this.stick.active) { x += this.stick.x; y += this.stick.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.axis.x = x; this.axis.y = y;

    // 推杆幅度。键盘永远是满的，摇杆按实际推了多远算。
    // 手机上就靠这个值决定走还是跑，没有 Shift 键，不这么做永远跑不起来，
    // 也就永远跳不过那条河。
    this.stickDriven = this.stick.active && !keyed;
    const raw = this.stickDriven ? Math.min(1, Math.hypot(this.stick.x, this.stick.y)) : (keyed ? 1 : 0);
    this.mag = raw <= DEAD ? 0 : (raw - DEAD) / (1 - DEAD);   // 去掉死区再拉回 0~1

    // 迟滞：过 0.82 算跑，掉到 0.62 以下才算停，卡在边界上不会来回抖
    if (this.mag > 0.82) this._stickRun = true;
    else if (this.mag < 0.62) this._stickRun = false;
    this.run = this.keys.has('run') || (this.stickDriven && this._stickRun);
  }

  // 消费型读取 -----------------------------------------------------------
  takeConfirm() { const v = this.confirmPressed; this.confirmPressed = false; return v; }
  takeJump() { const v = this.jumpPressed; this.jumpPressed = false; return v; }
  takeIndex() { const v = this.pressedIndex; this.pressedIndex = -1; return v; }
  takeClick() { const v = this.clickPos; this.clickPos = null; return v; }
  takeDrag() { const d = { ...this.dragDelta }; this.dragDelta.x = 0; this.dragDelta.y = 0; return d; }
  takePose() { const v = !!this.togglePose; this.togglePose = false; return v; }
  takeMute() { const v = !!this.toggleMute; this.toggleMute = false; return v; }
  takeVoice() { const v = this.voiceKey; this.voiceKey = null; return v; }
  takeChapter() { const v = this.chapterKey ?? -1; this.chapterKey = null; return v; }
  takeAnimal() { const v = !!this.switchAnimal; this.switchAnimal = false; return v; }
  takeView() { const v = !!this.switchView; this.switchView = false; return v; }
  takeTime() { const v = !!this.nextTime; this.nextTime = false; return v; }
  takeAmb() { const v = !!this.toggleAmb; this.toggleAmb = false; return v; }
  takeDance() { const v = !!this.danceKey; this.danceKey = false; return v; }
  takeDanceStop() { const v = !!this.danceStop; this.danceStop = false; return v; }
  takeSlide() { const v = !!this.slideKey; this.slideKey = false; return v; }
}
