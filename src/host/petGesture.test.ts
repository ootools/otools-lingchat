import { describe, expect, it, vi } from 'vitest';
import { PetGesture } from './petGesture';
const pointer = (x=10,y=10,button=0,id=1) => ({x,y,button,id});
describe('pet gesture', () => {
  it('keeps a short left press as pet interaction without starting a drag', () => {
    const pet=vi.fn(),drag=vi.fn(async()=>{}),held=vi.fn();
    const gesture=new PetGesture({pet,drag,held,error:vi.fn()});
    gesture.down(pointer()); gesture.move(pointer(12,12)); gesture.up(1);
    expect(pet).toHaveBeenCalledTimes(1); expect(drag).not.toHaveBeenCalled(); expect(held).toHaveBeenLastCalledWith(false);
  });
  it('drags from the pet after a small movement and does not also pet on release', async () => {
    let finish!:()=>void; const pet=vi.fn(),drag=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),held=vi.fn();
    const gesture=new PetGesture({pet,drag,held,error:vi.fn()});
    gesture.down(pointer()); gesture.move(pointer(20,12)); gesture.move(pointer(30,12));
    expect(drag).toHaveBeenCalledTimes(1); expect(held).toHaveBeenLastCalledWith(true);
    gesture.up(1); finish(); await Promise.resolve();
    expect(pet).not.toHaveBeenCalled(); expect(held).toHaveBeenLastCalledWith(false);
  });
  it('right-click and cancelled or unrelated pointers never trigger a pet or drag', () => {
    const pet=vi.fn(),drag=vi.fn(async()=>{}),held=vi.fn(); const gesture=new PetGesture({pet,drag,held,error:vi.fn()});
    expect(gesture.down(pointer(1,1,2))).toBe(false); gesture.move(pointer(50,50,2)); gesture.up(1);
    gesture.down(pointer()); gesture.up(2); expect(pet).not.toHaveBeenCalled(); gesture.cancel(); gesture.up(1);
    expect(pet).not.toHaveBeenCalled(); expect(drag).not.toHaveBeenCalled();
  });
  it('keeps a native drag interactive even if the startup call acknowledges before pointer release', async () => {
    const held=vi.fn(); const gesture=new PetGesture({pet:vi.fn(),held,error:vi.fn(),drag:async()=>{}});
    gesture.down(pointer()); gesture.move(pointer(30));
    for(let i=0;i<6;i++) await Promise.resolve();
    expect(held).toHaveBeenLastCalledWith(true);
    gesture.up(1); expect(held).toHaveBeenLastCalledWith(false);
  });
  it('a late native drag result cannot release a newer press', async () => {
    let finish!:()=>void; const held=vi.fn(); const gesture=new PetGesture({pet:vi.fn(),held,error:vi.fn(),drag:()=>new Promise<void>(r=>{finish=r;})});
    gesture.down(pointer()); gesture.move(pointer(25)); gesture.cancel(); gesture.down(pointer(5,5,0,2)); finish();
    for(let i=0;i<6;i++) await Promise.resolve(); expect(held).toHaveBeenLastCalledWith(true); gesture.cancel();
  });
});
