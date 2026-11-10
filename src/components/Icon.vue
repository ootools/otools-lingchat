<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5a8.5 8.5 0 0 1 8.5-8.5h3a8.5 8.5 0 0 1 8.5 8.5ZM7 10h8M7 14h5',
  saves: 'M4 4h13l3 3v13H4V4Zm3 0v6h10V4M7 20v-6h10v6',
  characters: 'm5 9-1-6 6 3h4l6-3-1 6a8 8 0 1 1-14 0ZM8 12v1m8-1v1m-6 3 2 1 2-1',
  story: 'M12 5C7 2 3 4 2 5v15c3-2 6-2 10 0 4-2 7-2 10 0V5c-3-2-6-2-10 0Zm0 0v15',
  memory: 'M9 4a4 4 0 0 0-6 4 4 4 0 0 0-1 7 4 4 0 0 0 7 4V4Zm6 0a4 4 0 0 1 6 4 4 4 0 0 1 1 7 4 4 0 0 1-7 4V4ZM5 8h4m-5 7h5m6-7h4m-4 7h5',
  notes: 'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h3',
  connections: 'M9 7V3m6 4V3M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4m-3 0h6',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
  send: 'm4 11 16-8-7 18-2-8-7-2Zm7 2 9-10', stop: 'M6 6h12v12H6z',
  pin: 'm9 3 6 0-1 6 4 4H6l4-4-1-6Zm3 10v8', expand: 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5', collapse: 'M9 4v5H4m16 0h-5V4M9 20v-5H4m16 0h-5v5',
  heart: 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 2 10 8 15 6-5 12-11 8-15Z',
  arrow: 'M5 12h14m-5-5 5 5-5 5', upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7', check: 'm5 12 4 4L19 6',
  sparkle: 'm12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  sound: 'M11 4 6 8H2v8h4l5 4V4Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-4 7a7 7 0 0 0 14 0m-7 7v3m-4 0h8',
  folder: 'M2 6h8l2 3h10v12H2V6Zm0 0V3h7l3 3h8v3', clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4v6l4 3',
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6', more: 'M5 11v2m7-2v2m7-2v2', refresh: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
  move: 'M12 2v20M2 12h20m-14-6 4-4 4 4m-8 12 4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4',
};
</script>
<template><svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.sparkle" /></svg></template>
