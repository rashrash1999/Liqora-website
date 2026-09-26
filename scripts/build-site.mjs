import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const publicDirectories = ['css', 'data', 'images', 'js'];
const publicFiles = ['_headers', 'robots.txt', 'site.webmanifest', 'sitemap.xml'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const rootEntries = await readdir(root, { withFileTypes: true });
const htmlFiles = rootEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => entry.name);

await Promise.all([
  ...htmlFiles.map((name) => cp(join(root, name), join(output, name))),
  ...publicDirectories.map((name) => cp(join(root, name), join(output, name), { recursive: true })),
  ...publicFiles.map((name) => cp(join(root, name), join(output, name))),
]);

console.log(`Production site built in dist (${htmlFiles.length} HTML pages).`);
