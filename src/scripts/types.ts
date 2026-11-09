// SPDX-License-Identifier: AGPL-3.0-only
// LingChat 0.5.2-compatible story domain; derived from LingChat contributors' script_engine.
import type { CharacterPack } from '../characters'
import type { DialogueSegment } from '../dialogue/protocol'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ScriptEvent = { type: string; [key: string]: unknown }
export interface StoryChapter { name: string; events: ScriptEvent[] }
export interface StoryConfig { script_name: string; intro_chapter: string; description?: string; [key: string]: unknown }
export interface StoryPack { id: string; config: StoryConfig; chapters: Record<string, StoryChapter>; characters: Record<string, CharacterPack>; assets: Record<string, Blob | string>; warnings: string[] }
export interface StoryRole { name: string; visible: boolean; perceive: boolean; emotion: string; clothes: string }
export interface StoryChoice { index: number; text: string; disabled: boolean; reason?: string }
export interface StoryEffect {
  type: string; text?: string; character?: string; displayName?: string; displaySubtitle?: string; emotion?: string
  segments?: DialogueSegment[]; asset?: string; duration?: number; data: Record<string, unknown>
}
export type StoryWait =
  | { kind: 'advance'; duration?: number }
  | { kind: 'choice'; options: StoryChoice[]; allowFree: boolean; event: ScriptEvent }
  | { kind: 'input'; hint: string; event: ScriptEvent; free?: { rounds: number } }
  | { kind: 'ai'; mode: 'dialogue' | 'free_dialogue' | 'judge'; character: string; prompt: string; event: ScriptEvent; userInput?: string; rounds?: number; lastRound?: boolean }
export interface StoryState {
  version: 1; storyId: string; chapter: string; index: number; playerName: string; variables: Record<string, JsonValue>
  roles: Record<string, StoryRole>; currentRole: string; waiting: StoryWait | null; ended: boolean
  background: string; music: string; ambient: string; picture: string; backgroundEffect: string
  achievements: Record<string, { title: string; description: string }>; history: StoryEffect[]; randomSeed: number; steps: number
}
export interface StoryStep { effects: StoryEffect[]; waiting: StoryWait | null; ended: boolean; state: StoryState }
export interface StoryEngineOptions { playerName?: string; mainCharacter?: CharacterPack; randomSeed?: number; onSave?: (state: StoryState) => void }
