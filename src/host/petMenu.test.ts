import { describe, expect, it, vi } from 'vitest';
import { PetMenu, petMenuEntries } from './petMenu';
const labels=(key:string)=>key;
describe('pet context menu', () => {
  it('puts companion functions in the menu with checked topmost and privacy/stop state', () => {
    const items=petMenuEntries(labels,{topmost:true,busy:true,observing:true,ready:true,notice:true});
    expect(items.filter(item=>'id' in item).map(item=>(item as {id:string}).id)).toEqual(['chat','saves','characters','story','memory','connections','settings','model','agent','pet','notice','topmost','stop','stopObservation','close']);
    expect(items.find(item=>'id' in item && item.id==='topmost')).toMatchObject({checked:true});
    expect(items.find(item=>'id' in item && item.id==='stopObservation')).toMatchObject({enabled:true});
  });
  it('keeps the native menu outside window layout and retains resources until replaced or disposed', async () => {
    const close=vi.fn(async()=>{}),select=vi.fn(),held=vi.fn(); let action!:(id:string)=>void;
    const factory=vi.fn(async(_items:any,callback:(id:string)=>void)=>{action=callback; return {popup:vi.fn(async()=>{}),close};});
    const menu=new PetMenu({create:factory,select,held,error:vi.fn()});
    await menu.open([], {x:12,y:20}); expect(close).not.toHaveBeenCalled(); action('settings'); expect(select).toHaveBeenCalledWith('settings');
    await menu.open([], {x:15,y:22}); expect(close).toHaveBeenCalledTimes(1);
    await menu.dispose(); expect(close).toHaveBeenCalledTimes(2); action('chat'); expect(select).toHaveBeenCalledTimes(1); expect(held).toHaveBeenLastCalledWith(false);
  });
  it('closes a menu created after its owner is disposed without showing it', async () => {
    let release!:(value:any)=>void; const popup=vi.fn(async()=>{}),close=vi.fn(async()=>{});
    const menu=new PetMenu({create:()=>new Promise(r=>{release=r;}),select:vi.fn(),held:vi.fn(),error:vi.fn()});
    const opening=menu.open([], {x:1,y:1}); await Promise.resolve(); await menu.dispose(); release({popup,close}); await opening;
    expect(popup).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  });
});
