import type { AiApi, AiCapabilities, AiMediaChannel, AiModelCatalog, AiReadResult, AiSelection, AiTransport } from './ai-types';
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

function normalizeSelection(value: AiSelection): AiSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError('invalidSettings');
  const field = (input: unknown, maxLength: number): string | null => {
    if (input === null) return null;
    if (typeof input !== 'string' || input.length > maxLength || !input.trim()) throw new AiError('invalidSettings');
    return input.trim();
  };
  // Only selection fields cross IPC. Allowed IDs and efforts are validated by the host.
  return { model: field(value.model, 512), reasoningEffort: field(value.reasoningEffort, 64) };
}

function mediaRequest(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError('invalidRequest');
  const request = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter(field => request[field] !== undefined).map(field => [field, request[field]]));
}

/** Dependency-free factory for both the SDK runtime and the injected window API. */
export function createAiApi(transport: AiTransport): AiApi {
  const call = async <T>(method: string, args?: Record<string, unknown>): Promise<T> => {
    try { return await transport.invoke(`otools_host_ai_${method}`, args) as T; }
    catch (error) { throw normalizeError(error); }
  };
  const mediaCall = async <T>(command: string, request: unknown): Promise<T> => {
    try { return await transport.invoke(command, { request }) as T; }
    catch (error) { throw normalizeError(error); }
  };
  const mediaSaves = new Map<AiMediaChannel, Promise<{ model: string | null }>>();
  const mediaExecute = async <T>(channel: AiMediaChannel, command: string, request: Record<string, unknown>): Promise<T> => {
    for (;;) {
      const saving = mediaSaves.get(channel); await saving;
      const model = request.model ?? (await call<{ model: string | null }>('media_get_settings', { channel })).model;
      if (saving !== mediaSaves.get(channel)) continue;
      if (typeof model !== 'string' || !model.trim()) throw new AiError('modelNotSelected');
      return mediaCall(command, { ...request, model });
    }
  };
  const api: AiApi = {
    media: {
      models: ({ channel }) => call('media_models', { channel }),
      getSettings: ({ channel }) => call('media_get_settings', { channel }),
      saveSettings: async ({ channel, model }) => {
        const normalized = normalizeSelection({ model, reasoningEffort: null }).model;
        const previous = mediaSaves.get(channel);
        const saved = (async () => { await previous?.catch(() => {}); return call<{ model: string | null }>('media_save_settings', { channel, model: normalized }); })();
        mediaSaves.set(channel, saved); void saved.catch(() => {});
        return saved;
      },
      images: request => mediaExecute('images', 'otools_ai_images', mediaRequest(request, ['prompt', 'model', 'size', 'n'])),
      speech: request => mediaExecute('tts', 'otools_ai_speech', mediaRequest(request, ['input', 'model', 'voice', 'responseFormat', 'speed'])),
      transcribe: request => mediaExecute('stt', 'otools_ai_transcribe', mediaRequest(request, ['audioBase64', 'filename', 'model', 'language'])),
      embeddings: request => mediaExecute('embeddings', 'otools_ai_embeddings', mediaRequest(request, ['input', 'model'])),
      videoSubmit: request => mediaExecute('video', 'otools_ai_video_submit', mediaRequest(request, ['prompt', 'model', 'image', 'duration', 'fps', 'width', 'height', 'seed', 'metadata'])),
      videoStatus: request => mediaCall('otools_ai_video_status', mediaRequest(request, ['taskId', 'refresh'])),
      videoContent: request => mediaCall('otools_ai_video_content', mediaRequest(request, ['taskId'])),
    },
    capabilities: () => call<AiCapabilities>('capabilities'),
    models: () => call<AiModelCatalog>('models'),
    getSettings: () => call<AiSelection>('get_settings'),
    saveSettings: async settings => call<AiSelection>('save_settings', { settings: normalizeSelection(settings) }),
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
            // Capabilities describe the default model, not an explicit alternative.
            // Unknown vision metadata must not be interpreted as unsupported.
            const usesDefaultModel = !request.model || request.model === capability.model;
            if (usesDefaultModel && capability.vision === 'unsupported' && request.messages.some(message => message.content.some(part => part.type === 'image'))) {
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
