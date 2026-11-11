import { computed, ref, shallowRef } from 'vue';
import type { AiApi, AiModelCatalog, AiModelInfo, AiSelection } from 'otools-plugin-sdk/ai-factory';

export type SettingsApi = Pick<AiApi, 'models' | 'saveSettings'>;
const same = (a: AiSelection, b: AiSelection) => a.model === b.model && a.reasoningEffort === b.reasoningEffort;
const defaults = (): AiSelection => ({ model: null, reasoningEffort: null });

/** Host persists these preferences against the authenticated plugin identity. */
export function useAiSettings(getApi: () => SettingsApi | undefined) {
  const models = shallowRef<AiModelInfo[]>([]);
  const defaultModel = ref('');
  const selection = ref<AiSelection>(defaults());
  const saved = ref<AiSelection>(defaults());
  const loading = ref(false); const saving = ref(false); const loaded = ref(false);
  const available = computed(() => Boolean(getApi()?.models && getApi()?.saveSettings));
  const dirty = computed(() => !same(selection.value, saved.value));
  const selectedModel = computed(() => models.value.find(model => model.id === selection.value.model));
  const levels = computed(() => selectedModel.value?.reasoningLevels ?? []);
  const missingModel = computed(() => loaded.value && selection.value.model !== null && !selectedModel.value);
  const invalidEffort = computed(() => selection.value.reasoningEffort !== null && !levels.value.some(level => level.effort === selection.value.reasoningEffort));
  const api = () => { const value = getApi(); if (!value?.models || !value.saveSettings) throw new Error('unsupported'); return value; };
  return {
    models, defaultModel, selection, saved, loading, saving, loaded, available, dirty,
    selectedModel, levels, missingModel, invalidEffort,
    selectModel(model: string | null) { selection.value = { model, reasoningEffort: null }; },
    async load(): Promise<void> {
      if (loading.value || saving.value) return;
      loading.value = true;
      const wasDirty = dirty.value;
      const before = { ...selection.value };
      try {
        const result: AiModelCatalog = await api().models();
        models.value = result.models; defaultModel.value = '';
        saved.value = { ...result.selection };
        if (!wasDirty && same(before, selection.value)) selection.value = { ...result.selection };
        loaded.value = true;
      } finally { loading.value = false; }
    },
    async reset(): Promise<void> {
      if (saving.value || loading.value) throw new Error('busy');
      saving.value = true;
      try {
        const result = await api().saveSettings(defaults());
        saved.value = { ...result }; selection.value = { ...result };
      } finally { saving.value = false; }
    },
    async save(): Promise<void> {
      if (saving.value || loading.value) throw new Error('busy');
      if (!loaded.value) throw new Error('modelsNotLoaded');
      if (missingModel.value) throw new Error('modelUnavailable');
      if (invalidEffort.value) throw new Error('reasoningUnsupported');
      const request = { model: selection.value.model, reasoningEffort: selection.value.reasoningEffort };
      saving.value = true;
      try {
        const result = await api().saveSettings(request);
        saved.value = { ...result };
        if (same(request, selection.value)) selection.value = { ...result };
      } finally { saving.value = false; }
    },
  };
}
