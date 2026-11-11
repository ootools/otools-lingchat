// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

let component: any; let app: App | undefined;
beforeAll(async () => { history.replaceState(null, '', '/?preview=1'); component = (await import('./App.vue')).default; });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; });
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick(); }
function button(label: string) { return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
it('shows an opt-in Agent switch and actionable missing-host guidance in expanded chat', async () => {
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(component); app.mount(root); await settle();
  const mode = document.querySelector<HTMLInputElement>('.agent-mode input')!;
  expect(mode).not.toBeNull(); expect(mode.checked).toBe(false);
  mode.click(); await settle();
  expect(document.querySelector('.agent-controls')?.textContent).toContain('更新 Otools');
  expect(document.querySelector('.agent-controls')?.textContent).toContain('管理引擎');
});
