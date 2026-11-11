<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { createConnectionsController, type ConnectionItem, type ConsentStatus } from '../host/connections';
import { getHost, unavailable } from '../host/bridge';
import { providerKey } from '../host/providers';
import type { TextKey } from '../composables/i18n';
import ProviderDataSection from './ProviderDataSection.vue';
import Icon from './Icon.vue';
const props = defineProps<{ t: (key: TextKey) => string }>();
const emit = defineEmits<{ context: [text: string]; error: [error: unknown]; bubble: [text: string] }>();
interface Row { provider: { source: string; uuid: string }; types: string[]; name: string }
type ConnectionState = 'connected' | 'unauthorized' | 'pending' | 'denied' | 'cancelled' | 'expired';
interface PendingRequest { id?: string; items: ConnectionItem[]; expiresAt: number }
const rows = shallowRef<Row[]>([]);
const states = shallowRef<Map<string, ConnectionState>>(new Map());
const selected = shallowRef<Set<string>>(new Set());
const pending = shallowRef<Map<string, PendingRequest>>(new Map());
const busy = ref(false); const loaded = ref(false);
let poll: ReturnType<typeof setTimeout> | undefined;
let epoch = 0; let polling = false; let disposed = false;
const hasHost = () => !!getHost()?.data;
function api() { const data = getHost()?.data; if (!data) throw unavailable('插件数据服务'); return data; }
function controller() { return createConnectionsController({ data: api() as never }); }
const keyOf = (item: ConnectionItem) => JSON.stringify([item.provider.source, item.provider.uuid, item.type]);
const pairs = computed(() => rows.value.flatMap(row => row.types.map(type => ({ provider: row.provider, type, name: row.name }))));
const readyToConnect = computed(() => pairs.value.filter(item => selected.value.has(keyOf(item)) && !['connected', 'pending'].includes(states.value.get(keyOf(item)) ?? 'unauthorized')));
const connectedPairs = computed(() => pairs.value.filter(item => states.value.get(keyOf(item)) === 'connected'));
function updateState(items: ConnectionItem[], state: ConnectionState) {
  const next = new Map(states.value);
  for (const item of items) next.set(keyOf(item), state);
  states.value = next;
}
async function run(fn: () => Promise<void>) {
  if (busy.value || disposed) return;
  busy.value = true;
  try { await fn(); } catch (error) { if (!disposed) emit('error', error); }
  finally { if (!disposed) busy.value = false; }
}
async function refresh() {
  const current = ++epoch;
  const discovered = await controller().discover();
  if (current !== epoch || disposed) return;
  const next = new Map<string, ConnectionState>();
  for (const row of discovered) {
    for (const type of row.types) {
      const item = { provider: row.provider, type }; const key = keyOf(item);
      if (states.value.get(key) === 'pending') { next.set(key, 'pending'); continue; }
      const granted = await controller().probeGrantState(row.provider, type) === 'connected';
      if (current !== epoch || disposed) return;
      next.set(key, granted ? 'connected' : (states.value.get(key) ?? 'unauthorized'));
      if (!granted && next.get(key) === 'connected') next.set(key, 'unauthorized');
    }
  }
  rows.value = discovered; states.value = next;
  // Initial suggested selection is limited to the currently discovered providers.
  if (!loaded.value) selected.value = new Set([...next].filter(([, state]) => state !== 'connected').map(([key]) => key));
  loaded.value = true;
}
function choose(item: ConnectionItem, checked: boolean) {
  const next = new Set(selected.value); const key = keyOf(item);
  if (checked) next.add(key); else next.delete(key);
  selected.value = next;
}
function schedulePoll() {
  if (!disposed && pending.value.size && !poll) {
    poll = setTimeout(() => { poll = undefined; void pollPending(); }, 2000);
  }
}
async function connect(items: ConnectionItem[]) {
  if (!items.length) return;
  const current = epoch;
  const result = await controller().connectBatch(items);
  if (disposed || current !== epoch) return;
  if (result.status === 'granted') {
    for (const item of items) {
      const granted = await controller().probeGrantState(item.provider, item.type) === 'connected';
      if (disposed || current !== epoch) return;
      updateState([item], granted ? 'connected' : 'unauthorized');
    }
    return;
  }
  if (result.status !== 'pending') { updateState(items, result.status as ConnectionState); return; }
  updateState(items, 'pending');
  const id = result.id || keyOf(items[0]);
  pending.value = new Map(pending.value).set(id, { id: result.id, items, expiresAt: result.expiresAt || Date.now() + 300_000 });
  schedulePoll();
}
async function pollPending() {
  if (polling || disposed) return;
  polling = true;
  try {
    const current = epoch;
    for (const [key, request] of [...pending.value]) {
      let result: ConsentStatus;
      try {
        if (Date.now() >= request.expiresAt) result = { status: 'expired' };
        else if (request.id && api().accessStatus) result = await controller().accessStatus(request.id);
        else {
          const granted = await Promise.all(request.items.map(item => controller().probeGrantState(item.provider, item.type)));
          result = { status: granted.every(state => state === 'connected') ? 'granted' : 'pending' };
        }
      } catch (error) {
        if (disposed || current !== epoch) return;
        const code = (error as { code?: string })?.code;
        if (code === 'unavailable') { emit('error', error); continue; }
        result = { status: 'cancelled' };
      }
      if (disposed || current !== epoch) return;
      if (result.status === 'pending') continue;
      if (result.status === 'granted') {
        const confirmed: Array<{ item: ConnectionItem; granted: boolean }> = [];
        try {
          for (const item of request.items) {
            const granted = await controller().probeGrantState(item.provider, item.type) === 'connected';
            if (disposed || current !== epoch) return;
            confirmed.push({ item, granted });
          }
        } catch (error) {
          if (!disposed && current === epoch) emit('error', error);
          continue; // Keep the pending request so a transient read error can recover.
        }
        for (const { item, granted } of confirmed) updateState([item], granted ? 'connected' : 'unauthorized');
      } else updateState(request.items, result.status as ConnectionState);
      pending.value = new Map([...pending.value].filter(([id]) => id !== key));
    }
  } catch (error) { if (!disposed) emit('error', error); }
  finally { polling = false; schedulePoll(); }
}
async function disconnect(item: ConnectionItem) {
  // Keep the previous grant indicator if withdrawal fails.
  await controller().disconnect(item.provider, item.type);
  if (!disposed) updateState([item], 'unauthorized');
}
function stateText(item: ConnectionItem): TextKey {
  switch (states.value.get(keyOf(item))) {
    case 'connected': return 'connected';
    case 'pending': return 'waitingConsent';
    case 'denied': return 'connectionDenied';
    case 'cancelled': return 'connectionCancelled';
    case 'expired': return 'connectionExpired';
    default: return 'notConnected';
  }
}
onMounted(() => { if (hasHost()) void run(refresh); });
onBeforeUnmount(() => { disposed = true; epoch++; clearTimeout(poll); pending.value = new Map(); });
</script>
<template>
  <div class="section-intro"><div class="eyebrow">PLUGIN CONNECTIONS</div><h2>{{ t('connections') }}</h2><p>{{ t('connectionsIntro') }}</p></div>
  <p v-if="!hasHost()" class="hint">{{ t('unavailable') }}</p>
  <template v-else>
    <section v-if="loaded && rows.length" class="surface connection-card">
      <div class="card-heading"><span class="icon-tile"><Icon name="connections" /></span><div><h3>{{ t('dataConnectionsBundle') }}</h3><p>{{ t('dataConnectionsHint') }}</p></div></div>
      <div class="section-actions">
        <button data-connect-selected class="button primary" :disabled="busy || pending.size > 0 || !readyToConnect.length" @click="run(() => connect(readyToConnect.map(({ provider, type }) => ({ provider, type }))))">{{ t('connectSelected') }}</button>
        <button class="button" :disabled="busy || pending.size > 0" @click="run(refresh)">{{ t('refresh') }}</button>
      </div>
    </section>
    <div v-if="loaded && !rows.length" class="empty-state compact-empty"><Icon name="connections" :size="36" /><p>{{ t('pluginEmpty') }}</p></div>
    <section v-for="row in rows" :key="providerKey(row.provider)" class="surface connection-card">
      <div class="card-heading"><span class="icon-tile"><Icon name="connections" /></span><div><h3>{{ row.name }}</h3><p>{{ t('pluginAccess') }}</p></div></div>
      <label v-for="type in row.types" :key="type" class="setting-row connection-row">
        <span><code class="type-badge">{{ type }}</code><small>{{ t(stateText({ provider: row.provider, type })) }}</small></span>
        <button v-if="states.get(keyOf({ provider: row.provider, type })) === 'connected'" class="text-button" :disabled="busy" @click.prevent="run(() => disconnect({ provider: row.provider, type }))">{{ t('disconnectData') }}</button>
        <span v-else class="switch"><input type="checkbox" :checked="selected.has(keyOf({ provider: row.provider, type }))" :disabled="busy || states.get(keyOf({ provider: row.provider, type })) === 'pending'" :aria-label="`${row.name} ${type}`" @change="choose({ provider: row.provider, type }, ($event.target as HTMLInputElement).checked)" /><span /></span>
      </label>
    </section>
  </template>
  <template v-for="pair in connectedPairs" :key="keyOf(pair)">
    <ProviderDataSection :provider="pair.provider" :type="pair.type" :t="t" @disconnected="updateState([pair], 'unauthorized')" @context="text => emit('context', text)" @error="error => emit('error', error)" @bubble="text => emit('bubble', text)" />
  </template>
</template>
