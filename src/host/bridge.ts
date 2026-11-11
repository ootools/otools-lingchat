import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import type { HostAi } from '../dialogue/session';
import type { ObservationApi } from './observation';
import type { AiApi } from 'otools-plugin-sdk/ai-factory';
import type { AgentApi } from './agent';

export interface CompanionHost {
  agent?: AgentApi;
  ai?: HostAi & Partial<Pick<AiApi, 'capabilities' | 'models' | 'getSettings' | 'saveSettings'>>;
  observation?: ObservationApi;
  capture?: { release(id: string): Promise<void>; capabilities?(): Promise<unknown> };
  data?: Record<string, (...args: any[]) => Promise<any>>;
  reminders?: Record<string, (...args: any[]) => Promise<any>>;
  getLocale?: () => string | Promise<string>;
  readHostFile?: (path: string) => Promise<{ name: string; dataBase64: string }>;
  hostReadFile?: (path: string) => Promise<{ name: string; dataBase64: string }>;
  writeHostFile?: (request: { path: string; dataBase64: string }) => Promise<void>;
}
export function getHost(): CompanionHost | undefined {
  return (window as unknown as { otools?: CompanionHost }).otools;
}
export function isExplicitPreview(search: string): boolean { return new URLSearchParams(search).get('preview') === '1'; }
export const preview = isExplicitPreview(window.location.search);
export function unavailable(name: string): Error { return new Error(`宿主尚未提供 ${name}。请从已更新的 Otools 打开灵伴。`); }
export const hostAi: HostAi = {
  async consume(request, options) {
    const api = getHost()?.ai;
    if (api) return api.consume(request, options);
    if (!preview) throw unavailable('AI 服务');
    const text = '【开心】今天也很高兴见到你。慢慢来，我会陪着你，把眼前的小事一件件做好。';
    let visible = '';
    for (const part of Array.from(text)) {
      await new Promise<void>((resolve, reject) => {
        if (options.signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
        const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
        const timer = setTimeout(() => { options.signal?.removeEventListener('abort', cancel); resolve(); }, 28);
        options.signal?.addEventListener('abort', cancel, { once: true });
      });
      visible += part; options.onEvent?.({ sequence: visible.length, type: 'delta', text: part });
    }
    return { id: 'local-preview', text };
  },
};
export async function chooseFile(extensions: string[]): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (preview && !getHost()) return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = extensions.map(v => `.${v}`).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
      input.remove();
    };
    input.oncancel = () => { resolve(null); input.remove(); };
    input.click();
  });
  const host = getHost(); const read = host?.readHostFile ?? host?.hostReadFile;
  if (!read) throw unavailable('文件读取');
  const path = await open({ multiple: false, filters: [{ name: extensions.join(', '), extensions }] });
  if (!path || Array.isArray(path)) return null;
  const file = await read.call(host, path);
  const binary = atob(file.dataBase64); return { name: file.name, bytes: Uint8Array.from(binary, char => char.charCodeAt(0)) };
}
export async function exportFile(name: string, text: string): Promise<boolean> {
  if (preview && !getHost()) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
  }
  const host = getHost(); if (!host?.writeHostFile) throw unavailable('文件写入');
  const path = await save({ defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path) return false;
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  await host.writeHostFile({ path, dataBase64: btoa(binary) }); return true;
}
export async function confirmAction(message: string): Promise<boolean> {
  return preview && !getHost() ? window.confirm(message) : confirm(message, { kind: 'warning' });
}
export const nativeWindow = {
  async drag() { if (!preview) await getCurrentWindow().startDragging(); },
  async topmost(value: boolean) { if (!preview) await getCurrentWindow().setAlwaysOnTop(value); },
  async resize(expanded: boolean) { if (!preview) await getCurrentWindow().setSize(new LogicalSize(expanded ? 1100 : 360, expanded ? 760 : 520)); },
  async close() { if (!preview) await getCurrentWindow().close(); },
};
