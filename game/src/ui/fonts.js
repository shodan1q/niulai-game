// p5 2.x 会把字体名整个加引号再拼进 ctx.font，
// 所以 'A, B, serif' 这种 CSS 回退列表会变成非法值，静默退回 12px sans-serif。
// 只能传单个字体名 —— 那就自己挑一个本机真有的。

function available(name) {
  const c = document.createElement('canvas').getContext('2d');
  const probe = '牛来永东国漢字';
  for (const base of ['monospace', 'sans-serif']) {
    c.font = `72px ${base}`;
    const w0 = c.measureText(probe).width;
    c.font = `72px "${name}", ${base}`;
    if (c.measureText(probe).width !== w0) return true;
  }
  return false;
}

function pick(candidates, fallback) {
  for (const f of candidates) if (available(f)) return f;
  return fallback;
}

// 宋体/明朝体系，水墨题字用
export const SERIF = pick([
  'Songti SC', 'STSong', 'Source Han Serif SC', 'Noto Serif CJK SC',
  'Noto Serif SC', 'SimSun', 'Georgia',
], 'serif');

// 黑体系，UI 用
export const SANS = pick([
  'PingFang SC', 'Hiragino Sans GB', 'Source Han Sans SC', 'Noto Sans CJK SC',
  'Noto Sans SC', 'Microsoft YaHei', 'Helvetica Neue',
], 'sans-serif');
