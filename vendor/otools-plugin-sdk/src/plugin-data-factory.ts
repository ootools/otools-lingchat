import type {
  PluginDataApi, PluginDataChangesPage, PluginDataErrorCode, PluginDataFailure, PluginDataTransport,
} from './plugin-data-types';
export type * from './plugin-data-types';

export class PluginDataError extends Error implements PluginDataFailure {
  constructor(public readonly code: PluginDataErrorCode, message: string) {
    super(message);
    this.name = 'PluginDataError';
  }
}
const codes: PluginDataErrorCode[] = ['permissionDenied', 'forbidden', 'conflict', 'deleted', 'resyncRequired', 'invalidCursor', 'invalidRequest', 'storageFailed', 'unavailable', 'unsupported', 'busy'];
function normalizeError(error: unknown): PluginDataError {
  if (error instanceof PluginDataError) return error;
  let value = error;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Plain transport error. */ } }
  const record = value && typeof value === 'object' ? value as Partial<PluginDataFailure> : undefined;
  const message = typeof record?.message === 'string' ? record.message : String(error);
  const code = record?.code && codes.includes(record.code) ? record.code
    : /unknown command|command .*not found|runtime.*unavailable|bridge.*unavailable/i.test(message) ? 'unsupported' : 'unavailable';
  return new PluginDataError(code, message);
}
function revision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new PluginDataError('invalidRequest', 'expectedRevision must be a non-negative safe integer');
}

/** Dependency-free client suitable for native SDK imports and host runtime injection. */
export function createPluginDataApi(transport: PluginDataTransport): PluginDataApi {
  const call = async <T>(method: string, request?: unknown): Promise<T> => {
    try { return await transport.invoke(`otools_host_plugin_data_${method}`, request === undefined ? undefined : { request }) as T; }
    catch (error) { throw normalizeError(error); }
  };
  const api: PluginDataApi = {
    discover: () => call('discover'),
    list: request => call('list', request),
    get: request => call('get', request),
    async put(request) { revision(request.expectedRevision); return call('put', request); },
    async remove(request) { revision(request.expectedRevision); return call('remove', request); },
    changes: request => call('changes', request),
    requestAccess: request => call('request_access', request),
    revokeAccess: request => call('revoke_access', request),
    subscribe(request, onChanges, options) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let after = request.after;
      // Copy the query so mutation of the caller's object cannot change cursor ownership.
      const query = { type: request.type, provider: request.provider ? { ...request.provider } : undefined, limit: request.limit };
      const interval = Math.max(250, Math.min(60_000, Number.isFinite(options.intervalMs) ? options.intervalMs! : 1000));
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', stop);
      };
      const poll = async () => {
        if (stopped) return;
        try {
          const page = await call<PluginDataChangesPage<never>>('changes', { ...query, after });
          if (stopped) return;
          if (!page || typeof page.after !== 'string' || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
            || (page.hasMore && page.after === after)) {
            throw new PluginDataError('unavailable', 'Host returned an invalid changes page');
          }
          after = page.after;
          await onChanges(page);
          if (!stopped) timer = setTimeout(() => { void poll(); }, page.hasMore ? 0 : interval);
        } catch (error) {
          if (stopped) return;
          stop();
          try { options.onError(normalizeError(error)); } catch { /* An error callback must not leave polling alive. */ }
        }
      };
      options.signal?.addEventListener('abort', stop, { once: true });
      if (options.signal?.aborted) stop();
      else void poll();
      return stop;
    },
  };
  return api;
}
