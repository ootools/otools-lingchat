import { ref } from 'vue';
import type { AsyncStore } from '../saves/store';
import { EmotionClassifier, createOnnxRuntimeAdapter, type EmotionModelFiles, type EmotionRuntime, type OnnxRuntimeModule } from '../emotion';
import { parseDialogue } from '../dialogue/protocol';

const shared = new WeakMap<AsyncStore, ReturnType<typeof createModel>>();
const abort = () => new DOMException('Emotion prediction cancelled', 'AbortError');
async function localRuntime(): Promise<EmotionRuntime> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL('./onnx/', document.baseURI).href;
  return createOnnxRuntimeAdapter(ort as unknown as OnnxRuntimeModule);
}
function createModel(store: AsyncStore, runtime: () => Promise<EmotionRuntime>) {
  const status = ref<EmotionClassifier['status']>('missing-model');
  const processing = ref(false); const error = ref(''); const hasStoredModel = ref(false);
  let classifier = new EmotionClassifier(); let generation = 0; let initialized = false;
  let initialization: Promise<void> | undefined;
  async function load(files: EmotionModelFiles, persist: boolean) {
    if (processing.value) throw new Error('Emotion model is already loading');
    processing.value = true; error.value = ''; const epoch = ++generation;
    const candidate = new EmotionClassifier();
    try {
      await candidate.load(files, await runtime());
      if (epoch !== generation) throw abort();
      if (persist) await store.update('emotion:model', () => files);
      if (epoch !== generation) throw abort();
      const old = classifier; classifier = candidate; status.value = 'ready'; hasStoredModel.value = true;
      await old.dispose();
    } catch (reason) {
      await candidate.dispose();
      if (epoch === generation) {
        status.value = classifier.status;
        error.value = reason instanceof Error ? reason.message : 'Emotion model loading failed';
      }
      throw reason;
    } finally { if (epoch === generation) processing.value = false; }
  }
  return {
    status, processing, error, hasStoredModel,
    initialize(): Promise<void> {
      if (initialization) return initialization;
      if (initialized) return Promise.resolve();
      initialization = (async () => {
        const files = await store.get<EmotionModelFiles>('emotion:model');
        hasStoredModel.value = !!files;
        if (files) await load(files, false);
        initialized = true;
      })().finally(() => { initialization = undefined; });
      return initialization;
    },
    async importModel(): Promise<boolean> {
      const { chooseFile } = await import('../host/bridge');
      const model = await chooseFile(['onnx']); if (!model) return false;
      const vocab = await chooseFile(['txt']); if (!vocab) return false;
      const labels = await chooseFile(['json']); if (!labels) return false;
      await load({ model: model.bytes, vocab: new TextDecoder().decode(vocab.bytes), labelMapping: new TextDecoder().decode(labels.bytes) }, true);
      initialized = true; return true;
    },
    async removeModel(confirmMessage: string): Promise<boolean> {
      const { confirmAction } = await import('../host/bridge');
      if (!await confirmAction(confirmMessage)) return false;
      generation++; processing.value = false;
      await store.update('emotion:model', () => undefined);
      await classifier.dispose(); classifier = new EmotionClassifier();
      hasStoredModel.value = false; status.value = 'missing-model'; error.value = ''; return true;
    },
    async predictCompleted(answer: string, isCurrent: () => boolean = () => true) {
      const epoch = generation; const segments = parseDialogue(answer);
      for (const segment of segments) {
        if (!isCurrent() || epoch !== generation) throw abort();
        const predicted = await classifier.predict(segment.originalTag);
        if (!isCurrent() || epoch !== generation) throw abort();
        if (!predicted.disabled) segment.emotion = predicted.label;
        status.value = classifier.status;
      }
      return segments;
    },
    async dispose() { generation++; processing.value = false; await classifier.dispose(); status.value = 'missing-model'; initialized = false; },
  };
}
export function useEmotionModel(store: AsyncStore, runtime: () => Promise<EmotionRuntime> = localRuntime) {
  let model = shared.get(store);
  if (!model) { model = createModel(store, runtime); shared.set(store, model); }
  return model;
}
