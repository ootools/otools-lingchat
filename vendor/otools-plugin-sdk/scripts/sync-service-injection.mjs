import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostFlag = process.argv.indexOf('--host');
const host = hostFlag >= 0 ? resolve(process.argv[hostFlag + 1]) : resolve(root, '../..');
const target = resolve(host, 'src/platform/runtime/otools/embedded-runtime.js');
const factories = [
  ['ai', 'ai-factory', 'createAiApi'],
  ['data', 'plugin-data-factory', 'createPluginDataApi'],
  ['observation', 'observation-factory', 'createObservationApi'],
  ['reminders', 'reminder-factory', 'createReminderApi'],
];
const blocks = factories.map(([, file, factory]) => {
  const source = readFileSync(resolve(root, `src/${file}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export (?=(?:class|function|const) )/gm, '')
    .replace(/^export \* from ['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export \{\};?\s*$/gm, '');
  // Each factory has private helper names. Keep their lexical scopes independent.
  return `const ${factory} = (() => {\n${compiled}\nreturn ${factory};\n})();`;
});
const begin = '// BEGIN GENERATED PLUGIN SERVICES\n';
const end = '// END GENERATED PLUGIN SERVICES';
const block = `${begin}${blocks.join('\n\n')}\n${end}`;
const input = readFileSync(target, 'utf8');
let output;
if (input.includes(begin)) {
  const endAt = input.indexOf(end, input.indexOf(begin));
  if (endAt < 0) throw new Error('Missing service injection end marker');
  output = input.slice(0, input.indexOf(begin)) + block + input.slice(endAt + end.length);
} else {
  if (!input.includes('  const otools = {')) throw new Error('Missing Otools API declaration');
  output = input.replace('  const otools = {', `  ${block}\n\n  const otools = {`);
}
for (const [name, , factory] of factories) {
  const entry = `    ${name}: ${factory}({ invoke }),`;
  if (!output.includes(entry)) output = output.replace('  const otools = {', `  const otools = {\n${entry}`);
}
if (process.argv.includes('--check')) {
  if (output !== input) throw new Error('Plugin service injection is stale; run sync:service-injection with --host');
} else if (output !== input) writeFileSync(target, output);
