export const MEMORY_LIMITS = { short_term: 500, long_term: 2000, user_info: 800, promises: 800 } as const;
export type MemorySection = keyof typeof MEMORY_LIMITS;
export interface MemoryBank {
  schema_version: 1;
  meta: { last_processed_global_idx: number; updated_at: string };
  data: Record<MemorySection, string>;
}
export function emptyMemory(): MemoryBank {
  return {
    schema_version: 1, meta: { last_processed_global_idx: 0, updated_at: '' },
    data: { short_term: '暂无近期对话摘要。', long_term: '暂无长期关键经历。', user_info: '暂无用户特征记录。', promises: '暂无未完成的约定。' },
  };
}
export function truncateChars(value: string, limit: number): string { return Array.from(value).slice(0, limit).join(''); }
export function validateMemory(value: unknown): asserts value is MemoryBank {
  const v = value as MemoryBank;
  if (!v || v.schema_version !== 1 || !v.meta || !Number.isSafeInteger(v.meta.last_processed_global_idx)
    || v.meta.last_processed_global_idx < 0 || typeof v.meta.updated_at !== 'string' || !v.data
    || Object.keys(MEMORY_LIMITS).some(key => typeof v.data[key as MemorySection] !== 'string'
      || v.data[key as MemorySection].length > 100_000)) throw new Error('Invalid memory schema (expected version 1)');
}
export function systemMemoryText(bank: MemoryBank): string {
  return `\n\n====== 记忆库 (Memory Bank) ======\n【taの信息】：${truncateChars(bank.data.user_info, 800)}\n【重要约定】：${truncateChars(bank.data.promises, 800)}\n【长期经历】：${truncateChars(bank.data.long_term, 2000)}\n=================================\n`;
}
export function shortTermText(bank: MemoryBank): string {
  const text = truncateChars(bank.data.short_term.trim(), 500);
  return !text || text === '暂无近期对话摘要。' ? '' : `【近期回顾】${text}\n\n`;
}
