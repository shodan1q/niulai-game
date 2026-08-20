import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync } from 'node:fs';

// 入口是 main.js 不是 html，vite 不会自己搬 index.html；
// 而 emptyOutDir 每次又会把手动拷进去的删掉。所以在这儿收尾拷一次，
// 保证 dist-minitool 永远是一个能直接打包的完整产物。
const copyIndex = () => ({
  name: 'copy-minitool-index',
  closeBundle() {
    copyFileSync(resolve(process.cwd(), 'minitool/index.html'),
                 resolve(process.cwd(), 'dist-minitool/index.html'));
  },
});

// 小工具容器要求：经典脚本（不能 type="module"）、无内联脚本、相对路径、离线。
// 所以打成单个 IIFE，页面用 <script src="./assets/app.js"> 引。
export default defineConfig({
  root: resolve(process.cwd(), 'minitool'),
  base: './',
  define: { __MINITOOL__: 'true' },
  plugins: [copyIndex()],
  // p5 换成自写垫片：它带的 fetch / WebAssembly / requestFullscreen 都是死代码，
  // 但扫描清单照样命中，而且它自己就占了一半体积
  resolve: {
    alias: {
      p5: resolve(process.cwd(), 'minitool/p5shim.js'),
      // 语音也内嵌：容器不许放 .mp3、不许 fetch，但 decodeAudioData 没被禁
      './bakedVoices.js': resolve(process.cwd(), 'minitool/voices.js'),
    },
  },
  preview: { port: 5174, host: true },
  build: {
    target: 'es2020',
    outDir: resolve(process.cwd(), 'dist-minitool'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(process.cwd(), 'minitool/main.js'),
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
