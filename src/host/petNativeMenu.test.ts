// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createPetNativeMenu } from './petNativeMenu';
import type { PetCommand } from './petMenu';

afterEach(()=>Reflect.deleteProperty(window,'__TAURI_INTERNALS__'));
function native(){
  const requests:{command:string;payload:any}[]=[];
  const callbacks=new Map<number,(message:unknown)=>void>();let next=0;
  const metadata={currentWindow:{label:'lingchat-first'}};
  Object.assign(window,{__TAURI_INTERNALS__:{metadata,transformCallback:(callback:(message:unknown)=>void)=>{const id=++next;callbacks.set(id,callback);return id;},unregisterCallback:(id:number)=>callbacks.delete(id),invoke:async(command:string,payload:any)=>{
    const data=JSON.parse(JSON.stringify(payload));requests.push({command,payload:data});
    if(command==='plugin:menu|new')return[requests.length,data.options.id??`generated-${requests.length}`];
  }}});
  return{requests,metadata,callbacks};
}
it('uses stable owner-scoped native IDs without colliding with another window or changing command IDs',async()=>{
  const f=native();const selected:PetCommand[]=[];const entries=[{id:'chat' as const,text:'Chat',enabled:true}];
  const first=await createPetNativeMenu(entries,id=>selected.push(id));
  await first.close();
  const second=await createPetNativeMenu(entries,id=>selected.push(id));
  f.metadata.currentWindow.label='lingchat-second';
  const other=await createPetNativeMenu(entries,id=>selected.push(id));
  const created=f.requests.filter(request=>request.command==='plugin:menu|new').map(request=>request.payload.options);
  expect(created[0].id).toBeTruthy();expect(created[1].id).toBe(created[0].id);expect(created[2].id).not.toBe(created[0].id);
  expect(created[0].items[0].id).not.toBe('chat');expect(created[2].items[0].id).not.toBe(created[0].items[0].id);
  expect(entries).toEqual([{id:'chat',text:'Chat',enabled:true}]);
  const channel=Number(created[1].items[0].handler.split(':')[1]);
  f.callbacks.get(channel)!({index:0,message:created[1].items[0].id});expect(selected).toEqual(['chat']);
  await second.close();await other.close();
});
it('stops forwarding native actions after close and closes the menu resource only once',async()=>{
  const f=native();const selected:PetCommand[]=[];
  const menu=await createPetNativeMenu([{id:'chat',text:'Chat',enabled:true}],id=>selected.push(id));
  const item=f.requests.find(request=>request.command==='plugin:menu|new')!.payload.options.items[0];
  const callback=f.callbacks.get(Number(item.handler.split(':')[1]))!;
  await menu.close();await menu.close();callback({index:0,message:item.id});
  expect(selected).toEqual([]);expect(f.requests.filter(request=>request.command==='plugin:resources|close')).toHaveLength(1);
});
