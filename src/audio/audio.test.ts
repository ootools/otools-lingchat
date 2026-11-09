import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioController, synthesizeVits } from './index';

afterEach(() => vi.unstubAllGlobals());
describe('optional VITS audio', () => {
  it('sends independent voice settings and validates audio output', async () => {
    let body: any;
    const blob = await synthesizeVits('你好', { enabled: true, endpoint: 'http://127.0.0.1:9880/voice', speakerId: '2', language: 'zh', speed: 2 }, undefined,
      async (_url, init) => { body = JSON.parse(init!.body as string); return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/wav' } }); });
    expect(body).toEqual({ text: '你好', id: '2', lang: 'zh', length: 0.5 });
    expect(blob.type).toBe('audio/wav'); expect(blob.size).toBe(2);
    await expect(synthesizeVits('hi', { enabled: true, endpoint: 'file:///etc/passwd' })).rejects.toThrow('HTTP');
    await expect(synthesizeVits('hi', { enabled: true, endpoint: 'https://voice.test' }, undefined,
      async () => new Response('{"error":"not audio"}', { headers: { 'content-type': 'application/json' } }))).rejects.toThrow('audio');
  });
  it('revokes blob URLs and settles playback when stopped', async () => {
    const revoked: string[] = []; let media: FakeAudio | undefined;
    class FakeAudio {
      src = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null;
      paused = false; constructor() { media = this; }
      play() { return Promise.resolve(); } pause() { this.paused = true; }
      removeAttribute() { this.src = ''; } load() {}
    }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:voice', revokeObjectURL: (url: string) => revoked.push(url) });
    const audio = new AudioController();
    const playing = audio.play(new Blob(['voice'], { type: 'audio/wav' })).catch(e => e);
    audio.stop();
    expect((await playing).name).toBe('AbortError');
    expect(media?.paused).toBe(true); expect(revoked).toEqual(['blob:voice']);
    await audio.dispose();
  });
  it('does not start late synthesis after stop even if fetch ignores abort', async () => {
    let release!: () => void;
    const wait = new Promise<void>(r => { release = r; });
    let created = 0;
    vi.stubGlobal('fetch', async () => { await wait; return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } }); });
    vi.stubGlobal('Audio', class { constructor() { created++; } });
    const audio = new AudioController();
    const speaking = audio.speak('hello', { enabled: true, endpoint: 'http://localhost:9880/voice' }).catch(e => e);
    audio.stop(); release();
    expect((await speaking).name).toBe('AbortError'); expect(created).toBe(0);
  });
  it('creates an original short oscillator tone and closes its context', async () => {
    const events: string[] = [];
    class Context {
      currentTime = 1; state = 'running'; destination = {};
      resume = async () => {}; close = async () => { events.push('close'); };
      createOscillator() { return { type: '', frequency: { setValueAtTime: () => {} }, connect: () => {}, disconnect: () => {}, start: () => events.push('start'), stop: () => events.push('stop'), onended: null }; }
      createGain() { return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {}, disconnect: () => {} }; }
    }
    vi.stubGlobal('AudioContext', Context);
    const audio = new AudioController(); await audio.beep('reminder'); await audio.dispose();
    expect(events).toContain('start'); expect(events).toContain('stop'); expect(events).toContain('close');
  });
});
