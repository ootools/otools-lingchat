import { describe, expect, it } from 'vitest';
import { visibleDialogue } from './visible';

describe('visible dialogue', () => {
  it('displays ordinary replies without requiring an emotion tag', () => {
    expect(visibleDialogue('A plain reply')).toBe('A plain reply');
    expect(visibleDialogue('【开心】你好<hello>（挥手）')).toBe('你好');
  });
});
