export interface VoiceSettings { enabled: boolean; endpoint: string; speakerId?: string; language?: string; speed?: number }
const cancelled = () => new DOMException('Audio cancelled', 'AbortError');

/** Common VITS simple-api POST dialect. Other servers can inject their own adapter. */
export async function synthesizeVits(text: string, settings: VoiceSettings, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Blob> {
  if (!settings.enabled) throw new Error('Voice is disabled');
  if (signal?.aborted) throw cancelled();
  let url: URL;
  try { url = new URL(settings.endpoint); } catch { throw new Error('Voice endpoint must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Voice endpoint must be an HTTP(S) URL without credentials');
  if (!text.trim() || text.length > 5000) throw new Error('Voice text must contain 1–5000 characters');
  const speed = settings.speed ?? 1;
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error('Voice speed must be between 0.25 and 4');
  const response = await fetcher(url.toString(), {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
    body: JSON.stringify({ text, id: settings.speakerId ?? '0', lang: settings.language ?? 'auto', length: 1 / speed }),
  });
  if (signal?.aborted) throw cancelled();
  if (!response.ok) throw new Error(`Voice synthesis failed (${response.status})`);
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('audio/')) throw new Error('Voice endpoint did not return audio');
  const blob = await response.blob();
  if (signal?.aborted) throw cancelled();
  if (!blob.size || blob.size > 20_000_000) throw new Error('Invalid audio size (maximum 20 MB)');
  return blob;
}

export class AudioController {
  private context?: AudioContext;
  private oscillator?: OscillatorNode;
  private controller?: AbortController;
  private finishPlayback?: (error?: Error) => void;
  private epoch = 0;
  private disposed = false;
  async beep(kind: 'message' | 'reminder' = 'message'): Promise<void> {
    if (this.disposed) throw new Error('Audio controller is disposed');
    this.stop(); const epoch = this.epoch;
    const context = this.context ??= new AudioContext();
    if (context.state === 'suspended') await context.resume();
    if (this.disposed || epoch !== this.epoch) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    this.oscillator = oscillator;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'reminder' ? 660 : 523.25, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (this.oscillator === oscillator) this.oscillator = undefined; };
    oscillator.start(); oscillator.stop(context.currentTime + 0.24);
  }
  private playback(blob: Blob, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const media = new Audio(); const url = URL.createObjectURL(blob);
      let done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true;
        signal.removeEventListener('abort', abort);
        media.onended = null; media.onerror = null;
        media.pause(); media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url);
        if (this.finishPlayback === finish) this.finishPlayback = undefined;
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(cancelled());
      this.finishPlayback = finish;
      signal.addEventListener('abort', abort, { once: true });
      media.onended = () => finish(); media.onerror = () => finish(new Error('Audio playback failed'));
      media.src = url;
      try { void media.play().catch(() => finish(new Error('Audio playback was blocked or failed'))); }
      catch { finish(new Error('Audio playback failed')); }
    });
  }
  private begin(signal?: AbortSignal): { controller: AbortController; unlink: () => void; epoch: number } {
    if (this.disposed) throw new Error('Audio controller is disposed');
    this.stop(); const controller = new AbortController(); this.controller = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    return { controller, unlink: () => signal?.removeEventListener('abort', abort), epoch: this.epoch };
  }
  async play(blob: Blob, signal?: AbortSignal): Promise<void> {
    const operation = this.begin(signal);
    try { await this.playback(blob, operation.controller.signal); }
    finally { operation.unlink(); if (this.controller === operation.controller) this.controller = undefined; }
  }
  async speak(text: string, settings: VoiceSettings, signal?: AbortSignal): Promise<void> {
    if (!settings.enabled) return;
    const operation = this.begin(signal);
    try {
      const blob = await synthesizeVits(text, settings, operation.controller.signal);
      if (operation.controller.signal.aborted || operation.epoch !== this.epoch) throw cancelled();
      await this.playback(blob, operation.controller.signal);
    } finally { operation.unlink(); if (this.controller === operation.controller) this.controller = undefined; }
  }
  stop(): void {
    this.epoch++; this.controller?.abort(); this.controller = undefined;
    this.finishPlayback?.(cancelled()); this.finishPlayback = undefined;
    if (this.oscillator) { try { this.oscillator.stop(); } catch { /* already ended */ } this.oscillator.disconnect(); this.oscillator = undefined; }
  }
  async dispose(): Promise<void> {
    this.stop(); this.disposed = true;
    const context = this.context; this.context = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
}
