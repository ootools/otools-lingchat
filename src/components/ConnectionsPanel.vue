<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { createConnectionsController } from '../host/connections';
import { getHost, unavailable } from '../host/bridge';
import { providerKey, type ProviderIdentity } from '../host/providers';
import type { TextKey } from '../composables/i18n';
import ProviderDataSection from './ProviderDataSection.vue';
import Icon from './Icon.vue';
const props = defineProps<{ t: (key: TextKey) => string }>();
const emit = defineEmits<{ context: [text: string]; error: [error: unknown]; bubble: [text: string] }>();
interface Provider { source: string; uuid: string }
interface Row { provider: Provider; types: string[]; name: string }
const rows = shallowRef<Row[]>([]);
const state = shallowRef<Map<string, boolean>>(new Map());
const pending = shallowRef<Set<string>>(new Set());
const busy = ref(false); const loaded = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;
let epoch = 0;
const hasHost = () => !!getHost()?.data;
function api() { const data = getHost()?.data; if (!data) throw unavailable('插件数据服务'); return data; }
function controller() { return createConnectionsController({ data: api() as never }); }
const keyOf = (row: Row, type: string) => `${providerKey(row.provider)}|${type}`;
const rowOf = (key: string) => rows.value.find(row => row.types.some(type => keyOf(row, type) === key));
const typeOf = (key: string) => key.split('|')[1];
async function run(fn: () => Promise<void>) { busy.value = true; try { await fn(); } catch (error) { emit('error', error); } finally { busy.value = false; } }
async function refresh() {
  const current = ++epoch;
  const discovered = await controller().discover();
  if (current !== epoch) return;
  rows.value = discovered;
  const states = new Map<string, boolean>();
  for (const row of discovered) {
    for (const type of row.types) {
      if (pending.value.has(keyOf(row, type))) { states.set(keyOf(row, type), true); continue; }
      states.set(keyOf(row, type), await controller().probeGrantState(row.provider, type) === 'connected');
    }
  }
  if (current !== epoch) return;
  state.value = states; loaded.value = true;
}
function isConnected(key: string) { return state.value.get(key) === true; }
function isPending(key: string) { return pending.value.has(key); }
async function toggle(row: Row, type: string) {
  const key = keyOf(row, type); const control = controller();
  if (isPending(key)) return;
  if (isConnected(key)) {
    state.value = new Map(state.value).set(key, false);
    await control.disconnect(row.provider, type);
    return;
  }
  const result = await control.connect(row.provider, type);
  if (result === 'granted') { state.value = new Map(state.value).set(key, true); return; }
  pending.value = new Set(pending.value).add(key);
  state.value = new Map(state.value).set(key, true);
  if (!poll) poll = setInterval(() => { void run(pollPending); }, 2000);
}
async function pollPending() {
  if (!pending.value.size) { if (poll) { clearInterval(poll); poll = undefined; } return; }
  const current = ++epoch;
  for (const key of [...pending.value]) {
    const row = rowOf(key); if (!row) { pending.value = new Set([...pending.value].filter(item => item !== key)); continue; }
    try {
      if (await controller().probeGrantState(row.provider, typeOf(key)) === 'connected') {
        if (current !== epoch) return;
        pending.value = new Set([...pending.value].filter(item => item !== key));
        state.value = new Map(state.value).set(key, true);
      }
    } catch { /* Keep waiting for the native consent window. */ }
  }
}
const connectedPairs = computed(() => rows.value.flatMap(row => row.types.filter(type => isConnected(keyOf(row, type))).map(type => ({ provider: row.provider, type }))));
onMounted(() => { if (hasHost()) void run(refresh); });
onBeforeUnmount(() => { epoch++; if (poll) { clearInterval(poll); poll = undefined; } });
</script>
<template>
  <div class="section-intro"><div class="eyebrow">PLUGIN CONNECTIONS</div><h2>{{ t('connections') }}</h2><p>{{ t('connectionsIntro') }}</p></div>
  <p v-if="!hasHost()" class="hint">{{ t('unavailable') }}</p>
  <div v-else-if="loaded && !rows.length" class="empty-state compact-empty"><Icon name="connections" :size="36" /><p>{{ t('pluginEmpty') }}</p></div>
  <section v-for="row in rows" :key="providerKey(row.provider)" class="surface connection-card">
    <div class="card-heading"><span class="icon-tile"><Icon name="connections" /></span><div><h3>{{ row.name }}</h3><p>{{ t('pluginAccess') }}</p></div></div>
    <label v-for="type in row.types" :key="type" class="setting-row connection-row">
      <span><code class="type-badge">{{ type }}</code><small v-if="isPending(keyOf(row, type))">{{ t('waitingConsent') }}</small><small v-else-if="isConnected(keyOf(row, type))">{{ t('connected') }}</small><small v-else>{{ t('notConnected') }}</small></span>
      <span class="switch"><input type="checkbox" :checked="isConnected(keyOf(row, type))" :disabled="busy || isPending(keyOf(row, type))" :aria-label="`${row.name} ${type}`" @change="run(() => toggle(row, type))" /><span /></span>
    </label>
  </section>
  <template v-for="pair in connectedPairs" :key="providerKey(pair.provider) + pair.type">
    <ProviderDataSection :provider="pair.provider" :type="pair.type" :t="t" @context="text => emit('context', text)" @error="error => emit('error', error)" @bubble="text => emit('bubble', text)" />
  </template>
</template>
