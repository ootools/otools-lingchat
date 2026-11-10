<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { useCompanion } from './composables/useCompanion';
import { languages } from './composables/i18n';
import { getHost, isExplicitPreview, nativeWindow } from './host/bridge';
import { MEMORY_LIMITS, type MemorySection } from './memory/schema';
import { visibleDialogue } from './dialogue/visible';
import type { ChatMessage, SaveRecord } from './saves/repository';
import Icon from './components/Icon.vue';
import Mascot from './components/Mascot.vue';
import MemoryEditor from './components/MemoryEditor.vue';
import StoryPanel from './components/StoryPanel.vue';
import ConnectionsPanel from './components/ConnectionsPanel.vue';
import EmotionModelPanel from './components/EmotionModelPanel.vue';

const c = useCompanion();
const {
  t, locale, direction, loading, busy, active, expanded, tab, draft, streamed,
  error, toast, bubble, emotion, avatar, characterName, currentCharacter,
  currentSave, messages, saves, saveId, roleId, role, characters,
  topmost, reduceMotion, scale, language, voice, notificationSound,
  observationStatus, targets, targetValue, externalContext,
} = c;
const explicitPreview = isExplicitPreview(window.location.search);
const navigation = ['chat', 'saves', 'characters', 'story', 'memory', 'connections', 'settings'] as const;
const memorySections = Object.keys(MEMORY_LIMITS) as MemorySection[];
const composerOpen = ref(false);
const acting = ref(false);
const newSaveOpen = ref(false);
const newSaveName = ref('');
const personaDraft = ref('');
const outfitDraft = ref('default');
const avatarBroken = ref(false);
const aiStatus = ref('');
const pendingUser = ref('');
const composer = ref<HTMLTextAreaElement | null>(null);
const chatScroll = ref<HTMLElement | null>(null);
let turn = 0;
let disposed = false;
let unlisten: UnlistenFn | undefined;
const host = computed(() => { void loading.value; return getHost(); });
const hasNative = computed(() => !explicitPreview && !!host.value);
const canReadFiles = computed(() => (explicitPreview && !host.value) || !!(host.value?.readHostFile || host.value?.hostReadFile));
const canWriteFiles = computed(() => (explicitPreview && !host.value) || !!host.value?.writeHostFile);
const canObserve = computed(() => !!(host.value?.observation?.targets && host.value.capture && host.value.ai));
const availableAi = computed(() => !!host.value?.ai || explicitPreview);
const canSend = computed(() => !loading.value && active.value && !!role.value && !busy.value && !acting.value && availableAi.value && !!draft.value.trim());
const canEdit = computed(() => !loading.value && active.value && !!role.value && !acting.value && !busy.value);
const avatarVisible = computed(() => !!avatar.value && !avatarBroken.value);
const panelTitle = computed(() => t(navigation.find(item => item === tab.value) ?? 'chat'));
const subtitle = computed(() => currentCharacter.value?.settings.ai_subtitle || t('petSubtitle'));
const petStyle = computed(() => ({ '--pet-scale': String(Math.min(1.3, Math.max(0.7, scale.value))) }));
const observationRunning = computed(() => observationStatus.value?.state === 'active' || observationStatus.value?.state === 'pending');

watch(avatar, () => { avatarBroken.value = false; });
watch(locale, value => { document.documentElement.lang = value; }, { immediate: true });
watch(direction, value => { document.documentElement.dir = value; }, { immediate: true });
watch([saveId, roleId, () => role.value?.persona, () => role.value?.outfitId], () => {
  personaDraft.value = role.value?.persona ?? '';
  outfitDraft.value = role.value?.outfitId ?? 'default';
});
watch([saveId, roleId], () => { turn++; pendingUser.value = ''; });
watch([messages, streamed, busy, expanded, tab], () => {
  void nextTick(() => {
    if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight;
  });
});

async function run(action: () => Promise<unknown>) {
  if (acting.value || loading.value || !active.value) return;
  acting.value = true;
  try { await c.attempt(action); } finally { acting.value = false; }
}
async function submit() {
  if (!canSend.value) return;
  const currentTurn = ++turn;
  pendingUser.value = draft.value.trim();
  try { await c.send(); } catch (value) { c.fail(value); }
  finally { if (turn === currentTurn) pendingUser.value = ''; }
}
function stopReply() { turn++; pendingUser.value = ''; c.stop(); }
function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
    event.preventDefault(); void submit();
  }
}
async function togglePanel() {
  if (!explicitPreview && !host.value) { expanded.value = !expanded.value; return; }
  await run(c.toggleExpanded);
  if (!expanded.value) startCursorManager();
  else await setNativeInteractive(true);
}
function selectTab(next: typeof navigation[number]) {
  tab.value = next;
  if (next === 'characters' || next === 'saves') void run(c.refresh);
}
function dragWindow(event: PointerEvent) {
  if (event.button !== 0 || !hasNative.value || (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, label'))) return;
  void c.attempt(nativeWindow.drag);
}
async function updateTopmost() {
  const requested = topmost.value;
  await run(async () => {
    try { await nativeWindow.topmost(requested); await c.preferences(); }
    catch (value) { topmost.value = !requested; throw value; }
  });
}
function toggleTopmost() { if (hasNative.value && !acting.value && !loading.value) { topmost.value = !topmost.value; void updateTopmost(); } }
async function createSave() {
  await run(async () => { await c.createSave(newSaveName.value); newSaveName.value = ''; newSaveOpen.value = false; });
}
function useNotesContext(text: string) { externalContext.value = text; tab.value = 'chat'; c.notify(t('ephemeral')); }
function messageText(message: ChatMessage) {
  return message.role === 'assistant' ? visibleDialogue(message.text) : message.text;
}
function date(value: string) { return new Date(value).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }); }
function time(value: string) { return new Date(value).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }); }
function messageCount(save: SaveRecord) { return Object.values(save.roles).reduce((count, item) => count + item.messages.length, 0); }
async function checkAi() { await run(async () => { await c.checkAi(); aiStatus.value = toast.value; }); }
/** The transparent window must not block other apps: it starts click-through and
 *  only becomes interactive while the cursor is over an actual hit zone. */
const CURSOR_POLL_MS = 120;
let hitPoll: ReturnType<typeof setInterval> | undefined;
let nativeInteractive = true;
let bounds: { x: number; y: number; scale: number; ready: boolean } = { x: 0, y: 0, scale: 1, ready: false };
function hitZones(): Array<{ x: number; y: number; w: number; h: number }> {
  const zones: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const node of document.querySelectorAll('[data-pet-hit]')) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      zones.push({ x: rect.x - 8, y: rect.y - 8, w: rect.width + 16, h: rect.height + 16 });
    }
  }
  return zones;
}
async function setNativeInteractive(next: boolean) {
  if (nativeInteractive === next || !hasNative.value || explicitPreview) return;
  nativeInteractive = next;
  try { await getCurrentWindow().setIgnoreCursorEvents(!next); }
  catch { nativeInteractive = !next; }
}
async function syncCursor() {
  if (!hasNative.value || explicitPreview || expanded.value || !active.value) return;
  const native = getCurrentWindow();
  if (!bounds.ready) {
    try {
      const [origin, scale] = await Promise.all([native.outerPosition(), native.scaleFactor()]);
      bounds = { x: origin.x, y: origin.y, scale: scale || 1, ready: true };
    } catch { return; }
  }
  const zones = hitZones();
  let hovering = false;
  if (zones.length) {
    try {
      const cursor = await cursorPosition();
      const x = (cursor.x - bounds.x) / bounds.scale;
      const y = (cursor.y - bounds.y) / bounds.scale;
      hovering = zones.some(zone => x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h);
    } catch { return; }
  }
  await setNativeInteractive(hovering);
}
function startCursorManager() {
  if (!hasNative.value || explicitPreview) return;
  nativeInteractive = true;
  void getCurrentWindow().setIgnoreCursorEvents(true).then(() => { nativeInteractive = false; }).catch(c.fail);
  hitPoll = setInterval(() => { void syncCursor(); }, CURSOR_POLL_MS);
  const invalidate = () => { bounds.ready = false; };
  void getCurrentWindow().onMoved(invalidate).catch(c.fail);
  void getCurrentWindow().onResized(invalidate).catch(c.fail);
}
function openComposer() {
  composerOpen.value = true;
  void nextTick(() => composer.value?.focus());
}
async function reopen() {
  if (disposed) return;
  await c.attempt(async () => { await c.reopen(); await c.refresh(); startCursorManager(); });
}
async function close() { turn++; pendingUser.value = ''; await c.attempt(c.close); }

onMounted(() => {
  void c.initialize();
  if (!explicitPreview && getHost()) {
    void listen('otools:custom-open', () => { void reopen(); }).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(c.fail);
    startCursorManager();
  }
});
onBeforeUnmount(() => {
  disposed = true; turn++; unlisten?.();
  if (hitPoll) { clearInterval(hitPoll); hitPoll = undefined; }
  void c.dispose().catch(c.fail);
});
</script>

<template>
  <div class="app-shell" :class="{ expanded, 'reduced-motion': reduceMotion }" :style="petStyle" :dir="direction" :lang="locale">
    <section v-if="active && !expanded" class="pet-window" :aria-label="t('companion')">
      <header class="pet-header drag-handle" data-pet-hit :title="t('drag')" @pointerdown="dragWindow">
        <span class="pet-brand"><Icon name="characters" :size="17" />{{ t('app') }}<span class="status-dot" :class="{ muted: !availableAi }" /></span>
        <div class="window-actions">
          <button class="icon-button" :class="{ selected: topmost && hasNative }" :disabled="!hasNative || loading || acting" :aria-label="t('topmost')" :aria-pressed="topmost && hasNative" :title="t('topmost')" @click="toggleTopmost"><Icon name="pin" :size="16" /></button>
          <button class="icon-button" :disabled="loading || acting" :aria-label="t('expand')" :title="t('expand')" @click="togglePanel"><Icon name="expand" :size="17" /></button>
          <button class="icon-button close-button" :disabled="loading || (!hasNative && !explicitPreview)" :aria-label="t('close')" :title="t('close')" @click="close"><Icon name="close" :size="17" /></button>
        </div>
      </header>
      <div class="pet-bubble" data-pet-hit role="status" aria-live="polite"><span class="bubble-spark"><Icon name="sparkle" :size="15" /></span><p>{{ loading ? t('loading') : bubble || t('welcome') }}</p><span v-if="busy" class="typing-dots" aria-hidden="true"><i /><i /><i /></span></div>
      <button class="pet-avatar" data-pet-hit :disabled="loading || acting" :aria-label="t('pet')" :title="t('pet')" @click="run(c.pet)">
        <img v-if="avatarVisible" :src="avatar" :alt="characterName" class="imported-avatar" @error="avatarBroken = true" />
        <Mascot v-else :emotion="emotion" compact />
      </button>
      <div class="pet-caption" data-pet-hit><strong>{{ characterName }}</strong><span><Icon name="heart" :size="12" />{{ role?.bond ?? 0 }}</span></div>
      <button v-if="!composerOpen" class="pet-fab" data-pet-hit :aria-label="t('chat')" :title="t('chat')" @click="openComposer"><Icon name="chat" :size="18" /></button>
      <form v-else class="compact-composer" data-pet-hit @submit.prevent="submit">
        <input ref="composer" v-model="draft" :aria-label="t('input')" :placeholder="t('input')" maxlength="5000" :disabled="loading" @keydown="onComposerKeydown" />
        <button v-if="busy" type="button" class="send-button" :aria-label="t('stop')" :title="t('stop')" @click="stopReply"><Icon name="stop" :size="17" /></button>
        <button v-else type="submit" class="send-button" :disabled="!canSend" :aria-label="t('send')" :title="t('send')"><Icon name="send" :size="18" /></button>
        <button type="button" class="icon-button composer-collapse" :aria-label="t('close')" :title="t('close')" @click="composerOpen = false"><Icon name="down" :size="16" /></button>
      </form>
      <p v-if="explicitPreview" class="compact-notice">{{ t('preview') }}</p>
      <p v-else-if="!host?.ai" class="compact-notice">{{ t('noHost') }}</p>
    </section>

    <section v-else-if="active" class="companion-window" :aria-label="t('app')">
      <header class="window-header drag-handle" :title="t('drag')" @pointerdown="dragWindow">
        <div class="window-brand"><img src="../logo.svg" alt="" /><strong>{{ t('app') }}</strong><span class="brand-divider" /><span>{{ t('companion') }}</span></div>
        <div class="window-actions">
          <span v-if="observationRunning" class="observation-indicator"><Icon name="eye" :size="14" />{{ observationStatus?.state === 'active' ? t('observing') : t('pendingConsent') }}</span>
          <button class="icon-button" :class="{ selected: topmost && hasNative }" :disabled="!hasNative || loading || acting" :aria-label="t('topmost')" :aria-pressed="topmost && hasNative" :title="t('topmost')" @click="toggleTopmost"><Icon name="pin" :size="17" /></button>
          <button class="icon-button" :disabled="loading || acting" :aria-label="t('collapse')" :title="t('collapse')" @click="togglePanel"><Icon name="collapse" :size="18" /></button>
          <button class="icon-button close-button" :disabled="loading || (!hasNative && !explicitPreview)" :aria-label="t('close')" :title="t('close')" @click="close"><Icon name="close" :size="18" /></button>
        </div>
      </header>
      <div class="panel-layout">
        <aside class="sidebar">
          <div class="sidebar-companion">
            <button class="sidebar-avatar" :disabled="loading || acting" :aria-label="t('pet')" @click="run(c.pet)"><img v-if="avatarVisible" :src="avatar" :alt="characterName" @error="avatarBroken = true" /><Mascot v-else :emotion="emotion" compact /></button>
            <strong>{{ characterName }}</strong><p>{{ subtitle }}</p>
            <span class="status-pill"><span class="status-dot" :class="{ muted: !availableAi }" />{{ explicitPreview ? t('preview') : availableAi ? t('online') : t('unavailable') }}</span>
          </div>
          <nav class="navigation" :aria-label="t('app')"><button v-for="item in navigation" :key="item" :class="{ active: tab === item }" :aria-current="tab === item ? 'page' : undefined" @click="selectTab(item)"><Icon :name="item" :size="19" /><span>{{ t(item) }}</span><span v-if="item === 'connections' && externalContext" class="nav-dot" /></button></nav>
          <div class="sidebar-footer"><Icon name="saves" :size="17" /><div><span>{{ t('currentSave') }}</span><strong :title="currentSave?.name">{{ currentSave?.name || t('loading') }}</strong></div></div>
        </aside>

        <main class="panel-main" :aria-label="panelTitle" :aria-busy="loading || acting">
          <div v-if="explicitPreview" class="environment-banner"><Icon name="eye" :size="15" />{{ t('preview') }}</div>
          <div v-else-if="!host?.ai" class="environment-banner warning"><Icon name="shield" :size="16" />{{ t('noHost') }}</div>
          <div v-if="loading" class="loading-state" role="status"><Icon name="sparkle" :size="32" /><p>{{ t('loading') }}</p></div>
          <div v-else-if="!role" class="empty-state"><Icon name="saves" :size="36" /><p>{{ t('empty') }}</p><button class="button primary" @click="c.attempt(c.initialize)">{{ t('retry') }}</button></div>

          <section v-else-if="tab === 'chat'" class="chat-view">
            <div ref="chatScroll" class="chat-scroll">
              <div class="chat-welcome"><div><span class="eyebrow"><Icon name="sun" :size="15" />{{ t('companion') }}</span><h1>{{ t('greeting') }}</h1><p>{{ t('greetingSub') }}</p><div class="welcome-detail"><span><Icon name="heart" :size="14" />{{ t('bond') }} <strong>{{ role.bond }}</strong></span><span>{{ messages.length }} {{ t('messages') }}</span></div></div><button class="welcome-avatar" :disabled="acting" :aria-label="t('pet')" @click="run(c.pet)"><img v-if="avatarVisible" :src="avatar" :alt="characterName" @error="avatarBroken = true" /><Mascot v-else :emotion="emotion" /></button></div>
              <div class="conversation-divider"><span>{{ currentSave?.name }}</span></div>
              <div v-if="!messages.length && !busy" class="first-message"><span class="message-avatar"><Icon name="characters" :size="19" /></span><div><span class="message-author">{{ characterName }}</span><p class="message-content">{{ bubble || t('welcome') }}</p></div></div>
              <div class="message-list" role="log" :aria-label="t('chat')" aria-live="polite" aria-relevant="additions">
                <article v-for="message in messages" :key="message.id" class="message" :class="message.role"><span class="message-avatar"><Icon :name="message.role === 'assistant' ? 'characters' : 'characters'" :size="17" /></span><div class="message-body"><div class="message-meta"><strong>{{ message.role === 'user' ? t('you') : characterName }}</strong><time :datetime="message.createdAt">{{ time(message.createdAt) }}</time><button v-if="message.role === 'assistant' && voice.endpoint" class="icon-button message-speak" :title="t('readAloud')" :aria-label="t('readAloud')" :disabled="acting || busy" @click="run(() => c.speak(messageText(message)))"><Icon name="sound" :size="14" /></button></div><p class="message-content">{{ messageText(message) }}</p></div></article>
                <article v-if="pendingUser && busy" class="message user"><span class="message-avatar"><Icon name="characters" :size="17" /></span><div class="message-body"><div class="message-meta"><strong>{{ t('you') }}</strong></div><p class="message-content">{{ pendingUser }}</p></div></article>
                <article v-if="busy" class="message assistant streaming-message"><span class="message-avatar"><Icon name="characters" :size="17" /></span><div class="message-body"><div class="message-meta"><strong>{{ characterName }}</strong><span>{{ t('thinking') }}</span></div><p v-if="streamed" class="message-content">{{ visibleDialogue(streamed) }}<span class="stream-cursor" /></p><span v-else class="typing-dots" aria-hidden="true"><i /><i /><i /></span></div></article>
              </div>
              <div v-if="!messages.length && !busy" class="suggestions"><button v-for="key in (['suggestion1', 'suggestion2', 'suggestion3'] as const)" :key="key" @click="draft = t(key); composer?.focus()">{{ t(key) }}<Icon name="arrow" :size="14" /></button></div>
            </div>
            <div class="composer-area">
              <div v-if="externalContext" class="context-chip"><Icon name="notes" :size="15" /><span>{{ t('ephemeral') }}</span><button class="icon-button" :title="t('clearContext')" :aria-label="t('clearContext')" @click="externalContext = ''"><Icon name="close" :size="14" /></button></div>
              <form class="chat-composer" @submit.prevent="submit"><textarea ref="composer" v-model="draft" rows="2" maxlength="5000" :aria-label="t('input')" :placeholder="t('input')" @keydown="onComposerKeydown" /><div class="composer-toolbar"><span><Icon name="sparkle" :size="14" />{{ characterName }}</span><button v-if="busy" type="button" class="button primary" @click="stopReply"><Icon name="stop" :size="16" />{{ t('stop') }}</button><button v-else type="submit" class="button primary" :disabled="!canSend">{{ t('send') }}<Icon name="send" :size="17" /></button></div></form>
              <div class="composer-footer"><span>{{ explicitPreview ? t('preview') : t('aiHost') }}</span><button class="text-button muted-text" :disabled="!canEdit || !messages.length" @click="run(c.clearChat)"><Icon name="trash" :size="13" />{{ t('clearChat') }}</button></div>
            </div>
          </section>

          <div v-else class="view-scroll">
            <template v-if="tab === 'saves'">
              <div class="section-intro"><span class="eyebrow">{{ t('currentSave') }}</span><h2>{{ t('saves') }}</h2><p>{{ t('savesIntro') }}</p></div>
              <div class="section-actions"><button class="button primary" :disabled="!canEdit" @click="newSaveOpen = !newSaveOpen"><Icon name="plus" :size="17" />{{ t('newSave') }}</button><button class="button" :disabled="!canEdit || !canReadFiles" @click="run(c.importSave)"><Icon name="upload" :size="16" />{{ t('import') }}</button></div>
              <form v-if="newSaveOpen" class="surface inline-form new-save-form" @submit.prevent="createSave"><input v-model="newSaveName" :aria-label="t('saveName')" :placeholder="t('saveName')" maxlength="500" /><button class="button primary" :disabled="!canEdit" type="submit">{{ t('save') }}</button><button type="button" class="icon-button" :title="t('cancel')" :aria-label="t('cancel')" @click="newSaveOpen = false"><Icon name="close" /></button></form>
              <div class="save-grid"><article v-for="save in saves" :key="save.id" class="surface save-card" :class="{ 'is-current': save.id === saveId }"><div class="save-card-top"><span class="icon-tile"><Icon name="saves" :size="24" /></span><span v-if="save.id === saveId" class="status-pill">{{ t('active') }}</span></div><h3>{{ save.name }}</h3><p>{{ messageCount(save) }} {{ t('messages') }}<span class="separator">·</span>{{ date(save.updatedAt) }}</p><div class="row-actions"><button class="text-button" :disabled="!canEdit || save.id === saveId" @click="run(() => c.select(save.id))">{{ save.id === saveId ? t('active') : t('choose') }}<Icon name="arrow" :size="16" /></button><div class="row-actions"><button class="icon-button" :disabled="!canEdit || !canWriteFiles" :title="t('export')" :aria-label="`${t('export')} ${save.name}`" @click="run(() => c.exportSave(save.id))"><Icon name="download" :size="16" /></button><button class="icon-button danger" :disabled="!canEdit" :title="t('delete')" :aria-label="`${t('delete')} ${save.name}`" @click="run(() => c.deleteSave(save.id))"><Icon name="trash" :size="16" /></button></div></div></article></div>
            </template>

            <template v-else-if="tab === 'characters'">
              <div class="section-intro"><span class="eyebrow">{{ t('companion') }}</span><h2>{{ t('characters') }}</h2><p>{{ t('charactersIntro') }}</p></div>
              <div class="section-actions"><button class="button primary" :disabled="!canEdit || !canReadFiles" @click="run(c.importCharacter)"><Icon name="upload" :size="17" />{{ t('importCharacter') }}</button></div>
              <div class="character-grid"><article class="surface character-card" :class="{ 'is-current': roleId === 'mochi' }"><div class="character-art"><Mascot emotion="平静" compact /></div><h3>{{ t('petName') }}</h3><p>{{ t('original') }}</p><button class="button" :class="{ subtle: roleId === 'mochi' }" :disabled="!canEdit || roleId === 'mochi'" @click="run(() => c.select(saveId, 'mochi'))">{{ roleId === 'mochi' ? t('active') : t('choose') }}<Icon name="heart" :size="15" /></button></article><article v-for="character in characters" :key="character.id" class="surface character-card" :class="{ 'is-current': character.id === roleId }"><div class="character-art"><img v-if="character.id === roleId && avatarVisible" :src="avatar" :alt="character.settings.ai_name" @error="avatarBroken = true" /><Icon v-else name="characters" :size="68" /></div><h3>{{ character.settings.ai_name }}</h3><p>{{ character.settings.ai_subtitle || character.settings.title || t('characters') }}</p><div class="row-actions"><button class="button" :disabled="!canEdit || character.id === roleId" @click="run(() => c.select(saveId, character.id))">{{ character.id === roleId ? t('active') : t('choose') }}</button><button class="icon-button danger" :disabled="!canEdit" :title="t('delete')" :aria-label="`${t('delete')} ${character.settings.ai_name}`" @click="run(() => c.deleteCharacter(character.id))"><Icon name="trash" :size="16" /></button></div><p v-for="warning in character.warnings" :key="warning" class="hint">{{ warning }}</p></article></div>
              <section class="surface settings-group"><div class="card-heading"><span class="icon-tile"><Icon name="heart" /></span><div><h3>{{ t('persona') }}</h3><p>{{ t('currentSave') }} · {{ characterName }}</p></div></div><form @submit.prevent="run(() => c.patchRole({ persona: personaDraft, outfitId: outfitDraft }))"><label v-if="currentCharacter" class="field outfit-field"><span>{{ t('outfit') }}</span><select v-model="outfitDraft" :disabled="!canEdit"><option v-for="outfit in currentCharacter.outfits" :key="outfit.name" :value="outfit.name">{{ outfit.name }}</option></select></label><textarea v-model="personaDraft" rows="4" maxlength="100000" :aria-label="t('persona')" :placeholder="t('personaHint')" :disabled="!canEdit" /><div class="section-actions end"><button class="button primary" :disabled="!canEdit || (personaDraft === role.persona && outfitDraft === (role.outfitId ?? 'default'))">{{ t('apply') }}<Icon name="check" :size="16" /></button></div></form></section>
              <section class="surface achievements-card"><h3><Icon name="sparkle" :size="18" />{{ t('achievements') }}</h3><div v-if="role.achievements.length" class="achievement-list"><span v-for="achievement in role.achievements" :key="achievement" class="status-pill">{{ achievement }}</span></div><p v-else class="hint">{{ t('achievementEmpty') }}</p></section>
            </template>

            <StoryPanel v-else-if="tab === 'story'" :key="`${saveId}:${roleId}`" :store="c.store" :repository="c.repository" :save-id="saveId" :role-id="roleId" :character="currentCharacter" :t="t" @error="c.fail" @emotion="c.setEmotion" @bubble="bubble = $event" />

            <template v-else-if="tab === 'memory'">
              <div class="section-intro"><span class="eyebrow">{{ characterName }} · {{ t('currentSave') }}</span><h2>{{ t('memory') }}</h2><p>{{ t('memoryIntro') }}</p></div>
              <div class="section-actions wrap"><button class="button primary" :disabled="!canEdit || !host?.ai" @click="run(c.summarize)"><Icon name="sparkle" :size="17" />{{ t('summarize') }}</button><button class="button" :disabled="!canEdit || !canReadFiles" @click="run(c.importMemory)"><Icon name="upload" :size="16" />{{ t('import') }}</button><button class="button" :disabled="!canEdit || !canWriteFiles" @click="run(c.exportMemory)"><Icon name="download" :size="16" />{{ t('export') }}</button><button class="text-button danger" :disabled="!canEdit" @click="run(c.clearMemory)">{{ t('clearMemory') }}</button></div>
              <fieldset class="memory-grid" :disabled="!canEdit"><MemoryEditor v-for="(section, index) in memorySections" :key="`${saveId}:${roleId}:${section}`" :title="t(section)" :value="role.memory.data[section]" :limit="MEMORY_LIMITS[section]" :save-label="t('save')" :index="index" @save="value => run(() => c.editMemory(section, value))" /></fieldset><p class="privacy-note"><Icon name="shield" :size="15" />{{ t('memoryPrivacy') }}</p>
            </template>

            <ConnectionsPanel v-else-if="tab === 'connections'" :t="t" @context="useNotesContext" @error="c.fail" @bubble="bubble = $event" />

            <template v-else-if="tab === 'settings'">
              <div class="section-intro"><span class="eyebrow">{{ t('companion') }}</span><h2>{{ t('settings') }}</h2><p>{{ t('tagline') }}</p></div>
              <section class="surface settings-group"><div class="card-heading"><span class="icon-tile warm"><Icon name="sun" /></span><div><h3>{{ t('appearance') }}</h3></div></div><label class="setting-row"><span>{{ t('language') }}</span><select v-model="language" :disabled="acting" @change="run(c.preferences)"><option value="host">{{ t('followHost') }}</option><option v-for="item in languages" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label class="setting-row"><span>{{ t('topmost') }}<small v-if="!hasNative">{{ t('unavailable') }}</small></span><span class="switch"><input v-model="topmost" type="checkbox" :disabled="!hasNative || acting" @change="updateTopmost" /><span /></span></label><label class="setting-row"><span>{{ t('reduceMotion') }}</span><span class="switch"><input v-model="reduceMotion" type="checkbox" :disabled="acting" @change="run(c.preferences)" /><span /></span></label><label class="setting-row"><span>{{ t('scale') }}</span><div class="range-field"><input v-model.number="scale" type="range" min="0.7" max="1.3" step="0.05" :disabled="acting" @change="run(c.preferences)" /><output>{{ Math.round(scale * 100) }}%</output></div></label></section>
              <section class="surface settings-group"><div class="card-heading"><span class="icon-tile"><Icon name="sound" /></span><div><h3>{{ t('sound') }}</h3></div></div><label class="setting-row"><span>{{ t('sound') }} · {{ t('messages') }}</span><span class="switch"><input v-model="notificationSound" type="checkbox" :disabled="acting" @change="run(c.preferences)" /><span /></span></label><label class="field endpoint-field"><span>VITS API · HTTP(S)</span><input v-model.trim="voice.endpoint" type="url" placeholder="http://127.0.0.1:9880/voice/vits" :disabled="acting" @change="run(c.preferences)" /></label><label class="setting-row"><span>{{ t('speech') }}</span><span class="switch"><input v-model="voice.enabled" type="checkbox" :disabled="acting || !voice.endpoint" @change="run(c.preferences)" /><span /></span></label><div class="voice-fields"><label class="field"><span>Speaker ID</span><input v-model="voice.speakerId" placeholder="0" maxlength="100" :disabled="acting" @change="run(c.preferences)" /></label><label class="field"><span>{{ t('language') }}</span><select v-model="voice.language" :disabled="acting" @change="run(c.preferences)"><option value="auto">Auto</option><option v-for="item in languages" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label class="field"><span>{{ t('voice') }} · ×{{ voice.speed ?? 1 }}</span><input v-model.number="voice.speed" type="range" min="0.25" max="4" step="0.05" :disabled="acting" @change="run(c.preferences)" /></label></div><div class="section-actions"><button class="button" :disabled="!canEdit || !voice.endpoint || !bubble" @click="run(() => c.speak(bubble))"><Icon name="sound" :size="16" />{{ t('readAloud') }}</button></div></section>
              <section class="surface settings-group"><div class="card-heading"><span class="icon-tile"><Icon name="eye" /></span><div><h3>{{ t('observation') }}</h3><p>{{ t('observationDesc') }}</p></div><span v-if="observationRunning" class="status-pill">{{ observationStatus?.state === 'active' ? t('observing') : t('pendingConsent') }}</span></div><p v-if="!canObserve" class="hint">{{ t('unavailable') }}</p><div class="inline-form"><label class="field grow"><span>{{ t('target') }}</span><select v-model="targetValue" :disabled="!canObserve || acting || observationRunning"><option value="">{{ t('selectTarget') }}</option><option v-for="target in targets" :key="target.value" :value="target.value">{{ target.label }}</option></select></label><button class="icon-button target-refresh" :disabled="!canObserve || acting" :title="t('refresh')" :aria-label="t('refresh')" @click="run(c.refreshTargets)"><Icon name="refresh" :size="18" /></button></div><div class="section-actions"><button v-if="observationRunning" class="button" :disabled="acting" @click="run(c.stopObservation)"><Icon name="stop" :size="16" />{{ t('stopObservation') }}</button><button v-else class="button primary" :disabled="!canObserve || !targetValue || acting || busy" @click="run(c.startObservation)"><Icon name="shield" :size="16" />{{ t('requestObservation') }}</button></div><p v-if="observationStatus?.reason" class="hint">{{ observationStatus.reason }}</p><p class="privacy-note"><Icon name="shield" :size="14" />{{ t('observationPrivacy') }}</p></section>
              <section class="surface settings-group"><div class="card-heading"><span class="icon-tile warm"><Icon name="sparkle" /></span><div><h3>{{ t('ai') }}</h3><p>{{ host?.ai ? t('aiHost') : t('unavailable') }}</p></div><button class="button" :disabled="!host?.ai?.capabilities || acting" @click="checkAi">{{ t('check') }}</button></div><pre v-if="aiStatus" class="capabilities-output">{{ aiStatus }}</pre></section>
              <EmotionModelPanel :store="c.store" :t="t" @error="c.fail" />
              <section class="about-card"><img src="../logo.svg" alt="" /><div><h3>{{ t('about') }}</h3><p>{{ t('attribution') }}</p><a href="https://github.com/SlimeBoyOwO/LingChat" target="_blank" rel="noopener noreferrer">LingChat · GitHub <Icon name="arrow" :size="13" /></a><span class="license-label">AGPL-3.0-only</span></div></section>
            </template>
          </div>
        </main>
      </div>
    </section>
    <div v-else-if="explicitPreview" class="closed-state"><Icon name="characters" :size="28" /><p>{{ t('close') }}</p><button class="button primary" @click="reopen">{{ t('resume') }}</button></div>
    <div v-if="error" class="feedback error-feedback" data-pet-hit role="alert"><Icon name="shield" :size="17" /><p>{{ error }}</p><button class="icon-button" :aria-label="t('close')" @click="error = ''"><Icon name="close" :size="16" /></button></div>
    <div v-if="toast" class="feedback toast-feedback" data-pet-hit role="status"><Icon name="check" :size="17" /><p>{{ toast }}</p><button class="icon-button" :aria-label="t('close')" @click="toast = ''"><Icon name="close" :size="15" /></button></div>
  </div>
</template>
