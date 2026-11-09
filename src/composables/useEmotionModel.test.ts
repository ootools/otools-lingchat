import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../saves/store';
import { useEmotionModel } from './useEmotionModel';

const files = { model: new Uint8Array([1]), vocab: '[PAD]\n[UNK]\n[CLS]\n[SEP]\n开\n心', labelMapping: JSON.stringify({ id2label: { 0: '开心', 1: '平静' }, label2id: { 开心: 0, 平静: 1 } }) };

describe('optional local model lifecycle', () => {
  it('loads a persisted model and normalizes completed dialogue tags with real controller logic', async () => {
    const store = new MemoryStore(); await store.update('emotion:model', () => files);
    const model = useEmotionModel(store, async () => ({ create: async () => ({ run: async () => [4, 0] }) }));
    await model.initialize();
    expect(model.status.value).toBe('ready');
    expect((await model.predictCompleted('【平静】Hello'))[0].emotion).toBe('开心');
    await model.dispose();
  });
  it('does not deliver a late prediction after a save switch', async () => {
    const store = new MemoryStore(); await store.update('emotion:model', () => files);
    let resolve!: (value: number[]) => void;
    const model = useEmotionModel(store, async () => ({ create: async () => ({ run: async () => new Promise<number[]>(done => resolve = done) }) }));
    await model.initialize(); let current = true;
    const pending = model.predictCompleted('【平静】Old save', () => current);
    await Promise.resolve(); current = false; resolve([4, 0]);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await model.dispose();
  });
});
