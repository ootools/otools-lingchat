// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

let component: any; let app: App | undefined;
beforeAll(async () => { history.replaceState(null, '', '/?preview=1'); component = (await import('./App.vue')).default; });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; });
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick(); }
function button(label: string) { return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
async function openMenu() {
  document.querySelector('.pet-avatar')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true,cancelable:true,clientX:80,clientY:90 }));
  await settle();
}
async function menuAction(label:string) {
  await openMenu();
  const item=[...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]')].find(item=>item.querySelector('span:last-child')?.textContent?.trim()===label)!;
  expect(item).toBeDefined(); item.click(); await settle();
}
it('shows an opt-in Agent switch and actionable missing-host guidance in expanded chat', async () => {
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(component); app.mount(root); await settle();
  await menuAction('对话');
  const mode = document.querySelector<HTMLInputElement>('.agent-mode input')!;
  expect(mode).not.toBeNull(); expect(mode.checked).toBe(false);
  mode.click(); await settle();
  expect(document.querySelector('.agent-controls')?.textContent).toContain('更新 Otools');
  expect(document.querySelector('.agent-controls')?.textContent).toContain('管理引擎');
});
it.each([
  {label:'存档',heading:'存档'},
  {label:'角色',heading:'角色'},
])('opens $label directly from the desktop menu while refreshing its data',async({label,heading})=>{
  const root=document.createElement('div');document.body.append(root);app=createApp(component);app.mount(root);await settle();
  await menuAction(label);
  expect(document.querySelector('.companion-window')).not.toBeNull();
  expect(document.querySelector('main')?.getAttribute('aria-label')).toBe(heading);
});
it('keeps desktop pet compact with all functions in its right-click menu and preserves the chat draft', async () => {
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(component); app.mount(root); await settle();
  expect(document.querySelector('.pet-window')).not.toBeNull();
  expect(document.querySelector('.pet-header, .pet-caption, .pet-fab, .compact-composer')).toBeNull();
  expect(document.querySelector('.pet-window input, .pet-window textarea')).toBeNull();
  expect(document.querySelector('.pet-bubble')).toBeNull();
  await openMenu();
  const labels=[...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map(item=>item.querySelector('span:last-child')?.textContent?.trim());
  expect(labels).toEqual(expect.arrayContaining(['对话','存档','角色','故事','记忆','插件连接','设置','AI 模型','窗口置顶','关闭']));
  document.querySelector<HTMLButtonElement>('[role="menuitem"][data-command="chat"]')!.click(); await settle();
  const input=document.querySelector<HTMLTextAreaElement>('.chat-composer textarea')!;
  input.value='Draft to keep'; input.dispatchEvent(new Event('input',{bubbles:true})); await nextTick();
  button('回到桌面').click(); await settle();
  expect(document.querySelector('.pet-window')).not.toBeNull();
  await menuAction('对话');
  expect(document.querySelector<HTMLTextAreaElement>('.chat-composer textarea')!.value).toBe('Draft to keep');
});
