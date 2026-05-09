import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid({ typescript: { tsconfigPath: 'tsconfig.client.json' } })],
  root: 'src/client',
  publicDir: '../../public',
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: false,
        ws: false,
      },
    },
  },
  preview: {
    port: 5174,
    host: '127.0.0.1',
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
