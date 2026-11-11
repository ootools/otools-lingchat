// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import DesktopPet from './DesktopPet.vue';
import type { Companion } from '../composables/useCompanion';
import { PET_ARTWORK, compactLayout } from '../host/petGeometry';
const apps: ReturnType<typeof createApp>[]=[];
afterEach(()=>{apps.splice(0).forEach(app=>app.unmount());document.body.replaceChildren();vi.useRealTimers();});
async function settle(){for(let i=0;i<16;i++)await Promise.resolve();await nextTick();}
function companion(){
  return {locale:ref('zh'),active:ref(true),topmost:ref(true),loading:ref(false),busy:ref(false),error:ref(''),toast:ref(''),bubble:ref('Last message'),streamed:ref(''),characterName:ref('Mochi'),emotion:ref('平静'),scale:ref(1),observationStatus:ref<{state:string}|null>(null),t:(key:string)=>key,fail:vi.fn()} as unknown as Companion;
}
function mount(c:Companion,version=ref(0)){
  const root=document.createElement('div');document.body.append(root);const commands:string[]=[];const layouts:any[]=[];
  const app=createApp({setup:()=>()=>h(DesktopPet,{companion:c,native:false,preview:true,noticeVersion:version.value,onCommand:(id:string)=>commands.push(id),onLayout:(layout:any)=>layouts.push(layout)})});apps.push(app);app.mount(root);return{root,commands,layouts};
}
it('Shift+F10 opens the pet menu without treating a keyboard event as mouse coordinates',async()=>{
  const f=mount(companion());await settle();
  const pet=f.root.querySelector<HTMLButtonElement>('.pet-avatar')!;pet.getBoundingClientRect=()=>({left:40,top:50,width:200,height:220} as DOMRect);pet.focus();
  pet.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));await settle();
  const menu=f.root.querySelector<HTMLElement>('[role="menu"]')!;expect(menu).not.toBeNull();
  expect(menu.style.left).toBe('140px');expect(menu.style.top).toBe('160px');
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await settle();expect(f.root.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement).toBe(pet);
});
it('shows transient messages then returns to the idle layout without erasing the last message',async()=>{
  vi.useFakeTimers();const c=companion();const f=mount(c);await settle();expect(f.root.querySelector('.pet-bubble')).toBeNull();
  c.bubble.value='New message';await settle();expect(f.root.querySelector('.pet-bubble')!.textContent).toContain('New message');
  expect(f.layouts.at(-1)).toEqual(compactLayout(PET_ARTWORK,1,true));
  await vi.advanceTimersByTimeAsync(12_000);await settle();expect(f.root.querySelector('.pet-bubble')).toBeNull();expect(f.layouts.at(-1)).toEqual(compactLayout(PET_ARTWORK,1,false));expect(c.bubble.value).toBe('New message');
});
it('shows a reply already running when returning to desktop and hides it after completion',async()=>{
  vi.useFakeTimers();const c=companion();c.busy.value=true;c.streamed.value='Partial response';const f=mount(c);await settle();
  expect(f.root.querySelector('.pet-bubble')?.textContent).toContain('Partial response');
  await vi.advanceTimersByTimeAsync(12_000);await settle();expect(f.root.querySelector('.pet-bubble')).not.toBeNull();
  c.bubble.value='Completed response';c.busy.value=false;await settle();
  await vi.advanceTimersByTimeAsync(12_000);await settle();expect(f.root.querySelector('.pet-bubble')).toBeNull();
});
it('shows initialization errors once loading finishes without displaying the welcome bubble',async()=>{
  const c=companion();c.loading.value=true;const f=mount(c);await settle();
  c.error.value='Initialization failed';await settle();expect(f.root.querySelector('.pet-bubble')).toBeNull();
  c.loading.value=false;await settle();expect(f.root.querySelector('[role="alert"]')?.textContent).toContain('Initialization failed');
});
it('fits the full privacy badge inside the compact window when a locale needs more width',async()=>{
  const c=companion();c.scale.value=0.7;c.observationStatus.value={id:'fixture',state:'pending'};const f=mount(c);await settle();
  const badge=f.root.querySelector<HTMLElement>('.pet-privacy-indicator')!;
  badge.getBoundingClientRect=()=>({width:180,height:26} as DOMRect);
  c.locale.value='de';await settle();
  expect(badge.textContent).toContain('Wartet auf Zustimmung');
  expect(f.layouts.at(-1)).toMatchObject({width:190,height:162,anchor:{x:95,y:158}});
});
it('keeps the observation indicator visible while idle and provides the stop action',async()=>{
  const c=companion();c.observationStatus.value={id:'fixture',state:'active'};const f=mount(c);await settle();
  expect(f.root.querySelector('.pet-privacy-indicator')!.textContent).toContain('正在观察');expect(f.root.querySelector('.pet-bubble')).toBeNull();
  f.root.querySelector('.pet-avatar')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:30}));await settle();
  const stop=f.root.querySelector<HTMLButtonElement>('[data-command="stopObservation"]')!;expect(stop.disabled).toBe(false);stop.click();await settle();expect(f.commands).toEqual(['stopObservation']);
});
