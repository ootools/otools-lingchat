import type { AsyncStore } from '../saves/store';

export interface ReminderPolicy { enabled: boolean; cooldownMs: number; quietStart?: string; quietEnd?: string }
export interface Reminder {
  id: string; text: string; dueAt: string; sourceId?: string;
  state: 'pending' | 'delivering' | 'delivered' | 'failed' | 'cancelled';
  createdAt: string; deliveredAt?: string; attempt?: string;
}
interface State { reminders: Reminder[]; notes: Record<string, { hash: string; revision: string }>; lastNotificationAt?: number }
const KEY = 'reminder:policy-state';
const initial = (): State => ({ reminders: [], notes: {} });
const ambiguous = () => ({ kind: 'ambiguous' as const, question: '请确认提醒的完整日期和 24 小时时间（例如 2026-11-12 15:30）。' });

/** Deliberately small grammar: do not infer a date or AM/PM from conversational hints. */
export function extractReminderTime(text: string, now = new Date()):
  { kind: 'explicit'; dueAt: string } | { kind: 'ambiguous'; question: string } | { kind: 'none' } {
  const clocks = text.match(/\d{1,2}:\d{2}/g) ?? [];
  if (clocks.length > 1 || /\b(am|pm)\b/i.test(text)) return ambiguous();
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))\b/);
  if (iso) {
    const date = new Date(iso[1]);
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso[1])!;
    const check = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    if (!Number.isFinite(+date) || +date <= +now || check.getUTCMonth() !== +parts[2] - 1 || check.getUTCDate() !== +parts[3]) return ambiguous();
    return { kind: 'explicit', dueAt: date.toISOString() };
  }
  const full = text.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\b/);
  const tomorrow = text.match(/(?:明天|\btomorrow\b)\s+(\d{2}):(\d{2})\b/i);
  if (full || tomorrow) {
    const date = new Date(now); date.setSeconds(0, 0);
    const hour = +(full?.[4] ?? tomorrow![1]); const minute = +(full?.[5] ?? tomorrow![2]);
    if (hour > 23 || minute > 59) return ambiguous();
    if (full) {
      date.setFullYear(+full[1], +full[2] - 1, +full[3]); date.setHours(hour, minute);
      if (date.getFullYear() !== +full[1] || date.getMonth() !== +full[2] - 1 || date.getDate() !== +full[3]) return ambiguous();
    } else { date.setDate(date.getDate() + 1); date.setHours(hour, minute); }
    if (date.getHours() !== hour || date.getMinutes() !== minute || +date <= +now) return ambiguous();
    return { kind: 'explicit', dueAt: date.toISOString() };
  }
  return /提醒|明天|今天|下周|晚点|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|remind|tomorrow|later|next week/i.test(text) ? ambiguous() : { kind: 'none' };
}
function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Quiet time must be HH:mm');
  const [h, m] = time.split(':').map(Number); return h * 60 + m;
}
export function isQuietTime(policy: ReminderPolicy, now = new Date()): boolean {
  if (!policy.quietStart || !policy.quietEnd) return false;
  const start = minutes(policy.quietStart); const end = minutes(policy.quietEnd);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
function suppression(state: State, policy: ReminderPolicy, now: Date): string | undefined {
  if (!Number.isFinite(policy.cooldownMs) || policy.cooldownMs < 0) throw new Error('Invalid cooldown');
  if (!policy.enabled) return 'disabled';
  if (isQuietTime(policy, now)) return 'quiet';
  if (state.lastNotificationAt !== undefined && Math.max(0, +now - state.lastNotificationAt) < policy.cooldownMs) return 'cooldown';
  return undefined;
}
async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** No timers or watchers: the host runtime owns lifecycle and invokes this policy. */
export class ReminderService {
  constructor(private store: AsyncStore) {}
  async observeNote(note: { sourceId: string; revision: string; text: string }, policy: ReminderPolicy, now = new Date()): Promise<{ changed: boolean; notify: boolean; reason: string }> {
    if (!note.sourceId || note.sourceId.length > 500) throw new Error('Invalid source ID');
    const hash = await digest(note.text); const key = JSON.stringify(note.sourceId);
    let result = { changed: false, notify: false, reason: 'baseline' };
    await this.store.update<State>(KEY, current => {
      const state = current ?? initial(); const old = state.notes[key];
      state.notes[key] = { hash, revision: note.revision };
      if (!old) return state;
      if (old.hash === hash) { result.reason = 'duplicate'; return state; }
      const reason = suppression(state, policy, now);
      result = { changed: true, notify: !reason, reason: reason ?? 'changed' };
      if (!reason) state.lastNotificationAt = +now;
      return state;
    });
    return result;
  }
  async schedule(input: { id?: string; text: string; dueAt: string; sourceId?: string }): Promise<Reminder> {
    if (!input.text.trim() || input.text.length > 4000 || !Number.isFinite(Date.parse(input.dueAt))) throw new Error('Invalid reminder');
    const item: Reminder = { ...input, id: input.id ?? crypto.randomUUID(), dueAt: new Date(input.dueAt).toISOString(), createdAt: new Date().toISOString(), state: 'pending' };
    if (!item.id || item.id.length > 200) throw new Error('Invalid reminder ID');
    await this.store.update<State>(KEY, current => {
      const state = current ?? initial();
      if (state.reminders.some(r => r.id === item.id)) throw new Error('Reminder already exists');
      state.reminders.push(item); return state;
    });
    return structuredClone(item);
  }
  async list(): Promise<Reminder[]> { return (await this.store.get<State>(KEY))?.reminders ?? []; }
  async cancel(id: string): Promise<void> {
    await this.store.update<State>(KEY, current => {
      if (!current) return current;
      const item = current.reminders.find(r => r.id === id);
      if (item) { item.state = 'cancelled'; delete item.attempt; }
      return current;
    });
  }
  async retry(id: string): Promise<void> {
    await this.store.update<State>(KEY, current => {
      const item = current?.reminders.find(r => r.id === id);
      if (!item || !['failed', 'delivering'].includes(item.state)) throw new Error('Reminder is not retryable');
      item.state = 'pending'; delete item.attempt; return current;
    });
  }
  async deliverDue(deliver: (reminder: Reminder) => Promise<void>, policy: ReminderPolicy, now = new Date()): Promise<number> {
    const candidates = (await this.list()).filter(r => r.state === 'pending' && Date.parse(r.dueAt) <= +now).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    let delivered = 0;
    for (const candidate of candidates) {
      let claimed: Reminder | undefined; const attempt = crypto.randomUUID();
      await this.store.update<State>(KEY, current => {
        if (!current || suppression(current, policy, now)) return current;
        const item = current.reminders.find(r => r.id === candidate.id);
        if (!item || item.state !== 'pending' || Date.parse(item.dueAt) > +now) return current;
        item.state = 'delivering'; item.attempt = attempt; current.lastNotificationAt = +now;
        claimed = structuredClone(item); return current;
      });
      if (!claimed) continue;
      let success = false;
      try { await deliver(claimed); success = true; } catch { /* Persist failure without source content or provider logs. */ }
      await this.store.update<State>(KEY, current => {
        const item = current?.reminders.find(r => r.id === candidate.id);
        if (!item || item.state !== 'delivering' || item.attempt !== attempt) return current;
        item.state = success ? 'delivered' : 'failed';
        if (success) { item.deliveredAt = now.toISOString(); delivered++; }
        delete item.attempt; return current;
      });
    }
    return delivered;
  }
}
