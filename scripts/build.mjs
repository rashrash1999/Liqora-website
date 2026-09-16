import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir('js/vendor', { recursive: true });
await copyFile('functions/lib/domain.js', 'js/domain.js');
await build({
  entryPoints: ['src/firebase-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'eof',
  outfile: 'js/vendor/firebase.js',
});
console.log('Shared validation and local Firebase SDK bundle built.');
