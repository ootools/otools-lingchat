// SPDX-License-Identifier: AGPL-3.0-only
// Derived from LingChat contributors' script_engine/events/mod.rs and utils/script_function.rs (0.5.2).
import { safeKey } from '../characters/archive'
import type { JsonValue } from './types'
const identifier = /^[\p{L}\p{N}\p{M}_]+$/u
export function validateCondition(condition: string): void {
  if (!condition.trim()) return
  const pieces = condition.split(/(!=|==)/)
  if (!identifier.test(pieces[0].trim()) || ![1, 3].includes(pieces.length) || (pieces.length === 3 && !pieces[2].trim())) throw new Error(`Unsupported condition: ${condition}; use a variable, ==, or !=`)
  safeKey(pieces[0].trim())
}
export function evaluateCondition(condition: string, variables: Record<string, JsonValue>): boolean {
  validateCondition(condition); condition = condition.trim()
  if (!condition) return true
  const match = /^(.*?)\s*(!=|==)\s*(.*)$/.exec(condition)
  if (match) {
    const exists = Object.hasOwn(variables, match[1].trim()), value = variables[match[1].trim()]
    const expected = match[3].trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '')
    const equal = exists && (typeof value === 'string' ? value : JSON.stringify(value)) === expected
    return match[2] === '!=' ? !equal : equal
  }
  return Object.hasOwn(variables, condition) && variables[condition] !== null && variables[condition] !== false
}
export function parseVariableAction(content: string): { name: string; operation: string; value: string } {
  const match = /^\s*([\p{L}\p{N}\p{M}_]+)\s*(=|\+=|-=)\s*(.+?)\s*$/u.exec(content)
  if (!match) throw new Error(`Invalid variable action: ${content}`)
  return { name: safeKey(match[1]), operation: match[2], value: match[3] }
}
export function variableValue(source: string, random: (min: number, max: number) => number): JsonValue {
  const s = source.trim(), rand = /^random\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(s)
  if (rand) {
    const min = Number(rand[1]), max = Number(rand[2])
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min > 0xffffffff) throw new Error('Invalid random range')
    return random(min, max)
  }
  if (/^random\(/.test(s)) throw new Error('Invalid random expression')
  if (/^true$/i.test(s)) return true
  if (/^false$/i.test(s)) return false
  if (/^(null|none)$/i.test(s)) return null
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s) && Number.isFinite(Number(s))) return Number(s)
  return /^(["']).*\1$/s.test(s) ? s.slice(1, -1) : s
}
