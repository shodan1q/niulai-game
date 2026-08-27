// 对话树执行器。走 lines -> choices/to -> 下一个节点，直到 to: null。

export class DialogueRunner {
  constructor(overlay, hooks = {}) {
    this.ov = overlay;
    this.hooks = hooks;          // { onFlag, onTrigger, onEnd, onNode }
    this.tree = null;
    this.node = null;
    this.nodeKey = null;
    this.lineIdx = 0;
    this.active = false;
    this.speakerColor = '#3b352c';
  }

  // nodeKey 可以是树里的键，也可以直接传一个节点对象
  // （闲聊那种轮换的小段落用得上，不必给每一句都在树里占一个键）。
  start(tree, nodeKey = 'start') {
    let key = nodeKey;
    if (nodeKey && typeof nodeKey === 'object') {
      key = '__adhoc';
      tree = { ...tree, __adhoc: nodeKey };
    }
    if (!tree?.[key]) return false;
    this.tree = tree;
    this.speakerColor = tree.color || '#3b352c';
    this.active = true;
    this._enter(key);
    return true;
  }

  _enter(key) {
    this.nodeKey = key;
    this.node = this.tree[key];
    this.lineIdx = 0;
    this.hooks.onNode?.(key, this.node);
    this._showCurrent();
  }

  _showCurrent() {
    const line = this.node.lines?.[this.lineIdx];
    if (!line) { this._afterLines(); return; }
    const isNarration = line.who === '旁白';
    if (!isNarration) this.hooks.onLine?.(line.who, line);
    this.ov.showLine(
      isNarration ? '' : line.who,
      line.text,
      isNarration ? '#4a4438' : this.speakerColor,
      isNarration ? 28 : 34,
    );
  }

  _afterLines() {
    if (this.node.flag) this.hooks.onFlag?.(this.node.flag);
    if (this.node.choices?.length) {
      // 选项挂在最后一句上显示
      this.lineIdx = (this.node.lines?.length ?? 1) - 1;
      const last = this.node.lines?.[this.lineIdx];
      if (last) {
        const isNarration = last.who === '旁白';
        this.ov.showLine(isNarration ? '' : last.who, last.text, isNarration ? '#4a4438' : this.speakerColor, 999);
      }
      this.ov.skipTyping();
      this.ov.setChoices(this.node.choices);
      this.awaitingChoice = true;
      return;
    }
    const trigger = this.node.trigger;
    if (this.node.to) { const nx = this.node.to; if (trigger) this.hooks.onTrigger?.(trigger); this._enter(nx); }
    else this._finish(trigger);
  }

  _finish(trigger) {
    this.active = false;
    this.awaitingChoice = false;
    this.ov.closeDialogue();
    if (trigger) this.hooks.onTrigger?.(trigger);
    this.hooks.onEnd?.(this.tree, this.nodeKey);
  }

  // 玩家按下确认 / 点击
  advance() {
    if (!this.active) return;
    if (this.awaitingChoice) return;              // 等选择，不能靠确认跳过
    if (!this.ov.dialogueDone) { this.ov.skipTyping(); return; }
    this.lineIdx++;
    if (this.lineIdx < (this.node.lines?.length ?? 0)) this._showCurrent();
    else this._afterLines();
  }

  choose(i) {
    if (!this.awaitingChoice) return;
    const c = this.node.choices?.[i];
    if (!c) return;
    this.awaitingChoice = false;
    if (this.node.flag) this.hooks.onFlag?.(this.node.flag);
    if (c.set) this.hooks.onFlag?.(c.set);
    if (c.to) this._enter(c.to);
    else this._finish(this.node.trigger);
  }

  get choiceCount() { return this.awaitingChoice ? (this.node.choices?.length ?? 0) : 0; }
}
