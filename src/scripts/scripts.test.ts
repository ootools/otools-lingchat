import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { parseStory, importStoryZip, StoryEngine, evaluateCondition } from './index'
import { parseCharacterSettings, type CharacterPack } from '../characters'
const main: CharacterPack = { id:'pet', settings:parseCharacterSettings('ai_name: Pet'), assets:{}, emotions:{}, outfits:[], warnings:[] }
const story = (events: string, other: Record<string,string> = {}) => parseStory('script_name: Test\nintro_chapter: Intro/main.yaml', { 'Intro/main.yaml': `name: Main\nevents:\n${events}`, ...other })
describe('story loading and safe conditions', () => {
  it('imports real story layout, nested chapters and script_role_key characters', async () => {
    const result = await importStoryZip(zipSync({
      'Story/story_config.yaml': strToU8('script_name: Story\nintro_chapter: Intro/start'),
      'Story/Chapters/Intro/start.yaml': strToU8('name: Start\nevents:\n  - type: narration\n    text: Hello'),
      'Story/characters/Npc/settings.yml': strToU8('ai_name: NPC\nscript_role_key: npc'),
    }))
    expect(result.chapters['Intro/start.yaml'].name).toBe('Start')
    expect(result.characters.npc.settings.ai_name).toBe('NPC')
  })
  it('rejects unknown events, nested actions, conditions, and chapter references explicitly', () => {
    expect(() => story('  - type: run_js\n    text: nope')).toThrow(/Unknown.*run_js/)
    expect(() => story('  - type: choices\n    options:\n      - text: A\n        actions:\n          - type: exec')).toThrow(/Unknown.*exec/)
    expect(() => story('  - type: narration\n    condition: hp > 5')).toThrow(/condition/i)
    expect(() => story('  - type: chapter_end\n    next: missing')).toThrow(/chapter/i)
    expect(() => story('  - type: background\n    imagePath: https://evil.example/x.png')).toThrow(/path/i)
  })
  it('matches upstream string comparison and non-null non-bool truthiness without evaluation', () => {
    expect(evaluateCondition('zero', {zero:0})).toBe(true)
    expect(evaluateCondition('empty', {empty:''})).toBe(true)
    expect(evaluateCondition('absent != true', {})).toBe(true)
    expect(evaluateCondition('absent == false', {})).toBe(false)
    expect(evaluateCondition('flag == true', {flag:'true'})).toBe(true)
    expect(() => evaluateCondition('x || alert(1)', {})).toThrow(/condition/i)
  })
})
describe('deterministic story engine', () => {
  it('applies real nested choice actions, locks options and branches through serializable saves', () => {
    const pack = story(`  - type: set_variable\n    options:\n      - actions:\n          - type: set_var\n            content: count = 0\n  - type: choices\n    options:\n      - text: Locked\n        condition: enabled\n        lock_hint: Not yet\n      - text: Go\n        actions:\n          - type: set_var\n            content: count += 2\n          - type: add_line\n            content: '%player% chose to go'\n  - type: chapter_end\n    end_type: branching\n    options:\n      - condition: count == 2\n        next: next\n      - default: true\n        next: end`, {'next.yaml':'name: Next\nevents:\n  - type: narration\n    text: Success'})
    let engine = new StoryEngine(pack, {playerName:'Friend', mainCharacter:main})
    expect(engine.advance().effects[0].type).toBe('set_variable')
    let step = engine.advance()
    expect(step.waiting).toMatchObject({ kind:'choice', options:[{disabled:true, reason:'Not yet'}, {disabled:false}] })
    expect(() => engine.select(0)).toThrow(/locked|disabled/i)
    engine = new StoryEngine(pack, {}, JSON.parse(JSON.stringify(engine.snapshot())))
    step = engine.select(1)
    expect(step.state.variables.count).toBe(2)
    expect(step.effects[0].text).toBe('Friend chose to go')
    engine.advance(); step = engine.advance()
    expect(step.effects[0].text).toBe('Success')
    expect(engine.advance().ended).toBe(true)
  })
  it('keeps multi-role state, protocol segments, media keys, and achievements', () => {
    const pack = story(`  - type: modify_character\n    character: npc\n    action: show_character\n    perceive: 'false'\n    clothes: winter\n  - type: dialogue\n    character: npc\n    text: '【开心】你好，%player%！<hello>（挥手）'\n  - type: background\n    imagePath: room.png\n  - type: music\n    musicPath: ''\n  - type: sound\n    soundPath: ''\n  - type: ambient\n    stop: true\n  - type: present_pic\n    imagePath: ''\n  - type: background_effect\n    effect: Snow\n  - type: unlock_achievement\n    achievement_id: hello\n    title: Hello\n    description: Meet a friend\n  - type: player\n    text: Thanks`)
    pack.characters.npc = {...main, id:'npc', settings: {...main.settings, ai_name:'NPC',script_role_key:'npc'}}
    pack.assets['Assets/Backgrounds/room.png'] = new Blob([], {type:'image/png'})
    const engine = new StoryEngine(pack,{mainCharacter:main,playerName:'Friend'})
    let step = engine.advance(); expect(step.state.roles.npc).toMatchObject({visible:true,perceive:false,clothes:'winter'})
    step = engine.advance(); expect(step.effects[0]).toMatchObject({character:'npc',displayName:'NPC',segments:[{text:'你好，Friend！',action:'挥手'}]})
    expect(engine.advance().state.background).toBe('Assets/Backgrounds/room.png')
    for(let i=0;i<6;i++) step=engine.advance()
    expect(step.state.achievements.hello.title).toBe('Hello')
    expect(engine.advance().effects[0].type).toBe('player')
  })
  it('pauses for input, AI dialogue, free dialogue final prompt, and AI judged chapter ends', () => {
    const pack = story(`  - type: input\n    hint: Say hello\n  - type: ai_dialogue\n    prompt: Reply\n  - type: free_dialogue\n    max_rounds: 2\n    prompt: Continue\n    end_prompt: Goodbye\n    end_line: bye\n  - type: chapter_end\n    end_type: ai_judged\n    options:\n      - name: finish\n        next: end`)
    const engine = new StoryEngine(pack,{mainCharacter:main})
    expect(engine.advance().waiting?.kind).toBe('input')
    expect(engine.input('hello').effects[0].text).toBe('hello')
    expect(engine.advance().waiting).toMatchObject({kind:'ai',mode:'dialogue',prompt:'Reply'})
    expect(() => engine.advance()).toThrow(/waiting/i)
    expect(engine.resolveAI('【开心】Hi').effects[0].segments?.[0].text).toBe('Hi')
    expect(engine.advance().waiting?.kind).toBe('input')
    expect(engine.input('first').waiting).toMatchObject({kind:'ai',prompt:'Continue',lastRound:false})
    expect(engine.resolveAI('ok').waiting?.kind).toBe('input')
    expect(engine.input('second').waiting).toMatchObject({kind:'ai',prompt:'Goodbye',lastRound:true})
    expect(engine.resolveAI('bye').waiting?.kind).toBe('advance')
    expect(engine.advance().waiting).toMatchObject({kind:'ai',mode:'judge'})
    expect(engine.resolveAI('FINISH').ended).toBe(true)
  })
  it('allows free choice input fallback and seeded random save/resume without ambient randomness', () => {
    const pack = story(`  - type: choices\n    allow_free: true\n    options:\n      - text: Hi\n  - type: set_variable\n    options:\n      - actions:\n          - type: set_var\n            content: dice = random(1, 6)`)
    const a=new StoryEngine(pack),b=new StoryEngine(pack)
    a.advance(); b.advance()
    expect(a.input('Other').effects[0].text).toBe('Other'); b.input('Other')
    expect(a.advance().state.variables.dice).toBe(b.advance().state.variables.dice)
  })
  it('rejects damaged saves and wrong role references rather than silently continuing', () => {
    const pack=story('  - type: dialogue\n    character: missing\n    text: hi')
    expect(() => new StoryEngine(pack).advance()).toThrow(/role/i)
    const save=new StoryEngine(pack).snapshot(); save.index=999
    expect(() => new StoryEngine(pack,{},save)).toThrow(/save/i)
  })
})
