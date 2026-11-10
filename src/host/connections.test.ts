import { describe, expect, it } from 'vitest';
import { createConnectionsController, probeGrantState } from './connections';
import type { ProviderIdentity } from './providers';

const notes: ProviderIdentity = { source: 'market', uuid: 'otools-notes' };
const devNotes: ProviderIdentity = { source: 'dev-debug', uuid: 'otools-notes' };

describe('grant state probe', () => {
  it('treats an authorized read as connected', async () => {
    expect(await probeGrantState({ list: async () => ({ items: [] }) }, notes, 'notes.v1')).toBe('connected');
  });
  it('maps broker denial to unauthorized without surfacing it as a failure', async () => {
    const denied = async () => { throw Object.assign(new Error('denied'), { code: 'permissionDenied' }); };
    expect(await probeGrantState({ list: denied }, notes, 'notes.v1')).toBe('unauthorized');
  });
  it('rethrows transport failures instead of pretending the grant is missing', async () => {
    const broken = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
    await expect(probeGrantState({ list: broken }, notes, 'notes.v1')).rejects.toThrow('offline');
  });
});

describe('connections discovery and grants', () => {
  it('attaches display names from the host plugin list and falls back to uuid', async () => {
    const controller = createConnectionsController({
      data: { discover: async () => [{ provider: notes, types: ['notes.v1'] }, { provider: devNotes, types: ['notes.v1'] }], list: async () => ({}), requestAccess: async () => ({ status: 'pending' }), revokeAccess: async () => undefined },
      pluginNames: async () => ({ 'otools-notes': '便笺' }),
    });
    const rows = await controller.discover();
    expect(rows.map(row => row.name)).toEqual(['便笺 · market', '便笺 · dev-debug']);
    expect(await controller.connect(notes, 'notes.v1')).toBe('pending');
    expect(await controller.disconnect(notes, 'notes.v1')).toBe('unauthorized');
  });
  it('reports an immediate grant when the host has already approved', async () => {
    const controller = createConnectionsController({
      data: { discover: async () => [], list: async () => ({}), requestAccess: async () => ({ status: 'granted' }), revokeAccess: async () => undefined },
    });
    expect(await controller.connect(notes, 'notes.v1')).toBe('granted');
  });
  it('keeps discovery usable when the name lookup is unavailable in old hosts', async () => {
    const controller = createConnectionsController({
      data: { discover: async () => [{ provider: notes, types: ['notes.v1'] }], list: async () => ({}), requestAccess: async () => ({ status: 'pending' }), revokeAccess: async () => undefined },
      pluginNames: async () => { throw new Error('unsupported'); },
    });
    expect((await controller.discover())[0].name).toBe('otools-notes');
  });
});
