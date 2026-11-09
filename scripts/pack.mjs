import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

export async function packPlugin(root) {
  root = resolve(root);
  const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
  if (manifest.entry !== 'dist/index.html' || manifest.logo !== 'logo.svg' || manifest.openMode !== 'custom') {
    throw new Error('Invalid production entry, logo or window mode');
  }
  if (!/^[a-z0-9-]+$/.test(manifest.packid) || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(manifest.version)) {
    throw new Error('Invalid package ID or version');
  }
  delete manifest.devUrl; delete manifest.quickDev;
  const entries = {};
  const epoch = new Date(1980, 0, 1);
  const add = (path, bytes) => { entries[path] = [bytes, { mtime: epoch }]; };
  add('plugin.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'));
  async function addFile(path) {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${path}`);
    if (!stat.isFile()) throw new Error(`Expected regular file: ${path}`);
    add(path, await readFile(join(root, path)));
  }
  for (const path of ['logo.svg', 'LICENSE', 'UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'README.md']) await addFile(path);
  async function walk(path) {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) await walk(`${path}/${name}`);
    } else if (stat.isFile()) await addFile(path);
    else throw new Error(`Unexpected package entry: ${path}`);
  }
  await walk('dist');
  try { await walk('licenses'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!entries[manifest.entry]) throw new Error('Production entry is missing; run build first');
  const bytes = zipSync(entries, { level: 6 });
  const verified = unzipSync(bytes);
  if (!verified[manifest.entry] || !verified.LICENSE) throw new Error('Package verification failed');
  const output = join(root, 'dist-pack'); await mkdir(output, { recursive: true });
  const name = `${manifest.packid}-${manifest.version}.oplg`;
  const archive = join(output, name); const checksums = join(output, 'SHA256SUMS');
  await writeFile(archive, bytes);
  await writeFile(checksums, `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  return { archive, checksums, bytes: bytes.length, entries: Object.keys(entries).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await packPlugin(root);
  console.log(`Created ${relative(root, result.archive)} (${result.bytes} bytes, ${result.entries} entries)`);
}
