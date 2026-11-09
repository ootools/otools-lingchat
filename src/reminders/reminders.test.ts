import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../saves/store';
import { ReminderService, extractReminderTime, isQuietTime } from './index';
const policy = { enabled: true, cooldownMs: 60_000, quietStart: '22:00', quietEnd: '08:00' };

describe('conservative reminder time extraction', () => {
  const now = new Date(2026, 10, 10, 12, 0);
  it('accepts explicit full dates and tomorrow with a 24-hour clock', () => {
    expect(extractReminderTime('明天 15:30 提醒我喝茶', now)).toEqual({ kind: 'explicit', dueAt: new Date(2026, 10, 11, 15, 30).toISOString() });
    expect(extractReminderTime('2026-11-12 09:00 开会', now)).toEqual({ kind: 'explicit', dueAt: new Date(2026, 10, 12, 9).toISOString() });
    expect(extractReminderTime('at 2026-11-12T09:00:00Z remind me', now)).toEqual({ kind: 'explicit', dueAt: '2026-11-12T09:00:00.000Z' });
  });
  it('asks instead of guessing dates, invalid dates, AM/PM, or conflicting times', () => {
    for (const text of ['晚点提醒我', '明天提醒我', '下周三开会', '2026-02-30 09:00', '2026-11-12 25:00', '明天 3:00', '明天 15:00 或 16:00', 'tomorrow 3:00 pm']) {
      expect(extractReminderTime(text, now).kind, text).toBe('ambiguous');
    }
    expect(extractReminderTime('喜欢茶', now)).toEqual({ kind: 'none' });
  });
  it('supports quiet hours crossing midnight', () => {
    expect(isQuietTime(policy, new Date(2026, 10, 10, 23))).toBe(true);
    expect(isQuietTime(policy, new Date(2026, 10, 11, 7, 59))).toBe(true);
    expect(isQuietTime(policy, new Date(2026, 10, 11, 8))).toBe(false);
  });
});
describe('persisted note and reminder policy', () => {
  it('baselines notes, deduplicates content and preserves cooldown across instances', async () => {
    const store = new MemoryStore(); const service = new ReminderService(store);
    const now = new Date(2026, 10, 10, 12);
    expect(await service.observeNote({ sourceId: 'note', revision: '1', text: 'a' }, policy, now)).toMatchObject({ changed: false, notify: false });
    expect(await service.observeNote({ sourceId: 'note', revision: '2', text: 'b' }, policy, now)).toMatchObject({ changed: true, notify: true });
    const reopened = new ReminderService(store);
    expect(await reopened.observeNote({ sourceId: 'note', revision: '3', text: 'b' }, policy, new Date(+now + 70_000))).toMatchObject({ changed: false, notify: false });
    expect(await reopened.observeNote({ sourceId: 'note', revision: '4', text: 'c' }, policy, new Date(+now + 10_000))).toMatchObject({ changed: true, notify: false, reason: 'cooldown' });
    expect(JSON.stringify(await store.list('reminder:'))).not.toContain('"text":"c"');
  });
  it('claims delivery atomically across concurrent runtimes and persists completion', async () => {
    const store = new MemoryStore(); const a = new ReminderService(store); const b = new ReminderService(store);
    const now = new Date(2026, 10, 10, 12);
    await a.schedule({ id: 'tea', text: 'Drink tea', dueAt: new Date(+now - 1000).toISOString() });
    const delivered: string[] = [];
    await Promise.all([a.deliverDue(async item => { delivered.push(item.id); }, policy, now), b.deliverDue(async item => { delivered.push(item.id); }, policy, now)]);
    expect(delivered).toEqual(['tea']);
    expect((await b.list())[0]).toMatchObject({ id: 'tea', state: 'delivered', deliveredAt: now.toISOString() });
    expect(await b.deliverDue(async () => { throw new Error('duplicate'); }, policy, new Date(+now + 100_000))).toBe(0);
  });
  it('defers quiet-time reminders and persists failure for explicit retry without duplicates', async () => {
    const store = new MemoryStore(); const service = new ReminderService(store);
    const night = new Date(2026, 10, 10, 23);
    await service.schedule({ id: 'tea', text: 'Tea', dueAt: new Date(+night - 1000).toISOString() });
    expect(await service.deliverDue(async () => {}, policy, night)).toBe(0);
    const morning = new Date(2026, 10, 11, 9);
    expect(await service.deliverDue(async () => { throw new Error('unavailable'); }, policy, morning)).toBe(0);
    expect((await service.list())[0].state).toBe('failed');
    await service.retry('tea');
    expect(await service.deliverDue(async () => {}, policy, new Date(+morning + 70_000))).toBe(1);
  });
  it('does not turn cancelled in-flight delivery back into delivered', async () => {
    const service = new ReminderService(new MemoryStore()); const now = new Date(2026, 10, 10, 12);
    await service.schedule({ id: 'tea', text: 'Tea', dueAt: now.toISOString() });
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(r => { started = r; }); const wait = new Promise<void>(r => { release = r; });
    const pending = service.deliverDue(async () => { started(); await wait; }, policy, now);
    await ready; await service.cancel('tea'); release(); await pending;
    expect((await service.list())[0].state).toBe('cancelled');
  });
});
