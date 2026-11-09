import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { packPlugin } from './pack.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lingchat-pack-test-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'plugin.json'), JSON.stringify({ uuid: 'pet', packid: 'pet', version: '0.1.0', entry: 'dist/index.html', logo: 'logo.svg', openMode: 'custom', devUrl: 'http://localhost:5995', quickDev: true }));
  for (const file of ['LICENSE', 'UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'README.md', 'logo.svg']) await writeFile(join(root, file), `fixture ${file}`);
  await writeFile(join(root, 'dist/index.html'), '<main>Pet</main>');
  return root;
}

test('production package removes dev routing and includes source notices with reproducible bytes', async () => {
  const root = await fixture();
  const first = await packPlugin(root);
  const bytes = await readFile(first.archive);
  const archive = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(archive['plugin.json']));
  assert.equal(manifest.devUrl, undefined); assert.equal(manifest.quickDev, undefined);
  assert.equal(manifest.entry, 'dist/index.html');
  for (const name of ['LICENSE', 'UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'dist/index.html']) assert.ok(archive[name]);
  const second = await packPlugin(root);
  assert.deepEqual(await readFile(second.archive), bytes);
  assert.match(await readFile(first.checksums, 'utf8'), /^[a-f0-9]{64}  pet-0\.1\.0\.oplg\n$/);
});

test('missing entry and symlinked package content cannot be published', async () => {
  const root = await fixture();
  await symlink('/etc/hosts', join(root, 'dist/private.txt'));
  await assert.rejects(packPlugin(root), /symlink/i);
  const other = await fixture();
  const manifest = JSON.parse(await readFile(join(other, 'plugin.json'), 'utf8'));
  manifest.entry = '../private/index.html';
  await writeFile(join(other, 'plugin.json'), JSON.stringify(manifest));
  await assert.rejects(packPlugin(other), /entry/i);
});
