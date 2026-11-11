<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import type { MenuEntry, PetCommand } from '../host/petMenu';
import type { Point } from '../host/petGeometry';
const props=defineProps<{items:MenuEntry[];point:Point;label:string}>();
const emit=defineEmits<{select:[command:PetCommand];close:[]}>();
const root=ref<HTMLElement>(); const position=ref({...props.point});
onMounted(async()=>{await nextTick(); const box=root.value?.getBoundingClientRect();if(box){position.value={x:Math.max(4,Math.min(props.point.x,window.innerWidth-box.width-4)),y:Math.max(4,Math.min(props.point.y,window.innerHeight-box.height-4))};}root.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();});
function keydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();emit('close');return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const buttons=[...root.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if(!buttons.length)return;
  event.preventDefault(); const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length;
  buttons[index].focus();
}
</script>
<template>
  <div class="preview-menu-scrim" @pointerdown.self="emit('close')" @contextmenu.prevent="emit('close')">
    <div ref="root" class="pet-context-menu" role="menu" :aria-label="label" :style="{left:`${position.x}px`,top:`${position.y}px`}" @keydown="keydown">
      <template v-for="(item,index) in items" :key="'id'in item?item.id:index">
        <div v-if="'item'in item" class="menu-separator" role="separator" />
        <button v-else :role="item.checked===undefined?'menuitem':'menuitemcheckbox'" :aria-checked="item.checked" :data-command="item.id" :disabled="!item.enabled" @click="emit('select',item.id)"><span class="menu-check" aria-hidden="true">{{item.checked?'✓':''}}</span><span>{{item.text}}</span></button>
      </template>
    </div>
  </div>
</template>
