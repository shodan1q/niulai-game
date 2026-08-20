import { defineConfig } from 'vite';

export default defineConfig({
  define: { __MINITOOL__: 'false' },
  server: { port: 5173, host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
