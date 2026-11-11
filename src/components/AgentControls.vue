<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Companion } from '../composables/useCompanion';
const props = defineProps<{ companion: Companion; disabled?: boolean; compact?: boolean }>();
const c = props.companion;
const { agentMode, agentProviderId, agentProviders, agentLoading, agentHealth, agentActivity, agentText: text, agentAvailable, agentProvider, agentTools, selectedAgentTools, externalContext } = c;
const selected = ref<Record<string, string[]>>({}); const custom = ref<Record<string, string>>({}); const answering = ref(false);
watch(() => agentActivity.value.question?.id, () => { selected.value = Object.fromEntries((agentActivity.value.question?.questions ?? []).map(q => [q.id, []])); custom.value = Object.create(null); }, { immediate: true });
const answers = computed(() => Object.fromEntries((agentActivity.value.question?.questions ?? []).map(q => [q.id, [...(selected.value[q.id] ?? []), ...(custom.value[q.id]?.trim() ? [custom.value[q.id].trim()] : [])]])));
const canAnswer = computed(() => !!agentActivity.value.question && Object.values(answers.value).every(values => values.length > 0));
async function respond() {
  const question = agentActivity.value.question; if (!question || !canAnswer.value || answering.value) return;
  answering.value = true;
  try { await c.attempt(() => c.answerAgentQuestion(question.id, answers.value)); } finally { answering.value = false; }
}
function selectTool(name: string, checked: boolean) {
  void c.attempt(() => c.setAgentTools(checked ? [...selectedAgentTools.value, name] : selectedAgentTools.value.filter(value => value !== name)));
}
</script>

<template>
  <section class="agent-controls" :class="{ compact }" data-pet-hit :aria-label="text.mode">
    <div v-if="!compact" class="agent-toolbar">
      <label class="agent-mode"><input type="checkbox" :checked="agentMode" :disabled="disabled" @change="c.attempt(() => c.setAgentMode(($event.target as HTMLInputElement).checked))" />{{ text.mode }}</label>
      <template v-if="agentMode">
        <select :value="agentProviderId" :aria-label="text.engine" :disabled="disabled || agentLoading || !agentAvailable" @change="c.attempt(() => c.setAgentProvider(($event.target as HTMLSelectElement).value))">
          <option value="">{{ text.choose }}</option>
          <option v-if="agentProviderId && !agentProvider" :value="agentProviderId">{{ agentProviderId }} · {{ text.unavailable }}</option>
          <option v-for="provider in agentProviders" :key="provider.id" :value="provider.id">{{ provider.name }}{{ provider.available ? '' : ` · ${text.unavailable}` }}</option>
        </select>
        <button type="button" class="text-button" :disabled="disabled || agentLoading || !agentAvailable" @click="c.attempt(c.refreshAgent)">{{ text.refresh }}</button>
        <span v-if="agentHealth" role="status">{{ text[agentHealth.status] }}</span>
      </template>
    </div>
    <template v-if="agentMode">
      <div class="agent-state"><span role="status" aria-live="polite">{{ compact ? `${text.mode} · ` : '' }}{{ text[agentActivity.status] }}</span><button type="button" class="text-button" :disabled="!agentAvailable" @click="c.attempt(c.openAgentManager)">{{ text.manage }}</button></div>
      <template v-if="!compact">
        <p class="hint">{{ !agentAvailable ? text.unsupported : externalContext ? text.ephemeral : agentProvider?.adapter === 'acp' || agentProvider?.configuration === 'native' ? text.acp : text.codex }}</p>
        <p v-if="agentAvailable && (agentHealth?.status === 'missing' || agentHealth?.status === 'unavailable' || !agentProvider?.available)" class="hint">{{ text.engineUnavailable }}</p>
        <details v-if="agentAvailable" class="agent-tool-picker"><summary>{{ text.tools }} ({{ selectedAgentTools.length }})</summary><p class="hint">{{ text.toolsHint }}</p><label v-for="tool in agentTools" :key="tool.name" :title="tool.description"><input type="checkbox" :checked="selectedAgentTools.includes(tool.name)" :disabled="disabled" @change="selectTool(tool.name, ($event.target as HTMLInputElement).checked)" />{{ tool.title || tool.name }}</label></details>
        <p v-if="agentActivity.detail" class="hint">{{ agentActivity.detail }}</p>
        <details v-if="agentActivity.tools.length" class="agent-log"><summary>{{ text.activity }} ({{ agentActivity.tools.length }})</summary><p class="hint">{{ text.hint }}</p><ol><li v-for="(tool, index) in agentActivity.tools" :key="index">{{ tool }}</li></ol></details>
      </template>
      <div v-if="agentActivity.permission" class="agent-pending"><p>{{ agentActivity.permission.title }}</p><p v-if="!compact && agentActivity.permission.description" class="hint">{{ agentActivity.permission.description }}</p><button type="button" class="button" @click="c.attempt(() => c.openAgentPermission(agentActivity.permission!.id))">{{ text.approve }}</button></div>
      <form v-if="agentActivity.question" class="agent-pending" @submit.prevent="respond">
        <fieldset v-for="question in agentActivity.question.questions" :key="question.id" :disabled="answering"><legend>{{ question.header }} {{ question.question }}</legend><label v-for="option in question.options" :key="option.id" :title="option.description"><input v-model="selected[question.id]" type="checkbox" :value="option.id" />{{ option.label }}</label><input v-if="question.allowCustom" v-model="custom[question.id]" type="text" maxlength="4000" :aria-label="`${question.question} · ${text.custom}`" :placeholder="text.custom" /></fieldset>
        <button type="submit" class="button" :disabled="!canAnswer || answering">{{ text.answer }}</button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.agent-controls { flex: 0 0 auto; font-size: 12px; border-block-end: 1px solid var(--border, #e6dfd7); padding: 8px 20px; max-height: 32vh; overflow: auto; }
.agent-toolbar, .agent-state { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.agent-state { justify-content: space-between; margin-block-start: 5px; }
.agent-mode, .agent-tool-picker label, .agent-pending label { display: inline-flex; align-items: center; gap: 6px; margin-inline-end: 10px; }
.agent-toolbar select { width: auto; max-width: 220px; min-height: 28px; padding: 3px 8px; }
.agent-controls input[type=checkbox] { width: 14px; height: 14px; margin: 0; accent-color: #a5785b; }
.agent-controls .hint { margin: 5px 0; font-size: 11px; }
.agent-controls summary { cursor: pointer; margin-block: 6px; }
.agent-log ol { max-height: 120px; overflow: auto; padding-inline-start: 20px; overflow-wrap: anywhere; white-space: pre-wrap; }
.agent-pending { margin-block-start: 8px; }
.agent-pending fieldset { border: 0; margin: 6px 0; padding: 0; min-width: 0; }
.agent-pending legend { margin-block-end: 6px; overflow-wrap: anywhere; }
.agent-pending input[type=text] { margin-block: 6px; }
.compact { width: 100%; padding: 6px 10px; max-height: 140px; background: var(--surface, #fffaf4); border-radius: 12px; pointer-events: auto; }
</style>
