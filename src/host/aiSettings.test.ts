import { describe, expect, it } from 'vitest';
import { useAiSettings } from './aiSettings';
import type { AiModelCatalog, AiSelection } from 'otools-plugin-sdk/ai-factory';

const catalog: AiModelCatalog = { defaultModel: 'balanced', selection: { model: null, reasoningEffort: null }, models: [
  { id: 'balanced', ownedBy: 'ai-switch', capabilities: ['text.generate'], reasoningLevels: [], defaultReasoningLevel: null, contextWindow: null },
  { id: 'thinking', ownedBy: 'ai-switch', capabilities: ['text.generate', 'image.input'], reasoningLevels: [{ effort: 'high', description: 'Careful' }, { effort: 'xhigh', description: 'More thorough' }], defaultReasoningLevel: 'high', contextWindow: 200000 },
] };
function setup() {
  const saved: AiSelection[] = [];
  const api = { models: async () => structuredClone(catalog), saveSettings: async (selection: AiSelection) => { saved.push(selection); return selection; } };
  return { api, saved, state: useAiSettings(() => api) };
}
describe('host-owned plugin model selection', () => {
  it('loads the catalog without silently selecting an old host default', async () => {
    const { state } = setup(); await state.load();
    expect(state.selection.value).toEqual({ model: null, reasoningEffort: null });
    expect(state.selectedModel.value).toBeUndefined();
    expect(state.levels.value).toEqual([]);
  });
  it('saves a catalog model and advertised reasoning effort without provider secrets', async () => {
    const { state, saved } = setup(); await state.load();
    state.selectModel('thinking'); state.selection.value.reasoningEffort = 'xhigh';
    await state.save();
    expect(saved).toEqual([{ model: 'thinking', reasoningEffort: 'xhigh' }]);
    expect(state.dirty.value).toBe(false);
    expect(state.selectedModel.value?.contextWindow).toBe(200000);
  });
  it('resets old reasoning preferences when switching model and rejects unsupported efforts', async () => {
    const { state, saved } = setup(); await state.load();
    state.selectModel('thinking'); state.selection.value.reasoningEffort = 'xhigh';
    state.selectModel('balanced'); expect(state.selection.value.reasoningEffort).toBeNull();
    state.selection.value.reasoningEffort = 'xhigh';
    await expect(state.save()).rejects.toThrow(); expect(saved).toEqual([]);
  });
  it('does not silently replace a saved model which vanished from the catalog', async () => {
    const { api, state, saved } = setup();
    api.models = async () => ({ ...structuredClone(catalog), selection: { model: 'removed', reasoningEffort: 'high' } });
    await state.load(); expect(state.selection.value.model).toBe('removed');
    await expect(state.save()).rejects.toThrow(); expect(saved).toEqual([]);
    state.selectModel(null); await state.save();
    expect(saved).toEqual([{ model: null, reasoningEffort: null }]);
  });
  it('preserves previous committed settings when host rejects a save', async () => {
    const { api, state } = setup(); await state.load(); state.selectModel('thinking');
    api.saveSettings = async () => { throw new Error('model catalog unavailable'); };
    await expect(state.save()).rejects.toThrow('model catalog unavailable');
    expect(state.saved.value.model).toBeNull(); expect(state.dirty.value).toBe(true);
    expect(state.saving.value).toBe(false);
  });
  it('allows restoring host defaults even when model discovery is offline', async () => {
    const { api, state, saved } = setup();
    api.models = async () => { throw new Error('offline'); };
    await expect(state.load()).rejects.toThrow('offline');
    await state.reset();
    expect(saved).toEqual([{ model: null, reasoningEffort: null }]);
    expect(state.selection.value.model).toBeNull();
  });
  it('reports unsupported host APIs without inventing a model list', async () => {
    const state = useAiSettings(() => undefined);
    await expect(state.load()).rejects.toThrow('unsupported');
    expect(state.models.value).toEqual([]); expect(state.available.value).toBe(false);
  });
});
