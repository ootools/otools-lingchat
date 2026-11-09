export type AiRole = 'system' | 'user' | 'assistant';
export type AiContent = { type: 'text'; text: string } | { type: 'image'; captureImageId: string };
export interface AiMessage { role: AiRole; content: AiContent[] }
/** Provider, model, URLs, and credentials are exclusively host-configured. */
export interface AiRequest { messages: AiMessage[]; temperature?: number; maxTokens?: number }
export interface AiCapabilities {
  /** Host settings resolve to a model. This does not assert provider reachability. */
  configured: boolean;
  provider?: string;
  model?: string;
  streaming: boolean;
  cancellation: boolean;
  /** Unknown means no reliable model metadata; image requests may still succeed. */
  vision: 'unknown' | 'supported' | 'unsupported';
  reason?: string;
}
export type AiEvent =
  | { sequence: number; type: 'delta'; text: string }
  | { sequence: number; type: 'done' | 'cancelled' }
  | { sequence: number; type: 'error'; error: string };
export interface AiReadResult { id: string; events: AiEvent[]; done: boolean }
export interface AiTransport { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
export interface AiConsumeOptions {
  signal?: AbortSignal;
  onEvent?: (event: AiEvent) => void;
  pollIntervalMs?: number;
}
export interface AiApi {
  capabilities(): Promise<AiCapabilities>;
  start(request: AiRequest): Promise<{ id: string }>;
  /** The cursor acknowledges earlier events; older cursors subsequently fail. */
  read(options: { id: string; after: number }): Promise<AiReadResult>;
  cancel(options: { id: string }): Promise<void>;
  /** Owns polling, terminal acknowledgement and cancellation on abort/failure. */
  consume(request: AiRequest, options?: AiConsumeOptions): Promise<{ id: string; text: string }>;
}
