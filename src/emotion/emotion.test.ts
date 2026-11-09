import { describe, expect, it } from 'vitest'
import { EmotionClassifier, tokenizeEmotion, createOnnxRuntimeAdapter } from './index'
import { parseDialogue } from '../dialogue/protocol'
const vocab = '[PAD]\n[UNK]\n[CLS]\n[SEP]\n开\n心\n😀\n'
const labelMapping = JSON.stringify({ id2label: { '0': '开心', '1': '平静' }, label2id: { '开心': 0, '平静': 1 } })
describe('upstream dialogue protocol', () => {
  it('preserves multiple emotion, TTS and action segments from actual protocol', () => {
    expect(parseDialogue('【开心】你好！<こんにちは~>（挥手）【平静】再见。(点头)', { enableTranslate: true })).toEqual([
      { emotion: '开心', originalTag: '开心', text: '你好！', ttsText: 'こんにちは。', action: '挥手' },
      { emotion: '平静', originalTag: '平静', text: '再见。', ttsText: '', action: '点头' },
    ])
  })
  it('repairs fullwidth/unclosed TTS tags, strips hidden braces, preserves book titles', () => {
    expect(parseDialogue('【平静】读《故事》{hidden}＜読む\n', { enableTranslate: true })[0]).toMatchObject({ text: '读故事', ttsText: '読む' })
    expect(parseDialogue('【开心】你好<hello>')[0].ttsText).toBe('你好')
    expect(parseDialogue('Plain text')).toEqual([])
  })
})
describe('emotion model pipeline', () => {
  it('tokenizes unicode scalars with CLS SEP and padding/truncation to 128', () => {
    const tokens = tokenizeEmotion('开心😀?', vocab)
    expect([...tokens.inputIds.slice(0, 8)]).toEqual([2n, 4n, 5n, 6n, 1n, 3n, 0n, 0n])
    expect([...tokens.attentionMask.slice(0, 8)]).toEqual([1, 1, 1, 1, 1, 1, 0, 0])
    expect(tokenizeEmotion('开'.repeat(200), vocab).inputIds[127]).toBe(3n)
  })
  it('reports unavailable model explicitly and applies true inference softmax when loaded', async () => {
    const classifier = new EmotionClassifier()
    expect(classifier.status).toBe('missing-model')
    expect(await classifier.predict('开心')).toMatchObject({ disabled: true, source: 'missing-model' })
    await classifier.load({ model: new Uint8Array([1]), vocab, labelMapping }, { create: async () => ({ run: async tokens => {
      expect(tokens.inputIds.length).toBe(128)
      expect(tokens.attentionMask).toBeInstanceOf(Float32Array)
      return [Math.log(3), 0]
    } }) })
    const result = await classifier.predict('开心')
    expect(result.label).toBe('开心'); expect(result.confidence).toBeCloseTo(0.75); expect(result.source).toBe('model')
    expect(await classifier.predict('撒娇')).toMatchObject({ label: '调皮', source: 'upstream-special-case' })
  })
  it('uses the 0.08 threshold and rejects LFS weights and malformed mappings', async () => {
    const classifier = new EmotionClassifier()
    const labels = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, `label${i}`]))
    await classifier.load({ model: new Uint8Array([1]), vocab, labelMapping: JSON.stringify({ id2label: labels, label2id: {} }) }, { create: async () => ({ run: async () => Array(20).fill(0) }) })
    expect(await classifier.predict('x')).toMatchObject({ label: '不确定', source: 'model', confidence: 0.05 })
    await expect(classifier.load({ model: new TextEncoder().encode('version https://git-lfs.github.com/spec/v1'), vocab, labelMapping }, { create: async () => { throw new Error('must not run') } })).rejects.toThrow(/LFS/)
  })
  it('adapts ONNX input names and int64 ids plus float32 attention, then releases runtime', async () => {
    const feeds: Record<string, unknown>[] = []; let released = false
    class Tensor { constructor(public type: string, public data: unknown, public dims: number[]) {} }
    const runtime = createOnnxRuntimeAdapter({ Tensor, InferenceSession: { create: async () => ({ inputNames: ['ids', 'mask'], outputNames: ['scores'], run: async (input: Record<string, unknown>) => { feeds.push(input); return { scores: { data: new Float32Array([2, 1]) } } }, release: async () => { released = true } }) } })
    const classifier = new EmotionClassifier()
    await classifier.load({ model: new Uint8Array([1]), vocab, labelMapping }, runtime)
    await classifier.predict('开心')
    expect(feeds[0].ids).toMatchObject({ type: 'int64', dims: [1, 128] })
    expect(feeds[0].mask).toMatchObject({ type: 'float32', dims: [1, 128] })
    await classifier.dispose(); expect(released).toBe(true); expect(classifier.status).toBe('missing-model')
  })
})
