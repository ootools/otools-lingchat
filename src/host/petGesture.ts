export interface PetPointer { x:number; y:number; id:number; button:number }
export interface GesturePort { pet(): void; drag(): Promise<void>; held(value:boolean): void; error(error:unknown): void }
export class PetGesture {
  private press?: { point:PetPointer; moved:boolean; generation:number };
  private generation=0;
  constructor(private port:GesturePort) {}
  down(point:PetPointer):boolean {
    if (point.button!==0 || this.press) return false;
    this.press={point:{...point},moved:false,generation:++this.generation}; this.port.held(true); return true;
  }
  move(point:PetPointer):void {
    const press=this.press;
    if (!press || point.id!==press.point.id || press.moved || Math.hypot(point.x-press.point.x,point.y-press.point.y)<5) return;
    press.moved=true;
    void this.port.drag().catch(error=>{
      if (this.press===press && press.generation===this.generation) this.cancel();
      this.port.error(error);
    });
  }
  up(id:number):void {
    if (!this.press || id!==this.press.point.id) return;
    const pet=!this.press.moved; this.cancel(); if (pet) this.port.pet();
  }
  cancel():void { this.press=undefined; this.generation++; this.port.held(false); }
}
