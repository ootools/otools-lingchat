import type { AgentApi, AgentConsumeOptions, AgentConsumeResult, AgentEvent, AgentOpenSessionRequest, AgentReadOptions, AgentReadResult, AgentResumeOptions, AgentResumeResult, AgentStartRequest, AgentTransport } from './agent-types';
export type * from './agent-types';

export class AgentError extends Error {
  constructor(public readonly code: string, message = code) { super(message); this.name = 'AgentError'; }
}

const MAX_TEXT = 4 * 1024 * 1024;
const MAX_BATCH = 256 * 1024;
const MAX_EVENTS = 100_000;
const terminalTypes = new Set(['done', 'cancelled', 'error']);

function normalizeError(error: unknown): Error {
  if (error instanceof AgentError) return error;
  const value = error as { code?: unknown; message?: unknown } | null;
  const message = typeof error === 'string' ? error : typeof value?.message === 'string' ? value.message : 'Agent transport failed';
  if (typeof value?.code === 'string') return new AgentError(value.code, message);
  if (/(unknown command|command.*not found|not implemented|agent.*unavailable)/i.test(message)) return new AgentError('unavailable', message);
  if (error instanceof Error) return error;
  return new AgentError(typeof error === 'string' ? error : 'transportFailed', message);
}
function invalid(): never { throw new AgentError('invalidRequest'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 512, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) invalid();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function optional(target: Record<string, unknown>, source: Record<string, unknown>, key: string, validate: (value: unknown) => unknown = string): void {
  if (source[key] !== undefined) target[key] = validate(source[key]);
}
function one(value: unknown, key: string): Record<string, unknown> {
  return { [key]: string(record(value)[key]) };
}
function readOptions(value: unknown): { id: string; after: number } {
  const input = record(value);
  return { id: string(input.id), after: input.after === undefined ? 0 : integer(input.after, 0, Number.MAX_SAFE_INTEGER) };
}
function relativePath(value: unknown, root = false): string {
  const path = string(value, 4096, root);
  if ((root && (path === '' || path === '.'))) return path;
  if (/^[\\/]|[\\:]|[\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) invalid();
  return path;
}
function openRequest(value: unknown): AgentOpenSessionRequest {
  const input = record(value);
  const out: Record<string, unknown> = { providerId: string(input.providerId) };
  for (const key of ['clientSessionId', 'workspaceId']) optional(out, input, key);
  optional(out, input, 'instructions', value => string(value, 1024 * 1024, true));
  optional(out, input, 'sandbox', value => { if (value !== 'read-only' && value !== 'workspace-write') invalid(); return value; });
  for (const key of ['network', 'background']) optional(out, input, key, boolean);
  optional(out, input, 'tools', value => {
    if (!Array.isArray(value) || value.length > 128) invalid();
    return value.map(item => string(item));
  });
  return out as unknown as AgentOpenSessionRequest;
}
function startRequest(value: unknown): AgentStartRequest {
  const input = record(value);
  const out: Record<string, unknown> = { sessionId: string(input.sessionId), prompt: string(input.prompt, 1024 * 1024) };
  for (const key of ['model', 'requestId']) optional(out, input, key);
  optional(out, input, 'reasoningEffort', value => value === null ? null : string(value, 64));
  optional(out, input, 'timeoutSecs', value => integer(value, 1, 86400));
  if (input.mediaModels !== undefined) {
    const models = record(input.mediaModels); const entries = Object.entries(models);
    if (entries.length > 5 || entries.some(([channel]) => !['images', 'video', 'tts', 'stt', 'embeddings'].includes(channel))) invalid();
    out.mediaModels = Object.fromEntries(entries.map(([channel, model]) => [channel, string(model, 512)]));
  }
  return out as unknown as AgentStartRequest;
}

/** Validate the entire page before delivering any callbacks, including bounded structured data. */
function validateBatch(batch: AgentReadResult, id: string, after: number): AgentEvent[] {
  const bad = (): never => { throw new AgentError('invalidResponse'); };
  const large = (): never => { throw new AgentError('responseTooLarge'); };
  if (!batch || batch.id !== id || !Array.isArray(batch.events) || typeof batch.done !== 'boolean' || !Number.isSafeInteger(batch.after) || batch.after < after) bad();
  if (batch.events.length > 256) large();
  if (!['running', 'completed', 'cancelled', 'failed', 'interrupted'].includes(batch.status)) bad();
  if (batch.text !== undefined) {
    if (typeof batch.text !== 'string') bad();
    if (batch.text.length > MAX_TEXT) large();
  }
  let budget = MAX_BATCH;
  let nodes = 0;
  const json = (value: unknown, depth = 0): void => {
    if (++nodes > 16384 || depth > 32) large();
    if (value === null || typeof value === 'boolean') budget -= 5;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) bad(); budget -= 24; }
    else if (typeof value === 'string') budget -= value.length;
    else if (Array.isArray(value)) { budget -= value.length; for (const item of value) json(item, depth + 1); }
    else if (typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) bad();
      for (const [key, item] of Object.entries(value)) { budget -= key.length; json(item, depth + 1); }
    } else bad();
    if (budget < 0) large();
  };
  let previous = 0;
  let cursor = after;
  let terminal: AgentEvent | undefined;
  const fresh: AgentEvent[] = [];
  for (const event of batch.events) {
    if (!event || !Number.isSafeInteger(event.sequence) || event.sequence <= previous || event.sequence < 1 || terminal) bad();
    previous = event.sequence;
    if (!['text', 'reasoning', 'tool', 'permission', 'question', 'status', 'done', 'cancelled', 'error'].includes(event.type)) bad();
    for (const key of ['text', 'itemId', 'error'] as const) {
      if (event[key] !== undefined) { if (typeof event[key] !== 'string') bad(); budget -= event[key]!.length; }
    }
    if (event.type === 'text' && typeof event.text !== 'string') bad();
    if (event.type === 'error' && (typeof event.error !== 'string' || !event.error)) bad();
    if (event.data !== undefined) json(event.data);
    if (budget < 0) large();
    if (terminalTypes.has(event.type)) terminal = event;
    if (event.sequence <= after) continue;
    if (event.sequence !== cursor + 1) throw new AgentError('cursorGap');
    cursor = event.sequence;
    fresh.push(event);
  }
  if (batch.after !== (batch.events.length ? previous : after) || batch.after !== cursor) bad();
  if (batch.done !== (batch.status !== 'running')) bad();
  if (terminal && !batch.done) bad();
  if (batch.done && !terminal && batch.events.length > 0) bad();
  if (terminal?.type === 'done' && batch.status !== 'completed') bad();
  if (terminal?.type === 'cancelled' && batch.status !== 'cancelled') bad();
  if (terminal?.type === 'error' && batch.status !== 'failed' && batch.status !== 'interrupted') bad();
  return fresh;
}

/** Dependency-free implementation shared by SDK imports and the injected window API. */
export function createAgentApi(transport: AgentTransport): AgentApi {
  const call = async <T>(method: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      if (!transport || typeof transport.invoke !== 'function') throw new AgentError('unavailable', 'Host agent API is unavailable');
      return await transport.invoke(`otools_host_agent_${method}`, args) as T;
    } catch (error) { throw normalizeError(error); }
  };
  const api: AgentApi = {
    providers: () => call('providers'),
    tools: () => call('tools'),
    capabilities: async options => call('capabilities', one(options, 'providerId')),
    health: async options => {
      const input = record(options); const out = one(input, 'providerId');
      optional(out, input, 'refresh', boolean); return call('health', out);
    },
    openManager: async (options = {}) => {
      const out = {}; optional(out, record(options), 'providerId'); return call('open_manager', out);
    },
    openSession: async request => call('open_session', { request: openRequest(request) }),
    configOptions: async options => call('config_options', one(options, 'sessionId')),
    setConfigOption: async options => {
      const input = record(options);
      return call('set_config_option', { sessionId: string(input.sessionId), configId: string(input.configId), value: string(input.value, 4096) });
    },
    start: async request => {
      const { mediaModels, ...normalized } = startRequest(request);
      return call('start', { request: normalized, ...(mediaModels ? { mediaModels } : {}) });
    },
    read: async options => call('read', readOptions(options)),
    cancel: async options => call('cancel', one(options, 'id')),
    closeSession: async options => call('close_session', one(options, 'sessionId')),
    respondQuestion: async options => {
      const input = record(options); const entries = Object.entries(record(input.answers));
      if (entries.length > 128) invalid();
      const answers: Record<string, string[]> = Object.create(null);
      let size = 0;
      for (const [key, values] of entries) {
        string(key);
        if (['__proto__', 'constructor', 'prototype'].includes(key) || !Array.isArray(values) || values.length > 128) invalid();
        answers[key] = values.map(value => {
          const answer = string(value, 65536, true); size += answer.length;
          if (size > 1024 * 1024) invalid(); return answer;
        });
      }
      return call('respond_question', { id: string(input.id), answers });
    },
    openPermission: async options => call('open_permission', one(options, 'id')),
    workspace: async (options = {}) => {
      const out = {}; optional(out, record(options), 'workspaceId'); return call('workspace', out);
    },
    syncAssets: async options => {
      const input = record(options);
      if (!Array.isArray(input.files) || input.files.length > 256) invalid();
      let size = 0;
      const files = input.files.map(value => {
        const file = record(value); const path = relativePath(file.path);
        const contentBase64 = string(file.contentBase64, 16 * 1024 * 1024, true);
        size += contentBase64.length;
        const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0;
        // A repeated capture over multi-megabyte assets can overflow the regexp stack.
        const body = padding ? contentBase64.slice(0, -padding) : contentBase64;
        if (size > 32 * 1024 * 1024 || contentBase64.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(body) || (padding > 0 && body.length < 2)) invalid();
        return { path, contentBase64 };
      });
      return call('sync_assets', { workspaceId: string(input.workspaceId), files });
    },
    workspaceFiles: async options => {
      const input = record(options); const out = one(input, 'workspaceId');
      optional(out, input, 'path', value => relativePath(value, true)); return call('workspace_files', out);
    },
    consume: (request, options = {}) => observe(request, undefined, options) as Promise<AgentConsumeResult>,
    resume: (request, options = {}) => observe(undefined, request, options),
  };

  function observe(start: AgentStartRequest | undefined, resume: AgentReadOptions | undefined, options: AgentResumeOptions | AgentConsumeOptions): Promise<AgentResumeResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let id: string | undefined;
      let sessionId: string | undefined;
      let after = 0;
      let text = '';
      let eventCount = 0;
      let hostTerminal = false;
      let cancelSent = false;
      let cancelLate = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let signal: AbortSignal | undefined;
      const cancel = () => {
        if (!id || cancelSent || hostTerminal) return;
        cancelSent = true; void api.cancel({ id }).catch(() => {});
      };
      const cleanup = () => {
        clearTimeout(timer); clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      };
      const fail = (error: unknown, shouldCancel = start !== undefined) => {
        if (settled) return;
        settled = true; cancelLate = shouldCancel; cleanup();
        if (shouldCancel) cancel();
        reject(normalizeError(error));
      };
      const abort = () => fail(new AgentError('cancelled'), start !== undefined || (options as AgentResumeOptions).cancelOnAbort === true);
      let interval: number;
      let timeout: number;
      let normalizedStart: AgentStartRequest | undefined;
      try {
        record(options);
        if (options.pollIntervalMs !== undefined && (typeof options.pollIntervalMs !== 'number' || !Number.isFinite(options.pollIntervalMs))) invalid();
        interval = options.pollIntervalMs === undefined ? 100 : Math.max(0, Math.min(10000, options.pollIntervalMs));
        timeout = options.timeoutMs === undefined ? 600000 : integer(options.timeoutMs, 1, 86400000);
        if (options.onEvent !== undefined && typeof options.onEvent !== 'function') invalid();
        if ('cancelOnAbort' in options && options.cancelOnAbort !== undefined) boolean(options.cancelOnAbort);
        signal = options.signal;
        if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean')) invalid();
        if (start !== undefined) normalizedStart = startRequest(start);
        else { const cursor = readOptions(resume); id = cursor.id; after = cursor.after; }
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
      } catch (error) { fail(error, false); return; }
      deadline = setTimeout(() => fail(new AgentError('timeout'), start !== undefined || (options as AgentResumeOptions).cancelOnAbort === true), timeout);
      const poll = async () => {
        if (settled || !id) return;
        try {
          const batch = await api.read({ id, after });
          if (settled) return;
          const events = validateBatch(batch, id, after);
          eventCount += events.length;
          if (eventCount > MAX_EVENTS) throw new AgentError('responseTooLarge');
          const suffix = events.filter(event => event.type === 'text').map(event => event.text!).join('');
          const nextText = batch.text === undefined ? text + suffix : batch.text;
          if (nextText.length > MAX_TEXT) throw new AgentError('responseTooLarge');
          text = nextText;
          hostTerminal = batch.done;
          for (const event of events) {
            after = event.sequence;
            options.onEvent?.(event);
            if (settled) return;
            if (event.type === 'error') throw new AgentError(event.error!);
            if (event.type === 'cancelled') throw new AgentError('cancelled');
          }
          after = batch.after;
          if (batch.done) {
            if (batch.status !== 'completed') throw new AgentError(batch.status === 'failed' ? 'failed' : batch.status);
            settled = true; cleanup();
            resolve({ id, ...(sessionId === undefined ? {} : { sessionId }), text });
          } else timer = setTimeout(() => { void poll(); }, interval);
        } catch (error) { fail(error); }
      };
      if (!normalizedStart) { void poll(); return; }
      void (async () => {
        try {
          const started = await api.start(normalizedStart);
          if (!started || typeof started.id !== 'string' || !started.id.trim() || started.id.length > 512) throw new AgentError('invalidResponse');
          id = started.id;
          if (settled) { if (cancelLate) cancel(); return; }
          if (started.sessionId !== normalizedStart.sessionId) throw new AgentError('invalidResponse');
          sessionId = started.sessionId;
          void poll();
        } catch (error) { fail(error); }
      })();
    });
  }
  return api;
}
