// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import * as built from '../../vendor/otools-plugin-sdk/dist/tauri-window-shim.js';

afterEach(() => Reflect.deleteProperty(window, '__TAURI_INTERNALS__'));
it('the distributed SDK returns usable physical cursor coordinates rather than a window handle', async () => {
  const calls: string[] = [];
  Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string) => { calls.push(command); return { x: -321, y: 456 }; } } });
  const cursor = await built.cursorPosition();
  expect(cursor).toMatchObject({ x: -321, y: 456 });
  expect(cursor.toLogical(2)).toMatchObject({ x: -160.5, y: 228 });
  expect(calls).toEqual(['plugin:window|cursor_position']);
});
