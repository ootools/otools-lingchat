export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface PetLayout { width: number; height: number; anchor: Point; artwork: { width: number; height: number } }
export const PET_ARTWORK: Rect = { x:35, y:28, width:270, height:287 };
export const PANEL_LAYOUT: PetLayout = { width:1100, height:760, anchor:{x:550,y:740}, artwork:{width:0,height:0} };

export function alphaBounds(data: Uint8ClampedArray, width: number, height: number): Rect | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= 16) continue;
    left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y);
  }
  return right < left ? null : { x:left,y:top,width:right-left+1,height:bottom-top+1 };
}
export function compactLayout(bounds: Rect, scale: number, notice: boolean): PetLayout {
  if (![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) bounds = PET_ARTWORK;
  const factor = Math.min(1.3,Math.max(0.7,Number.isFinite(scale) ? scale : 1));
  const ratio = 220 * factor / Math.max(bounds.width,bounds.height);
  const artwork = { width:Math.ceil(bounds.width * ratio), height:Math.ceil(bounds.height * ratio) };
  const width = Math.max(artwork.width + 8,notice ? 280 : 0);
  const height = artwork.height + 8 + (notice ? 110 : 0);
  return { width,height,anchor:{x:width/2,y:height-4},artwork };
}
export function moveToAnchor(origin: Point, before: Point, after: Point, scale: number): Point {
  return { x:Math.round(origin.x+(before.x-after.x)*scale),y:Math.round(origin.y+(before.y-after.y)*scale) };
}
export interface GeometryPort {
  read(): Promise<{ origin: Point; size: {width:number;height:number}; scale:number }>;
  setSize(size: {width:number;height:number}): Promise<void>;
  setPosition(position: Point): Promise<void>;
}
export class WindowGeometry {
  private previous?: PetLayout;
  private anchor?: Point;
  private observed?: Point;
  private pending: Promise<void> = Promise.resolve();
  constructor(private port: GeometryPort) {}
  apply(layout: PetLayout, _expanded: boolean, isCurrent:()=>boolean=()=>true): Promise<void> {
    const next = { ...layout,anchor:{...layout.anchor},artwork:{...layout.artwork} };
    this.pending = this.pending.catch(() => {}).then(async () => {
      if(!isCurrent())return;
      let state = await this.port.read();
      if(!isCurrent())return;
      const validate=()=>{
        if (![state.origin.x,state.origin.y,state.size.width,state.size.height,state.scale,next.width,next.height,next.anchor.x,next.anchor.y].every(Number.isFinite) || state.scale <= 0 || state.size.width <= 0 || state.size.height <= 0 || next.width <= 0 || next.height <= 0) throw new Error('Invalid window geometry');
      };
      validate();
      const offset=(value:PetLayout)=>({x:value.anchor.x*state.size.width/value.width,y:value.anchor.y*state.size.height/value.height});
      const before=this.previous?offset(this.previous):{x:state.size.width/2,y:state.size.height-4*state.scale};
      const observed={x:state.origin.x+before.x,y:state.origin.y+before.y};
      // Keep subpixel anchor precision, while still following external window moves.
      this.anchor=this.anchor&&this.observed
        ? {x:this.anchor.x+observed.x-this.observed.x,y:this.anchor.y+observed.y-this.observed.y}
        : observed;
      this.observed=observed;
      const actual = { width:state.size.width/state.scale,height:state.size.height/state.scale };
      if (Math.abs(actual.width-next.width) >= 0.5 || Math.abs(actual.height-next.height) >= 0.5) {
        await this.port.setSize(next);
        state=await this.port.read();validate();
      }
      const after=offset(next);
      this.previous=next;
      this.observed={x:state.origin.x+after.x,y:state.origin.y+after.y};
      if(!isCurrent())return;
      const position={x:Math.round(this.anchor.x-after.x),y:Math.round(this.anchor.y-after.y)};
      if (position.x !== state.origin.x || position.y !== state.origin.y) await this.port.setPosition(position);
      this.observed={x:position.x+after.x,y:position.y+after.y};
    });
    return this.pending;
  }
}
