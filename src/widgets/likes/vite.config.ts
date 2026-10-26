import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Standalone build for the Top Likes widget. Produces static assets the
 * event gateway serves at `/widgets/likes/` for OBS Browser Sources.
 * Separate entry and output from the main TikTools bundle; relative base so
 * assets resolve under the gateway prefix.
 *
 * Run: `bun run build:widget:likes`
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [vue(), vueJsx()],
  build: {
    outDir: resolve(import.meta.dirname, '../../../dist/widgets/likes'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
