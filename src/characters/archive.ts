// SPDX-License-Identifier: AGPL-3.0-only
// LingChat-compatible import boundary. Original bounded archive implementation for Otools.
import { Inflate } from 'fflate'
import { parseDocument, isAlias, visit } from 'yaml'

export type ZipInput = Uint8Array | ArrayBuffer | Blob
export interface ArchiveLimits { maxArchiveBytes: number; maxTotalBytes: number; maxFileBytes: number; maxEntries: number }
export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = { maxArchiveBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024, maxFileBytes: 32 * 1024 * 1024, maxEntries: 2048 }
export type SafeFiles = Record<string, Uint8Array>
const decoder = new TextDecoder('utf-8', { fatal: true })
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
export function safeKey(key: string): string {
  if (!key || forbiddenKeys.has(key)) throw new Error(`Unsafe key: ${key}`)
  return key
}
export function safePath(path: string): string {
  if (!path || path.length > 512 || /[\\:\x00-\x1f\x7f%?#]/u.test(path) || path.startsWith('/') || path.normalize('NFC') !== path) throw new Error(`Unsafe path: ${path}`)
  const parts = path.replace(/\/$/, '').split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || forbiddenKeys.has(p))) throw new Error(`Unsafe path: ${path}`)
  return path
}
export function textFile(bytes: Uint8Array): string {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Text file exceeds size limit')
  const text = decoder.decode(bytes)
  if (text.includes('\0')) throw new Error('Invalid text content')
  return text
}
export function parseSafeYaml(text: string): Record<string, unknown> {
  if (text.length > 2 * 1024 * 1024) throw new Error('YAML size limit exceeded')
  const doc = parseDocument(text, { uniqueKeys: true, strict: true, version: '1.2' })
  if (doc.errors.length || doc.warnings.length) throw new Error(`Invalid YAML: ${[...doc.errors, ...doc.warnings].map(e => e.message).join('; ')}`)
  visit(doc, (_key, node) => { if (isAlias(node)) throw new Error('YAML aliases are disallowed') })
  const value: unknown = doc.toJS({ maxAliasCount: 0 })
  validateJson(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected YAML mapping')
  return value as Record<string, unknown>
}
export function validateJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 50000 || depth > 32) throw new Error('Data nesting/size limit exceeded')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite value')
  if (value !== null && typeof value === 'object') {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Unsupported object')
    for (const [key, child] of Object.entries(value)) { safeKey(key); validateJson(child, depth + 1, budget) }
  } else if (!['string', 'boolean', 'number'].includes(typeof value) && value !== null) throw new Error('Unsupported value')
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** Inspect the central AND local directories before bounded, chunked inflation; never write to disk. */
export async function readSafeZip(input: ZipInput, overrides: Partial<ArchiveLimits> = {}): Promise<SafeFiles> {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides }
  for (const n of Object.values(limits)) if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid archive limit')
  const size = input instanceof Blob ? input.size : input.byteLength
  if (size > limits.maxArchiveBytes) throw new Error('Archive size limit exceeded')
  const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (p: number) => view.getUint16(p, true), u32 = (p: number) => view.getUint32(p, true)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break }
  }
  if (end < 0) throw new Error('Invalid ZIP directory')
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16)
  if (u16(end + 4) || u16(end + 6) || count !== u16(end + 8) || count === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new Error('Multipart/ZIP64 archives are unsupported')
  if (count > limits.maxEntries) throw new Error('Archive entries limit exceeded')
  if (centralStart + centralSize !== end) throw new Error('Invalid ZIP directory size')
  const entries: { name: string; start: number; compressed: number; size: number; method: number; crc: number }[] = []
  const names = new Set<string>(), ranges: [number, number][] = []
  let cursor = centralStart, total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry')
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16), compressed = u32(cursor + 20), expanded = u32(cursor + 24)
    const nameLen = u16(cursor + 28), extraLen = u16(cursor + 30), commentLen = u16(cursor + 32), offset = u32(cursor + 42)
    if (cursor + 46 + nameLen + extraLen + commentLen > end) throw new Error('Invalid ZIP filename length')
    const name = safePath(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)))
    if (names.has(name.toLowerCase())) throw new Error(`Duplicate archive path: ${name}`)
    names.add(name.toLowerCase())
    const mode = (u32(cursor + 38) >>> 16) & 0xf000
    if (mode && mode !== 0x8000 && !(mode === 0x4000 && name.endsWith('/'))) throw new Error('ZIP symlink or special file type disallowed')
    if (flags & 0x2041 || ![0, 8].includes(method) || u16(cursor + 34)) throw new Error('Encrypted/unsupported ZIP entry')
    if (expanded > limits.maxFileBytes || (total += expanded) > limits.maxTotalBytes) throw new Error('Expanded archive bytes limit exceeded')
    if (offset + 30 > centralStart || u32(offset) !== 0x04034b50) throw new Error('Invalid local ZIP entry')
    const localNameLen = u16(offset + 26), localExtraLen = u16(offset + 28), start = offset + 30 + localNameLen + localExtraLen
    if (start > centralStart || start + compressed > centralStart) throw new Error('Invalid ZIP data bounds')
    const localName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameLen))
    if (localName !== name || u16(offset + 8) !== method || u16(offset + 6) !== flags) throw new Error('Local/central ZIP mismatch')
    if (!(flags & 8) && (u32(offset + 18) !== compressed || u32(offset + 22) !== expanded || u32(offset + 14) !== crc)) throw new Error('Local/central ZIP size mismatch')
    if (ranges.some(([a, b]) => offset < b && start + compressed > a)) throw new Error('Overlapping ZIP entries')
    ranges.push([offset, start + compressed])
    entries.push({ name, start, compressed, size: expanded, method, crc })
    cursor += 46 + nameLen + extraLen + commentLen
  }
  if (cursor !== end) throw new Error('Invalid ZIP directory bounds')
  const result: SafeFiles = Object.create(null)
  for (const entry of entries) {
    let output: Uint8Array
    if (entry.method === 0) output = bytes.slice(entry.start, entry.start + entry.compressed)
    else {
      const chunks: Uint8Array[] = []; let length = 0
      const inflater = new Inflate((chunk) => {
        length += chunk.length
        if (length > entry.size || length > limits.maxFileBytes) throw new Error('Expanded ZIP size exceeds declared bytes')
        chunks.push(chunk)
      })
      // Limit each inflater push so a false size in the directory cannot allocate a bomb in one call.
      for (let at = 0; at < entry.compressed; at += 1024) inflater.push(bytes.subarray(entry.start + at, entry.start + Math.min(at + 1024, entry.compressed)), at + 1024 >= entry.compressed)
      output = new Uint8Array(length); let at = 0
      for (const chunk of chunks) { output.set(chunk, at); at += chunk.length }
    }
    if (output.length !== entry.size || crc32(output) !== entry.crc) throw new Error('ZIP content size/CRC mismatch')
    if (new TextDecoder().decode(output.subarray(0, 128)).trimStart().startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error(`Git LFS pointer is not media: ${entry.name}`)
    if (!entry.name.endsWith('/')) result[entry.name] = output
  }
  return result
}

/** Whitelist inert data and sniff media. User SVG, HTML, scripts and Live2D binaries never enter the asset map. */
export function safeAsset(path: string, bytes: Uint8Array): Blob | string {
  safePath(path)
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'svg') throw new Error('User supplied SVG is disallowed')
  if (['yml', 'yaml', 'txt', 'md', 'json'].includes(ext ?? '')) return textFile(bytes)
  const prefix = new TextDecoder().decode(bytes.subarray(0, 64))
  const magic = (...values: number[]) => values.every((value, i) => bytes[i] === value)
  let mime = ''
  if (ext === 'png' && magic(137, 80, 78, 71, 13, 10, 26, 10) && bytes.length >= 24) mime = 'image/png'
  if (['jpg', 'jpeg'].includes(ext ?? '') && magic(255, 216, 255)) mime = 'image/jpeg'
  if (ext === 'gif' && /^GIF8[79]a/.test(prefix)) mime = 'image/gif'
  if (ext === 'webp' && prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') mime = 'image/webp'
  if (ext === 'bmp' && prefix.startsWith('BM') && bytes.length >= 26) mime = 'image/bmp'
  if (ext === 'wav' && prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WAVE') mime = 'audio/wav'
  if (ext === 'ogg' && prefix.startsWith('OggS')) mime = 'audio/ogg'
  if (ext === 'mp3' && (prefix.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224))) mime = 'audio/mpeg'
  if (ext === 'flac' && prefix.startsWith('fLaC')) mime = 'audio/flac'
  if (!mime) throw new Error(`Unsupported executable or invalid media content: ${path}`)
  return new Blob([bytes.slice().buffer], { type: mime })
}
