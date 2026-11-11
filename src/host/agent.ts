// Local optional projection of the unified host contract; no SDK implementation or credentials.
export interface AgentCapabilities {
  models: boolean; reasoning: boolean; resume: boolean; permissions: boolean; questions: boolean;
  tools: boolean; filesystem: boolean; terminal: boolean; sandbox: boolean;
}
export interface ProviderInfo { id: string; name: string; adapter: 'codex' | 'acp'; source: 'managed' | 'external' | 'configured'; configuration?: 'host' | 'native'; available: boolean; capabilities: AgentCapabilities }
export interface AgentHealth { providerId: string; status: 'ready' | 'missing' | 'degraded' | 'unavailable'; checks: Array<{ id: string; status: 'ok' | 'error' | 'unknown'; message: string }>; version: string | null; path: string | null }
export interface AgentSessionInfo { id: string; providerId: string; workspaceId: string; capabilities: AgentCapabilities; status: 'idle' | 'running' | 'closed' | 'interrupted' }
export interface AgentOpenRequest { providerId: string; clientSessionId?: string; workspaceId?: string; instructions?: string; sandbox?: 'read-only' | 'workspace-write'; network?: boolean; background?: boolean; tools?: string[] }
export interface AgentStartRequest { sessionId: string; prompt: string; model?: string; reasoningEffort?: string | null; timeoutSecs?: number; requestId?: string }
export interface AgentEvent { sequence: number; type: 'text' | 'reasoning' | 'tool' | 'permission' | 'question' | 'status' | 'done' | 'cancelled' | 'error'; text?: string; itemId?: string; data?: unknown; error?: string }
export interface AgentReadResult { id: string; events: AgentEvent[]; done: boolean; after: number; status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; text?: string }
export interface AgentPermission { id: string; runId: string; title: string; description?: string; options: Array<{ id: string; label: string; kind?: string }> }
export interface AgentQuestion { id: string; runId: string; questions: Array<{ id: string; header?: string; question: string; options?: Array<{ id: string; label: string; description?: string }>; allowCustom?: boolean }> }
export interface AgentTool { name: string; title?: string; description?: string }
export interface AgentApi {
  tools?(): Promise<AgentTool[]>;
  providers(): Promise<ProviderInfo[]>;
  capabilities(request: { providerId: string }): Promise<AgentCapabilities>;
  health(request: { providerId: string; refresh?: boolean }): Promise<AgentHealth>;
  openManager(request?: { providerId?: string }): Promise<void>;
  workspace(request?: { workspaceId?: string }): Promise<{ id: string; name: string }>;
  openSession(request: AgentOpenRequest): Promise<AgentSessionInfo>;
  start(request: AgentStartRequest): Promise<{ id: string; sessionId: string }>;
  read(request: { id: string; after?: number }): Promise<AgentReadResult>;
  cancel(request: { id: string }): Promise<void>;
  closeSession(request: { sessionId: string }): Promise<void>;
  openPermission(request: { id: string }): Promise<void>;
  respondQuestion(request: { id: string; answers: Record<string, string[]> }): Promise<void>;
}
export type AgentPreference = { model?: string | null; reasoningEffort?: string | null };
export class AgentError extends Error { constructor(readonly code: 'unsupported' | 'engineUnavailable' | 'modelNotSelected' | 'modelUnsupported' | 'reasoningUnsupported' | 'failed' | 'timeout' | 'cursorGap' | 'toolsUnavailable') { super(code); } }

/** Only the Codex adapter shares the host's model namespace. ACP uses negotiated native defaults. */
export async function hostAgentPreferences(ai?: {
  getSettings?: () => Promise<AgentPreference>;
  models?: () => Promise<{ selection: AgentPreference; defaultModel?: string | null }>;
  capabilities?: () => Promise<{ model?: string }>;
}): Promise<AgentPreference> {
  const selected = ai?.models ? (await ai.models()).selection : await ai?.getSettings?.();
  return { model: selected?.model ?? null, reasoningEffort: selected?.reasoningEffort ?? null };
}
