import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const entries = (dir, ext) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f)) : [];

await build({
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['electron'],
});

const preload = entries('src/preload', '.ts');
if (preload.length) {
  await build({
    entryPoints: preload,
    outdir: 'dist/preload',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
  });
}

const ui = entries('src/ui', '.ts');
if (ui.length) {
  await build({
    entryPoints: ui,
    outdir: 'dist/ui',
    bundle: true,
    format: 'iife',
    platform: 'browser',
  });
}

if (existsSync('src/ui')) {
  mkdirSync('dist/ui', { recursive: true });
  for (const f of [...entries('src/ui', '.html'), ...entries('src/ui', '.css')]) {
    copyFileSync(f, join('dist/ui', f.split('/').pop()));
  }
}
