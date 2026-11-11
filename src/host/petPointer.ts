export interface Point { x: number; y: number }
export interface CursorSample { cursor: Point; origin: Point; scale: number; cursorScale?: number }
export interface PointerPort {
  compact(): boolean;
  held(): boolean;
  sample(): Promise<CursorSample>;
  hit(point: Point): boolean;
  setIgnore(value: boolean): Promise<void>;
  error(error: unknown): void;
}
export function logicalCursor(sample: CursorSample): Point {
  if (![sample.cursor?.x, sample.cursor?.y, sample.origin?.x, sample.origin?.y, sample.scale].every(Number.isFinite) || sample.scale <= 0) {
    throw new Error('Invalid cursor sample');
  }
  const cursorScale = sample.cursorScale ?? sample.scale;
  if (!Number.isFinite(cursorScale) || cursorScale <= 0) throw new Error('Invalid cursor scale');
  return { x: sample.cursor.x / cursorScale - sample.origin.x / sample.scale, y: sample.cursor.y / cursorScale - sample.origin.y / sample.scale };
}

/** Owns one polling loop and serializes native input changes. Never disable mouse
 * input until a valid native cursor sample proves the pointer is in empty space. */
export class PetPointerController {
  private running = false;
  private ignored?: boolean;
  private reported = false;
  private failed = false;
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private port: PointerPort) {}
  async start(): Promise<void> {
    if (this.running) { this.failed = false; this.reported = false; return this.refresh(); }
    this.running = true; this.failed = false; this.reported = false;
    await this.refresh();
    this.schedule();
  }
  private schedule() {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().finally(() => this.schedule());
    }, 100);
  }
  private async apply(ignore: boolean, force = false) {
    if (!force && this.ignored === ignore) return;
    await this.port.setIgnore(ignore);
    this.ignored = ignore;
  }
  private async sample() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.port.sample(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Cursor query timed out')), 2000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  refresh(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.update().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async update() {
    try {
      if (this.failed || !this.port.compact() || this.port.held()) { await this.apply(false); return; }
      const point = logicalCursor(await this.sample());
      if (!this.running) return;
      // Re-evaluate mode after native IPC: a stale sample must not disable an
      // expanded panel or a drag that started while the query was in flight.
      const ignore = this.port.compact() && !this.port.held() && !this.port.hit(point);
      await this.apply(ignore);
    } catch (error) {
      this.failed = true;
      try { await this.apply(false, true); } catch { /* Reopening remains available from the host. */ }
      if (!this.reported) { this.reported = true; this.port.error(error); }
    }
  }
  async stop(): Promise<void> {
    this.running = false; clearTimeout(this.timer); this.timer = undefined;
    await this.pending;
    try { await this.apply(false); } catch (error) { if (!this.reported) this.port.error(error); }
  }
}
