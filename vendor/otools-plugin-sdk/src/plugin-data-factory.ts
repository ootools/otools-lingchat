import type {
  PluginDataAccessRequest, PluginDataApi, PluginDataChangesPage, PluginDataErrorCode, PluginDataFailure, PluginDataTransport,
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
function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= 256
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function accessItems(items: PluginDataAccessRequest[]): PluginDataAccessRequest[] {
  const seen = new Set<string>();
  return items.map(item => {
    if (!item || !item.provider || !validName(item.provider.source) || !validName(item.provider.uuid)
      || [item.provider.source, item.provider.uuid].some(value => value.trim() !== value || /[A-Z]/.test(value))
      || !validName(item.type) || (item.subscribe !== undefined && typeof item.subscribe !== 'boolean')) {
      throw new PluginDataError('invalidRequest', 'Access items require a canonical provider, resource type and optional boolean subscribe');
    }
    if (item.scope !== undefined && (!item.scope || (item.scope.kind !== 'all' && item.scope.kind !== 'ids')
      || (item.scope.kind === 'ids' && (!Array.isArray(item.scope.ids) || !item.scope.ids.length
        || item.scope.ids.length > 256 || ![...item.scope.ids].every(validName))))) {
      throw new PluginDataError('invalidRequest', 'Access scope must be all or contain 1..256 valid IDs');
    }
    const key = JSON.stringify([item.provider.source, item.provider.uuid, item.type]);
    if (seen.has(key)) throw new PluginDataError('invalidRequest', 'Duplicate access item');
    seen.add(key);
    return {
      provider: { source: item.provider.source, uuid: item.provider.uuid },
      type: item.type,
      ...(item.scope ? { scope: item.scope.kind === 'ids' ? { kind: 'ids' as const, ids: [...item.scope.ids] } : { kind: 'all' as const } } : {}),
      ...(item.subscribe !== undefined ? { subscribe: item.subscribe } : {}),
    };
  });
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
    async requestAccessBatch(request) {
      if (!request || !Array.isArray(request.items) || !request.items.length || request.items.length > 32) {
        throw new PluginDataError('invalidRequest', 'Access bundles contain 1..32 explicit items');
      }
      return call('request_access_batch', { items: accessItems(request.items) });
    },
    accessStatus: request => call('access_status', { id: request.id }),
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
