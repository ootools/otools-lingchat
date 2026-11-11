// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { afterEach, expect, it } from 'vitest';
import AiModelSettings from './AiModelSettings.vue';

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; Reflect.deleteProperty(window, 'otools'); });
async function settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); await nextTick(); }
it('saves the selected model and advertised reasoning strength through the host', async () => {
  const writes: unknown[] = []; let paused = false;
  Object.assign(window, { otools: { ai: {
    models: async () => ({ defaultModel: 'plain', selection: { model: null, reasoningEffort: null }, models: [
      { id: 'plain', ownedBy: 'ai-switch', capabilities: [], reasoningLevels: [], defaultReasoningLevel: null, contextWindow: null },
      { id: 'deep', ownedBy: 'ai-switch', capabilities: ['text.generate'], reasoningLevels: [{ effort: 'high', description: 'Careful' }, { effort: 'ultra', description: 'Deep' }], defaultReasoningLevel: 'high', contextWindow: 128000 },
    ] }),
    saveSettings: async (settings: unknown) => { expect(paused).toBe(true); writes.push(settings); return settings; },
  } } });
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(AiModelSettings, { locale: 'zh', beforeSave: async () => { paused = true; } }); app.mount(root); await settle();
  const [model, reasoning] = Array.from(root.querySelectorAll('select'));
  expect(model.value).toBe(''); expect(reasoning.disabled).toBe(true);
  model.value = 'deep'; model.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(reasoning.disabled).toBe(false);
  reasoning.value = 'ultra'; reasoning.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  const save = Array.from(root.querySelectorAll('button')).find(button => button.textContent === '保存选择')!;
  expect(save.disabled).toBe(false); save.click(); await settle();
  expect(writes).toEqual([{ model: 'deep', reasoningEffort: 'ultra' }]);
  expect(root.textContent).toContain('已保存'); expect(root.textContent).toContain('128,000');
});
it('an older host displays an explicit update requirement rather than an invented model list', async () => {
  Object.assign(window, { otools: { ai: { consume: async () => ({ text: '' }) } } });
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(AiModelSettings, { locale: 'zh' }); app.mount(root); await settle();
  expect(root.textContent).toContain('请更新 Otools'); expect(root.querySelectorAll('select')).toHaveLength(0);
});
