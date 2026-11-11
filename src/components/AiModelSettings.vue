<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getHost } from '../host/bridge';
import { useAiSettings } from '../host/aiSettings';
import { aiSettingsLabels } from '../host/aiSettingsLabels';
import Icon from './Icon.vue';
const props = defineProps<{ locale: string; beforeSave?: () => Promise<void> }>();
const model = useAiSettings(() => {
  const api = getHost()?.ai;
  return api?.models && api.saveSettings ? { models: () => api.models!(), saveSettings: settings => api.saveSettings!(settings) } : undefined;
});
const { models, selection, selectedModel, levels, loading, saving, loaded, available, dirty, missingModel, invalidEffort } = model;
const text = computed(() => aiSettingsLabels(props.locale));
const notice = ref(''); const error = ref('');
async function load() {
  notice.value = ''; error.value = '';
  try { await model.load(); } catch { error.value = text.value.loadFailed; }
}
async function save() {
  notice.value = ''; error.value = '';
  try { await props.beforeSave?.(); await model.save(); notice.value = text.value.saved; }
  catch { error.value = text.value.saveFailed; }
}
async function reset() {
  notice.value = ''; error.value = '';
  try { await props.beforeSave?.(); await model.reset(); notice.value = text.value.saved; }
  catch { error.value = text.value.saveFailed; }
}
function selectModel(event: Event) { model.selectModel((event.target as HTMLSelectElement).value || null); notice.value = ''; }
onMounted(() => { if (available.value) void load(); });
</script>
<template>
  <section class="surface settings-group">
    <div class="card-heading"><span class="icon-tile warm"><Icon name="sparkle" /></span><div><h3>{{ text.title }}</h3><p>{{ text.description }}</p></div><button class="button" :disabled="!available || loading || saving" @click="load">{{ loading ? text.loading : text.refresh }}</button></div>
    <p v-if="!available" class="hint">{{ text.unsupported }}</p>
    <template v-else>
      <label class="field"><span>{{ text.model }}</span><select :value="selection.model ?? ''" :disabled="!loaded || loading || saving" @change="selectModel"><option value="">{{ text.follow }}</option><option v-if="missingModel" :value="selection.model!" disabled>{{ selection.model }} · {{ text.missing }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.id }}</option></select></label>
      <p v-if="missingModel" class="hint" role="alert">{{ text.missing }}</p>
      <label class="field endpoint-field"><span>{{ text.reasoning }}</span><select v-model="selection.reasoningEffort" :disabled="loading || saving || !levels.length"><option :value="null">{{ text.defaultReasoning }}</option><option v-if="invalidEffort" :value="selection.reasoningEffort!" disabled>{{ selection.reasoningEffort }} · {{ text.missing }}</option><option v-for="level in levels" :key="level.effort" :value="level.effort">{{ level.effort }}{{ level.description ? ` — ${level.description}` : '' }}</option></select></label>
      <p v-if="loaded && !levels.length" class="hint">{{ text.reasoningUnknown }}</p>
      <p v-else-if="selectedModel?.defaultReasoningLevel" class="hint">{{ text.recommended }} · {{ selectedModel.defaultReasoningLevel }}</p>
      <div v-if="selectedModel" class="section-actions wrap"><span v-for="capability in selectedModel.capabilities" :key="capability" class="status-pill neutral">{{ capability }}</span><span v-if="selectedModel.contextWindow" class="status-pill neutral">{{ text.context }} · {{ selectedModel.contextWindow.toLocaleString() }}</span></div>
      <div class="section-actions"><button class="button primary" :disabled="!loaded || !dirty || loading || saving || missingModel || invalidEffort" @click="save">{{ saving ? text.loading : text.save }}</button><button class="button" :disabled="loading || saving" @click="reset">{{ text.follow }}</button><span v-if="notice" role="status">{{ notice }}</span></div>
      <p v-if="error" class="hint" role="alert">{{ error }}</p>
    </template>
  </section>
</template>
