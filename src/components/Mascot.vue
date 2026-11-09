<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ emotion?: string; compact?: boolean }>(), { emotion: '平静' });
const mood = computed(() => /开心|happy|喜|爱/.test(props.emotion) ? 'happy' : /难过|sad|哭|伤/.test(props.emotion) ? 'sad' : /生气|angry|怒/.test(props.emotion) ? 'angry' : /惊|surprise/.test(props.emotion) ? 'surprise' : /困|sleep/.test(props.emotion) ? 'sleep' : 'calm');
</script>
<template>
  <!-- Original vector artwork created for Otools LingChat; no upstream artwork used. -->
  <svg class="mascot" :class="[mood, { compact }]" viewBox="0 0 320 340" role="img" :aria-label="`小糯 · ${emotion}`">
    <defs>
      <linearGradient id="catCoat" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf7"/><stop offset="1" stop-color="#eee7da"/></linearGradient>
      <linearGradient id="catScarf" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8bbca0"/><stop offset="1" stop-color="#4f8d73"/></linearGradient>
      <radialGradient id="catGlow"><stop stop-color="#f2d793" stop-opacity=".3"/><stop offset="1" stop-color="#f2d793" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="159" cy="298" rx="100" ry="15" fill="#385a44" opacity=".09"/>
    <circle cx="156" cy="168" r="145" fill="url(#catGlow)"/>
    <g class="cat-tail"><path d="M226 256C292 277 294 221 265 218c-15-1-23 12-17 24" fill="none" stroke="#ddd5c8" stroke-width="29" stroke-linecap="round"/><path d="M228 250c58 25 62-25 36-25" fill="none" stroke="#f6f0e5" stroke-width="21" stroke-linecap="round"/></g>
    <g class="cat-body">
      <path d="M112 195c-13 15-25 48-20 75 4 24 30 23 66 23s68 4 71-22c3-27-15-59-28-76Z" fill="url(#catCoat)" stroke="#dfd6c7" stroke-width="2"/>
      <ellipse cx="158" cy="254" rx="39" ry="31" fill="#fffef8"/>
      <path d="M111 251c-11 0-21 28-4 36 11 4 21 0 22-7m57-29c11 0 25 28 8 36-11 4-21 0-22-7" fill="#faf6ed" stroke="#dfd6c7" stroke-width="2"/>
      <path d="m139 204 1 48 20-9-3-39" fill="url(#catScarf)"/>
      <path d="M98 192q59 38 115-1l-5 26q-54 28-105-1Z" fill="url(#catScarf)"/>
      <path d="M177 216v24l8-6 8 6-2-29" fill="#699f83"/>
      <circle cx="161" cy="224" r="8" fill="#e5bf72" stroke="#ceaa61" stroke-width="1.5"/><path d="M161 222v5m-3-6h6" stroke="#a08047" stroke-width="1.5" stroke-linecap="round"/>
    </g>
    <g class="cat-head">
      <path d="M80 111Q65 50 83 39q8-2 51 39h53q39-37 51-35 17 14 1 73c28 33 23 71-6 87-34 20-115 20-149-2-29-19-31-57-4-90Z" fill="url(#catCoat)" stroke="#dfd6c7" stroke-width="2.5"/>
      <path d="M85 92q-7-34 1-39 6 0 32 27Z" fill="#eac4ba"/><path d="M205 81q21-24 29-25 5 10-3 39Z" fill="#eac4ba"/>
      <path d="M143 82q9 10 5 20m12-22q8 10 4 20m11-17q7 8 2 16" fill="none" stroke="#d2c8b9" stroke-width="6" stroke-linecap="round" opacity=".7"/>
      <ellipse cx="103" cy="165" rx="15" ry="8" fill="#e7b5a9" opacity=".55"/><ellipse cx="215" cy="165" rx="15" ry="8" fill="#e7b5a9" opacity=".55"/>
      <g class="cat-eyes" stroke="#464d43" stroke-width="4.5" stroke-linecap="round" fill="none">
        <template v-if="mood === 'happy'"><path d="M110 148q10-13 20 0m61 0q10-13 20 0"/></template>
        <template v-else-if="mood === 'sleep'"><path d="M110 149q10 9 20 0m61 0q10 9 20 0"/></template>
        <template v-else-if="mood === 'angry'"><path d="m110 139 20 7m61 0 20-7M122 150v7m78-7v7"/></template>
        <template v-else-if="mood === 'sad'"><path d="m111 137 16-6m66 0 16 6M121 150v7m79-7v7"/><path d="M211 159q-8 11 0 12 8-1 0-12" fill="#a4c9d0" stroke="none"/></template>
        <template v-else><ellipse cx="121" cy="147" :ry="mood === 'surprise' ? 11 : 8" rx="5.5" fill="#464d43" stroke="none"/><ellipse cx="199" cy="147" :ry="mood === 'surprise' ? 11 : 8" rx="5.5" fill="#464d43" stroke="none"/><circle cx="119" cy="144" r="1.8" fill="white" stroke="none"/><circle cx="197" cy="144" r="1.8" fill="white" stroke="none"/></template>
      </g>
      <path d="M153 160q7-5 14 0l-7 6Z" fill="#bc9284"/>
      <path v-if="mood === 'surprise'" d="M155 177a5 6 0 1 0 10 0 5 6 0 1 0-10 0" fill="#9f7169"/>
      <path v-else d="M160 166v5q-6 10-14 1m14-1q6 10 14 1" fill="none" stroke="#71655a" stroke-width="2.4" stroke-linecap="round"/>
      <path d="m76 154 20 5m-21 9 19-1m131-8 20-5m-19 13 20 1" stroke="#c8bfb2" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="cat-sparkles" fill="#cda95d"><path d="m54 105 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/><path d="m263 82 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/><circle cx="252" cy="163" r="3"/></g>
  </svg>
</template>
