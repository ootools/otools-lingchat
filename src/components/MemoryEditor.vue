<script setup lang="ts">
import { ref, watch } from 'vue';
import Icon from './Icon.vue';
const props = defineProps<{ title: string; value: string; limit: number; saveLabel: string; index: number }>();
const emit = defineEmits<{ save: [value: string] }>();
const draft = ref(props.value); watch(() => props.value, value => draft.value = value);
</script>
<template><article class="surface memory-card"><div class="memory-heading"><span class="memory-number">0{{ index + 1 }}</span><h3>{{ title }}</h3><Icon :name="['clock', 'story', 'characters', 'heart'][index]" :size="19"/></div><textarea v-model="draft" :aria-label="title" maxlength="100000" rows="5"/><div class="memory-footer"><span>{{ Array.from(draft).length }} · {{ limit }}</span><button class="text-button" :disabled="draft === value" @click="emit('save', draft)"><Icon name="check" :size="15"/>{{ saveLabel }}</button></div></article></template>
