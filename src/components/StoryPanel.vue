<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { importStoryZip, StoryEngine } from '../scripts';
import type { StoryPack, StoryState, StoryStep } from '../scripts/types';
import type { AsyncStore } from '../saves/store';
import type { SaveRepository, JsonValue } from '../saves/repository';
import type { CharacterPack } from '../characters';
import type { TextKey } from '../composables/i18n';
import { chooseFile, hostAi, confirmAction } from '../host/bridge';
import { AudioController } from '../audio';
import Icon from './Icon.vue';
const props = defineProps<{ store: AsyncStore; repository: SaveRepository; saveId: string; roleId: string; character?: CharacterPack; t: (key: TextKey) => string }>();
const emit = defineEmits<{ error: [unknown]; emotion: [string]; bubble: [string] }>();
const packs = shallowRef<StoryPack[]>([]); const selected = shallowRef<StoryPack>(); const step = shallowRef<StoryStep>();
const line = ref(''); const speaker = ref(''); const input = ref(''); const background = ref(''); const picture = ref(''); const portrait = ref(''); const busy = ref(false);
let engine: StoryEngine | undefined; let generation = 0; let abort = new AbortController(); let urls: string[] = [];
let persistence = Promise.resolve();
const music = new AudioController(); const ambient = new AudioController(); const effects = new AudioController();
const waiting = computed(() => step.value?.waiting);
function url(path: string): string {
  const asset = selected.value?.assets[path];
  if (!(asset instanceof Blob)) return '';
  const value = URL.createObjectURL(asset); urls.push(value); return value;
}
async function run(fn: () => Promise<void>) { try { await fn(); } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) emit('error', error); } }
function stop() { generation++; abort.abort(); abort = new AbortController(); busy.value = false; music.stop(); ambient.stop(); effects.stop(); }
async function load() { packs.value = (await props.store.list<StoryPack>('story:')).map(row => row.value); }
async function importPack() {
  const file = await chooseFile(['zip']); if (!file) return;
  const pack = await importStoryZip(file.bytes);
  await props.store.update(`story:${pack.id}`, () => pack); await load();
}
async function remove(pack: StoryPack) { if (!await confirmAction(props.t('confirmDelete'))) return; if (selected.value?.id === pack.id) { stop(); selected.value = undefined; engine = undefined; } await props.store.update(`story:${pack.id}`, () => undefined); await load(); }
function persist(state: StoryState) {
  const sid = props.saveId; const rid = props.roleId; const value = JSON.parse(JSON.stringify(state)) as JsonValue;
  persistence = persistence.then(async () => {
    const current = await props.repository.get(sid, rid); if (!current) return;
    await props.repository.patch(sid, rid, { scriptState: { ...current.scriptState, [state.storyId]: value }, achievements: [...new Set([...current.achievements, ...Object.keys(state.achievements)])] });
  }).catch(error => { emit('error', error); });
}
async function play(pack: StoryPack, reset = false) {
  stop(); urls.forEach(value => URL.revokeObjectURL(value)); urls = []; selected.value = pack; line.value = ''; picture.value = ''; portrait.value = ''; background.value = '';
  const epoch = generation;
  const current = await props.repository.get(props.saveId, props.roleId);
  // Unmount or a save/role switch during the read must not revive the engine.
  if (epoch !== generation || selected.value !== pack) return;
  const saved = reset ? undefined : current?.scriptState[pack.id] as unknown as StoryState | undefined;
  engine = new StoryEngine(pack, { playerName: pack.characters[props.roleId]?.settings.user_name ?? props.character?.settings.user_name ?? '你', mainCharacter: props.character, onSave: persist }, saved);
  if (saved) {
    background.value = url(saved.background); picture.value = url(saved.picture);
    const last = saved.history.filter(item => item.text).at(-1); line.value = last?.text ?? ''; speaker.value = last?.displayName ?? last?.character ?? '';
    step.value = { effects: [], waiting: saved.waiting, ended: saved.ended, state: saved };
    if (saved.waiting?.kind === 'ai') await process(step.value);
  } else await process(engine.advance());
}
async function process(result: StoryStep): Promise<void> {
  const epoch = generation; step.value = result;
  for (const effect of result.effects) {
    if (effect.text) { line.value = effect.text; speaker.value = effect.displayName ?? effect.character ?? ''; emit('bubble', effect.text); }
    if (effect.emotion) emit('emotion', effect.emotion);
    if (effect.type === 'background') background.value = effect.asset ? url(effect.asset) : '';
    if (effect.type === 'picture') picture.value = effect.asset ? url(effect.asset) : '';
    if (effect.asset && /music|ambient|sound|audio/.test(effect.type)) {
      const asset = selected.value?.assets[effect.asset];
      if (asset instanceof Blob) void (effect.type.includes('music') ? music : effect.type.includes('ambient') ? ambient : effects).play(asset, abort.signal).catch(error => emit('error', error));
    }
    if (/stop.*music/.test(effect.type)) music.stop();
    if (/stop.*ambient/.test(effect.type)) ambient.stop();
  }
  background.value = result.state.background ? url(result.state.background) : background.value;
  const currentRole = result.state.roles[result.state.currentRole];
  const character = selected.value?.characters[result.state.currentRole];
  const avatarPath = character?.outfits.find(item => item.name === currentRole?.clothes)?.emotions[currentRole?.emotion ?? '正常'] ?? character?.emotions[currentRole?.emotion ?? '正常'] ?? character?.avatar;
  const image = avatarPath ? character?.assets[avatarPath] : undefined;
  if (image instanceof Blob) { portrait.value = URL.createObjectURL(image); urls.push(portrait.value); }
  if (result.waiting?.kind === 'ai') {
    busy.value = true;
    try {
      const wait = result.waiting;
      const response = await hostAi.consume({ messages: [
        { role: 'system', content: [{ type: 'text', text: character?.settings.system_prompt ?? props.character?.settings.system_prompt ?? '你正在参与一段互动故事。按照故事上下文回应，不能执行工具。' }] },
        { role: 'user', content: [{ type: 'text', text: wait.prompt + (wait.userInput ? `\n${wait.userInput}` : '') }] },
      ] }, { signal: abort.signal });
      if (epoch === generation && engine) await process(engine.resolveAI(response.text));
    } finally { if (epoch === generation) busy.value = false; }
  }
}
async function advance() { if (engine) await process(engine.advance()); }
async function select(index: number) { if (engine) await process(engine.select(index)); }
async function submit() { if (!input.value.trim() || !engine) return; const text = input.value; input.value = ''; await process(engine.input(text)); }
watch(() => [props.saveId, props.roleId], () => { stop(); engine = undefined; selected.value = undefined; });
onMounted(() => { void run(load); });
onBeforeUnmount(() => { stop(); urls.forEach(value => URL.revokeObjectURL(value)); void music.dispose(); void ambient.dispose(); void effects.dispose(); });
</script>
<template>
  <div class="section-intro"><div class="eyebrow">A NEW CHAPTER</div><h2>{{ t('story') }}</h2><p>{{ t('storyIntro') }}</p></div>
  <div class="section-actions"><button class="button primary" @click="run(importPack)"><Icon name="upload" :size="17"/>{{ t('importStory') }}</button></div>
  <template v-if="selected">
    <section class="story-stage" :style="background ? { backgroundImage: `url(${background})` } : {}">
      <div class="story-title"><Icon name="story" :size="17"/>{{ selected.config.script_name }}<button class="icon-button" :title="t('close')" @click="stop(); selected = undefined"><Icon name="close"/></button></div>
      <img v-if="portrait" class="story-portrait" :src="portrait" alt=""/><img v-if="picture" class="story-picture" :src="picture" alt=""/>
      <div class="story-dialog"><span class="eyebrow">{{ speaker || selected.config.script_name }}</span><p>{{ line }}</p><span v-if="busy" class="status-pill">{{ t('thinking') }}</span></div>
    </section>
    <div class="story-controls">
      <button v-if="waiting?.kind === 'advance'" class="button primary" :disabled="busy" @click="run(advance)">{{ t('advance') }}<Icon name="arrow" :size="17"/></button>
      <div v-if="waiting?.kind === 'choice'" class="story-choices"><button v-for="option in waiting.options" :key="option.index" class="button" :disabled="option.disabled || busy" :title="option.reason" @click="run(() => select(option.index))">{{ option.text }}<Icon name="arrow" :size="16"/></button></div>
      <form v-if="waiting?.kind === 'input' || (waiting?.kind === 'choice' && waiting.allowFree)" class="inline-form" @submit.prevent="run(submit)"><input v-model="input" :placeholder="waiting.kind === 'input' ? waiting.hint : t('storyInput')"/><button class="button primary" :disabled="!input.trim() || busy">{{ t('send') }}</button></form>
      <p v-if="step?.ended" class="end-label">{{ t('finished') }}</p><button v-if="busy" class="button" @click="stop">{{ t('stop') }}</button>
    </div>
  </template>
  <div v-else-if="!packs.length" class="empty-state"><span class="empty-art"><Icon name="story" :size="48"/></span><h3>{{ t('noStories') }}</h3><p>LingChat · ZIP</p></div>
  <div class="story-grid"><article v-for="pack in packs" :key="pack.id" class="surface story-card"><div class="story-cover"><Icon name="story" :size="42"/><span>{{ pack.config.script_name.slice(0, 1) }}</span></div><div class="story-card-content"><h3>{{ pack.config.script_name }}</h3><p>{{ pack.config.description }}</p><p v-for="warning in pack.warnings" :key="warning" class="hint">{{ warning }}</p><div class="row-actions"><button class="text-button" @click="run(() => play(pack))">{{ t('resume') }}<Icon name="arrow" :size="16"/></button><button class="icon-button" :title="t('delete')" @click="run(() => remove(pack))"><Icon name="trash" :size="17"/></button></div></div></article></div>
</template>
