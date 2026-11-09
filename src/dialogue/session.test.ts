import { describe, expect, it } from 'vitest';
import { SaveRepository } from '../saves/repository';
import { MemoryStore } from '../saves/store';
import { ChatSession, type HostAi, type SessionUpdate } from './session';

async function setup(ai: HostAi, onUpdate?: (value: SessionUpdate) => void) {
  const repository = new SaveRepository(new MemoryStore());
  await repository.create('First', 'alice', 'one'); await repository.create('Second', 'bob', 'two');
  const session = new ChatSession({ repository, ai, onUpdate }); await session.select('one', 'alice');
  return { repository, session };
}
describe('chat orchestration', () => {
  it('streams host deltas and persists completed turns with persona and memory context', async () => {
    const updates: SessionUpdate[] = []; let received: any;
    const { session, repository } = await setup({ consume: async (request, options) => {
      received = request;
      options.onEvent?.({ sequence: 1, type: 'delta', text: 'Hello' });
      options.onEvent?.({ sequence: 2, type: 'delta', text: ' there' });
      return { id: 'req', text: 'Hello there' };
    } }, value => updates.push(value));
    await repository.patch('one', 'alice', { persona: 'Kind character' });
    expect(await session.send('Hi', { systemPrompt: 'Stay in character' })).toBe('Hello there');
    expect(updates.some(u => u.text === 'Hello' && u.status === 'streaming')).toBe(true);
    expect(received.messages[0].content[0].text).toContain('Kind character');
    expect(received.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hi' }] });
    expect((await repository.get('one', 'alice'))!.messages.map(m => m.text)).toEqual(['Hi', 'Hello there']);
  });
  it('keeps external context and its derived turn ephemeral by default', async () => {
    const requests: any[] = [];
    const { session, repository } = await setup({ consume: async request => { requests.push(request); return { id: 'req', text: 'Secret summary' }; } });
    await session.send('Summarize', { externalContext: 'PRIVATE NOTE' });
    expect(requests[0].messages.some((m: any) => m.content[0].text.includes('PRIVATE NOTE'))).toBe(true);
    expect((await repository.get('one', 'alice'))!.messages).toEqual([]);
    await session.send('Hello');
    expect(JSON.stringify(requests[1])).not.toContain('PRIVATE NOTE');
    expect(JSON.stringify(requests[1])).not.toContain('Secret summary');
  });
  it('persists an external turn only with explicit consent', async () => {
    const { session, repository } = await setup({ consume: async () => ({ id: 'req', text: 'Remembered' }) });
    await session.send('Remember this', { externalContext: 'Tea preference', rememberExternalContext: true });
    expect((await repository.get('one', 'alice'))!.messages[0]).toMatchObject({ memoryEligible: true });
    expect((await repository.get('one', 'alice'))!.messages[0].text).toContain('Tea preference');
  });
  it('aborts on role/save switch and ignores events and results from an uncooperative host', async () => {
    let release!: () => void; let started!: () => void; let signal!: AbortSignal;
    const ready = new Promise<void>(r => { started = r; }); const wait = new Promise<void>(r => { release = r; });
    const updates: SessionUpdate[] = [];
    const { session, repository } = await setup({ consume: async (_request, options) => {
      signal = options.signal!; started(); await wait;
      options.onEvent?.({ sequence: 2, type: 'delta', text: 'STALE' });
      return { id: 'req', text: 'STALE' };
    } }, value => updates.push(value));
    const sending = session.send('Hi'); const result = sending.catch(e => e);
    await ready; await session.select('two', 'bob'); release();
    expect(signal.aborted).toBe(true); expect((await result).name).toBe('AbortError');
    expect(updates.some(u => u.text === 'STALE')).toBe(false);
    expect((await repository.get('one', 'alice'))!.messages.map(m => m.role)).toEqual(['user']);
    expect((await repository.get('two', 'bob'))!.messages).toEqual([]);
  });
  it('persists the reply even when unrelated pet or story writes advance the role revision', async () => {
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(r => { started = r; }); const wait = new Promise<void>(r => { release = r; });
    const { session, repository } = await setup({ consume: async () => { started(); await wait; return { id: 'req', text: 'Reply' }; } });
    const sending = session.send('Hi').catch(e => e); await ready;
    await repository.patch('one', 'alice', { bond: 3, persona: 'Updated while streaming' });
    release(); expect(await sending).toBe('Reply');
    const role = (await repository.get('one', 'alice'))!;
    expect(role.messages.map(m => m.text)).toEqual(['Hi', 'Reply']);
    expect(role.bond).toBe(3);
  });
  it('cannot recreate a deleted save after late completion', async () => {
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(r => { started = r; }); const wait = new Promise<void>(r => { release = r; });
    const { session, repository } = await setup({ consume: async () => { started(); await wait; return { id: 'req', text: 'late' }; } });
    const result = session.send('Hi').catch(e => e); await ready;
    await repository.remove('one'); release(); await result;
    expect(await repository.get('one', 'alice')).toBeUndefined();
  });
  it('surfaces host errors without persisting a fabricated assistant message', async () => {
    const { session, repository } = await setup({ consume: async (_request, options) => {
      options.onEvent?.({ sequence: 1, type: 'error', error: 'provider unavailable' });
      return { id: 'req', text: '' };
    } });
    await expect(session.send('Hi')).rejects.toThrow('provider unavailable');
    expect((await repository.get('one', 'alice'))!.messages).toHaveLength(1);
  });
});
