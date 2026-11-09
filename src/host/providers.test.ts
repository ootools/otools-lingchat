import { describe, expect, it } from 'vitest';
import { providerKey, findProvider } from './providers';

describe('source-qualified provider selection', () => {
  it('keeps development and market providers with the same UUID distinct', () => {
    const market = { source: 'market', uuid: 'otools-notes' };
    const dev = { source: 'dev-debug', uuid: 'otools-notes' };
    expect(providerKey(market)).not.toBe(providerKey(dev));
    expect(findProvider([market, dev], providerKey(dev))).toEqual(dev);
    expect(findProvider([market, dev], 'otools-notes')).toBeUndefined();
  });
});
