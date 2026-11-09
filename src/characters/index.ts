// SPDX-License-Identifier: AGPL-3.0-only
// Derived from LingChat 0.5.2 (LingChat contributors), src-tauri/src/ai_service/types.rs
// and src-tauri/src/api/character.rs, revision 848fd3448c20ca32e0436a498d20e85f63393e7f.
import { parseSafeYaml, readSafeZip, safeAsset, safeKey, safePath, textFile, type SafeFiles, type ZipInput } from './archive'

export interface BodyPart { X: number[]; Y: number[]; clothesName?: string; message?: string; windowWidth?: number; windowHeight?: number }
export interface ClothesSettings { name: string; prompt?: string; [key: string]: string | undefined }
export interface CharacterSettings {
  ai_name: string; ai_subtitle?: string | null; user_name: string; user_subtitle?: string | null
  title?: string | null; info?: string | null; body_part?: Record<string, BodyPart> | null
  clothes?: ClothesSettings[] | null; clothes_name?: string | null
  scale: number; offset_x: number; offset_y: number; scale_p: number; offset_x_p: number; offset_y_p: number
  bubble_top: number; bubble_left: number; thinking_message: string
  system_prompt?: string | null; system_prompt_example?: string | null; system_prompt_example_old?: string | null
  voice_models?: Record<string, unknown> | null; tts_type?: string | null; voice_lang?: string | null; voice_dialect?: string | null
  character_folder?: string; script_role_key?: string | null; script_key?: string | null; live2d?: unknown
  [key: string]: unknown
}
export interface CharacterOutfit { name: string; prompt?: string; emotions: Record<string, string> }
export interface CharacterPack {
  id: string; settings: CharacterSettings; assets: Record<string, Blob | string>; avatar?: string
  emotions: Record<string, string>; outfits: CharacterOutfit[]; warnings: string[]
}
export function parseCharacterSettings(yaml: string): CharacterSettings {
  const raw = parseSafeYaml(yaml)
  const settings = { ai_name: 'ai_name未设定', user_name: 'user_name未设定', scale: 1, scale_p: 1, offset_x: 0, offset_y: 0, offset_x_p: 0, offset_y_p: 0, bubble_top: 5, bubble_left: 20, thinking_message: '正在思考中...', ...raw } as CharacterSettings
  for (const field of ['ai_name', 'user_name', 'thinking_message']) if (typeof settings[field] !== 'string') throw new Error(`Invalid character ${field}`)
  for (const field of ['ai_subtitle','user_subtitle','title','info','clothes_name','system_prompt','system_prompt_example','system_prompt_example_old','tts_type','voice_lang','voice_dialect','script_role_key','script_key']) {
    if (settings[field] != null && typeof settings[field] !== 'string') throw new Error(`Invalid character ${field}`)
  }
  for (const field of ['scale','scale_p','offset_x','offset_y','offset_x_p','offset_y_p','bubble_top','bubble_left']) if (typeof settings[field] !== 'number' || !Number.isFinite(settings[field])) throw new Error(`Invalid character ${field}`)
  if (settings.scale <= 0 || settings.scale_p <= 0 || settings.scale > 20 || settings.scale_p > 20) throw new Error('Character scale out of bounds')
  if (settings.clothes != null) {
    if (!Array.isArray(settings.clothes)) throw new Error('clothes must be a list of {name, prompt} objects')
    const names = new Set<string>()
    for (const item of settings.clothes) {
      if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name || Object.values(item).some(v => typeof v !== 'string')) throw new Error('Invalid clothes object')
      safePath(item.name)
      if (item.name.includes('/') || names.has(item.name)) throw new Error('Invalid or duplicate clothes name')
      names.add(item.name)
    }
  }
  if (settings.body_part != null) {
    if (typeof settings.body_part !== 'object' || Array.isArray(settings.body_part)) throw new Error('Invalid body_part mapping')
    for (const [name, part] of Object.entries(settings.body_part)) {
      safeKey(name)
      if (!part || !Array.isArray(part.X) || !Array.isArray(part.Y) || part.X.length < 3 || part.X.length > 1024 || part.X.length !== part.Y.length || [...part.X, ...part.Y].some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) throw new Error(`Invalid XY polygon: ${name}`)
      for (const k of ['message', 'clothesName'] as const) if (part[k] != null && typeof part[k] !== 'string') throw new Error(`Invalid polygon ${k}`)
      for (const k of ['windowWidth', 'windowHeight'] as const) if (part[k] != null && (typeof part[k] !== 'number' || !Number.isFinite(part[k]) || part[k]! <= 0)) throw new Error(`Invalid polygon ${k}`)
    }
  }
  return settings
}
export function characterFromFiles(files: SafeFiles, prefix = '', id = 'character'): CharacterPack {
  const settingsBytes = files[`${prefix}settings.yml`]
  if (!settingsBytes) throw new Error('Character ZIP requires settings.yml')
  const settings = parseCharacterSettings(textFile(settingsBytes))
  const assets: CharacterPack['assets'] = Object.create(null), emotions: Record<string, string> = Object.create(null)
  const outfits: CharacterOutfit[] = (settings.clothes ?? []).map(c => ({ name: c.name, prompt: c.prompt, emotions: Object.create(null) }))
  if (!outfits.some(o => o.name === 'default')) outfits.unshift({ name: 'default', emotions: Object.create(null) })
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    assets[relative] = safeAsset(relative, bytes)
    if (!(assets[relative] instanceof Blob) || !(assets[relative] as Blob).type.startsWith('image/')) continue
    const match = /^avatar\/(?:([^/]+)\/)?([^/]+)\.[^.]+$/.exec(relative)
    if (!match) continue
    const outfitName = match[1] || 'default', emotion = safeKey(match[2])
    let outfit = outfits.find(o => o.name === outfitName)
    if (!outfit) { outfit = { name: outfitName, emotions: Object.create(null) }; outfits.push(outfit) }
    if (!outfit.emotions[emotion]) outfit.emotions[emotion] = relative
    if (outfitName === 'default' && !emotions[emotion]) emotions[emotion] = relative
  }
  const warnings: string[] = []
  if (settings.live2d) warnings.push('Live2D metadata retained as data only; proprietary runtime/models are not supported.')
  if (!Object.keys(emotions).length) warnings.push('No default avatar images found; use the original application avatar.')
  const avatar = emotions['正常'] ?? emotions['平静'] ?? Object.values(emotions)[0]
  return { id, settings, assets, avatar, emotions, outfits, warnings }
}
export async function importCharacterZip(input: ZipInput): Promise<CharacterPack> {
  const files = await readSafeZip(input)
  const settings = Object.keys(files).filter(p => p === 'settings.yml' || p.endsWith('/settings.yml'))
  if (settings.length !== 1) throw new Error('Character ZIP must contain exactly one settings.yml')
  // Validate even entries outside the character root; they cannot hide executable content.
  for (const [path, bytes] of Object.entries(files)) safeAsset(path, bytes)
  const prefix = settings[0].slice(0, -'settings.yml'.length)
  return characterFromFiles(files, prefix, prefix.replace(/\/$/, '').split('/').pop() || 'character')
}
export function resolveCharacterImage(pack: CharacterPack, emotion: string, clothes = 'default'): string | undefined {
  const images = clothes && clothes !== 'default' ? pack.outfits.find(o => o.name === clothes)?.emotions : pack.emotions
  return images?.[emotion] ?? (emotion === '平静' ? images?.['正常'] : undefined)
}
export { type ZipInput } from './archive'
