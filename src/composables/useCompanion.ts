// SPDX-License-Identifier: AGPL-3.0-only
// Pet interaction flow adapted from LingChat contributors' PetMode.vue (848fd3448c20ca32e0436a498d20e85f63393e7f).
import { computed, ref, shallowRef, toRaw } from 'vue';
import { IndexedDbStore, MemoryStore, type AsyncStore } from '../saves/store';
import { SaveRepository, type RoleState, type SaveRecord } from '../saves/repository';
import { ChatSession } from '../dialogue/session';
import { MemoryService, createHostSummarizer, type MemorySection } from '../memory';
import { importCharacterZip, resolveCharacterImage, type CharacterPack } from '../characters';
import { hostAi, preview, getHost, chooseFile, exportFile, confirmAction, nativeWindow, unavailable } from '../host/bridge';
import { ObservationController, type ObservationStatus, type ObservationTarget } from '../host/observation';
import { useLocale } from './i18n';
import { parseDialogue } from '../dialogue/protocol';
import { visibleDialogue } from '../dialogue/visible';
import { useEmotionModel } from './useEmotionModel';
import { AudioController, type VoiceSettings } from '../audio';
import { ForegroundAgent, type AgentActivity } from '../dialogue/agent';
import { AgentError, hostAgentPreferences, type ProviderInfo, type AgentHealth, type AgentTool } from '../host/agent';
import { agentLabels } from '../host/agentLabels';

export function useCompanion(options: { store?: AsyncStore } = {}) {
  const { locale, setLocale, t, direction } = useLocale();
  const store = options.store ?? (preview ? new MemoryStore() : new IndexedDbStore());
  const repository = new SaveRepository(store);
  const emotionModel = useEmotionModel(store);
  const memoryService = new MemoryService(repository, createHostSummarizer(hostAi));
  const audio = new AudioController();
  const error = ref(''); const toast = ref(''); const loading = ref(true); const busy = ref(false);
  const expanded = ref(preview); const tab = ref('chat'); const draft = ref(''); const streamed = ref('');
  const saves = shallowRef<SaveRecord[]>([]); const saveId = ref(''); const roleId = ref('mochi');
  const role = shallowRef<RoleState>(); const characters = shallowRef<CharacterPack[]>([]);
  const bubble = ref(''); const emotion = ref('平静'); const externalContext = ref('');
  const topmost = ref(true); const reduceMotion = ref(false); const scale = ref(1); const language = ref('host');
  const voice = ref<VoiceSettings>({ enabled: false, endpoint: '', language: 'zh', speed: 1 });
  const notificationSound = ref(false); const active = ref(true); let generation = 0;
  const observationStatus = shallowRef<ObservationStatus | null>(null);
  const targets = shallowRef<Array<{ label: string; value: string; target: ObservationTarget }>>([]);
  const targetValue = ref(''); let observation: ObservationController | undefined;
  let summaryAbort = new AbortController(); let toastTimer: ReturnType<typeof setTimeout>;
  let currentUrls: string[] = [];
  const avatar = ref('');
  const currentCharacter = computed(() => characters.value.find(item => item.id === roleId.value));
  const characterName = computed(() => currentCharacter.value?.settings.ai_name ?? t('petName'));
  const currentSave = computed(() => saves.value.find(item => item.id === saveId.value));
  const messages = computed(() => role.value?.messages ?? []);
  const agentMode = ref(false); const agentProviderId = ref(''); const agentLoading = ref(false);
  const agentProviders = shallowRef<ProviderInfo[]>([]); const agentHealth = shallowRef<AgentHealth>();
  const agentTools = shallowRef<AgentTool[]>([]); const selectedAgentTools = ref<string[]>([]);
  const agentActivity = shallowRef<AgentActivity>({ status: 'idle', tools: [] });
  const agentText = computed(() => agentLabels(locale.value));
  const agentAvailable = computed(() => { void agentLoading.value; return !!getHost()?.agent; });
  const agentProvider = computed(() => agentProviders.value.find(item => item.id === agentProviderId.value));
  const agentReady = computed(() => agentAvailable.value && !!agentProvider.value?.available && !agentLoading.value && agentHealth.value?.providerId === agentProviderId.value && agentHealth.value.status !== 'missing' && agentHealth.value.status !== 'unavailable');
  let agentCheck = 0;
  const agent = new ForegroundAgent({ repository, getApi: () => getHost()?.agent,
    preferences: () => hostAgentPreferences(getHost()?.ai), onUpdate: value => agentActivity.value = value,
    onCleanupError: () => { if (active.value) error.value = agentText.value.cleanupFailed; },
  });
  async function refreshAgent() {
    const check = ++agentCheck; agentLoading.value = true;
    try {
      const api = getHost()?.agent; if (!api) return;
      const providers = await api.providers(); if (check !== agentCheck) return;
      agentProviders.value = providers;
      if (!agentProviderId.value) agentProviderId.value = providers.find(item => item.adapter === 'codex')?.id ?? providers[0]?.id ?? '';
      const providerId = agentProviderId.value;
      const [health, tools] = await Promise.all([providerId ? api.health({ providerId, refresh: true }) : undefined, api.tools?.() ?? []]);
      if (check !== agentCheck || providerId !== agentProviderId.value) return;
      agentHealth.value = health; agentTools.value = tools;
    } finally { if (check === agentCheck) agentLoading.value = false; }
  }
  async function setAgentMode(value: boolean) { await stop(); agentMode.value = value; if (value) await refreshAgent(); }
  async function setAgentProvider(value: string) { await stop(); agentProviderId.value = value; agentHealth.value = undefined; await refreshAgent(); }
  async function setAgentTools(value: string[]) { await stop(); selectedAgentTools.value = [...value]; }
  async function openAgentManager() {
    const api = getHost()?.agent; if (!api) throw new AgentError('unsupported');
    await api.openManager(agentProviderId.value ? { providerId: agentProviderId.value } : {});
  }
  const session = new ChatSession({ repository, ai: hostAi, onUpdate(update) {
    if (!active.value || update.saveId !== saveId.value || update.roleId !== roleId.value) return;
    streamed.value = update.text; busy.value = update.status === 'streaming';
    if (update.text) { const parts = parseDialogue(update.text); bubble.value = visibleDialogue(update.text); emotion.value = parts.at(-1)?.emotion ?? '平静'; updateAvatar(); }
    if (update.error) error.value = update.error;
  } });
  function notify(text: string) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 3500); }
  function fail(value: unknown) { if (value instanceof Error && value.name === 'AbortError') return; error.value = value instanceof AgentError ? agentText.value[value.code] : value instanceof Error ? value.message : String(value); }
  async function attempt(action: () => Promise<unknown>) { error.value = ''; try { await action(); } catch (value) { fail(value); } }
  function revokeUrls() { currentUrls.forEach(url => URL.revokeObjectURL(url)); currentUrls = []; }
  function updateAvatar() {
    revokeUrls(); avatar.value = '';
    const pack = currentCharacter.value; if (!pack) return;
    const path = resolveCharacterImage(pack, emotion.value, role.value?.outfitId ?? 'default') ?? pack.avatar;
    const asset = path ? pack.assets[path] : undefined;
    if (asset instanceof Blob) { avatar.value = URL.createObjectURL(asset); currentUrls.push(avatar.value); }
  }
  async function refresh() {
    const epoch = generation; const sid = saveId.value; const rid = roleId.value;
    const [records, selected] = await Promise.all([repository.list(), sid ? repository.get(sid, rid) : undefined]);
    if (epoch !== generation || sid !== saveId.value || rid !== roleId.value) return;
    saves.value = records; if (sid) role.value = selected;
  }
  async function select(nextSave: string, nextRole = roleId.value) {
    const epoch = ++generation; session.abort(); summaryAbort.abort(); summaryAbort = new AbortController(); audio.stop();
    await agent.close(); if (epoch !== generation) return;
    await observation?.stop(); if (epoch !== generation) return;
    observationStatus.value = null; externalContext.value = ''; busy.value = false; streamed.value = ''; emotion.value = '平静';
    saveId.value = nextSave; roleId.value = nextRole;
    const selected = await session.select(nextSave, nextRole); if (epoch !== generation) return;
    role.value = selected; updateAvatar(); bubble.value = t('welcome');
    await store.update('ui:selected', previous => epoch === generation ? { saveId: nextSave, roleId: nextRole } : previous);
    if (epoch === generation) await refresh();
  }
  async function initialize() {
    loading.value = true;
    try {
      const preferences = await store.get<{ language?: string; topmost?: boolean; reduceMotion?: boolean; scale?: number; voice?: VoiceSettings; notificationSound?: boolean }>('ui:preferences');
      language.value = preferences?.language ?? 'host';
      if (language.value !== 'host') setLocale(language.value);
      else {
        const hostLocale = await getHost()?.getLocale?.();
        const documentLocale = document.documentElement.lang;
        setLocale(hostLocale || documentLocale || 'zh');
      }
      topmost.value = preferences?.topmost ?? true; reduceMotion.value = preferences?.reduceMotion ?? false; scale.value = preferences?.scale ?? 1;
      voice.value = preferences?.voice ?? voice.value; notificationSound.value = preferences?.notificationSound ?? false;
      await agent.recover();
      characters.value = (await store.list<CharacterPack>('character:')).map(row => row.value);
      saves.value = await repository.list();
      if (!saves.value.length) { const record = await repository.create(t('newChat'), 'mochi'); saves.value = [record]; }
      const last = await store.get<{ saveId: string; roleId: string }>('ui:selected');
      await select(saves.value.some(item => item.id === last?.saveId) ? last!.saveId : saves.value[0].id, last?.roleId && (last.roleId === 'mochi' || characters.value.some(item => item.id === last.roleId)) ? last.roleId : 'mochi');
      if (getHost() && !preview) await nativeWindow.topmost(topmost.value);
      void emotionModel.initialize().catch(fail);
      const host = getHost();
      if (host?.observation && host.capture) {
        observation = new ObservationController({ observation: host.observation, capture: host.capture }, hostAi, {
          onText: text => { if (active.value) bubble.value = visibleDialogue(text); },
          onStatus: status => observationStatus.value = status, onError: fail,
        });
      }
    } catch (value) { fail(value); } finally { loading.value = false; }
  }
  async function preferences() {
    setLocale(language.value === 'host' ? await getHost()?.getLocale?.() ?? 'zh' : language.value);
    await store.update('ui:preferences', () => ({ language: language.value, topmost: topmost.value, reduceMotion: reduceMotion.value, scale: scale.value, voice: { ...toRaw(voice.value) }, notificationSound: notificationSound.value }));
  }
  async function send(text = draft.value) {
    if (!text.trim() || busy.value || !active.value) return;
    const epoch = generation; const sid = saveId.value; const rid = roleId.value;
    const context = externalContext.value; draft.value = ''; externalContext.value = ''; error.value = ''; busy.value = true;
    try {
      const pack = currentCharacter.value;
      const outfit = pack?.outfits.find(item => item.name === role.value?.outfitId);
      const answer = await session.send(text, { systemPrompt: `${pack?.settings.system_prompt ?? `你是温柔真诚的小猫伙伴${characterName.value}，在桌面陪伴用户。用用户的语言回应，允许以【情绪】开头，不要假装执行工具或承诺未设置的提醒。`}${outfit?.prompt ? `\n服装：${outfit.prompt}` : ''}`, externalContext: context || undefined }, agentMode.value && !context && role.value ? agent.transport(role.value, agentProviderId.value, text, selectedAgentTools.value) : undefined);
      if (epoch !== generation || !active.value) return;
      const completed = await emotionModel.predictCompleted(answer, () => epoch === generation && active.value);
      if (epoch !== generation || !active.value) return;
      if (completed.length) { bubble.value = completed.map(part => part.text).join('\n'); setEmotion(completed.at(-1)!.emotion); }
      await refresh(); streamed.value = '';
      if (notificationSound.value) await audio.beep('message');
      if (voice.value.enabled) await audio.speak(parseDialogue(answer).map(part => part.ttsText || part.text).join(''), voice.value, summaryAbort.signal);
      if (!context && !preview) await memoryService.summarize(sid, rid, { signal: summaryAbort.signal });
      if (epoch === generation) await refresh();
    } catch (value) { if (epoch === generation) { fail(value); await refresh(); } }
    finally { if (epoch === generation) { busy.value = false; streamed.value = ''; } }
  }
  function stop() { generation++; session.abort(); const cleanup = agent.close(); summaryAbort.abort(); summaryAbort = new AbortController(); audio.stop(); busy.value = false; streamed.value = ''; void refresh(); return cleanup; }
  function setEmotion(value: string) { emotion.value = value; updateAvatar(); }
  async function pet() {
    emotion.value = '开心'; bubble.value = t('petted'); updateAvatar();
    if (role.value) { role.value = await repository.patch(saveId.value, roleId.value, { bond: role.value.bond + 1 }); await refresh(); }
  }
  async function createSave(name: string) { const record = await repository.create(name.trim() || t('newChat'), roleId.value); await select(record.id); notify(t('saved')); }
  async function deleteSave(id: string) {
    if (!await confirmAction(t('confirmDelete'))) return;
    stop(); await observation?.stop(); await repository.remove(id); saves.value = await repository.list();
    if (!saves.value.length) { const record = await repository.create(t('newChat'), roleId.value); saves.value = [record]; }
    await select(id === saveId.value ? saves.value[0].id : saveId.value);
  }
  async function importSave() { const file = await chooseFile(['json']); if (!file) return; await stop(); const id = await repository.importSave(new TextDecoder().decode(file.bytes)); await select(id); notify(t('imported')); }
  async function exportSave(id = saveId.value) { await exportFile(`lingchat-${id}.json`, await repository.exportSave(id)); }
  async function importCharacter() {
    const file = await chooseFile(['zip']); if (!file) return;
    const pack = await importCharacterZip(file.bytes);
    pack.id = `imported-${crypto.randomUUID()}`;
    await store.update(`character:${pack.id}`, () => pack); characters.value = [...characters.value, pack];
    await select(saveId.value, pack.id); notify(t('imported'));
  }
  async function deleteCharacter(id: string) {
    if (!await confirmAction(t('confirmDelete'))) return;
    if (id === roleId.value) await select(saveId.value, 'mochi');
    await store.update(`character:${id}`, () => undefined); characters.value = characters.value.filter(item => item.id !== id);
  }
  async function patchRole(patch: { persona?: string; outfitId?: string | null }) { await stop(); role.value = await repository.patch(saveId.value, roleId.value, patch); updateAvatar(); notify(t('saved')); }
  async function editMemory(section: MemorySection, text: string) { await stop(); await memoryService.edit(saveId.value, roleId.value, section, text); await refresh(); notify(t('saved')); }
  async function summarize() { await memoryService.summarize(saveId.value, roleId.value, { force: true, signal: summaryAbort.signal }); await refresh(); notify(t('updated')); }
  async function clearMemory() { if (!await confirmAction(t('confirmClear'))) return; await stop(); await memoryService.clear(saveId.value, roleId.value); await refresh(); }
  async function exportMemory() { await exportFile('lingchat-memory.json', await memoryService.export(saveId.value, roleId.value)); }
  async function importMemory() { const file = await chooseFile(['json']); if (!file) return; await stop(); await memoryService.import(saveId.value, roleId.value, new TextDecoder().decode(file.bytes)); await refresh(); notify(t('imported')); }
  async function clearChat() { if (!await confirmAction(t('confirmClear'))) return; await stop(); await repository.clearChat(saveId.value, roleId.value); await refresh(); }
  async function toggleExpanded() { expanded.value = !expanded.value; await nativeWindow.resize(expanded.value); }
  async function refreshTargets() {
    const api = getHost()?.observation; if (!api?.targets) throw unavailable('观察目标列表');
    const result = await api.targets();
    targets.value = [
      ...result.screens.map(item => ({ label: item.name, value: `screen:${item.id}`, target: { kind: 'screen' as const, displayId: item.id } })),
      ...result.windows.map(item => ({ label: `${item.appName} · ${item.title}`, value: `window:${item.id}`, target: { kind: 'window' as const, windowId: item.id } })),
    ];
  }
  async function startObservation() {
    if (!observation) throw unavailable('桌面观察');
    const item = targets.value.find(item => item.value === targetValue.value); if (!item) throw new Error(t('selectTarget'));
    await observation.start(item.target);
  }
  async function stopObservation() { await observation?.stop(); }
  async function close() { active.value = false; await stop(); await stopObservation(); await nativeWindow.close(); }
  async function reopen() { if (active.value) return; active.value = true; await session.select(saveId.value, roleId.value); }
  async function dispose() { active.value = false; session.dispose(); const cleanup = agent.close(); summaryAbort.abort(); clearTimeout(toastTimer); revokeUrls(); await cleanup; await stopObservation(); await audio.dispose(); await emotionModel.dispose(); }
  async function speak(text: string) { await audio.speak(text, { ...voice.value, enabled: true }); }
  async function checkAi() { if (!getHost()?.ai?.capabilities) throw unavailable('AI 能力查询'); const result = await getHost()!.ai!.capabilities!(); notify(JSON.stringify(result)); }
  return { agentMode, agentProviderId, agentLoading, agentProviders, agentHealth, agentActivity, agentTools, selectedAgentTools, agentText, agentAvailable, agentProvider, agentReady, refreshAgent, setAgentMode, setAgentProvider, setAgentTools, openAgentManager, openAgentPermission: (id: string) => agent.openPermission(id), answerAgentQuestion: (id: string, answers: Record<string, string[]>) => agent.respondQuestion(id, answers), store, repository, memoryService, audio, locale, setLocale, t, direction, error, toast, loading, busy, expanded, tab, draft, streamed, saves, saveId, roleId, role, characters, bubble, emotion, externalContext, topmost, reduceMotion, scale, language, voice, notificationSound, active, observationStatus, targets, targetValue, avatar, currentCharacter, characterName, currentSave, messages, notify, fail, attempt, refresh, select, initialize, preferences, send, stop, setEmotion, pet, createSave, deleteSave, importSave, exportSave, importCharacter, deleteCharacter, patchRole, editMemory, summarize, clearMemory, exportMemory, importMemory, clearChat, toggleExpanded, refreshTargets, startObservation, stopObservation, close, reopen, dispose, speak, checkAi };
}
export type Companion = ReturnType<typeof useCompanion>;
