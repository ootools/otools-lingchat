import { describe, expect, it } from 'vitest';
import { SaveRepository } from '../saves/repository';
import { MemoryStore } from '../saves/store';
import { MemoryService, createHostSummarizer } from './index';
import { emptyMemory, shortTermText, systemMemoryText } from './schema';

async function setup() {
  const repository = new SaveRepository(new MemoryStore());
  await repository.create('Test', 'alice', 'save');
  await repository.mutate('save', 'alice', undefined, role => {
    role.messages = [
      { id: '1', role: 'user', text: 'I like tea', createdAt: '2026-11-10T12:00:00Z', memoryEligible: true },
      { id: '2', role: 'assistant', text: 'A private screenshot password', createdAt: '2026-11-10T12:00:00Z', memoryEligible: false },
    ];
  });
  return repository;
}
describe('upstream persistent memory', () => {
  it('injects bounded Unicode-safe sections and suppresses empty short-term placeholder', () => {
    const bank = emptyMemory();
    expect(shortTermText(bank)).toBe('');
    bank.data.user_info = '😀'.repeat(900);
    const text = systemMemoryText(bank);
    expect(Array.from(text).filter(c => c === '😀')).toHaveLength(800);
    expect(text).not.toContain('\ufffd');
  });
  it('summarizes all four sections through bounded upstream prompts and excludes unconsented context', async () => {
    const repo = await setup(); const prompts: string[] = [];
    const service = new MemoryService(repo, async (prompt) => { prompts.push(prompt); return '用户喜欢茶。'; });
    expect(await service.summarize('save', 'alice', { force: true })).toBe('updated');
    const bank = (await repo.get('save', 'alice'))!.memory;
    expect(bank).toMatchObject({ schema_version: 1, meta: { last_processed_global_idx: 2 }, data: { short_term: '用户喜欢茶。', long_term: '用户喜欢茶。', user_info: '用户喜欢茶。', promises: '用户喜欢茶。' } });
    expect(prompts).toHaveLength(4);
    expect(prompts.every(p => p.includes('第三人称') && p.includes('I like tea') && !p.includes('password'))).toBe(true);
  });
  it('does not partially commit on one failed section and enforces retry cooldown', async () => {
    const repo = await setup(); let calls = 0;
    const service = new MemoryService(repo, async () => { if (++calls === 3) throw new Error('provider failed'); return 'ok'; });
    await expect(service.summarize('save', 'alice', { force: true })).rejects.toThrow('summarization');
    expect((await repo.get('save', 'alice'))!.memory.meta.last_processed_global_idx).toBe(0);
    expect((await repo.get('save', 'alice'))!.memory.data.short_term).toBe('暂无近期对话摘要。');
    expect(await service.summarize('save', 'alice', { force: true })).toBe('skipped');
  });
  it('cannot restore memory cleared while summarization was in flight', async () => {
    const repo = await setup(); let release!: () => void;
    const wait = new Promise<void>(r => { release = r; });
    let started!: () => void; const ready = new Promise<void>(r => { started = r; });
    const service = new MemoryService(repo, async () => { started(); await wait; return 'late secret'; });
    const pending = service.summarize('save', 'alice', { force: true }); await ready;
    await service.clear('save', 'alice'); release();
    expect(await pending).toBe('stale');
    expect((await repo.get('save', 'alice'))!.memory.data.user_info).toBe('暂无用户特征记录。');
    expect(await service.summarize('save', 'alice', { force: true })).toBe('skipped');
  });
  it('validates memory archives and supports editing, section removal, export and import', async () => {
    const repo = await setup(); const service = new MemoryService(repo, async () => 'ok');
    await service.edit('save', 'alice', 'user_info', 'Tea');
    const archive = await service.export('save', 'alice');
    await service.edit('save', 'alice', 'user_info', '');
    expect((await repo.get('save', 'alice'))!.memory.data.user_info).toBe('');
    await service.import('save', 'alice', archive);
    expect((await repo.get('save', 'alice'))!.memory.data.user_info).toBe('Tea');
    const bad = JSON.parse(archive); bad.memory.schema_version = 7;
    await expect(service.import('save', 'alice', JSON.stringify(bad))).rejects.toThrow();
  });
  it('uses the actual host text-part consume contract', async () => {
    let received: unknown;
    const summarize = createHostSummarizer({ consume: async (request, options) => {
      received = request; expect(options.signal).toBeInstanceOf(AbortSignal);
      options.onEvent?.({ sequence: 1, type: 'delta', text: 'result' });
      return { id: 'request', text: 'result' };
    } });
    expect(await summarize('prompt', new AbortController().signal)).toBe('result');
    expect(received).toMatchObject({ messages: [{ role: 'user', content: [{ type: 'text', text: 'prompt' }] }] });
  });
});
