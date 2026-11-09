import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { importCharacterZip, parseCharacterSettings, resolveCharacterImage } from './index'
import { readSafeZip } from './archive'

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1])
const settings = `ai_name: Original\nuser_name: Friend\nclothes:\n  - name: default\n    prompt: Everyday outfit\n  - name: winter\n    prompt: A coat\nbody_part:\n  head:\n    X: [0.1, 0.5, 0.8]\n    Y: [0.1, 0.2, 0.1]\n    clothesName: default\n    message: Hello\n    windowWidth: 800\n    windowHeight: 600\n`
const pack = (files: Record<string, Uint8Array> = {}) => zipSync({ 'Pet/settings.yml': strToU8(settings), 'Pet/avatar/正常.png': png, ...files })

describe('character imports', () => {
  it('preserves upstream clothes objects and XY polygons, indexing outfit images without object URLs', async () => {
    const result = await importCharacterZip(pack({ 'Pet/avatar/winter/开心.png': png }))
    expect(result.settings.ai_name).toBe('Original')
    expect(result.settings.clothes?.[1]).toEqual({ name: 'winter', prompt: 'A coat' })
    expect(result.settings.body_part?.head.X).toEqual([0.1, 0.5, 0.8])
    expect(result.assets['avatar/正常.png']).toBeInstanceOf(Blob)
    expect(resolveCharacterImage(result, '平静')).toBe('avatar/正常.png')
    expect(resolveCharacterImage(result, '开心', 'winter')).toBe('avatar/winter/开心.png')
  })
  it.each([
    ['../escape.png', png, /path/i],
    ['Pet/avatar/x.svg', strToU8('<svg onload="alert(1)"/>'), /svg/i],
    ['Pet/avatar/fake.png', strToU8('<html>unsafe</html>'), /content|image/i],
    ['Pet/avatar/lfs.png', strToU8('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 999'), /LFS/i],
    ['Pet/run.js', strToU8('alert(1)'), /unsupported|executable/i],
  ])('rejects unsafe entry %s', async (name, bytes, error) => {
    await expect(importCharacterZip(pack({ [name]: bytes }))).rejects.toThrow(error)
  })
  it('rejects aliases, prototype keys, and malformed polygon lengths', () => {
    expect(() => parseCharacterSettings('ai_name: &a Pet\ninfo: *a')).toThrow(/alias/i)
    expect(() => parseCharacterSettings('ai_name: Pet\n__proto__: {polluted: true}')).toThrow(/key/i)
    expect(() => parseCharacterSettings(settings.replace('Y: [0.1, 0.2, 0.1]', 'Y: [0.2]'))).toThrow(/polygon/i)
  })
  it('bounds archive bytes, expanded bytes, and entries before extraction', async () => {
    await expect(readSafeZip(pack(), { maxEntries: 1 })).rejects.toThrow(/entries/i)
    await expect(readSafeZip(pack(), { maxTotalBytes: 10 })).rejects.toThrow(/size|bytes/i)
    await expect(readSafeZip(pack(), { maxArchiveBytes: 10 })).rejects.toThrow(/size|bytes/i)
  })
  it('rejects symlinks and local/central path disagreement', async () => {
    const zip = pack()
    const symlink = zip.slice()
    const view = new DataView(symlink.buffer)
    for (let i = 0; i < symlink.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 38, 0xa1ff0000, true); break }
    }
    await expect(readSafeZip(symlink)).rejects.toThrow(/symlink|file type/i)
    const mismatch = zip.slice(); mismatch[30] = 88
    await expect(readSafeZip(mismatch)).rejects.toThrow(/mismatch/i)
  })
})
