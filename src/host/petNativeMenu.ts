import type { MenuEntry, MenuHandle, PetCommand } from './petMenu';
import { LogicalPosition, getCurrentWindow } from '@tauri-apps/api/window';

export async function createPetNativeMenu(entries:MenuEntry[],select:(id:PetCommand)=>void):Promise<MenuHandle>{
  const { Menu }=await import('@tauri-apps/api/menu');
  const native=getCurrentWindow(); const id=`otools-lingchat:${encodeURIComponent(native.label)}:pet`;
  let closed=false; let closing:Promise<void>|undefined;
  const items=entries.map(entry=>'item'in entry?{item:entry.item}:{...entry,id:`${id}:${entry.id}`,action:()=>{if(!closed)select(entry.id);}});
  const menu=await Menu.new({id,items});
  return {
    popup:point=>closed?Promise.resolve():menu.popup(new LogicalPosition(point.x,point.y),native),
    close:()=>{if(!closing){closed=true;closing=menu.close();}return closing;},
  };
}
