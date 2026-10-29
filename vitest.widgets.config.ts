import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(viteConfig, defineConfig({
  test: { root: process.cwd(), environment: 'happy-dom', include: ['src/widgets/**/*.vitest-case.ts'], restoreMocks: true },
}));
