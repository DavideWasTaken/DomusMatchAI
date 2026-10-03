import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work both in a Tauri bundle and on a GitHub Pages subpath.
  base: './',
  build: { target: 'es2022' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
});
