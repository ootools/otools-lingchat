<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Mascot from './Mascot.vue';
import { imageBounds } from '../host/petHit';
import { PET_ARTWORK, compactLayout, type Rect } from '../host/petGeometry';
const props=defineProps<{avatar?:string;name:string;emotion:string;scale:number}>();
const emit=defineEmits<{geometry:[bounds:Rect];broken:[]}>();
const image=ref<HTMLImageElement>(); const bounds=ref<Rect>(PET_ARTWORK); const natural=ref({width:0,height:0});
let disposed=false;
watch(()=>props.avatar,()=>{bounds.value=PET_ARTWORK; natural.value={width:0,height:0}; emit('geometry',PET_ARTWORK);});
const layout=computed(()=>compactLayout(bounds.value,props.scale,false));
const imageStyle=computed(()=>{
  const ratio=layout.value.artwork.height/bounds.value.height;
  return natural.value.height?{width:`${natural.value.width*ratio}px`,height:`${natural.value.height*ratio}px`,left:`${-bounds.value.x*ratio}px`,top:`${-bounds.value.y*ratio}px`}:{};
});
function loaded(event:Event){
  if(disposed || !image.value || event.currentTarget!==image.value)return;
  const visible=imageBounds(image.value);
  if(!visible){emit('broken');return;}
  natural.value={width:image.value.naturalWidth,height:image.value.naturalHeight}; bounds.value=visible;emit('geometry',visible);
}
function failed(event:Event){if(!disposed&&event.currentTarget===image.value)emit('broken');}
onBeforeUnmount(()=>{disposed=true;});
</script>
<template>
  <div class="pet-art" :style="{width:`${layout.artwork.width}px`,height:`${layout.artwork.height}px`}">
    <img v-if="avatar" :key="avatar" ref="image" class="imported-avatar" :src="avatar" :alt="name" :style="imageStyle" draggable="false" @load="loaded" @error="failed" />
    <Mascot v-else :emotion="emotion" compact cropped />
  </div>
</template>
