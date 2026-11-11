import { describe, expect, it, vi } from 'vitest';
import { hostAgentPreferences } from './agent';

describe('host-backed Agent model selection', () => {
  it('never inherits a catalog default when this plugin has no selection', async () => {
    const ai = { models: async () => ({ selection: { model: null, reasoningEffort: null }, defaultModel: 'obsolete-default' }) };
    expect(await hostAgentPreferences(ai)).toEqual({ model: null, reasoningEffort: null });
  });
  it('never inherits capabilities.model on the legacy preference path', async () => {
    const capabilities = vi.fn(async () => ({ model: 'obsolete-default' }));
    const ai = { getSettings: async () => ({ model: null, reasoningEffort: null }), capabilities };
    expect(await hostAgentPreferences(ai)).toEqual({ model: null, reasoningEffort: null });
    expect(capabilities).not.toHaveBeenCalled();
  });
  it('keeps the current plugin selection and reasoning option', async () => {
    expect(await hostAgentPreferences({ models: async () => ({ selection: { model: 'chosen', reasoningEffort: 'high' }, defaultModel: 'obsolete' }) })).toEqual({ model: 'chosen', reasoningEffort: 'high' });
  });
});
