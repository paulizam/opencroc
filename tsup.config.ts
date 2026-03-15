import { defineConfig } from 'tsup';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  splitting: false,
  shims: true,
  onSuccess: async () => {
    // Copy web assets to dist/web/
    const src = resolve('src/web');
    const dest = resolve('dist/web');
    if (existsSync(src)) {
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
      console.log('✅ Copied web assets to dist/web/');
    }
  },
});
