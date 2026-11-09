// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ObservationController } from './observation';
import { isExplicitPreview } from './bridge';

describe('companion host boundary', () => {
  it('never silently enables a fixture when host APIs are absent', () => {
    expect(isExplicitPreview('')).toBe(false);
    expect(isExplicitPreview('?preview')).toBe(false);
    expect(isExplicitPreview('?preview=1')).toBe(true);
  });
  it('does not capture while consent is pending and releases a late image after stopping', async () => {
    let consent = 'pending'; let captures = 0; const released: string[] = [];
    let finishCapture!: (value: { imageId: string }) => void;
    const host = {
      observation: {
        request: async () => ({ id: 'session', state: 'pending' as const }),
        status: async () => ({ id: 'session', state: consent as 'pending' | 'active' }),
        capture: async () => { captures++; return new Promise<{ imageId: string }>(resolve => { finishCapture = resolve; }); },
        stop: async () => ({ id: 'session', state: 'stopped' as const }),
      },
      capture: { release: async (id: string) => { released.push(id); } },
    };
    const consume = vi.fn(async () => ({ id: 'ai', text: 'late' }));
    const onText = vi.fn();
    const controller = new ObservationController(host, { consume }, { onText });
    await controller.start({ kind: 'screen', displayId: 'screen-1' });
    await controller.tick();
    expect(captures).toBe(0);
    consent = 'active';
    const pending = controller.tick();
    await vi.waitFor(() => expect(captures).toBe(1));
    await controller.stop();
    finishCapture({ imageId: 'image-1' });
    await pending;
    expect(consume).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(released).toEqual(['image-1']);
  });
  it('rechecks consent after capture before sending an image to AI', async () => {
    let reads = 0; const released: string[] = [];
    const consume = vi.fn(async () => ({ id: 'ai', text: 'no' }));
    const controller = new ObservationController({
      observation: {
        request: async () => ({ id: 's', state: 'active' as const }),
        status: async () => ({ id: 's', state: (++reads === 1 ? 'active' : 'stopped') as 'active' | 'stopped' }),
        capture: async () => ({ imageId: 'i' }), stop: async () => ({ id: 's', state: 'stopped' as const }),
      }, capture: { release: async (id: string) => { released.push(id); } },
    }, { consume });
    await controller.start({ kind: 'screen', displayId: 'd' });
    await controller.tick();
    expect(consume).not.toHaveBeenCalled();
    expect(released).toEqual(['i']);
    await controller.stop();
  });
});
