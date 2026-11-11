import type { AgentApi, AgentEvent, AgentPermission, AgentPreference, AgentQuestion, AgentSessionInfo } from '../host/agent';
import { AgentError } from '../host/agent';
import type { AgentLink, RoleState, SaveRepository } from '../saves/repository';
import { shortTermText, truncateChars } from '../memory/schema';
import { abortError, type HostAi } from './session';

export interface AgentActivity {
  status: 'idle' | 'opening' | 'running' | 'permission' | 'question' | 'completed' | 'error';
  tools: string[]; detail?: string; permission?: AgentPermission; question?: AgentQuestion;
}
const idle = (): AgentActivity => ({ status: 'idle', tools: [] });
const sameScope = (a: AgentLink, b: RoleState, providerId: string) => a.saveId === b.saveId && a.roleId === b.roleId && a.generation === b.generation && a.providerId === providerId;
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortError());
    if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  });
}
function activityLabel(event: AgentEvent): string {
  if (event.text) return truncateChars(event.text, 2000);
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
  // Do not stringify arbitrary arguments, output, credentials or nested payloads.
  return ['title', 'tool', 'name', 'type', 'status'].map(key => typeof data[key] === 'string' ? truncateChars(data[key], 200) : '').filter(Boolean).join(' · ');
}
function permission(value: unknown, runId: string): AgentPermission | undefined {
  const item = value as AgentPermission | undefined;
  if (!item || typeof item.id !== 'string' || item.runId !== runId || typeof item.title !== 'string' || !Array.isArray(item.options)) return;
  return { id: item.id, runId, title: truncateChars(item.title, 500), description: typeof item.description === 'string' ? truncateChars(item.description, 2000) : undefined, options: [] };
}
function question(value: unknown, runId: string): AgentQuestion | undefined {
  const item = value as AgentQuestion | undefined;
  if (!item || typeof item.id !== 'string' || item.runId !== runId || !Array.isArray(item.questions) || !item.questions.length || item.questions.length > 20) return;
  if (item.questions.some(q => !q || typeof q.id !== 'string' || typeof q.question !== 'string' || (q.options !== undefined && (!Array.isArray(q.options) || q.options.length > 50 || q.options.some(o => !o || typeof o.id !== 'string' || typeof o.label !== 'string'))))) return;
  return { id: item.id, runId, questions: item.questions.map(q => ({ id: q.id, header: typeof q.header === 'string' ? truncateChars(q.header, 200) : undefined, question: truncateChars(q.question, 4000), allowCustom: q.allowCustom === true, options: q.options?.map(o => ({ id: o.id, label: truncateChars(o.label, 500), description: typeof o.description === 'string' ? truncateChars(o.description, 1000) : undefined })) })) };
}

/** One foreground session, scoped to a save/role generation. Implicit AI never uses this object. */
export class ForegroundAgent {
  private epoch = 0;
  private controller?: AbortController;
  private connection?: { api: AgentApi; link: AgentLink; session: AgentSessionInfo; toolsKey: string };
  private state = idle();
  constructor(private options: {
    repository: SaveRepository; getApi: () => AgentApi | undefined;
    preferences: () => Promise<AgentPreference>; onUpdate?: (state: AgentActivity) => void;
    onCleanupError?: () => void; pollIntervalMs?: number;
  }) {}
  private publish(state: AgentActivity) { this.state = state; this.options.onUpdate?.(state); }
  private async release(api: AgentApi, link: AgentLink) {
    if (link.runId) await api.cancel({ id: link.runId }).catch(() => this.options.onCleanupError?.());
    try { await api.closeSession({ sessionId: link.sessionId }); await this.options.repository.removeAgentLink(link); }
    catch { this.options.onCleanupError?.(); }
  }
  async close(): Promise<void> {
    this.epoch++; this.controller?.abort(); this.controller = undefined;
    const previous = this.connection; this.connection = undefined; this.publish(idle());
    if (previous) await this.release(previous.api, previous.link);
  }
  /** A reopened window never silently resumes an interrupted execution or conversation. */
  async recover(): Promise<void> {
    const api = this.options.getApi(); if (!api) return;
    for (const link of await this.options.repository.listAgentLinks()) await this.release(api, link);
  }
  async openPermission(id: string): Promise<void> {
    if (this.state.permission?.id !== id || !this.connection) throw abortError();
    await this.connection.api.openPermission({ id });
  }
  async respondQuestion(id: string, answers: Record<string, string[]>): Promise<void> {
    const pending = this.state.question; const epoch = this.epoch;
    if (!pending || pending.id !== id || !this.connection) throw abortError();
    const safe: Record<string, string[]> = Object.create(null);
    for (const q of pending.questions) {
      const values = answers[q.id];
      if (!Array.isArray(values) || !values.length || values.length > 20 || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 4000 || (!q.allowCustom && !q.options?.some(o => o.id === v)))) throw new Error('Invalid answer');
      safe[q.id] = values;
    }
    await this.connection.api.respondQuestion({ id, answers: safe });
    if (epoch === this.epoch && this.state.question?.id === id) this.publish({ ...this.state, question: undefined, status: this.state.permission ? 'permission' : 'running' });
  }
  transport(scope: RoleState, providerId: string, prompt: string, selectedTools: string[] = []): HostAi {
    const tools = [...new Set(selectedTools)].sort(); const toolsKey = JSON.stringify(tools);
    return { consume: async (request, consumeOptions) => {
      if (request.messages.some(m => m.content.some(c => c.type !== 'text'))) throw new Error('Agent accepts explicit text only');
      const api = this.options.getApi(); if (!api) throw new AgentError('unsupported');
      if (this.controller) throw new Error('Agent is already running');
      // Reserve the slot synchronously: a scope-change close below bumps the
      // epoch, and a concurrent consumer must see a busy controller, not a gap.
      const controller = new AbortController(); this.controller = controller;
      if (this.connection && (!sameScope(this.connection.link, scope, providerId) || this.connection.toolsKey !== toolsKey)) await this.close();
      if (this.controller !== controller) throw abortError();
      const epoch = this.epoch;
      const externalAbort = () => { controller.abort(); };
      consumeOptions.signal?.addEventListener('abort', externalAbort, { once: true });
      if (consumeOptions.signal?.aborted) controller.abort();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 600_000);
      const current = () => epoch === this.epoch && !controller.signal.aborted;
      const requireCurrent = () => { if (!current()) throw abortError(); };
      const checkScope = async () => {
        const role = await this.options.repository.get(scope.saveId, scope.roleId); requireCurrent();
        if (!role || role.generation !== scope.generation) throw abortError();
      };
      this.publish({ status: 'opening', tools: [] });
      try {
        await checkScope();
        const providers = await abortable(api.providers(), controller.signal); requireCurrent();
        const provider = providers.find(p => p.id === providerId);
        if (!provider?.available) throw new AgentError('engineUnavailable');
        const health = await abortable(api.health({ providerId }), controller.signal); requireCurrent();
        if (health.status === 'missing' || health.status === 'unavailable') throw new AgentError('engineUnavailable');
        const preferences = provider.adapter === 'codex' && provider.configuration !== 'native' ? await abortable(this.options.preferences(), controller.signal) : {};
        if (provider.adapter === 'codex' && provider.configuration !== 'native' && !preferences.model?.trim()) throw new AgentError('modelNotSelected');
        if (tools.length) {
          const granted = api.tools ? await abortable(api.tools(), controller.signal) : [];
          requireCurrent();
          if (tools.some(name => !granted.some(tool => tool.name === name))) throw new AgentError('toolsUnavailable');
        }
        requireCurrent();
        const validatePreferences = (capabilities: AgentSessionInfo['capabilities']) => {
          if (preferences.model && !capabilities.models) throw new AgentError('modelUnsupported');
          if (preferences.reasoningEffort && !capabilities.reasoning) throw new AgentError('reasoningUnsupported');
        };
        validatePreferences(provider.capabilities);
        if (!this.connection) {
          const workspace = await abortable(api.workspace({}), controller.signal); requireCurrent();
          const instructions = request.messages.slice(0, -1).map(m => `${m.role}: ${m.content.map(c => c.type === 'text' ? c.text : '').join('\n')}`).join('\n\n');
          const opening = api.openSession({ providerId, workspaceId: workspace.id, clientSessionId: JSON.stringify([scope.saveId, scope.roleId, scope.generation, crypto.randomUUID()]), background: false, ...(provider.adapter === 'codex' ? { sandbox: 'workspace-write' as const } : {}), tools, instructions: truncateChars(`${instructions}\n${shortTermText(scope.memory)}`, 60_000) }).then(async session => {
            if (!current()) { await api.closeSession({ sessionId: session.id }).catch(() => this.options.onCleanupError?.()); throw abortError(); }
            const link: AgentLink = { saveId: scope.saveId, roleId: scope.roleId, generation: scope.generation, providerId, workspaceId: session.workspaceId, sessionId: session.id };
            this.connection = { api, link, session, toolsKey };
            return this.connection;
          });
          await abortable(opening, controller.signal); requireCurrent();
        }
        const connection = this.connection!;
        validatePreferences(connection.session.capabilities);
        await checkScope();
        await this.options.repository.putAgentLink(connection.link, current); requireCurrent();
        const starting = api.start({ sessionId: connection.link.sessionId, prompt, ...(preferences.model ? { model: preferences.model } : {}), ...(preferences.reasoningEffort ? { reasoningEffort: preferences.reasoningEffort } : {}), requestId: crypto.randomUUID(), timeoutSecs: 600 }).then(async run => {
          if (!current()) { await api.cancel({ id: run.id }).catch(() => this.options.onCleanupError?.()); throw abortError(); }
          if (run.sessionId !== connection.link.sessionId) { await api.cancel({ id: run.id }); throw new AgentError('failed'); }
          connection.link = { ...connection.link, runId: run.id }; return run;
        });
        const run = await abortable(starting, controller.signal); requireCurrent();
        await this.options.repository.putAgentLink(connection.link, current); requireCurrent();
        this.publish({ status: 'running', tools: [] });
        let after = 0; let text = ''; let eventCount = 0;
        while (true) {
          const page = await abortable(api.read({ id: run.id, after }), controller.signal); requireCurrent(); await checkScope();
          if (page.id !== run.id || !Array.isArray(page.events) || page.events.length > 10_000 || !Number.isSafeInteger(page.after) || page.after < after) throw new AgentError('cursorGap');
          let terminal: AgentEvent['type'] | undefined;
          for (const event of page.events) {
            if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new AgentError('cursorGap');
            if (event.sequence <= after) continue;
            if (event.sequence !== after + 1) throw new AgentError('cursorGap');
            after = event.sequence;
            if (++eventCount > 100_000) throw new AgentError('failed');
            if (event.type === 'error') throw new AgentError('failed');
            if (event.type === 'cancelled') throw abortError();
            if (event.type === 'done') terminal = event.type;
            if (event.type === 'text') {
              text += event.text ?? ''; if (text.length > 100_000) throw new AgentError('failed');
              consumeOptions.onEvent?.({ sequence: after, type: 'delta', text: event.text ?? '' });
            }
            if (event.type === 'tool') this.publish({ ...this.state, tools: [...this.state.tools, activityLabel(event) || event.itemId || '…'].slice(-50) });
            if (event.type === 'status') this.publish({ ...this.state, detail: truncateChars(event.text ?? '', 500) });
            if (event.type === 'permission') {
              const value = permission(event.data, run.id); if (!value) throw new AgentError('failed');
              this.publish({ ...this.state, status: 'permission', permission: value });
            }
            if (event.type === 'question') {
              const value = question(event.data, run.id); if (!value) throw new AgentError('failed');
              this.publish({ ...this.state, status: 'question', question: value });
            }
          }
          if (page.after !== after) throw new AgentError('cursorGap');
          if (page.text !== undefined) { if (page.text.length > 100_000) throw new AgentError('failed'); text = page.text; }
          if (page.done) {
            if (page.status === 'cancelled') throw abortError();
            if (page.status !== 'completed' || !text.trim()) throw new AgentError('failed');
            this.publish({ status: 'completed', tools: this.state.tools });
            return { id: run.id, text };
          }
          if (terminal || page.status !== 'running') throw new AgentError('failed');
          await delay(this.options.pollIntervalMs ?? 100, controller.signal);
        }
      } catch (error) {
        if (epoch === this.epoch) {
          const previous = this.connection; this.connection = undefined;
          this.publish({ status: controller.signal.aborted && !timedOut ? 'idle' : 'error', tools: this.state.tools });
          if (previous) await this.release(previous.api, previous.link);
        }
        if (timedOut) throw new AgentError('timeout');
        throw error;
      } finally {
        clearTimeout(timer); consumeOptions.signal?.removeEventListener('abort', externalAbort);
        if (this.controller === controller) this.controller = undefined;
      }
    } };
  }
}
