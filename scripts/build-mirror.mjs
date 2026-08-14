// build-mirror.mjs — bundle client-src/mirror-panel.js → public/mirror.bundle.js
// IIFE, ไม่ minify (ให้ review ได้), target chrome110
// รัน: npm run build:mirror  (ต้องเคลียร์ NODE_OPTIONS ในเซสชัน sandbox)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'client-src/mirror-panel.js')],
  outfile: resolve(root, 'public/mirror.bundle.js'),
  bundle: true,
  minify: false,
  format: 'iife',
  target: 'chrome110',
  platform: 'browser',
  logLevel: 'info',
});

console.log('built public/mirror.bundle.js');
