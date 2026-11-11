// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import ProviderDataSection from './ProviderDataSection.vue';
const host = vi.hoisted(() => ({ lists: 0, afters: [] as string[], revoked: false }));
vi.mock('../host/bridge', () => ({
  getHost: () => ({ data: {
    list: async () => { host.lists++; return { items: [{ id: 'one', provider: { source: 'market', uuid: 'notes' }, type: 'notes.v1', revision: 1, updatedAt: 1, deleted: false, data: { title: 'First', body: 'old text' } }], next: null, after: 'snapshot-cursor' }; },
    changes: async ({ after }: { after: string }) => {
      host.afters.push(after);
      if (host.revoked) throw { code: 'permissionDenied' };
      return { items: [{ id: 'one', provider: { source: 'market', uuid: 'notes' }, type: 'notes.v1', revision: 2, updatedAt: 2, deleted: false, data: { title: 'Updated', body: 'new text' } }], after: 'next-cursor', hasMore: false };
    },
  } }),
  unavailable: (name: string) => new Error(name),
}));
let app: App | undefined;
async function settle() { for (let i = 0; i < 25; i++) { await Promise.resolve(); await nextTick(); } }
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); vi.useRealTimers(); host.lists = 0; host.afters = []; host.revoked = false; });
describe('shared provider snapshot and subscription', () => {
  it('uses the snapshot cursor for changes and clears content when access is revoked', async () => {
    vi.useFakeTimers();
    const disconnected = vi.fn();
    const root = document.createElement('div'); document.body.append(root);
    app = createApp(ProviderDataSection, { provider: { source: 'market', uuid: 'notes' }, type: 'notes.v1', t: (key: string) => key, onDisconnected: disconnected });
    app.mount(root); await settle();
    expect(root.textContent).toContain('old text');
    await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(host.afters).toEqual(['snapshot-cursor']);
    expect(root.textContent).toContain('new text');
    host.revoked = true; await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(root.textContent).not.toContain('new text');
    expect(disconnected).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(host.afters).toEqual(['snapshot-cursor', 'next-cursor']);
  });
});
