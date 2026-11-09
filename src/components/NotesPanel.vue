<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { getHost, unavailable } from '../host/bridge';
import Icon from './Icon.vue';
import { providerKey } from '../host/providers';
import type { TextKey } from '../composables/i18n';
const props = defineProps<{ t: (key: TextKey) => string }>();
const emit = defineEmits<{ context: [text: string]; error: [error: unknown]; bubble: [text: string] }>();
interface Provider { source: string; uuid: string }
interface Note { provider: Provider; type: string; id: string; revision: number; updatedAt: number; deleted: boolean; data: { title?: string; body?: string; todos?: Array<{ id: string; text: string; done: boolean }> } }
const providers = shallowRef<Array<{ provider: Provider; types: string[] }>>([]);
const selected = ref(''); const notes = shallowRef<Note[]>([]); const busy = ref(false); const pending = ref(false);
const background = ref(false); const quietStart = ref('22:00'); const quietEnd = ref('08:00'); const cooldown = ref(60);
const access = ref(false); let cursor = ''; let poll: ReturnType<typeof setInterval> | undefined; let epoch = 0; let checking = false;
const provider = () => providers.value.find(item => providerKey(item.provider) === selected.value)?.provider;
function api() { const data = getHost()?.data; if (!data) throw unavailable('便笺数据服务'); return data; }
async function run(fn: () => Promise<void>) { busy.value = true; try { await fn(); } catch (error) { emit('error', error); } finally { busy.value = false; } }
async function discover() { providers.value = (await api().discover()).filter((item: { types: string[] }) => item.types.includes('notes.v1')); }
async function load() {
  const owner = provider(); if (!owner) return;
  const current = ++epoch; notes.value = []; access.value = false; cursor = ''; let next: string | undefined;
  do {
    const page = await api().list({ provider: owner, type: 'notes.v1', cursor: next, limit: 100 });
    if (current !== epoch) return;
    notes.value = [...notes.value, ...page.items.filter((item: Note) => !item.deleted)]; cursor = page.after; next = page.next ?? undefined;
  } while (next);
  access.value = true; pending.value = false;
  if (getHost()?.reminders) {
    const status = await getHost()!.reminders!.status();
    const watches = Array.isArray(status) ? status : status.watches ?? [];
    background.value = watches.some((watch: { provider?: Provider; enabled?: boolean }) => watch.provider?.source === owner.source && watch.provider?.uuid === owner.uuid && watch.enabled);
  }
}
async function request() {
  const owner = provider(); if (!owner) return;
  const result = await api().requestAccess({ provider: owner, type: 'notes.v1', subscribe: true, scope: { kind: 'all' } });
  pending.value = result.status === 'pending'; if (result.status === 'granted') await load();
}
async function revoke() {
  const owner = provider(); if (!owner) return;
  await api().revokeAccess({ provider: owner, type: 'notes.v1' }); epoch++; notes.value = []; access.value = false; background.value = false;
}
async function tick() {
  if (checking || !provider() || (!access.value && !pending.value)) return;
  checking = true;
  try {
    if (pending.value) { await load(); return; }
    const current = epoch; const owner = provider()!;
    const result = await api().changes({ provider: owner, type: 'notes.v1', after: cursor, limit: 100 });
    if (current !== epoch) return;
    const merged = new Map(notes.value.map(note => [note.id, note]));
    for (const item of result.items as Note[]) { if (item.deleted) merged.delete(item.id); else merged.set(item.id, item); }
    notes.value = [...merged.values()]; cursor = result.after;
    if (background.value && getHost()?.reminders) {
      const result = await getHost()!.reminders!.pending();
      const items = Array.isArray(result) ? result : result.items ?? [];
      if (items.length && current === epoch) {
        emit('bubble', items.map((item: { title?: string; body?: string }) => [item.title, item.body].filter(Boolean).join(' · ')).filter(Boolean).join('\n'));
        await getHost()!.reminders!.acknowledge(items.map((item: { id: string }) => item.id));
      }
    }
  } catch {
    // A revoked grant immediately removes already rendered external material.
    notes.value = []; access.value = false;
  } finally { checking = false; }
}
async function useNote(note: Note) {
  const fresh = await api().get({ provider: note.provider, type: note.type, id: note.id }) as Note | null;
  if (!fresh || fresh.deleted) { await load(); return; }
  emit('context', [fresh.data.title, fresh.data.body, ...(fresh.data.todos ?? []).map(todo => `${todo.done ? '[x]' : '[ ]'} ${todo.text}`)].filter(Boolean).join('\n'));
}
async function configure() {
  const owner = provider(); const reminders = getHost()?.reminders;
  if (!owner || !reminders) { background.value = false; throw unavailable('后台提醒服务'); }
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  await reminders.configure({ provider: owner, type: 'notes.v1', enabled: background.value, quietHours: { start: minutes(quietStart.value), end: minutes(quietEnd.value) }, cooldownMs: cooldown.value * 1000 });
}
onMounted(() => { if (getHost()?.data) void run(discover); poll = setInterval(() => { void tick(); }, 2000); });
onBeforeUnmount(() => { epoch++; clearInterval(poll); notes.value = []; });
</script>
<template>
  <div class="section-intro"><div class="eyebrow">LITTLE THINGS</div><h2>{{ t('notes') }}</h2><p>{{ t('notesIntro') }}</p></div>
  <section class="surface access-card">
    <div class="card-heading"><span class="icon-tile"><Icon name="shield" /></span><div><h3>{{ t('connectNotes') }}</h3><p>{{ t('ephemeral') }}</p></div><button class="icon-button" :title="t('refresh')" @click="run(discover)"><Icon name="refresh" /></button></div>
    <div class="inline-form"><select v-model="selected" :aria-label="t('connectNotes')" @change="run(load)"><option value="">{{ t('choose') }}</option><option v-for="item in providers" :key="providerKey(item.provider)" :value="providerKey(item.provider)">{{ item.provider.uuid }} · {{ item.provider.source }}</option></select><button class="button primary" :disabled="!selected || busy" @click="run(request)">{{ t('permissions') }}</button><button v-if="access" class="button subtle" @click="run(revoke)">{{ t('delete') }}</button></div>
    <p v-if="pending" class="hint">{{ t('pendingConsent') }}</p>
    <p v-if="!getHost()?.data" class="hint">{{ t('unavailable') }}</p>
  </section>
  <div class="note-grid" v-if="notes.length"><article v-for="note in notes" :key="note.id" class="surface note-card"><span class="note-date">{{ new Date(note.updatedAt).toLocaleDateString() }}</span><h3>{{ note.data.title }}</h3><p class="note-body">{{ note.data.body }}</p><ul class="todo-list"><li v-for="todo in note.data.todos" :key="todo.id" :class="{ done: todo.done }"><Icon :name="todo.done ? 'check' : 'clock'" :size="15" />{{ todo.text }}</li></ul><button class="text-button" @click="run(() => useNote(note))">{{ t('useContext') }}<Icon name="arrow" :size="16" /></button></article></div>
  <div v-else class="empty-state compact-empty"><Icon name="notes" :size="36"/><p>{{ t('empty') }}</p></div>
  <section class="surface settings-group">
    <div class="card-heading"><span class="icon-tile warm"><Icon name="clock" /></span><div><h3>{{ t('reminders') }}</h3><p>{{ t('reminderEmpty') }}</p></div><label class="switch"><input v-model="background" type="checkbox" :disabled="!access || !getHost()?.reminders" :aria-label="t('reminders')" @change="run(configure)"/><span /></label></div>
    <div class="inline-form"><label class="field">{{ t('stop') }}<input v-model="quietStart" type="time" :disabled="!background" @change="run(configure)"/></label><label class="field">{{ t('resume') }}<input v-model="quietEnd" type="time" :disabled="!background" @change="run(configure)"/></label><label class="field">{{ t('reminders') }} · s<input v-model.number="cooldown" type="number" min="60" max="86400" :disabled="!background" @change="run(configure)"/></label></div>
  </section>
</template>
