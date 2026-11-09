<script setup lang="ts">
import { onMounted } from 'vue';
import type { AsyncStore } from '../saves/store';
import type { TextKey } from '../composables/i18n';
import { useEmotionModel } from '../composables/useEmotionModel';
import Icon from './Icon.vue';
const props = defineProps<{ store: AsyncStore; t: (key: TextKey) => string }>();
const emit = defineEmits<{ error: [unknown] }>();
const model = useEmotionModel(props.store);
const { status, processing, hasStoredModel, error } = model;
async function run(action: () => Promise<unknown>) { try { await action(); } catch (reason) { emit('error', reason); } }
onMounted(() => { void run(model.initialize); });
</script>
<template>
  <section class="surface settings-group">
    <div class="card-heading"><span class="icon-tile"><Icon name="memory" /></span><div><h3>{{ t('emotionModel') }}</h3><p>{{ t('modelHint') }}</p></div><span class="status-pill" :class="{ neutral: status !== 'ready' }">{{ status === 'ready' ? t('active') : t('unavailable') }}</span></div>
    <p class="hint">model.onnx → vocab.txt → label_mapping.json</p>
    <div class="section-actions"><button class="button primary" :disabled="processing" @click="run(model.importModel)"><Icon name="upload" :size="16" />{{ processing ? t('loading') : t('importModel') }}</button><button v-if="hasStoredModel" class="text-button danger" :disabled="processing" @click="run(() => model.removeModel(t('confirmDelete')))">{{ t('delete') }}</button></div>
    <p v-if="error" class="hint" role="alert">{{ error }}</p>
  </section>
</template>
