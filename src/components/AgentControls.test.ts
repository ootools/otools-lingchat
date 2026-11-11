// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { useCompanion } from '../composables/useCompanion';
import { MemoryStore } from '../saves/store';
import AgentControls from './AgentControls.vue';
let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; });
it('submits selected structured question option ids and opens only the host approval UI', async () => {
  const c = useCompanion({ store: new MemoryStore() }); c.setLocale('en'); c.agentMode.value = true;
  c.agentActivity.value = { status: 'question', tools: [], permission: { id: 'permit', runId: 'run', title: 'Write?', options: [] }, question: { id: 'question', runId: 'run', questions: [{ id: 'q', question: 'Which?', options: [{ id: 'a', label: 'First' }], allowCustom: true }] } };
  c.answerAgentQuestion = vi.fn(async () => {}); c.openAgentPermission = vi.fn(async () => {});
  const root = document.createElement('div'); document.body.append(root); app = createApp(AgentControls, { companion: c }); app.mount(root);
  const check = document.querySelector<HTMLInputElement>('.agent-pending input[type=checkbox]')!; check.click(); await nextTick();
  document.querySelector<HTMLFormElement>('form.agent-pending')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await nextTick();
  expect(c.answerAgentQuestion).toHaveBeenCalledWith('question', { q: ['a'] });
  [...document.querySelectorAll('button')].find(button => button.textContent === 'Open host approval')!.click(); await nextTick();
  expect(c.openAgentPermission).toHaveBeenCalledWith('permit');
});
