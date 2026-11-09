import type { AiApi, AiCapabilities, AiEvent, AiReadResult, AiTransport } from './ai-types';
export type * from './ai-types';

export class AiError extends Error {
  constructor(public readonly code: string, message = code) { super(message); this.name = 'AiError'; }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new AiError(error);
  const value = error as { code?: unknown; message?: unknown } | null;
  return new AiError(typeof value?.code === 'string' ? value.code : 'transportFailed', typeof value?.message === 'string' ? value.message : undefined);
}

function validateBatch(value: AiReadResult, id: string, after: number): void {
  const invalid = () => { throw new AiError('invalidResponse'); };
  if (!value || value.id !== id || !Array.isArray(value.events) || value.events.length > 256 || typeof value.done !== 'boolean') invalid();
  let terminal = false;
  let bytes = 0;
  for (const event of value.events) {
    if (!event || !Number.isSafeInteger(event.sequence) || event.sequence !== ++after || terminal) invalid();
    switch (event.type) {
      case 'delta':
        if (typeof event.text !== 'string') invalid();
        bytes += event.text.length;
        if (bytes > 256 * 1024) invalid();
        break;
      case 'error':
        if (typeof event.error !== 'string') invalid();
        terminal = true;
        break;
      case 'done': case 'cancelled': terminal = true; break;
      default: invalid();
    }
  }
  if (value.done !== terminal) invalid();
}

/** Dependency-free factory for both the SDK runtime and the injected window API. */
export function createAiApi(transport: AiTransport): AiApi {
  const call = async <T>(method: string, args?: Record<string, unknown>): Promise<T> => {
    try { return await transport.invoke(`otools_host_ai_${method}`, args) as T; }
    catch (error) { throw normalizeError(error); }
  };
  const api: AiApi = {
    capabilities: () => call<AiCapabilities>('capabilities'),
    start: request => call('start', { request }),
    read: options => call('read', options),
    cancel: options => call('cancel', options),
    consume(request, options = {}) {
      return new Promise((resolve, reject) => {
        let done = false;
        let id: string | undefined;
        let after = 0;
        let text = '';
        let timer: ReturnType<typeof setTimeout> | undefined;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const cancel = (job: string) => { void api.cancel({ id: job }).catch(() => {}); };
        const cleanup = () => {
          clearTimeout(timer); clearTimeout(deadline);
          options.signal?.removeEventListener('abort', abort);
        };
        const fail = (error: unknown) => {
          if (done) return;
          done = true; cleanup();
          if (id) cancel(id);
          reject(normalizeError(error));
        };
        const abort = () => fail(new AiError('cancelled'));
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) { abort(); return; }
        deadline = setTimeout(() => fail(new AiError('timeout')), 10 * 60 * 1000);
        const interval = Number.isFinite(options.pollIntervalMs) ? Math.max(0, Math.min(10_000, options.pollIntervalMs!)) : 100;
        const poll = async () => {
          if (done || !id) return;
          try {
            const batch = await api.read({ id, after });
            if (done) return;
            validateBatch(batch, id, after);
            for (const event of batch.events) {
              after = event.sequence;
              if (event.type === 'delta') {
                text += event.text;
                if (text.length > 4 * 1024 * 1024) throw new AiError('responseTooLarge');
              }
              options.onEvent?.(event);
              if (done) return;
              if (event.type === 'error') throw new AiError(event.error);
              if (event.type === 'cancelled') throw new AiError('cancelled');
            }
            if (batch.done) {
              done = true; cleanup();
              // Drop retained plaintext promptly; do not make completed output wait
              // for a second IPC round trip. Host TTL is the fallback for failed ack.
              void api.read({ id, after }).catch(() => {});
              resolve({ id, text });
            } else timer = setTimeout(() => { void poll(); }, interval);
          } catch (error) { fail(error); }
        };
        void (async () => {
          try {
            const capability = await api.capabilities();
            if (done) return;
            if (!capability?.configured) throw new AiError('notConfigured');
            if (!capability.streaming || !capability.cancellation) throw new AiError('unsupported');
            // Unknown vision metadata must not be interpreted as unsupported.
            if (capability.vision === 'unsupported' && request.messages.some(message => message.content.some(part => part.type === 'image'))) {
              throw new AiError('visionUnsupported');
            }
            const started = await api.start(request);
            if (!started || typeof started.id !== 'string' || !started.id) throw new AiError('invalidResponse');
            id = started.id;
            if (done) { cancel(id); return; }
            void poll();
          } catch (error) { fail(error); }
        })();
      });
    },
  };
  return api;
}
