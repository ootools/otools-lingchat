/** Callback parameters never travel in a navigation URL or broadcast event. */
export interface PluginDeepLink {
  requestId: string;
  action: 'open' | 'panel' | 'detach' | 'callback';
  route: string | null;
  params: Record<string, string[]>;
}
export interface CallbackOptions {
  route: string;
  openMode?: 'panel' | 'tabs' | 'detach';
  ttlSeconds?: number;
}
export interface PluginCallback {
  url: string;
  state: string;
  expiresAt: number;
}
export interface DeepLinksApi {
  createCallback(options: CallbackOptions): Promise<PluginCallback>;
  cancelCallback(state: string): Promise<void>;
  onOpen(handler: (value: PluginDeepLink) => void | Promise<void>): Promise<() => void>;
}
export interface DeepLinkTransport {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: () => void): Promise<() => void>;
}
const identifier = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
const validEntry = (value: unknown): value is PluginDeepLink => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as PluginDeepLink;
  return typeof entry.requestId === 'string' && ['open', 'panel', 'detach', 'callback'].includes(entry.action)
    && (entry.route === null || typeof entry.route === 'string')
    && !!entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params)
    && Object.values(entry.params).every(values => Array.isArray(values) && values.every(value => typeof value === 'string'));
};

export function createDeepLinksApi(transport: DeepLinkTransport): DeepLinksApi {
  return {
    async createCallback(options) {
      if (!options || !identifier.test(options.route) || ['.', '..'].includes(options.route)
        || (options.openMode !== undefined && !['panel', 'tabs', 'detach'].includes(options.openMode))
        || (options.ttlSeconds !== undefined && (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 10 || options.ttlSeconds > 600))) {
        throw new Error('Invalid callback options');
      }
      return await transport.invoke('otools_host_deep_link_create_callback', { ...options }) as PluginCallback;
    },
    async cancelCallback(state) {
      if (typeof state !== 'string' || !identifier.test(state)) throw new Error('Invalid callback state');
      await transport.invoke('otools_host_deep_link_cancel_callback', { state });
    },
    async onOpen(handler) {
      let active = true;
      let busy = false;
      let again = false;
      const seen = new Set<string>();
      const consume = async () => {
        if (!active) return;
        if (busy) { again = true; return; }
        busy = true;
        try {
          do {
            again = false;
            const batch = await transport.invoke('otools_host_deep_link_consume');
            if (!active) return;
            if (Array.isArray(batch)) for (const value of batch) {
              if (!active) return;
              if (!validEntry(value) || seen.has(value.requestId)) continue;
              seen.add(value.requestId);
              if (seen.size > 128) seen.delete(seen.values().next().value!);
              await handler(value);
            }
          } while (again && active);
        } finally { busy = false; }
      };
      const unlisten = await transport.listen('otools:deep-link-ready', () => {
        // Do not print callback contents or transport failures with credentials.
        void consume().catch(() => {});
      });
      try { await consume(); } catch (error) { active = false; unlisten(); throw error; }
      return () => { if (active) { active = false; seen.clear(); unlisten(); } };
    },
  };
}
