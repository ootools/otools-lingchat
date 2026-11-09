import { type SaveRepository } from '../saves/repository';
import { abortError, type HostAi } from '../dialogue/session';
import { emptyMemory, MEMORY_LIMITS, validateMemory, truncateChars, type MemoryBank, type MemorySection } from './schema';
import { summaryPrompt } from './prompts';
export * from './schema';
export type Summarizer = (prompt: string, signal: AbortSignal) => Promise<string>;
export function createHostSummarizer(ai: HostAi): Summarizer {
  return async (prompt, signal) => {
    let error: Error | undefined;
    const response = await ai.consume({ messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], temperature: 0.2, maxTokens: 2000 }, {
      signal, onEvent: event => {
        if (event.type === 'error') error = new Error('Host summarization failed');
        if (event.type === 'cancelled') error = abortError();
      },
    });
    if (signal.aborted) throw abortError();
    if (error) throw error;
    return response.text;
  };
}
export class MemoryService {
  private pending = new Set<string>();
  private failures = new Map<string, { generation: string; revision: number; at: number }>();
  constructor(private repository: SaveRepository, private summarizeText: Summarizer,
    private options: { updateInterval?: number; now?: () => number } = {}) {}
  async summarize(saveId: string, roleId: string, options: { signal?: AbortSignal; force?: boolean } = {}): Promise<'updated' | 'skipped' | 'stale'> {
    const key = JSON.stringify([saveId, roleId]);
    if (this.pending.has(key)) return 'skipped';
    this.pending.add(key);
    const signal = options.signal ?? new AbortController().signal;
    const now = this.options.now ?? Date.now;
    let snapshot: Awaited<ReturnType<SaveRepository['get']>>;
    try {
      if (signal.aborted) throw abortError();
      snapshot = await this.repository.get(saveId, roleId);
      if (!snapshot) return 'stale';
      const failure = this.failures.get(key);
      if (failure?.generation === snapshot.generation && failure.revision === snapshot.revision
        && Math.max(0, now() - failure.at) < 60_000) return 'skipped';
      const lines = snapshot.messages;
      let end = Math.min(snapshot.memory.meta.last_processed_global_idx, lines.length);
      let chatText = ''; let count = 0;
      for (; end < lines.length; end++) {
        const line = lines[end];
        if (!line.memoryEligible || !line.text.trim()) continue;
        // A single enormous turn cannot make the prompt unbounded.
        const chunk = `${line.role === 'assistant' ? roleId : 'User'}: ${truncateChars(line.text, 12_000)}\n`;
        if (chatText && Array.from(chatText + chunk).length > 16_000) break;
        chatText += chunk; count++;
      }
      const allEligible = lines.slice(snapshot.memory.meta.last_processed_global_idx).filter(line => line.memoryEligible && line.text.trim()).length;
      if (!count || (!options.force && allEligible < (this.options.updateInterval ?? 250))) return 'skipped';
      const sections = Object.keys(MEMORY_LIMITS) as MemorySection[];
      const results = await Promise.all(sections.map(async section => {
        if (signal.aborted) throw abortError();
        const response = (await this.summarizeText(summaryPrompt(section, snapshot!.memory, chatText), signal)).trim();
        if (!response || response.length > 100_000) throw new Error('Invalid summary');
        return response;
      }));
      if (signal.aborted) throw abortError();
      const updated = await this.repository.mutate(saveId, roleId, snapshot, role => {
        // Match upstream: truncate input/injection, preserve the full generated summary.
        sections.forEach((section, i) => { role.memory.data[section] = results[i]; });
        role.memory.meta = { last_processed_global_idx: end, updated_at: new Date(now()).toISOString() };
      }, () => !signal.aborted);
      if (!updated) return 'stale';
      this.failures.delete(key);
      return 'updated';
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError();
      if (snapshot) {
        const current = await this.repository.get(saveId, roleId);
        if (!current || current.generation !== snapshot.generation || current.revision !== snapshot.revision) return 'stale';
        this.failures.set(key, { generation: snapshot.generation, revision: snapshot.revision, at: now() });
      }
      // Do not leak source text/provider response through error messages or logs.
      throw new Error('Memory summarization failed; the previous memory was preserved');
    } finally { this.pending.delete(key); }
  }
  async edit(saveId: string, roleId: string, section: MemorySection, content: string): Promise<void> {
    if (!Object.hasOwn(MEMORY_LIMITS, section) || typeof content !== 'string' || content.length > 100_000) throw new Error('Invalid memory section');
    const updated = await this.repository.mutate(saveId, roleId, undefined, role => {
      role.memory.data[section] = content;
      role.memory.meta.updated_at = new Date().toISOString();
    });
    if (!updated) throw new Error('Save or role not found');
  }
  async clear(saveId: string, roleId: string): Promise<void> {
    const updated = await this.repository.mutate(saveId, roleId, undefined, role => {
      role.memory = emptyMemory();
      // Cleared history must not be summarized back into memory on the next turn.
      role.memory.meta.last_processed_global_idx = role.messages.length;
      role.memory.meta.updated_at = new Date().toISOString();
    });
    if (!updated) throw new Error('Save or role not found');
  }
  async export(saveId: string, roleId: string): Promise<string> {
    const role = await this.repository.get(saveId, roleId);
    if (!role) throw new Error('Save or role not found');
    return JSON.stringify({ format: 'otools-lingchat-memory', version: 1, memory: role.memory });
  }
  async import(saveId: string, roleId: string, json: string): Promise<void> {
    if (json.length > 1_000_000) throw new Error('Memory archive is too large');
    const archive = JSON.parse(json);
    if (archive?.format !== 'otools-lingchat-memory' || archive.version !== 1) throw new Error('Unsupported memory archive version');
    validateMemory(archive.memory);
    const bank: MemoryBank = archive.memory;
    const updated = await this.repository.mutate(saveId, roleId, undefined, role => {
      role.memory = structuredClone(bank);
      // Standalone memory imports have no shared chat index; start from current boundary.
      role.memory.meta.last_processed_global_idx = role.messages.length;
      role.memory.meta.updated_at = new Date().toISOString();
    });
    if (!updated) throw new Error('Save or role not found');
  }
}
