// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from LingChat 0.5.2 script_engine, revision 848fd3448c20ca32e0436a498d20e85f63393e7f.
import { parseDialogue } from '../dialogue/protocol'
import { safeKey, safePath, validateJson } from '../characters/archive'
import { evaluateCondition, parseVariableAction, variableValue } from './conditions'
import type { ScriptEvent, StoryEngineOptions, StoryEffect, StoryPack, StoryRole, StoryState, StoryStep, StoryWait } from './types'

const chapterKey = (name: string) => { safePath(name); return name.endsWith('.yaml') ? name : `${name}.yaml` }
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const optionsOf = (event: ScriptEvent) => Array.isArray(event.options) ? event.options as Record<string, unknown>[] : []
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const duration = (event: ScriptEvent) => typeof event.duration === 'number' ? Math.max(0, Math.min(3600, event.duration)) : undefined

export class StoryEngine {
  private state: StoryState
  constructor(private pack: StoryPack, private options: StoryEngineOptions = {}, saved?: StoryState) {
    if (saved) {
      validateJson(saved)
      const chapter = pack.chapters[saved.chapter]
      if (saved.version !== 1 || saved.storyId !== pack.id || !chapter || !Number.isSafeInteger(saved.index)
        || saved.index < 0 || saved.index > chapter.events.length || !saved.roles || !saved.variables
        || !Array.isArray(saved.history) || saved.history.length > 500 || !Number.isSafeInteger(saved.randomSeed)
        || !Number.isSafeInteger(saved.steps) || saved.steps < 0 || saved.steps > 100000) throw new Error('Invalid story save')
      if (saved.waiting && !['advance', 'choice', 'input', 'ai'].includes(saved.waiting.kind)) throw new Error('Invalid story save waiting state')
      this.state = clone(saved)
    } else {
      const roles: Record<string, StoryRole> = Object.create(null)
      roles.MAIN = { name: options.mainCharacter?.settings.ai_name ?? 'MAIN', visible: true, perceive: true, emotion: '正常', clothes: 'default' }
      for (const [key, character] of Object.entries(pack.characters)) {
        safeKey(key)
        roles[key] = { name: character.settings.ai_name, visible: false, perceive: true, emotion: '正常', clothes: 'default' }
      }
      this.state = { version: 1, storyId: pack.id, chapter: chapterKey(pack.config.intro_chapter), index: 0,
        playerName: options.playerName ?? 'Player', variables: Object.create(null), roles, currentRole: 'MAIN', waiting: null, ended: false,
        background: '', music: '', ambient: '', picture: '', backgroundEffect: '', achievements: Object.create(null), history: [],
        randomSeed: (options.randomSeed ?? 0x6d2b79f5) >>> 0, steps: 0 }
    }
  }
  snapshot(): StoryState { return clone(this.state) }
  private result(effects: StoryEffect[]): StoryStep {
    this.state.history.push(...effects)
    if (this.state.history.length > 500) this.state.history.splice(0, this.state.history.length - 500)
    const snapshot = this.snapshot()
    this.options.onSave?.(snapshot)
    return { effects, waiting: clone(this.state.waiting), ended: this.state.ended, state: snapshot }
  }
  private replace(value: string): string {
    return value.replace(/%player%/g, () => this.state.playerName).replace(/%([\p{L}\p{N}\p{M}_]+)%/gu, (match, key: string) => {
      const item = this.state.variables[key]
      return Object.hasOwn(this.state.variables, key) ? typeof item === 'string' ? item : JSON.stringify(item) : match
    })
  }
  private role(key: string): StoryRole {
    safeKey(key)
    const role = Object.hasOwn(this.state.roles, key) ? this.state.roles[key] : undefined
    if (!role) throw new Error(`Unknown story role: ${key}`)
    return role
  }
  private effect(type: string, event: ScriptEvent, extras: Partial<StoryEffect> = {}): StoryEffect {
    return { type, data: clone(event), ...extras }
  }
  private dialogue(event: ScriptEvent, content: string, key = text(event.character, 'MAIN')): StoryEffect {
    const role = this.role(key)
    const segments = parseDialogue(this.replace(content), { enableTranslate: true })
    role.emotion = segments.at(-1)?.emotion ?? text(event.emotion, role.emotion)
    this.state.currentRole = key
    return this.effect('dialogue', event, { character: key, displayName: text(event.displayName, role.name),
      displaySubtitle: text(event.displaySubtitle), emotion: role.emotion, text: segments.map(segment => segment.text).join('\n'), segments })
  }
  private random(min: number, max: number): number {
    let seed = this.state.randomSeed || 0x6d2b79f5
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    this.state.randomSeed = seed >>> 0
    return min + Math.floor((this.state.randomSeed / 0x100000000) * (max - min + 1))
  }
  private actions(option: Record<string, unknown>): StoryEffect[] {
    const effects: StoryEffect[] = []
    const actions = Array.isArray(option.actions) ? option.actions as Record<string, unknown>[] : []
    for (const action of actions) {
      if (action.type === 'set_var') {
        const parsed = parseVariableAction(text(action.content))
        const value = variableValue(this.replace(parsed.value), (min, max) => this.random(min, max))
        if (parsed.operation === '=') this.state.variables[parsed.name] = value
        else {
          const previous = this.state.variables[parsed.name] ?? 0
          if (typeof previous !== 'number' || typeof value !== 'number') throw new Error('Variable arithmetic requires numbers')
          const next = parsed.operation === '+=' ? previous + value : previous - value
          if (!Number.isFinite(next)) throw new Error('Variable arithmetic overflow')
          this.state.variables[parsed.name] = next
        }
      } else if (action.type === 'add_line') effects.push(this.effect('player', { type: 'player' }, { text: this.replace(text(action.content)), displayName: this.state.playerName }))
      else throw new Error(`Unknown nested action: ${text(action.type)}`)
    }
    return effects
  }
  private move(next: string): void {
    if (next === 'end' || !next) { this.state.ended = true; this.state.waiting = null; return }
    const key = chapterKey(next)
    if (!Object.hasOwn(this.pack.chapters, key)) throw new Error(`Missing chapter: ${next}`)
    this.state.chapter = key; this.state.index = 0; this.state.waiting = { kind: 'advance' }
  }
  private mediaPath(event: ScriptEvent, field: string, folder: string): string {
    const path = text(event[field])
    if (!path || event.stop === true) return ''
    safePath(path)
    const candidates = [path, `Assets/${folder}/${path}`]
    const match = candidates.find(candidate => Object.hasOwn(this.pack.assets, candidate))
    if (!match) throw new Error(`Missing story media: ${path}`)
    return match
  }
  advance(): StoryStep {
    if (this.state.ended) return this.result([])
    if (this.state.waiting && this.state.waiting.kind !== 'advance') throw new Error('Story is waiting for input or AI')
    this.state.waiting = null
    const chapter = this.pack.chapters[this.state.chapter]
    while (this.state.index < chapter.events.length) {
      if (++this.state.steps > 100000) throw new Error('Story execution limit exceeded')
      const event = chapter.events[this.state.index++]
      if (typeof event.condition === 'string' && !evaluateCondition(event.condition, this.state.variables)) continue
      let effects: StoryEffect[] = []
      this.state.waiting = { kind: 'advance', ...(duration(event) === undefined ? {} : { duration: duration(event) }) }
      switch (event.type) {
        case 'narration': case 'player': effects = [this.effect(event.type, event, { text: this.replace(text(event.text)), displayName: event.type === 'player' ? this.state.playerName : '' })]; break
        case 'dialogue': effects = [this.dialogue(event, text(event.text))]; break
        case 'input': this.state.waiting = { kind: 'input', hint: this.replace(text(event.hint)), event: clone(event) }; break
        case 'choices': {
          const options = optionsOf(event).map((option, index) => {
            const disabled = typeof option.condition === 'string' && !evaluateCondition(option.condition, this.state.variables)
            return { index, text: this.replace(text(option.text)), disabled, ...(disabled ? { reason: text(option.lock_hint, 'This choice is locked') } : {}) }
          })
          this.state.waiting = { kind: 'choice', options, allowFree: event.allow_free === true, event: clone(event) }; break
        }
        case 'ai_dialogue': this.role(text(event.character, 'MAIN')); this.state.waiting = { kind: 'ai', mode: 'dialogue', character: text(event.character, 'MAIN'), prompt: this.replace(text(event.prompt)), event: clone(event) }; break
        case 'free_dialogue': this.role(text(event.character, 'MAIN')); this.state.waiting = { kind: 'input', hint: this.replace(text(event.hint)), event: clone(event), free: { rounds: 0 } }; break
        case 'set_variable': {
          for (const option of optionsOf(event)) if (typeof option.condition !== 'string' || evaluateCondition(option.condition, this.state.variables)) effects.push(...this.actions(option))
          effects.unshift(this.effect('set_variable', event)); break
        }
        case 'modify_character': {
          const key = text(event.character, 'MAIN'), role = this.role(key)
          if (event.action === 'show_character') role.visible = true
          else if (event.action === 'hide_character') role.visible = false
          if (event.perceive !== undefined) role.perceive = event.perceive !== false && event.perceive !== 'false'
          if (event.clothes !== undefined) role.clothes = text(event.clothes)
          if (event.emotion !== undefined) role.emotion = text(event.emotion)
          this.state.currentRole = key; effects.push(this.effect(event.type, event, { character: key, emotion: role.emotion })); break
        }
        case 'background': this.state.background = this.mediaPath(event, 'imagePath', 'Backgrounds'); effects.push(this.effect('background', event, { asset: this.state.background })); break
        case 'music': this.state.music = this.mediaPath(event, 'musicPath', 'Music'); effects.push(this.effect(this.state.music ? 'music' : 'stop_music', event, { asset: this.state.music })); break
        case 'ambient': this.state.ambient = this.mediaPath(event, 'ambientPath', 'Ambient'); effects.push(this.effect(this.state.ambient ? 'ambient' : 'stop_ambient', event, { asset: this.state.ambient })); break
        case 'sound': effects.push(this.effect('sound', event, { asset: this.mediaPath(event, 'soundPath', 'Sounds') })); break
        case 'present_pic': this.state.picture = this.mediaPath(event, 'imagePath', 'Pictures'); effects.push(this.effect('picture', event, { asset: this.state.picture })); break
        case 'background_effect': this.state.backgroundEffect = text(event.effect); effects.push(this.effect(event.type, event)); break
        case 'unlock_achievement': {
          const id = safeKey(text(event.achievement_id))
          if (!Object.hasOwn(this.state.achievements, id)) { this.state.achievements[id] = { title: text(event.title, id), description: text(event.description) }; effects.push(this.effect(event.type, event)) }
          break
        }
        case 'chapter_end': {
          if (event.end_type === 'ai_judged') {
            this.state.waiting = { kind: 'ai', mode: 'judge', character: 'MAIN', prompt: this.replace(text(event.prompt, `Select one route by name: ${optionsOf(event).map(option => text(option.name)).join(', ')}`)), event: clone(event) }
          } else if (event.end_type === 'branching') {
            const routes = optionsOf(event)
            const route = routes.find(option => typeof option.condition === 'string' && evaluateCondition(option.condition, this.state.variables)) ?? routes.find(option => option.default === true)
            if (!route) throw new Error('No matching story chapter route')
            this.move(text(route.next, 'end'))
          } else this.move(text(event.next_chapter, text(event.next, 'end')))
          effects.push(this.effect('chapter_end', event)); break
        }
        default: throw new Error(`Unknown story action: ${event.type}`)
      }
      return this.result(effects)
    }
    this.state.ended = true; this.state.waiting = null
    return this.result([])
  }
  select(index: number | string): StoryStep {
    const waiting = this.state.waiting
    if (waiting?.kind !== 'choice') throw new Error('Story is not waiting for a choice')
    if (typeof index === 'string') {
      const selected = waiting.options.find(option => option.text === index)
      if (!selected) return this.input(index)
      index = selected.index
    }
    const choice = waiting.options[index]
    if (!choice || choice.disabled) throw new Error('Choice is locked or disabled')
    const option = optionsOf(waiting.event)[index]
    this.state.waiting = { kind: 'advance' }
    const effects = this.actions(option)
    if (!effects.length) effects.push(this.effect('player', { type: 'player' }, { text: choice.text, displayName: this.state.playerName }))
    if (typeof option.next === 'string') this.move(option.next)
    return this.result(effects)
  }
  input(value: string): StoryStep {
    if (!value.trim() || value.length > 10000) throw new Error('Invalid story input')
    const waiting = this.state.waiting
    if (waiting?.kind === 'choice') {
      if (!waiting.allowFree) throw new Error('Free choice input is disabled')
      this.state.waiting = { kind: 'advance' }
    } else if (waiting?.kind === 'input') {
      this.state.variables.player_input = value
      if (waiting.free) {
        const rounds = waiting.free.rounds + 1
        const limit = typeof waiting.event.max_rounds === 'number' ? Math.max(1, waiting.event.max_rounds) : Infinity
        const lastRound = rounds >= limit || (typeof waiting.event.end_line === 'string' && value.includes(waiting.event.end_line))
        this.state.waiting = { kind: 'ai', mode: 'free_dialogue', character: text(waiting.event.character, 'MAIN'),
          prompt: this.replace(text(lastRound ? waiting.event.end_prompt : waiting.event.prompt)), event: waiting.event, userInput: value, rounds, lastRound }
      } else this.state.waiting = { kind: 'advance' }
    } else throw new Error('Story is not waiting for input')
    return this.result([this.effect('player', { type: 'player' }, { text: value, displayName: this.state.playerName })])
  }
  resolveAI(value: string): StoryStep {
    const waiting = this.state.waiting
    if (waiting?.kind !== 'ai') throw new Error('Story is not waiting for AI')
    if (value.length > 100000) throw new Error('AI story response limit exceeded')
    if (waiting.mode === 'judge') {
      const name = value.trim().toLocaleLowerCase()
      const route = optionsOf(waiting.event).find(option => text(option.name).toLocaleLowerCase() === name)
      if (!route) throw new Error('AI returned an unknown chapter route')
      this.move(text(route.next, 'end'))
      return this.result([this.effect('chapter_end', waiting.event)])
    }
    const effect = this.dialogue(waiting.event, value, waiting.character)
    this.state.waiting = waiting.mode === 'free_dialogue' && !waiting.lastRound
      ? { kind: 'input', hint: this.replace(text(waiting.event.hint)), event: waiting.event, free: { rounds: waiting.rounds ?? 0 } }
      : { kind: 'advance' }
    return this.result([effect])
  }
}
