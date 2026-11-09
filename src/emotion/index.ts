// SPDX-License-Identifier: AGPL-3.0-only
// Derived from LingChat contributors, 0.5.2, src-tauri/src/ai_service/emotion/classifier.rs
// Revision 848fd3448c20ca32e0436a498d20e85f63393e7f. No model weights are distributed.
import { validateJson } from '../characters/archive'
export interface EmotionTokens { inputIds: BigInt64Array; attentionMask: Float32Array }
export interface EmotionSession { run(tokens: EmotionTokens): Promise<ArrayLike<number>>; dispose?(): Promise<void> | void }
export interface EmotionRuntime { create(model: Uint8Array): Promise<EmotionSession> }
export interface EmotionModelFiles { model: Uint8Array; vocab: string; labelMapping: string }
export interface EmotionPrediction {
  label: string; confidence: number; top3: [string, number][]; disabled: boolean
  source: 'model' | 'missing-model' | 'direct-label' | 'upstream-special-case' | 'error'; warning?: string
}
function vocabulary(text: string): Map<string, number> {
  if (!text || text.length > 8 * 1024 * 1024) throw new Error('Invalid vocabulary size')
  const lines = text.replace(/\r\n/g, '\n').split('\n'); if (lines.at(-1) === '') lines.pop()
  return new Map(lines.map((token, i) => [token, i]))
}
/** Upstream uses Unicode scalar characters, not wordpiece or grapheme segmentation. */
export function tokenizeEmotion(text: string, vocab: string | ReadonlyMap<string, number>): EmotionTokens {
  const map = typeof vocab === 'string' ? vocabulary(vocab) : vocab
  const ids = [map.get('[CLS]') ?? 101, ...Array.from(text).slice(0, 126).map(c => map.get(c) ?? map.get('[UNK]') ?? 100), map.get('[SEP]') ?? 102]
  const inputIds = new BigInt64Array(128).fill(BigInt(map.get('[PAD]') ?? 0)), attentionMask = new Float32Array(128)
  ids.forEach((id, i) => { inputIds[i] = BigInt(id); attentionMask[i] = 1 })
  return { inputIds, attentionMask }
}
export class EmotionClassifier {
  status: 'missing-model' | 'ready' | 'error' = 'missing-model'
  private session?: EmotionSession
  private vocab = new Map<string, number>()
  private labels: string[] = []
  private label2id: Record<string, number> = {}
  constructor(private options: { directReturnIfLabel?: boolean; threshold?: number } = {}) {}
  async load(files: EmotionModelFiles, runtime: EmotionRuntime): Promise<void> {
    await this.dispose()
    try {
      if (!files.model.length || files.model.length > 512 * 1024 * 1024) throw new Error('Invalid model size')
      if (new TextDecoder().decode(files.model.subarray(0, 100)).trimStart().startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('Model is a Git LFS pointer, not weights')
      if (files.labelMapping.length > 1024 * 1024) throw new Error('Label mapping size limit')
      const mapping = JSON.parse(files.labelMapping); validateJson(mapping)
      if (!mapping.id2label || !mapping.label2id || typeof mapping.id2label !== 'object' || typeof mapping.label2id !== 'object' || Array.isArray(mapping.id2label) || Array.isArray(mapping.label2id)) throw new Error('Invalid label mapping')
      const count = Object.keys(mapping.id2label).length
      if (count < 1 || count > 10000) throw new Error('Invalid label count')
      const labels: string[] = []
      for (let i = 0; i < count; i++) {
        if (typeof mapping.id2label[i] !== 'string' || !mapping.id2label[i]) throw new Error('Label IDs must be contiguous from zero')
        labels.push(mapping.id2label[i])
      }
      for (const [label, id] of Object.entries(mapping.label2id)) if (!Number.isInteger(id) || labels[id as number] !== label) throw new Error('Inconsistent label mapping')
      this.vocab = vocabulary(files.vocab); this.labels = labels; this.label2id = mapping.label2id
      this.session = await runtime.create(files.model); this.status = 'ready'
    } catch (error) { this.status = 'error'; throw error }
  }
  async predict(text: string): Promise<EmotionPrediction> {
    const passthrough = (source: EmotionPrediction['source'], disabled = false, warning?: string): EmotionPrediction => ({ label: text, confidence: source === 'missing-model' || source === 'error' ? 0 : 1, top3: source === 'missing-model' || source === 'error' ? [] : [[text, 1]], disabled, source, ...(warning ? { warning } : {}) })
    if (!this.session) return passthrough(this.status === 'error' ? 'error' : 'missing-model', true, 'Emotion model is unavailable; original tag is preserved without model inference.')
    if (this.options.directReturnIfLabel && Object.hasOwn(this.label2id, text)) return passthrough('direct-label')
    if (text.includes('撒娇')) return { label: '调皮', confidence: 1, top3: [['调皮', 1]], disabled: false, source: 'upstream-special-case' }
    try {
      const logits = Array.from(await this.session.run(tokenizeEmotion(text, this.vocab)))
      if (logits.length !== this.labels.length || logits.some(n => !Number.isFinite(n))) throw new Error('Invalid model logits')
      const max = Math.max(...logits), exps = logits.map(n => Math.exp(n - max)), sum = exps.reduce((a, b) => a + b, 0), probs = exps.map(n => n / sum)
      const ranked = probs.map((prob, id) => ({ prob, id })).sort((a, b) => b.prob - a.prob || a.id - b.id)
      const confidence = ranked[0].prob, threshold = this.options.threshold ?? 0.08
      return { label: confidence < threshold ? '不确定' : this.labels[ranked[0].id], confidence, top3: ranked.slice(0, 3).map(p => [this.labels[p.id], p.prob]), disabled: false, source: 'model', ...(confidence < threshold ? { warning: `置信度低于阈值(${threshold * 100}%)` } : {}) }
    } catch (error) { this.status = 'error'; return passthrough('error', true, error instanceof Error ? error.message : String(error)) }
  }
  async dispose(): Promise<void> { const old = this.session; this.session = undefined; this.status = 'missing-model'; await old?.dispose?.() }
}
/** Structural adapter accepts an explicitly installed/imported onnxruntime-web module, never downloads code or weights. */
export interface OnnxRuntimeModule {
  Tensor: new (type: 'int64' | 'float32', data: BigInt64Array | Float32Array, dims: number[]) => unknown
  InferenceSession: { create(model: Uint8Array): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, any>): Promise<Record<string, { data: ArrayLike<number | bigint | string | boolean> }>>; release?(): Promise<void> | void }> }
}
export function createOnnxRuntimeAdapter(ort: OnnxRuntimeModule): EmotionRuntime {
  return { async create(model) {
    const session = await ort.InferenceSession.create(model)
    if (session.inputNames.length !== 2 || !session.outputNames.length) { await session.release?.(); throw new Error('Expected two ONNX inputs and logits output') }
    return { async run(tokens) {
      const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('int64', tokens.inputIds, [1, 128]), [session.inputNames[1]]: new ort.Tensor('float32', tokens.attentionMask, [1, 128]) })
      const result = outputs[session.outputNames[0]]
      if (!result) throw new Error('Missing ONNX logits output')
      return Array.from(result.data, n => { if (typeof n !== 'number') throw new Error('Expected float logits'); return n })
    }, dispose: () => session.release?.() }
  } }
}
