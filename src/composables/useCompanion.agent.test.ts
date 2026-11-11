// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { useCompanion } from './useCompanion';
import { MemoryStore } from '../saves/store';
import type { AgentApi, AgentCapabilities } from '../host/agent';
import type { CompanionHost } from '../host/bridge';
import { agentLabels } from '../host/agentLabels';
const capabilities: AgentCapabilities = { models: true, reasoning: true, resume: true, permissions: true, questions: true, tools: true, filesystem: true, terminal: true, sandbox: true };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const run of cleanup.splice(0)) await run(); delete (window as any).otools; });
async function setup() {
  let sequence = 0;
  const api: AgentApi = {
    tools: vi.fn(async () => []), providers: vi.fn(async () => [{ id: 'codex', name: 'Codex', adapter: 'codex', source: 'managed', available: true, capabilities }]),
    capabilities: vi.fn(async () => capabilities), health: vi.fn(async () => ({ providerId: 'codex', status: 'ready', checks: [], path: null, version: null })),
    workspace: vi.fn(async () => ({ id: 'workspace', name: 'Plugin workspace' })),
    openSession: vi.fn(async () => ({ id: `session-${++sequence}`, providerId: 'codex', workspaceId: 'workspace', capabilities, status: 'idle' })),
    start: vi.fn(async r => ({ id: `run-${sequence}`, sessionId: r.sessionId })),
    read: vi.fn(async () => ({ id: `run-${sequence}`, events: [], after: 0, done: true, status: 'completed', text: 'Agent answer' })),
    cancel: vi.fn(async () => {}), closeSession: vi.fn(async () => {}), openManager: vi.fn(async () => {}), openPermission: vi.fn(async () => {}), respondQuestion: vi.fn(async () => {}),
  };
  const consume = vi.fn(async () => ({ id: 'normal', text: 'Normal answer' }));
  (window as unknown as { otools: CompanionHost }).otools = { agent: api, ai: { consume, models: async () => ({ defaultModel: 'host-default', selection: { model: 'pet-model', reasoningEffort: 'high' }, models: [] }) } };
  const c = useCompanion({ store: new MemoryStore() }); cleanup.push(c.dispose);
  await c.repository.create('One', 'alice', 'one'); await c.repository.create('Two', 'bob', 'two');
  await c.select('one', 'alice'); return { c, api, consume };
}
it('keeps default chat and summarization on AI; routes only explicit Agent sends and closes on role changes', async () => {
  const { c, api, consume } = await setup();
  expect(c.agentMode.value).toBe(false); await c.send('Normal'); expect(consume).toHaveBeenCalledTimes(1); expect(api.start).not.toHaveBeenCalled();
  await c.setAgentMode(true); expect(api.openSession).not.toHaveBeenCalled(); await c.send('Do a task');
  expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ model: 'pet-model', reasoningEffort: 'high', prompt: 'Do a task' }));
  c.externalContext.value = 'PRIVATE NOTE'; await c.send('Read temporarily');
  expect(api.start).toHaveBeenCalledTimes(1); expect(JSON.stringify(vi.mocked(api.openSession).mock.calls)).not.toContain('PRIVATE NOTE');
  await c.summarize(); expect(api.start).toHaveBeenCalledTimes(1); expect(consume.mock.calls.length).toBeGreaterThan(2);
  await c.select('two', 'bob'); expect(api.closeSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
  await c.send('New role'); expect(api.openSession).toHaveBeenCalledTimes(2);
  expect(c.messages.value.map(m => m.text)).toEqual(['New role', 'Agent answer']);
  await c.setAgentMode(false); expect(api.closeSession).toHaveBeenCalledWith({ sessionId: 'session-2' });
});
it('keeps the latest selection when an earlier role switch waits on host cleanup', async () => {
  const { c, api } = await setup(); await c.setAgentMode(true); await c.send('Hello');
  let release!: () => void; const waiting = new Promise<void>(resolve => release = resolve);
  vi.mocked(api.closeSession).mockImplementationOnce(() => waiting);
  const first = c.select('two', 'bob'); await vi.waitFor(() => expect(api.closeSession).toHaveBeenCalled());
  await c.select('one', 'carol'); release(); await first;
  expect(c.saveId.value).toBe('one'); expect(c.roleId.value).toBe('carol'); expect(c.role.value?.roleId).toBe('carol');
});
it('keeps AI usable when Agent is missing and all added translations have the same keys', async () => {
  const { c, consume } = await setup(); delete (window as any).otools.agent;
  await c.setAgentMode(true); expect(c.agentReady.value).toBe(false);
  await c.attempt(c.openAgentManager); expect(c.error.value).toContain('更新 Otools');
  await c.setAgentMode(false); await c.send('Still here'); expect(consume).toHaveBeenCalled();
  const keys = Object.keys(agentLabels('en')).sort();
  for (const locale of ['zh', 'ja', 'ko', 'de', 'es', 'ru', 'ar']) expect(Object.keys(agentLabels(locale)).sort()).toEqual(keys);
});
