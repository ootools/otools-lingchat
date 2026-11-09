import { parseDialogue } from './protocol';
export function visibleDialogue(text: string): string {
  const segments = parseDialogue(text);
  return segments.length ? segments.map(segment => segment.text).join('\n') : text;
}
