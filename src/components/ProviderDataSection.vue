<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { getHost, unavailable } from '../host/bridge';
import type { ProviderIdentity } from '../host/providers';
import type { TextKey } from '../composables/i18n';
import Icon from './Icon.vue';
const props = defineProps<{ provider: ProviderIdentity; type: string; t: (key: TextKey) => string }>();
const emit = defineEmits<{ context: [text: string]; error: [error: unknown]; bubble: [text: string] }>();
interface Note { provider: ProviderIdentity; type: string; id: string; revision: number; updatedAt: number; deleted: boolean; data: { title?: string; body?: string; todos?: Array<{ id: string; text: string; done: boolean }> } }
const notes = shallowRef<Note[]>([]); const busy = ref(false);
const background = ref(false); const quietStart = ref('22:00'); const quietEnd = ref('08:00'); const cooldown = ref(60);
let cursor = ''; let poll: ReturnType<typeof setInterval> | undefined; let epoch = 0; let checking = false;
function api() { const data = getHost()?.data; if (!data) throw unavailable('插件数据服务'); return data; }
async function run(fn: () => Promise<void>) { busy.value = true; try { await fn(); } catch (error) { emit('error', error); } finally { busy.value = false; } }
async function load() {
  const current = ++epoch; const fresh: Note[] = []; let next: string | undefined;
  do {
    const page = await api().list({ provider: props.provider, type: props.type, cursor: next, limit: 100 });
    if (current !== epoch) return;
    fresh.push(...(page.items as Note[]).filter(item => !item.deleted)); next = page.next ?? undefined;
  } while (next);
  notes.value = fresh;
  if (getHost()?.reminders) {
    const status = await getHost()!.reminders!.status();
    const watches = Array.isArray(status) ? status : status.watches ?? [];
    background.value = watches.some((watch: { provider?: ProviderIdentity; type?: string; enabled?: boolean }) => watch.provider?.source === props.provider.source && watch.provider?.uuid === props.provider.uuid && watch.type === props.type && watch.enabled);
  }
}
async function tick() {
  if (checking) return;
  checking = true;
  try {
    const current = epoch;
    const result = await api().changes({ provider: props.provider, type: props.type, after: cursor, limit: 100 });
    if (current !== epoch) return;
    const merged = new Map(notes.value.map(note => [note.id, note]));
    for (const item of result.items as Note[]) { if (item.deleted) merged.delete(item.id); else merged.set(item.id, item); }
    notes.value = [...merged.values()]; cursor = result.after;
    if (background.value && getHost()?.reminders) {
      const due = await getHost()!.reminders!.pending();
      const items = Array.isArray(due) ? due : due.items ?? [];
      if (items.length && current === epoch) {
        emit('bubble', items.map((item: { title?: string; body?: string }) => [item.title, item.body].filter(Boolean).join(' · ')).filter(Boolean).join('\n'));
        await getHost()!.reminders!.acknowledge(items.map((item: { id: string }) => item.id));
      }
    }
  } catch {
    // A revoked grant immediately removes already rendered external material.
    notes.value = [];
  } finally { checking = false; }
}
async function useNote(note: Note) {
  const fresh = await api().get({ provider: note.provider, type: note.type, id: note.id }) as Note | null;
  if (!fresh || fresh.deleted) { await run(load); return; }
  emit('context', [fresh.data.title, fresh.data.body, ...(fresh.data.todos ?? []).map(todo => `${todo.done ? '[x]' : '[ ]'} ${todo.text}`)].filter(Boolean).join('\n'));
}
async function configure() {
  const reminders = getHost()?.reminders;
  if (!reminders) { background.value = false; throw unavailable('后台提醒服务'); }
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  await reminders.configure({ provider: props.provider, type: props.type, enabled: background.value, quietHours: { start: minutes(quietStart.value), end: minutes(quietEnd.value) }, cooldownMs: cooldown.value * 1000 });
}
onMounted(() => { void run(load); poll = setInterval(() => { void tick(); }, 2000); });
onBeforeUnmount(() => { epoch++; clearInterval(poll); notes.value = []; });
</script>
<template>
  <section class="surface connection-detail">
    <div class="card-heading"><span class="icon-tile warm"><Icon name="notes" /></span><div><h3>{{ t('notes') }}<code class="type-badge">{{ type }}</code></h3><p>{{ t('notesIntro') }}</p></div><button class="icon-button" :title="t('refresh')" :aria-label="t('refresh')" @click="run(load)"><Icon name="refresh" /></button></div>
    <div class="note-grid" v-if="notes.length"><article v-for="note in notes" :key="note.id" class="surface note-card"><span class="note-date">{{ new Date(note.updatedAt).toLocaleDateString() }}</span><h3>{{ note.data.title }}</h3><p class="note-body">{{ note.data.body }}</p><ul class="todo-list"><li v-for="todo in note.data.todos" :key="todo.id" :class="{ done: todo.done }"><Icon :name="todo.done ? 'check' : 'clock'" :size="15" />{{ todo.text }}</li></ul><button class="text-button" :disabled="busy" @click="run(() => useNote(note))">{{ t('useContext') }}<Icon name="arrow" :size="16" /></button></article></div>
    <div v-else class="empty-state compact-empty"><Icon name="notes" :size="36" /><p>{{ t('empty') }}</p></div>
    <div class="settings-group plain-group">
      <div class="card-heading"><span class="icon-tile"><Icon name="clock" /></span><div><h3>{{ t('reminders') }}</h3><p>{{ t('reminderEmpty') }}</p></div><label class="switch"><input v-model="background" type="checkbox" :disabled="!getHost()?.reminders" :aria-label="t('reminders')" @change="run(configure)" /><span /></label></div>
      <div class="inline-form"><label class="field">{{ t('stop') }}<input v-model="quietStart" type="time" :disabled="!background" @change="run(configure)" /></label><label class="field">{{ t('resume') }}<input v-model="quietEnd" type="time" :disabled="!background" @change="run(configure)" /></label><label class="field">{{ t('reminders') }} · s<input v-model.number="cooldown" type="number" min="60" max="86400" :disabled="!background" @change="run(configure)" /></label></div>
    </div>
  </section>
</template>
