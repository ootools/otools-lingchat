import { describe, expect, it } from 'vitest';
import { alphaBounds, compactLayout, moveToAnchor, WindowGeometry, type PetLayout } from './petGeometry';

const artwork = { x: 35, y: 28, width: 270, height: 287 };
describe('compact pet geometry', () => {
  it('sizes the idle window to the visible artwork with only a safety inset', () => {
    const layout = compactLayout(artwork, 1, false);
    expect(layout.width).toBe(215);
    expect(layout.height).toBe(228);
    expect(layout.anchor).toEqual({ x: 107.5, y: 224 });
    expect(compactLayout(artwork, 0.7, false).height).toBe(162);
    expect(compactLayout(artwork, 1.3, false).height).toBe(294);
  });
  it.each([
    {bounds:{x:0,y:0,width:4000,height:400},width:228,height:30},
    {bounds:{x:0,y:0,width:400,height:4000},width:30,height:228},
  ])('keeps imported artwork proportional without a desktop-sized window: $width × $height',({bounds,width,height})=>{
    const layout=compactLayout(bounds,1,false);expect(layout.width).toBe(width);expect(layout.height).toBe(height);
  });
  it('uses safe artwork geometry instead of emitting invalid window sizes',()=>{
    const layout=compactLayout({x:0,y:0,width:NaN,height:0},1,false);
    expect({width:layout.width,height:layout.height}).toEqual({width:215,height:228});
  });
  it('grows only for a transient notice and restores exactly the pet layout', () => {
    const idle = compactLayout(artwork, 1, false);
    const notice = compactLayout(artwork, 1, true);
    expect(notice.height - idle.height).toBe(110);
    expect(notice.width).toBeGreaterThanOrEqual(idle.width);
    expect(compactLayout(artwork, 1, false)).toEqual(idle);
  });
  it('finds only nontransparent pixels and does not allocate a window for empty images', () => {
    const pixels = new Uint8ClampedArray(6 * 5 * 4);
    for (const [x,y] of [[2,1],[3,3]]) pixels[(y * 6 + x) * 4 + 3] = 255;
    expect(alphaBounds(pixels, 6, 5)).toEqual({ x:2, y:1, width:2, height:3 });
    expect(alphaBounds(new Uint8ClampedArray(6 * 5 * 4),6,5)).toBeNull();
  });
  it('retains negative-monitor physical screen coordinates at nonunit DPI', () => {
    expect(moveToAnchor({ x:-950,y:100 }, { x:190,y:480 }, { x:107.5,y:224 }, 2)).toEqual({ x:-785,y:612 });
  });
  it.each([1,1.25,2])('does not accumulate pixel drift across repeated panel transitions at scale %s',async scale=>{
    let origin={x:-400,y:100};let size={width:Math.round(215*scale),height:Math.round(228*scale)};
    const geometry=new WindowGeometry({read:async()=>({origin:{...origin},size:{...size},scale}),setSize:async next=>{size={width:Math.round(next.width*scale),height:Math.round(next.height*scale)};},setPosition:async next=>{origin={...next};}});
    const idle=compactLayout(artwork,1,false);await geometry.apply(idle,false);const initial={...origin};
    for(let i=0;i<10;i++){
      await geometry.apply({width:1100,height:760,anchor:{x:550,y:740},artwork:{width:0,height:0}},true);
      await geometry.apply(compactLayout(artwork,1,true),false);
      await geometry.apply(idle,false);
    }
    expect(origin).toEqual(initial);
  });
  it('does not apply a queued resize after its owner becomes inactive',async()=>{
    let release!:(value:any)=>void;let current=true;const changes:string[]=[];
    const geometry=new WindowGeometry({read:()=>new Promise(resolve=>{release=resolve;}),setSize:async()=>{changes.push('size');},setPosition:async()=>{changes.push('position');}});
    const pending=geometry.apply(compactLayout(artwork,1,false),false,()=>current);
    for(let i=0;i<4;i++)await Promise.resolve();current=false;
    release({origin:{x:0,y:0},size:{width:380,height:520},scale:1});await pending;
    expect(changes).toEqual([]);
  });
  it('overrides remembered large startup geometry and preserves the pet through panel/notice transitions', async () => {
    let origin = { x:-400,y:100 }; let size = { width:760,height:1040 };
    const geometry = new WindowGeometry({ read: async()=>({ origin:{...origin},size:{...size},scale:2 }), setSize:async next=>{size={width:next.width*2,height:next.height*2};},setPosition:async next=>{origin={...next};} });
    const idle = compactLayout(artwork,1,false);
    await geometry.apply(idle, false);
    expect(size).toEqual({width:430,height:456});
    const anchor = { x:origin.x+idle.anchor.x*2, y:origin.y+idle.anchor.y*2 };
    const panel: PetLayout = { width:1100,height:760,anchor:{x:550,y:740},artwork:{width:207,height:220} };
    await geometry.apply(panel,true);
    await geometry.apply(idle,false);
    expect({x:origin.x+idle.anchor.x*2,y:origin.y+idle.anchor.y*2}).toEqual(anchor);
  });
});
