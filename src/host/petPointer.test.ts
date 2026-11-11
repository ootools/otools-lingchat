import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetPointerController, logicalCursor, type CursorSample } from './petPointer';

const sample = (): CursorSample => ({ cursor: { x: -160, y: 260 }, origin: { x: -200, y: 200 }, scale: 2 });
function setup() {
  let compact = true; let held = false; let point = sample(); let failure = false;
  const writes: boolean[] = []; const positions: Array<{ x: number; y: number }> = [];
  const errors: unknown[] = [];
  const port = {
    compact: () => compact, held: () => held,
    sample: async () => { if (failure) throw new Error('cursor permission denied'); return point; },
    hit: (p: { x: number; y: number }) => { positions.push(p); return p.x >= 10 && p.x <= 30 && p.y >= 20 && p.y <= 40; },
    setIgnore: async (ignore: boolean) => { writes.push(ignore); },
    error: (error: unknown) => { errors.push(error); },
  };
  const controller = new PetPointerController(port);
  return { controller, port, writes, positions, errors,
    compact: (value: boolean) => compact = value, held: (value: boolean) => held = value,
    point: (value: CursorSample) => point = value, fail: () => failure = true };
}
afterEach(() => vi.useRealTimers());

describe('native pet pointer controller', () => {
  it('converts negative-monitor physical coordinates using the window scale', () => {
    expect(logicalCursor(sample())).toEqual({ x: 20, y: 30 });
    expect(() => logicalCursor({ ...sample(), cursor: {} as any })).toThrow();
    expect(() => logicalCursor({ ...sample(), scale: 0 })).toThrow();
  });
  it('normalizes macOS cursor and window coordinates with different monitor scales', () => {
    expect(logicalCursor({ cursor: { x: -2000, y: 600 }, origin: { x: -1100, y: 200 }, scale: 1, cursorScale: 2 })).toEqual({ x: 100, y: 100 });
  });
  it('passes empty space through and restores interaction over the pet', async () => {
    vi.useFakeTimers(); const f = setup();
    f.point({ ...sample(), cursor: { x: -100, y: 400 } });
    await f.controller.start(); expect(f.writes).toEqual([true]);
    f.point(sample()); await f.controller.refresh(); expect(f.writes).toEqual([true, false]);
    expect(f.positions.at(-1)).toEqual({ x: 20, y: 30 });
    await f.controller.stop();
  });
  it('never makes an expanded panel click-through, including reactivation', async () => {
    vi.useFakeTimers(); const f = setup(); f.compact(false);
    await f.controller.start(); await f.controller.start();
    expect(f.writes).toEqual([false]); expect(f.positions).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    await f.controller.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers interactivity and reports once if cursor queries fail', async () => {
    vi.useFakeTimers(); const f = setup();
    f.point({ ...sample(), cursor: { x: 0, y: 0 } }); await f.controller.start();
    f.fail(); await f.controller.refresh(); await f.controller.refresh();
    expect(f.writes).toEqual([true, false]); expect(f.errors).toHaveLength(1);
    await f.controller.stop();
  });
  it('restores the native input state if a cursor request stalls', async () => {
    vi.useFakeTimers(); const f = setup();
    f.point({ ...sample(), cursor: { x: 0, y: 0 } }); await f.controller.start();
    f.port.sample = () => new Promise(() => {});
    const refresh = f.controller.refresh();
    await vi.advanceTimersByTimeAsync(2000); await refresh;
    expect(f.writes).toEqual([true, false]); expect(f.errors).toHaveLength(1);
    await f.controller.stop();
  });
  it('does not race an older cursor sample against opening the panel', async () => {
    vi.useFakeTimers(); const f = setup();
    let finish!: (value: CursorSample) => void;
    f.port.sample = async () => new Promise(resolve => { finish = resolve; });
    const pending = f.controller.start();
    await Promise.resolve(); f.compact(false); const refresh = f.controller.refresh();
    finish({ ...sample(), cursor: { x: 0, y: 0 } }); await pending; await refresh;
    expect(f.writes).toEqual([false]);
    await f.controller.stop();
  });
  it('keeps a drag interactive until release and restores native input on stop', async () => {
    vi.useFakeTimers(); const f = setup(); f.held(true);
    await f.controller.start(); expect(f.writes).toEqual([false]);
    f.held(false); f.point({ ...sample(), cursor: { x: 0, y: 0 } });
    await f.controller.refresh(); expect(f.writes).toEqual([false, true]);
    await f.controller.stop(); expect(f.writes.at(-1)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
