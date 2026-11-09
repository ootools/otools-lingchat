import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

// Run in the host checkout. The generated block is checked in because Rust embeds
// this file with include_str! before any browser module loader is available.
const source = readFileSync(new URL('../src/capture-factory.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^export (?=(?:class|function|const) )/gm, '');
const target = process.env.OTOOLS_HOST_ROOT
  ? `${process.env.OTOOLS_HOST_ROOT}/src/platform/runtime/otools/embedded-runtime.js`
  : new URL('../../../src/platform/runtime/otools/embedded-runtime.js', import.meta.url);
const input = readFileSync(target, 'utf8');
const begin = '// BEGIN GENERATED CAPTURE FACTORY\n';
const end = '// END GENERATED CAPTURE FACTORY';
const block = `${begin}${compiled}${end}`;
const output = input.includes(begin)
  ? input.slice(0, input.indexOf(begin)) + block + input.slice(input.indexOf(end) + end.length)
  : input.replace('  const otools = {', `  ${block}\n\n  const otools = {`);
if (process.argv.includes('--check')) {
  if (output !== input) throw new Error('Capture injection is stale; run pnpm sync:capture-injection in the SDK checkout');
} else if (output !== input) writeFileSync(target, output);
