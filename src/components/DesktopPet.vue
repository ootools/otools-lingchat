<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { cursorPosition, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import type { Companion } from '../composables/useCompanion';
import type { TextKey } from '../composables/i18n';
import { PetPointerController } from '../host/petPointer';
import { hitsPetContent } from '../host/petHit';
import { PetGesture } from '../host/petGesture';
import { PetMenu, petMenuEntries, type PetCommand } from '../host/petMenu';
import { createPetNativeMenu } from '../host/petNativeMenu';
import { compactLayout, PET_ARTWORK, type Point, type PetLayout, type Rect } from '../host/petGeometry';
import { petUiLabels } from '../host/petUiLabels';
import { nativeWindow } from '../host/bridge';
import PetArtwork from './PetArtwork.vue';
import PetPreviewMenu from './PetPreviewMenu.vue';
import Icon from './Icon.vue';

const props=defineProps<{companion:Companion;native:boolean;preview:boolean;avatar?:string;noticeVersion:number}>();
const emit=defineEmits<{layout:[layout:PetLayout];command:[command:PetCommand];broken:[]}>();
const c=props.companion;
const bounds=ref<Rect>(PET_ARTWORK);
const showing=ref(false); const previewMenu=ref<Point>();
const avatarButton=ref<HTMLButtonElement>(); const privacyBadge=ref<HTMLElement>(); const privacySize=ref({width:0,height:0});
const labels=computed(()=>petUiLabels(c.locale.value));
const observing=computed(()=>c.observationStatus.value?.state==='active'||c.observationStatus.value?.state==='pending');
const notice=computed(()=>c.error.value||c.toast.value||(c.busy.value?(c.streamed.value||c.t('thinking')):c.bubble.value));
const layout=computed(()=>{
  const value=compactLayout(bounds.value,c.scale.value,showing.value&&!!notice.value);
  if(!observing.value)return value;
  const width=Math.max(value.width,Math.ceil(privacySize.value.width)+10);
  const height=Math.max(value.height,Math.ceil(privacySize.value.height)+10);
  return{...value,width,height,anchor:{x:width/2,y:height-4}};
});
const entries=computed(()=>petMenuEntries(key=>labels.value[key as keyof typeof labels.value]??c.t(key as TextKey),{topmost:c.topmost.value,busy:c.busy.value,observing:observing.value,ready:!c.loading.value,notice:!!notice.value}));
let disposed=false; let timer:ReturnType<typeof setTimeout>|undefined;
let held=false; let menuHeld=false; let pointer:PetPointerController|undefined;
function measurePrivacy(){const box=privacyBadge.value?.getBoundingClientRect();privacySize.value={width:box?.width??0,height:box?.height??0};}
watch([observing,labels,()=>c.scale.value,()=>c.observationStatus.value?.state],()=>{if(!disposed)measurePrivacy();},{flush:'post'});
function showNotice(){if(!notice.value)return;showing.value=true;clearTimeout(timer);if(!c.busy.value)timer=setTimeout(()=>{showing.value=false;},12_000);}
watch([notice,()=>c.busy.value,()=>c.loading.value],([text,busy,loading],before)=>{
  if(!loading&&!disposed&&(busy||c.error.value||c.toast.value||(before?.length&&(text!==before[0]||busy!==before[1]))))showNotice();
},{immediate:true});
watch(()=>props.noticeVersion,showNotice);
watch(layout,value=>emit('layout',value),{immediate:true});
const gesture=new PetGesture({pet:()=>emit('command','pet'),drag:async()=>{await nativeWindow.drag();},held:value=>{held=value;void pointer?.refresh();},error:c.fail});
const menu=new PetMenu({create:createPetNativeMenu,select:command=>emit('command',command),held:value=>{menuHeld=value;void pointer?.refresh();},error:c.fail});
function pointerData(event:PointerEvent){return{x:event.clientX,y:event.clientY,id:event.pointerId,button:event.button};}
function down(event:PointerEvent){
  if(props.native&&!hitsPetContent({x:event.clientX,y:event.clientY}))return;
  if(gesture.down(pointerData(event))){event.preventDefault();try{(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);}catch{/* Native move still owns the window drag. */}}
}
function move(event:PointerEvent){if(!event.buttons){gesture.cancel();return;}gesture.move(pointerData(event));}
function release(){gesture.cancel();}
function openContextMenu(point:Point){
  gesture.cancel();
  if(props.native)void menu.open(entries.value,point);
  else if(props.preview)previewMenu.value=point;
  else c.fail(c.t('noHost'));
}
function contextMenu(event:MouseEvent){
  event.preventDefault();
  const point={x:event.clientX,y:event.clientY};
  if(props.native&&!hitsPetContent(point))return;
  openContextMenu(point);
}
function keyboardMenu(event:KeyboardEvent){
  const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenu({x:rect.left+rect.width/2,y:rect.top+rect.height/2});
}
async function closePreviewMenu(){previewMenu.value=undefined;await nextTick();if(!disposed)avatarButton.value?.focus();}
function choose(command:PetCommand){void closePreviewMenu();emit('command',command);}
function startPointer(){
  if(!props.native||disposed)return;
  if(!pointer){const windowApi=getCurrentWindow();pointer=new PetPointerController({
    compact:()=>c.active.value,held:()=>held||menuHeld,
    sample:async()=>{const macOS=/Mac/.test(navigator.platform);const[cursor,origin,scale,primary]=await Promise.all([cursorPosition(),windowApi.outerPosition(),windowApi.scaleFactor(),macOS?primaryMonitor():Promise.resolve(null)]);if(macOS&&!primary)throw new Error('Primary monitor is unavailable');return{cursor,origin,scale,cursorScale:macOS?primary!.scaleFactor:scale};},
    hit:hitsPetContent,setIgnore:value=>windowApi.setIgnoreCursorEvents(value),error:()=>c.fail(c.t('pointerUnavailable')),
  });}void pointer.start();
}
watch(()=>props.native,startPointer);
onMounted(()=>{measurePrivacy();startPointer();window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('blur',release);});
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);gesture.cancel();window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('blur',release);void pointer?.stop();void menu.dispose().catch(c.fail);});
</script>
<template>
  <section class="pet-window" :aria-label="c.t('companion')" :style="{width:`${layout.width}px`,height:`${layout.height}px`}">
    <div v-if="showing&&notice" class="pet-bubble" data-pet-hit :role="c.error.value?'alert':'status'" aria-live="polite"><Icon name="sparkle" :size="14"/><p>{{notice}}</p></div>
    <button ref="avatarButton" type="button" class="pet-avatar" :aria-label="c.t('pet')" :title="labels.drag" @pointerdown="down" @pointermove="move" @pointerup="gesture.up($event.pointerId)" @pointercancel="release" @contextmenu="contextMenu" @click="event=>{if(event.detail===0)emit('command','pet');}" @keydown.shift.f10.prevent="keyboardMenu">
      <PetArtwork :avatar="avatar" :name="c.characterName.value" :emotion="c.emotion.value" :scale="c.scale.value" @geometry="bounds=$event" @broken="emit('broken')" />
    </button>
    <div v-if="observing" ref="privacyBadge" class="pet-privacy-indicator" data-pet-hit role="status" :aria-label="c.observationStatus.value?.state==='active'?labels.observing:labels.pending"><Icon name="eye" :size="14"/><span>{{c.observationStatus.value?.state==='active'?labels.observing:labels.pending}}</span></div>
    <PetPreviewMenu v-if="previewMenu" :label="labels.menu" :items="entries" :point="previewMenu" @select="choose" @close="closePreviewMenu" />
  </section>
</template>
