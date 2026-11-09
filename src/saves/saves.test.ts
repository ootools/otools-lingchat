import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store';
import { SaveRepository } from './repository';

const setup = () => new SaveRepository(new MemoryStore());
describe('atomic cloned storage', () => {
  it('isolates nested values and supports binary assets', async () => {
    const store = new MemoryStore();
    const value = { nested: { n: 1 }, bytes: new Uint8Array([7, 8]) };
    await store.update('asset:a', () => value);
    value.nested.n = 99;
    const read = (await store.get<typeof value>('asset:a'))!;
    read.bytes[0] = 0;
    expect(await store.get('asset:a')).toEqual({ nested: { n: 1 }, bytes: new Uint8Array([7, 8]) });
    expect((await store.list('asset:')).map(x => x.key)).toEqual(['asset:a']);
  });
  it('serializes updates and rolls back throwing or noncloneable writes', async () => {
    const store = new MemoryStore();
    await Promise.all(Array.from({ length: 30 }, () => store.update<number>('count', n => (n ?? 0) + 1)));
    await expect(store.update('count', () => { throw new Error('stop'); })).rejects.toThrow('stop');
    await expect(store.update('count', () => ({ bad: () => 1 }))).rejects.toThrow();
    expect(await store.get('count')).toBe(30);
    await store.update('count', () => undefined);
    expect(await store.get('count')).toBeUndefined();
  });
});

describe('save repository', () => {
  it('keeps save and role state independent and survives a new repository', async () => {
    const store = new MemoryStore(); const repo = new SaveRepository(store);
    await repo.create('First', 'alice', 'first');
    await repo.create('Second', 'alice', 'second');
    await repo.ensureRole('first', 'bob');
    await repo.patch('first', 'alice', { persona: 'Tea lover', outfitId: 'winter', bond: 8, achievements: ['hello'], scriptState: { chapter: 2 } });
    const reopened = new SaveRepository(store);
    expect(await reopened.get('first', 'alice')).toMatchObject({ persona: 'Tea lover', outfitId: 'winter', bond: 8, achievements: ['hello'], scriptState: { chapter: 2 } });
    expect((await reopened.get('first', 'bob'))?.persona).toBe('');
    expect((await reopened.get('second', 'alice'))?.bond).toBe(0);
  });
  it('roundtrips archives and rejects unsupported or corrupted schemas without overwriting', async () => {
    const repo = setup(); await repo.create('First', 'alice', 'first');
    await repo.patch('first', 'alice', { persona: 'Original' });
    const archive = await repo.exportSave('first');
    const imported = setup(); expect(await imported.importSave(archive)).toBe('first');
    expect((await imported.get('first', 'alice'))?.persona).toBe('Original');
    for (const alter of [
      (x: any) => { x.version = 99; },
      (x: any) => { x.save.roles.alice.memory.schema_version = 2; },
      (x: any) => { x.save.roles.alice.messages = [{ text: 'invalid' }]; },
      (x: any) => { x.save.roles.alice.bond = 'eight'; },
    ]) {
      const invalid = JSON.parse(archive); alter(invalid);
      await expect(repo.importSave(JSON.stringify(invalid))).rejects.toThrow();
    }
    expect((await repo.get('first', 'alice'))?.persona).toBe('Original');
  });
  it('rejects stale mutations after deletion/recreation, clear and archive import', async () => {
    const repo = setup(); await repo.create('First', 'alice', 'first');
    const stale = (await repo.get('first', 'alice'))!;
    await repo.remove('first'); await repo.create('New', 'alice', 'first');
    expect(await repo.mutate('first', 'alice', stale, role => { role.persona = 'resurrected'; })).toBeUndefined();
    const fresh = (await repo.get('first', 'alice'))!;
    await repo.clearChat('first', 'alice');
    expect(await repo.mutate('first', 'alice', fresh, role => { role.persona = 'stale'; })).toBeUndefined();
    const preImport = (await repo.get('first', 'alice'))!;
    await repo.importSave(await repo.exportSave('first'));
    expect(await repo.mutate('first', 'alice', preImport, role => { role.persona = 'stale'; })).toBeUndefined();
    expect((await repo.get('first', 'alice'))?.persona).toBe('');
  });
});
