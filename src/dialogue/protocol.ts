// SPDX-License-Identifier: AGPL-3.0-only
// Derived from LingChat contributors, 0.5.2, src-tauri/src/ai_service/message_system/processor.rs
// Revision 848fd3448c20ca32e0436a498d20e85f63393e7f. See UPSTREAM.md and LICENSE.
export interface DialogueSegment { emotion: string; originalTag: string; text: string; ttsText: string; action: string }
/** Parse LingChat's 【emotion】text<TTS>（action） protocol. Render every field as text, never HTML. */
export function parseDialogue(text: string, options: { enableTranslate?: boolean } = {}): DialogueSegment[] {
  if (text.length > 1_000_000) throw new Error('Dialogue exceeds text limit')
  const prepared = text.replace(/\{[^{}]*\}/g, '').replace(/＜/g, '<').replace(/＞/g, '>').replace(/[《》]/g, '').replace(/<([^>\n]*)(>|(?=\n|$))/g, '<$1>')
  const segments: DialogueSegment[] = []
  for (const match of prepared.matchAll(/【([^】]*)】([^【】]*)/g)) {
    const following = match[2].replace(/\(/g, '（').replace(/\)/g, '）')
    const action = /（([^）]*)）/.exec(following)?.[1].trim() ?? ''
    const clean = following.replace(/<[^>]*>|（[^）]*）/g, '').trim()
    const translated = (/<([^>]*)>/.exec(following)?.[1] ?? '').replace(/（[^）]*）|【[^】]*】/g, '').trim().replace(/~/g, '。')
    const ttsText = options.enableTranslate ? translated : clean
    if (clean || ttsText || action) segments.push({ emotion: match[1], originalTag: match[1], text: clean, ttsText, action })
  }
  return segments
}
