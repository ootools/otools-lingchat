import type { ReminderApi, ReminderConfigureRequest, ReminderItem, ReminderProvider, ReminderStatus, ReminderTransport } from './reminder-types';
export * from './reminder-types';

export class ReminderError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ReminderError'; }
}
function normalize(error: unknown): ReminderError {
  if (error instanceof ReminderError) return error;
  let value = error;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Plain IPC error. */ } }
  const record = value && typeof value === 'object' ? value as {code?: string; message?: string} : undefined;
  return new ReminderError(typeof record?.code === 'string' ? record.code : 'unsupported', typeof record?.message === 'string' ? record.message : String(error));
}
function invalid(): never { throw new ReminderError('invalidRequest', 'Provide a provider, data type, enabled flag and valid reminder settings'); }
function invalidResponse(): never { throw new ReminderError('invalidResponse', 'Invalid reminder response'); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === 'string' && [...value].length <= maximum; }
function timestamp(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function provider(value: unknown): value is ReminderProvider {
  const item = value as ReminderProvider | undefined;
  return !!item && bounded(item.source,64) && !!item.source && bounded(item.uuid,128) && !!item.uuid;
}
function validSettings(value: ReminderConfigureRequest): boolean {
  return !!value && provider(value.provider) && bounded(value.type,128) && !!value.type && typeof value.enabled === 'boolean'
    && (value.cooldownMs === undefined || Number.isSafeInteger(value.cooldownMs) && value.cooldownMs >= 30_000 && value.cooldownMs <= 86_400_000)
    && (value.quietHours === undefined || !!value.quietHours && Number.isInteger(value.quietHours.start) && Number.isInteger(value.quietHours.end)
      && value.quietHours.start >= 0 && value.quietHours.start < 1440 && value.quietHours.end >= 0 && value.quietHours.end < 1440);
}
function checkStatus(value: unknown): ReminderStatus {
  const item = value as ReminderStatus;
  if (!validSettings(item) || typeof item.cooldownMs !== 'number' || typeof item.available !== 'boolean'
    || item.lastCheckedAt !== undefined && !timestamp(item.lastCheckedAt)
    || item.lastDeliveredAt !== undefined && !timestamp(item.lastDeliveredAt)) invalidResponse();
  return item;
}
function checkItem(value: unknown): ReminderItem {
  const item = value as ReminderItem;
  if (!item || !/^[a-f0-9]{64}$/.test(item.id) || !provider(item.provider) || !bounded(item.type,128) || !item.type
    || !bounded(item.resourceId,1024) || !item.resourceId || !timestamp(item.dueAt) || !timestamp(item.deliveredAt)
    || !bounded(item.title,120) || !bounded(item.body,500)) invalidResponse();
  return item;
}

/** Dependency-free host IPC factory. Scheduling belongs to the running host;
 * this API never creates a webview timer, grants access, or interprets note text. */
export function createReminderApi(transport: ReminderTransport): ReminderApi {
  const call = async (method: string, args?: Record<string, unknown>): Promise<unknown> => {
    try { return await transport.invoke(`otools_host_plugin_reminders_${method}`,args); }
    catch (error) { throw normalize(error); }
  };
  return {
    async configure(options) {
      if (!validSettings(options)) invalid();
      // Explicit projection prevents caller-supplied owner identities from being
      // forwarded. The host captures its source-aware native plugin identity.
      const request: ReminderConfigureRequest = {provider:{source:options.provider.source,uuid:options.provider.uuid},type:options.type,enabled:options.enabled};
      if (options.quietHours !== undefined) request.quietHours = {start:options.quietHours.start,end:options.quietHours.end};
      if (options.cooldownMs !== undefined) request.cooldownMs = options.cooldownMs;
      return checkStatus(await call('configure',{request}));
    },
    async status() {
      const result = await call('status');
      if (!Array.isArray(result) || result.length > 16) invalidResponse();
      return result.map(checkStatus);
    },
    async pending() {
      const result = await call('pending');
      if (!Array.isArray(result) || result.length > 20) invalidResponse();
      return result.map(checkItem);
    },
    async acknowledge(ids) {
      if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) invalid();
      await call('acknowledge',{ids:[...ids]});
    },
  };
}
