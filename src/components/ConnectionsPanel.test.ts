// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import ConnectionsPanel from './ConnectionsPanel.vue';

const host = vi.hoisted(() => ({ granted: false, status: 'pending', batches: [] as unknown[], reads: 0, failGrantedRead: false }));
vi.mock('../host/bridge', () => ({
  getHost: () => ({ data: {
    discover: async () => [{ provider: { source: 'market', uuid: 'notes' }, types: ['notes.v1'] }],
    list: async () => {
      if (!host.granted) throw { code: 'permissionDenied' };
      if (host.failGrantedRead) throw { code: 'unavailable' };
      return { items: [] };
    },
    requestAccess: async () => ({ status: 'pending' }),
    requestAccessBatch: async (request: unknown) => { host.batches.push(request); return { id: 'consent-1', status: 'pending', expiresAt: Date.now() + 300000 }; },
    accessStatus: async () => ({ id: 'consent-1', status: host.status, expiresAt: Date.now() + 300000 }),
    revokeAccess: async () => { host.granted = false; },
  } }),
  unavailable: (name: string) => new Error(name),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => [{ uuid: 'notes', displayName: 'Notes' }] }));
vi.mock('./ProviderDataSection.vue', () => ({ default: { mounted() { host.reads++; }, template: '<section data-provider-content>Shared content</section>' } }));
let app: App | undefined;
async function settle() { for (let i = 0; i < 25; i++) { await Promise.resolve(); await nextTick(); } }
async function mount() {
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(ConnectionsPanel, { t: (key: string) => key }); app.mount(root); await settle();
  return root;
}
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); vi.useRealTimers(); host.granted = false; host.status = 'pending'; host.batches = []; host.reads = 0; host.failGrantedRead = false; });

describe('one-click plugin connections', () => {
  it('waits for approval without showing connected content, and stops after denial', async () => {
    vi.useFakeTimers();
    const root = await mount();
    root.querySelector<HTMLButtonElement>('[data-connect-selected]')!.click(); await settle();
    expect(host.batches).toEqual([{ items: [{ provider: { source: 'market', uuid: 'notes' }, type: 'notes.v1', scope: { kind: 'all' }, subscribe: true }] }]);
    expect(root.textContent).toContain('waitingConsent'); expect(host.reads).toBe(0);
    host.status = 'denied'; await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(root.textContent).toContain('connectionDenied'); expect(root.textContent).not.toContain('waitingConsent');
    expect(root.querySelector<HTMLButtonElement>('[data-connect-selected]')!.disabled).toBe(false);
  });
  it('retries a temporary read failure after approval instead of getting stuck pending', async () => {
    vi.useFakeTimers();
    const root = await mount();
    root.querySelector<HTMLButtonElement>('[data-connect-selected]')!.click(); await settle();
    host.status = 'granted'; host.granted = true; host.failGrantedRead = true;
    await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(host.reads).toBe(0);
    host.failGrantedRead = false;
    await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(host.reads).toBe(1);
    expect(root.textContent).not.toContain('waitingConsent');
  });
  it('renders data only after the host grants access and the read probe succeeds', async () => {
    vi.useFakeTimers();
    const root = await mount();
    root.querySelector<HTMLButtonElement>('[data-connect-selected]')!.click(); await settle();
    host.status = 'granted'; host.granted = true; await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(host.reads).toBe(1); expect(root.querySelector('[data-provider-content]')).not.toBeNull();
  });
});
