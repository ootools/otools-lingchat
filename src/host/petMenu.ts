import type { Point } from './petGeometry';
export type PetCommand='chat'|'saves'|'characters'|'story'|'memory'|'connections'|'settings'|'model'|'agent'|'pet'|'notice'|'topmost'|'stop'|'stopObservation'|'close';
export type MenuEntry={id:PetCommand;text:string;enabled:boolean;checked?:boolean}|{item:'Separator'};
export function petMenuEntries(t:(key:string)=>string,state:{topmost:boolean;busy:boolean;observing:boolean;ready:boolean;notice:boolean}):MenuEntry[]{
  const open=(id:PetCommand,key=id):MenuEntry=>({id,text:t(key),enabled:state.ready});
  return [
    open('chat'),open('saves'),open('characters'),open('story'),open('memory'),open('connections'),open('settings'),open('model'),open('agent'),
    {item:'Separator'},open('pet'),{id:'notice',text:t('notice'),enabled:state.notice},
    {id:'topmost',text:t('topmost'),enabled:state.ready,checked:state.topmost},
    {id:'stop',text:t('stop'),enabled:state.busy},{id:'stopObservation',text:t('stopObservation'),enabled:state.observing},
    {item:'Separator'},{id:'close',text:t('close'),enabled:true},
  ];
}
export interface MenuHandle { popup(point:Point):Promise<void>; close():Promise<void> }
export interface MenuPort { create(items:MenuEntry[],select:(id:PetCommand)=>void):Promise<MenuHandle>;select(id:PetCommand):void;held(value:boolean):void;error(error:unknown):void }
export class PetMenu {
  private current?:MenuHandle;
  private sequence=0;
  private disposed=false;
  constructor(private port:MenuPort) {}
  async open(items:MenuEntry[],point:Point):Promise<void>{
    if(this.disposed)return;
    const sequence=++this.sequence; const previous=this.current; this.current=undefined;
    this.port.held(true);
    try{
      await previous?.close();
      const menu=await this.port.create(items,id=>{if(!this.disposed && sequence===this.sequence)this.port.select(id);});
      if(this.disposed || sequence!==this.sequence){await menu.close();return;}
      this.current=menu; await menu.popup(point);
    }catch(error){if(!this.disposed)this.port.error(error);}
    finally{if(sequence===this.sequence)this.port.held(false);}
  }
  async dispose():Promise<void>{this.disposed=true;this.sequence++;const menu=this.current;this.current=undefined;this.port.held(false);await menu?.close();}
}
