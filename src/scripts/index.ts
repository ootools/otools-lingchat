// SPDX-License-Identifier: AGPL-3.0-only
// Derived from LingChat contributors' script_engine (0.5.2), revision 848fd3448c20ca32e0436a498d20e85f63393e7f.
import { characterFromFiles } from '../characters'
import { parseSafeYaml, readSafeZip, safeAsset, safeKey, safePath, textFile, validateJson, type ZipInput } from '../characters/archive'
import { parseVariableAction, validateCondition } from './conditions'
import type { ScriptEvent, StoryConfig, StoryPack } from './types'
export * from './types'
export { StoryEngine } from './engine'
export { evaluateCondition } from './conditions'
export const STORY_EVENT_TYPES = ['narration','dialogue','player','input','choices','free_dialogue','ai_dialogue','background','music','sound','ambient','present_pic','background_effect','modify_character','set_variable','unlock_achievement','chapter_end'] as const
export function chapterKey(name: string): string { safePath(name); return name.endsWith('.yaml') ? name : `${name}.yaml` }
export function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${context} mapping`)
  return value as Record<string, unknown>
}
export function optionsOf(event: Record<string, unknown>): Record<string, unknown>[] {
  if (event.options === undefined) return []
  if (!Array.isArray(event.options)) throw new Error('options must be an array')
  return event.options.map(v => object(v, 'option'))
}
export function validateEvent(event: ScriptEvent): void {
  if (!STORY_EVENT_TYPES.includes(event.type as typeof STORY_EVENT_TYPES[number])) throw new Error(`Unknown story action: ${event.type}`)
  for (const key of ['condition','text','prompt','hint','end_line','end_prompt','character','displayName','displaySubtitle','emotion','imagePath','musicPath','soundPath','ambientPath','effect','action','clothes','achievement_id','title','description','end_type','next','next_chapter']) if (event[key] !== undefined && typeof event[key] !== 'string') throw new Error(`Invalid ${event.type}.${key}`)
  if (typeof event.condition === 'string') validateCondition(event.condition)
  for (const key of ['duration','transition','scale','volume','playbackSpeed','max_rounds']) if (event[key] !== undefined && (typeof event[key] !== 'number' || !Number.isFinite(event[key]))) throw new Error(`Invalid ${event.type}.${key}`)
  for (const key of ['allow_free','loop','stop','fade']) if (event[key] !== undefined && typeof event[key] !== 'boolean') throw new Error(`Invalid ${event.type}.${key}`)
  for (const key of ['imagePath','musicPath','soundPath','ambientPath']) if (event[key]) safePath(event[key] as string)
  if (event.character) safeKey(event.character as string)
  if (event.type === 'modify_character' && event.action && !['show_character','hide_character'].includes(event.action as string)) throw new Error(`Unknown character action: ${event.action}`)
  if (event.type === 'chapter_end' && event.end_type && !['linear','branching','ai_judged'].includes(event.end_type as string)) throw new Error(`Unknown chapter end_type: ${event.end_type}`)
  for (const opt of optionsOf(event)) {
    if (opt.condition !== undefined) { if (typeof opt.condition !== 'string') throw new Error('Invalid option condition'); validateCondition(opt.condition) }
    for (const key of ['text','lock_hint','next','name']) if (opt[key] !== undefined && typeof opt[key] !== 'string') throw new Error(`Invalid option ${key}`)
    if (opt.actions !== undefined) {
      if (!Array.isArray(opt.actions)) throw new Error('actions must be an array')
      for (const raw of opt.actions) {
        const action = object(raw, 'action')
        if (!['set_var', ...(event.type === 'choices' ? ['add_line'] : [])].includes(action.type as string)) throw new Error(`Unknown nested action: ${action.type}`)
        if (typeof action.content !== 'string') throw new Error('Action content must be text')
        if (action.type === 'set_var') parseVariableAction(action.content)
      }
    }
  }
}
export function parseStory(configYaml: string, chapterYamls: Record<string, string>): StoryPack {
  const raw = parseSafeYaml(configYaml)
  if (typeof raw.script_name !== 'string' || !raw.script_name.trim()) throw new Error('story_config.yaml requires script_name')
  if (raw.intro_chapter !== undefined && typeof raw.intro_chapter !== 'string') throw new Error('Invalid intro_chapter')
  const config = { ...raw, intro_chapter: raw.intro_chapter ?? 'main' } as StoryConfig
  const chapters: StoryPack['chapters'] = Object.create(null)
  let eventCount = 0
  for (const [name, yaml] of Object.entries(chapterYamls)) {
    const key = chapterKey(name), value = parseSafeYaml(yaml)
    if (Object.hasOwn(chapters, key)) throw new Error(`Duplicate chapter: ${key}`)
    if (!Array.isArray(value.events)) throw new Error(`Chapter ${name} requires top-level events array`)
    const events = value.events.map(raw => { const event = object(raw, 'event') as ScriptEvent; validateEvent(event); return event })
    if ((eventCount += events.length) > 10000) throw new Error('Story event limit exceeded')
    if (value.name !== undefined && typeof value.name !== 'string') throw new Error('Invalid chapter name')
    chapters[key] = { name: value.name as string ?? name, events }
  }
  const reference = (next: unknown) => { if (next === undefined || next === 'end') return; if (typeof next !== 'string' || !chapters[chapterKey(next)]) throw new Error(`Missing chapter: ${next}`) }
  reference(config.intro_chapter)
  for (const chapter of Object.values(chapters)) for (const event of chapter.events) if (event.type === 'chapter_end') {
    reference(event.next); reference(event.next_chapter); for (const opt of optionsOf(event)) reference(opt.next)
  }
  return { id: config.script_name, config, chapters, characters: Object.create(null), assets: Object.create(null), warnings: [] }
}
export async function importStoryZip(input: ZipInput): Promise<StoryPack> {
  const files = await readSafeZip(input)
  const configs = Object.keys(files).filter(p => p === 'story_config.yaml' || p.endsWith('/story_config.yaml'))
  if (configs.length !== 1) throw new Error('Story ZIP requires exactly one story_config.yaml')
  const prefix = configs[0].slice(0, -'story_config.yaml'.length), chapterYamls: Record<string,string> = Object.create(null)
  for (const [path, bytes] of Object.entries(files)) {
    safeAsset(path, bytes)
    if (path.startsWith(`${prefix}Chapters/`) && path.endsWith('.yaml')) chapterYamls[path.slice(prefix.length + 9)] = textFile(bytes)
  }
  const pack = parseStory(textFile(files[configs[0]]), chapterYamls)
  for (const [path, bytes] of Object.entries(files)) if (path.startsWith(prefix)) pack.assets[path.slice(prefix.length)] = safeAsset(path, bytes)
  for (const path of Object.keys(files)) if (path.startsWith(`${prefix}characters/`) && /^characters\/[^/]+\/settings\.yml$/.test(path.slice(prefix.length))) {
    const root = path.slice(0, -'settings.yml'.length), name = root.slice(prefix.length).split('/')[1]
    const character = characterFromFiles(files, root, name), role = character.settings.script_role_key
    if (!role || typeof role !== 'string') throw new Error(`Story character ${name} requires script_role_key`)
    safeKey(role)
    if (role === 'MAIN' || Object.hasOwn(pack.characters, role)) throw new Error(`Duplicate/reserved script role: ${role}`)
    pack.characters[role] = character
  }
  validateJson(pack.config)
  return pack
}
