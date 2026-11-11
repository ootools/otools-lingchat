import { describe, expect, it, vi } from 'vitest';
import { ForegroundAgent } from './agent';
import type { AgentApi, AgentCapabilities, AgentEvent, ProviderInfo } from '../host/agent';
import { ChatSession } from './session';
import { SaveRepository } from '../saves/repository';
import { MemoryStore } from '../saves/store';

const capabilities: AgentCapabilities = { models: true, reasoning: true, resume: true, permissions: true, questions: true, tools: true, filesystem: true, terminal: true, sandbox: true };
const provider: ProviderInfo = { id: 'codex', name: 'Codex', adapter: 'codex', source: 'managed', available: true, capabilities };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
function fake() {
  let count = 0;
  return {
    tools: vi.fn(async () => [{ name: 'calendar.read', title: 'Calendar' }]),
    providers: vi.fn(async () => [provider]), capabilities: vi.fn(async () => capabilities),
    health: vi.fn(async () => ({ providerId: 'codex', status: 'ready' as const, checks: [], version: null, path: null })),
    workspace: vi.fn(async () => ({ id: 'workspace', name: 'LingChat' })),
    openSession: vi.fn(async () => ({ id: `session-${++count}`, providerId: 'codex', workspaceId: 'workspace', capabilities, status: 'idle' as const })),
    start: vi.fn(async (request: { sessionId: string }) => ({ id: `run-${count}`, sessionId: request.sessionId })),
    read: vi.fn(async () => ({ id: `run-${count}`, events: [{ sequence: 1, type: 'text', text: 'Hello' }] as AgentEvent[], done: true, after: 1, status: 'completed' as const, text: 'Hello' })),
    cancel: vi.fn(async () => {}), closeSession: vi.fn(async () => {}), openPermission: vi.fn(async () => {}), respondQuestion: vi.fn(async () => {}), openManager: vi.fn(async () => {}),
  } satisfies AgentApi;
}
async function setup(api = fake()) {
  const repository = new SaveRepository(new MemoryStore()); await repository.create('One', 'alice', 'one');
  const normal = vi.fn(async () => ({ id: 'ai', text: 'Normal answer' }));
  const chat = new ChatSession({ repository, ai: { consume: normal } }); await chat.select('one', 'alice');
  const states: any[] = [];
  const preferences = vi.fn(async () => ({ model: 'host-model', reasoningEffort: 'high' }));
  const agent = new ForegroundAgent({ repository, getApi: () => api, preferences, onUpdate: state => states.push(state), pollIntervalMs: 0 });
  const send = async (text: string, options = {}) => {
    const role = (await repository.get('one', 'alice'))!;
    return chat.send(text, { systemPrompt: 'Kind character', ...options }, agent.transport(role, provider.id, text));
  };
  return { api, agent, chat, repository, send, states, normal, preferences };
}
describe('foreground Agent', () => {
  it('uses a host workspace and reuses a session for normal turns; links are outside exported memory', async () => {
    const { api, send, repository } = await setup();
    await send('First'); await send('Second');
    expect(api.workspace).toHaveBeenCalledWith({}); expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(api.openSession.mock.calls[0]?.[0]).toMatchObject({ background: false, sandbox: 'workspace-write', instructions: expect.stringContaining('Kind character') });
    expect(api.start.mock.calls.map(([r]) => r)).toEqual([
      expect.objectContaining({ prompt: 'First', model: 'host-model', reasoningEffort: 'high' }),
      expect.objectContaining({ prompt: 'Second', model: 'host-model', reasoningEffort: 'high' }),
    ]);
    expect((await repository.listAgentLinks())[0]).toMatchObject({ sessionId: 'session-1', runId: 'run-1' });
    expect(await repository.exportSave('one')).not.toContain('session-1');
    expect((await repository.get('one', 'alice'))!.messages.map(m => m.text)).toEqual(['First', 'Hello', 'Second', 'Hello']);
  });
  it('routes temporary notes and captures through normal AI without exposing them to any persistent session', async () => {
    const { api, send, normal } = await setup();
    await send('Read note', { externalContext: 'SECRET' }); await send('See image', { captureImageIds: ['screen'] }); await send('Hello');
    expect(normal).toHaveBeenCalledTimes(2); expect(api.start).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(api.openSession.mock.calls)).not.toMatch(/SECRET|screen|Normal answer/);
  });
  it('passes only explicitly selected currently granted tools to a new session', async () => {
    const { api, agent, chat, repository } = await setup();
    const role = (await repository.get('one', 'alice'))!;
    await chat.send('Use calendar', {}, agent.transport(role, 'codex', 'Use calendar', ['calendar.read']));
    expect(api.openSession.mock.calls[0]?.[0]).toMatchObject({ tools: ['calendar.read'] });
    await agent.close();
    await expect(chat.send('Use secret', {}, agent.transport(role, 'codex', 'Use secret', ['notes.private']))).rejects.toThrow('toolsUnavailable');
    expect(api.openSession).toHaveBeenCalledTimes(1);
  });
  it('requires a selected plugin model before opening a host-backed Codex session', async () => {
    const { api, send, preferences } = await setup();
    preferences.mockResolvedValue({ model: null, reasoningEffort: null } as never);
    await expect(send('Hello')).rejects.toThrow('modelNotSelected');
    expect(api.openSession).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('never forwards host model preferences to ACP, even with advertised selection capabilities', async () => {
    const { api, send, preferences } = await setup(); api.providers.mockResolvedValue([{ ...provider, adapter: 'acp' }]);
    await send('Hello'); expect(preferences).not.toHaveBeenCalled();
    expect(api.start.mock.calls[0]?.[0]).not.toHaveProperty('model');
    expect(api.start.mock.calls[0]?.[0]).not.toHaveProperty('reasoningEffort');
  });
  it('uses native Codex defaults without reading host settings', async () => {
    const { api, send, preferences } = await setup(); api.providers.mockResolvedValue([{ ...provider, configuration: 'native' }]);
    await send('Hello'); expect(preferences).not.toHaveBeenCalled(); expect(api.start.mock.calls[0]?.[0]).not.toHaveProperty('model');
  });
  it('discards late read results when a save is cleared, imported or deleted outside the composer', async () => {
    for (const change of ['clear', 'import', 'delete']) {
      const { api, send, repository } = await setup(); const pending = deferred<any>(); api.read.mockImplementation(() => pending.promise);
      const result = send('Hello').catch(error => error); await vi.waitFor(() => expect(api.read).toHaveBeenCalled());
      if (change === 'clear') await repository.clearChat('one', 'alice');
      if (change === 'import') await repository.importSave(await repository.exportSave('one'));
      if (change === 'delete') await repository.remove('one');
      pending.resolve({ id: 'run-1', events: [{ sequence: 1, type: 'text', text: 'STALE' }], done: true, after: 1, status: 'completed', text: 'STALE' });
      expect((await result).name).toBe('AbortError');
      expect((await repository.get('one', 'alice'))?.messages.some(m => m.text === 'STALE')).not.toBe(true);
      expect(api.closeSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    }
  });
  it('displays structured host tool activity without serializing tool input or output', async () => {
    const { api, send, states } = await setup();
    api.read.mockResolvedValue({ id: 'run-1', events: [{ sequence: 1, type: 'tool', data: { type: 'mcpToolCall', tool: 'calendar.read', status: 'completed', arguments: { secret: 'PRIVATE' } } }], done: true, after: 1, status: 'completed', text: 'Done' } as any);
    await send('Hello'); expect(states.at(-1).tools[0]).toContain('calendar.read'); expect(JSON.stringify(states)).not.toContain('PRIVATE');
  });
  it('fails explicitly when Codex cannot honor preferences and does not fall back to AI', async () => {
    const { api, send, normal } = await setup(); api.providers.mockResolvedValue([{ ...provider, capabilities: { ...capabilities, models: false } }]);
    await expect(send('Hello')).rejects.toThrow('modelUnsupported'); expect(api.start).not.toHaveBeenCalled(); expect(normal).not.toHaveBeenCalled();
  });
  it('closes a session that opens after cancellation and discards its result', async () => {
    const { api, agent, send, repository } = await setup(); const pending = deferred<Awaited<ReturnType<AgentApi['openSession']>>>();
    api.openSession.mockImplementation(() => pending.promise);
    const result = send('Hello').catch(error => error); await vi.waitFor(() => expect(api.openSession).toHaveBeenCalled());
    await agent.close(); pending.resolve({ id: 'late-session', providerId: 'codex', workspaceId: 'workspace', capabilities, status: 'idle' });
    expect((await result).name).toBe('AbortError'); expect(api.closeSession).toHaveBeenCalledWith({ sessionId: 'late-session' });
    expect(api.start).not.toHaveBeenCalled(); expect(await repository.listAgentLinks()).toEqual([]);
  });
  it('cancels a run whose start resolves late and ignores late reads after a clear', async () => {
    const { api, agent, send, repository, states } = await setup(); const pending = deferred<{ id: string; sessionId: string }>();
    api.start.mockImplementation(() => pending.promise);
    const result = send('Hello').catch(error => error); await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
    await agent.close(); await repository.clearChat('one', 'alice'); pending.resolve({ id: 'late-run', sessionId: 'session-1' });
    expect((await result).name).toBe('AbortError'); expect(api.cancel).toHaveBeenCalledWith({ id: 'late-run' });
    expect((await repository.get('one', 'alice'))!.messages).toEqual([]); expect(states.at(-1).status).toBe('idle');
  });
  it('shows bounded tools and delegates permissions/questions to host, never memory', async () => {
    const { api, agent, send, repository, states } = await setup(); const waiting = deferred<any>(); let reads = 0;
    api.read.mockImplementation(async () => ++reads === 1 ? {
      id: 'run-1', events: [
        { sequence: 1, type: 'tool', text: 'PRIVATE TOOL OUTPUT' },
        { sequence: 2, type: 'permission', data: { id: 'perm', runId: 'run-1', title: 'Allow file write?', options: [{ id: 'yes', label: 'Allow' }] } },
        { sequence: 3, type: 'question', data: { id: 'q', runId: 'run-1', questions: [{ id: 'name', question: 'Name?', allowCustom: true }] } },
      ], done: false, after: 3, status: 'running',
    } as any : waiting.promise);
    const result = send('Hello'); await vi.waitFor(() => expect(states.at(-1).question?.id).toBe('q'));
    await agent.openPermission('perm'); await agent.respondQuestion('q', { name: ['Mochi'] });
    expect(api.openPermission).toHaveBeenCalledWith({ id: 'perm' }); expect(api.respondQuestion).toHaveBeenCalledWith({ id: 'q', answers: { name: ['Mochi'] } });
    waiting.resolve({ id: 'run-1', events: [], done: true, after: 3, status: 'completed', text: 'Hello' }); await result;
    expect(await repository.exportSave('one')).not.toContain('PRIVATE TOOL OUTPUT');
    expect(states.at(-1).permission).toBeUndefined(); expect(states.at(-1).question).toBeUndefined();
  });
});
