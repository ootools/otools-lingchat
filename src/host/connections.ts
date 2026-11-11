import { invoke } from '@tauri-apps/api/core';
import type { ProviderIdentity } from './providers';

export interface DiscoveredProvider { provider: ProviderIdentity; types: string[] }
export interface ConsentStatus { id?: string; status: string; expiresAt?: number }
export interface ConnectionItem { provider: ProviderIdentity; type: string }
export interface ConnectionsDataApi {
  discover(): Promise<DiscoveredProvider[]>;
  list(request: { provider: ProviderIdentity; type: string; limit?: number; cursor?: string }): Promise<unknown>;
  requestAccess(request: { provider: ProviderIdentity; type: string; subscribe?: boolean; scope?: { kind: 'all' } }): Promise<ConsentStatus>;
  requestAccessBatch?(request: { items: Array<ConnectionItem & { subscribe: boolean; scope: { kind: 'all' } }> }): Promise<ConsentStatus>;
  accessStatus?(request: { id: string }): Promise<ConsentStatus>;
  revokeAccess(request: { provider: ProviderIdentity; type: string }): Promise<unknown>;
}
export type GrantState = 'connected' | 'unauthorized';
export type ConnectResult = 'granted' | 'pending';
export interface ConnectionRow { provider: ProviderIdentity; types: string[]; name: string }

/** A successful read proves the grant; broker denial proves its absence.
 *  Transport failures must surface instead of silently dropping access. */
export async function probeGrantState(data: Pick<ConnectionsDataApi, 'list'>, provider: ProviderIdentity, type: string): Promise<GrantState> {
  try { await data.list({ provider, type, limit: 1 }); return 'connected'; }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'permissionDenied' || code === 'forbidden') return 'unauthorized';
    throw error;
  }
}

/** uuid → display name from the host plugin registry (old hosts fall back to uuid). */
export async function listPluginNames(): Promise<Record<string, string>> {
  const plugins = await invoke<Array<{ uuid?: string; packid?: string; displayName?: string; displayNameCN?: string }>>('otools_get_all_plugins');
  const names: Record<string, string> = {};
  for (const plugin of Array.isArray(plugins) ? plugins : []) {
    const id = typeof plugin?.uuid === 'string' ? plugin.uuid : typeof plugin?.packid === 'string' ? plugin.packid : '';
    if (!id) continue;
    names[id] = plugin.displayNameCN || plugin.displayName || id;
  }
  return names;
}

function validateConsent(value: ConsentStatus): ConsentStatus {
  if (!value || !['granted', 'pending', 'denied', 'cancelled', 'expired'].includes(value.status)) {
    throw new Error('Host returned an invalid data consent status');
  }
  return value;
}

export function createConnectionsController(deps: { data: ConnectionsDataApi; pluginNames?: () => Promise<Record<string, string>> }) {
  const names = deps.pluginNames ?? listPluginNames;
  return {
    async discover(): Promise<ConnectionRow[]> {
      const discovered = await deps.data.discover();
      let nameMap: Record<string, string> = {};
      try { nameMap = await names(); } catch { /* uuid fallback keeps old hosts usable. */ }
      const rows = discovered.map(row => ({ ...row, name: nameMap[row.provider.uuid] || row.provider.uuid }));
      // Dev and market copies share one uuid; disambiguate duplicate display names.
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.provider.uuid, (counts.get(row.provider.uuid) ?? 0) + 1);
      return rows.map(row => counts.get(row.provider.uuid)! > 1 ? { ...row, name: `${row.name} · ${row.provider.source}` } : row);
    },
    probeGrantState: (provider: ProviderIdentity, type: string) => probeGrantState(deps.data, provider, type),
    async connect(provider: ProviderIdentity, type: string): Promise<ConnectResult> {
      const result = validateConsent(await deps.data.requestAccess({ provider, type, subscribe: true, scope: { kind: 'all' } }));
      if (result.status !== 'granted' && result.status !== 'pending') throw new Error('Data consent was not granted');
      return result.status;
    },
    async connectBatch(items: ConnectionItem[]): Promise<ConsentStatus> {
      if (!items.length || items.length > 32) throw new Error('Select between one and 32 data connections');
      if (deps.data.requestAccessBatch) {
        return validateConsent(await deps.data.requestAccessBatch({ items: items.map(item => ({ ...item, scope: { kind: 'all' }, subscribe: true })) }));
      }
      if (items.length !== 1) throw new Error('Update Otools to approve multiple data connections together');
      const item = items[0];
      return validateConsent(await deps.data.requestAccess({ ...item, scope: { kind: 'all' }, subscribe: true }));
    },
    async accessStatus(id: string): Promise<ConsentStatus> {
      if (!deps.data.accessStatus) throw new Error('Update Otools to track data approval');
      return validateConsent(await deps.data.accessStatus({ id }));
    },
    async disconnect(provider: ProviderIdentity, type: string): Promise<GrantState> {
      await deps.data.revokeAccess({ provider, type });
      return 'unauthorized';
    },
  };
}
