import type { CaptureImage } from './capture-factory';
export type ObservationTarget = { kind: 'screen'; displayId: string } | { kind: 'window'; windowId: string };
export interface ObservationTargets {
  screens: Array<{ id: string; name: string }>;
  windows: Array<{ id: string; title: string; appName: string }>;
}
export interface ObservationStatus {
  id: string; state: 'pending' | 'active' | 'stopped'; target: ObservationTarget; intervalMs: number; reason?: string;
}
export interface ObservationRequest { target: ObservationTarget; intervalMs?: number }
export interface ObservationTransport { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
export interface ObservationApi {
  /** Enumerates native metadata only. Does not capture or request consent. */
  targets(): Promise<ObservationTargets>;
  /** Opens trusted host consent; returns pending. Plugins cannot approve it. */
  request(options: ObservationRequest): Promise<ObservationStatus>;
  status(options: { id: string }): Promise<ObservationStatus>;
  /** Returns a lease; release it using capture.release after use. No timer is started. */
  capture(options: { id: string }): Promise<CaptureImage>;
  stop(options: { id: string }): Promise<void>;
}
export class ObservationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ObservationError'; }
}
function normalize(error: unknown): ObservationError {
  if (error instanceof ObservationError) return error;
  let value = error;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Plain IPC error. */ } }
  const record = value && typeof value === 'object' ? value as { code?: string; message?: string } : undefined;
  return new ObservationError(record?.code ?? 'unsupported', record?.message ?? String(error));
}
function invalid(): never { throw new ObservationError('invalidRequest', 'Provide an explicit target and a sampling interval of at least 30000 ms'); }
function checkId(id: string) { if (typeof id !== 'string' || !id || id.length > 128) invalid(); }
function checkStatus(value: ObservationStatus, id?: string): ObservationStatus {
  if (!value || typeof value.id !== 'string' || (id && value.id !== id) || !['pending', 'active', 'stopped'].includes(value.state)) {
    throw new ObservationError('invalidResponse', 'Invalid observation status');
  }
  return value;
}
/** Dependency-free factory also suitable for the host's plain-webview injection. */
export function createObservationApi(transport: ObservationTransport): ObservationApi {
  const pending = new Map<string, { cancelled: boolean }>();
  const call = async <T>(method: string, args?: Record<string, unknown>): Promise<T> => {
    try { return await transport.invoke(`otools_host_observation_${method}`, args) as T; }
    catch (error) { throw normalize(error); }
  };
  const status = async ({ id }: { id: string }) => {
    checkId(id);
    const value = checkStatus(await call<ObservationStatus>('status', { id }), id);
    if (value.state === 'stopped') { const task = pending.get(id); if (task) task.cancelled = true; }
    return value;
  };
  return {
    targets: () => call('targets'),
    async request(options) {
      const target = options?.target;
      const targetId = target?.kind === 'screen' ? target.displayId : target?.kind === 'window' ? target.windowId : undefined;
      const intervalMs = options?.intervalMs ?? 60_000;
      if (typeof targetId !== 'string' || !/^[1-9]\d{0,9}$/.test(targetId) || Number(targetId) > 0xffffffff
        || !Number.isSafeInteger(intervalMs) || intervalMs < 30_000 || intervalMs > 3_600_000) invalid();
      return checkStatus(await call<ObservationStatus>('request', { options: { target, intervalMs } }));
    },
    status,
    async capture({ id }) {
      checkId(id);
      if (pending.has(id) || pending.size >= 32) throw new ObservationError('busy', 'An observation capture is already in progress');
      const task = { cancelled: false }; pending.set(id, task);
      let image: CaptureImage | undefined;
      let delivered = false;
      try {
        image = await call<CaptureImage>('capture', { id });
        if (!image || typeof image.imageId !== 'string' || !image.imageId || image.imageId.length > 128
          || image.mimeType !== 'image/png' || !Number.isSafeInteger(image.width) || image.width <= 0
          || !Number.isSafeInteger(image.height) || image.height <= 0 || image.width * image.height > 64_000_000
          || !Number.isFinite(image.expiresAt)) throw new ObservationError('invalidResponse', 'Invalid observation image');
        if (task.cancelled || (await status({ id })).state !== 'active' || task.cancelled) {
          throw new ObservationError('stopped', 'Observation stopped before capture delivery');
        }
        delivered = true;
        return image;
      } finally {
        pending.delete(id);
        if (!delivered && typeof image?.imageId === 'string' && image.imageId.length <= 128) {
          try { await transport.invoke('otools_host_capture_release', { imageId: image.imageId }); } catch { /* Host also revokes its lease on stop. */ }
        }
      }
    },
    async stop({ id }) {
      checkId(id);
      const task = pending.get(id); if (task) task.cancelled = true;
      await call('stop', { id });
    },
  };
}
