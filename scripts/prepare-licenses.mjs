import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'licenses'); await mkdir(target, { recursive: true });
const require = createRequire(join(root, 'package.json'));
const sources = [
  ['vue', ['LICENSE']], ['@vue/runtime-core', ['LICENSE']], ['@vue/runtime-dom', ['LICENSE']],
  ['@vue/reactivity', ['LICENSE']], ['@vue/shared', ['LICENSE']],
  ['@tauri-apps/api', ['LICENSE_MIT', 'LICENSE_APACHE-2.0']],
  ['@tauri-apps/plugin-dialog', ['LICENSE.spdx']], ['fflate', ['LICENSE']], ['yaml', ['LICENSE']],
  ['protobufjs', ['LICENSE']], ['long', ['LICENSE']], ['flatbuffers', ['LICENSE']],
];
const vueRequire = createRequire(require.resolve('vue'));
const ortRequire = createRequire(require.resolve('onnxruntime-web/wasm'));
const protobufRequire = createRequire(ortRequire.resolve('protobufjs'));
const resolvers = [require, vueRequire, ortRequire, protobufRequire];
for (const [name, files] of sources) {
  let packageFile;
  for (const resolver of resolvers) {
    try { packageFile = resolver.resolve(`${name}/package.json`); break; } catch {
      try {
        let folder = dirname(resolver.resolve(name));
        while (folder !== dirname(folder)) {
          const candidate = join(folder, 'package.json');
          try { const info = JSON.parse(await readFile(candidate, 'utf8')); if (info.name === name) { packageFile = candidate; break; } } catch { /* Ascend to the package root. */ }
          folder = dirname(folder);
        }
        if (packageFile) break;
      } catch { /* Try the dependency's own graph. */ }
    }
  }
  if (!packageFile) throw new Error(`Cannot resolve license package ${name}`);
  for (const filename of files) {
    const content = await readFile(join(dirname(packageFile), filename));
    await writeFile(join(target, `${name.replaceAll('/', '-').replace('@', '')}-${filename}.txt`), content);
  }
}
await writeFile(join(target, 'otools-plugin-sdk-MIT.txt'), await readFile(join(root, 'vendor/otools-plugin-sdk/LICENSE')));
