// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createApp, h, nextTick, ref } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import PetArtwork from './PetArtwork.vue';
const stylesheet=readFileSync(`${import.meta.dirname}/../style.css`,'utf8');

const apps: ReturnType<typeof createApp>[]=[];
afterEach(()=>{apps.splice(0).forEach(app=>app.unmount());document.body.replaceChildren();document.querySelectorAll('style[data-pet-test]').forEach(style=>style.remove());});
function nativeStyles(width:number,height:number){
  const source=document.createElement('style');source.dataset.petTest='';source.textContent=stylesheet;document.head.append(source);
  // jsdom does not evaluate media queries; activate matching CSSOM rules for the native viewport.
  const rules=[...source.sheet!.cssRules].flatMap(rule=>{
    if(rule.type!==CSSRule.MEDIA_RULE)return [rule.cssText];
    const media=rule as CSSMediaRule;
    const matches=[...media.conditionText.matchAll(/\((max|min)-(width|height):\s*(\d+)px\)/g)].every(([,bound,axis,value])=>bound==='max'?(axis==='width'?width:height)<=Number(value):(axis==='width'?width:height)>=Number(value));
    return matches?[...media.cssRules].map(child=>child.cssText):[];
  });
  source.textContent=rules.join('\n');
}
it('keeps the SVG fitted to its visible artwork at the native compact window height',async()=>{
  nativeStyles(278,294);
  const root=document.createElement('div');root.className='pet-avatar';document.body.append(root);
  const app=createApp({setup:()=>()=>h(PetArtwork,{name:'Fixture',emotion:'平静',scale:1.3})});apps.push(app);app.mount(root);await nextTick();
  const art=root.querySelector<HTMLElement>('.pet-art')!;
  const svg=root.querySelector<SVGElement>('svg')!;
  expect(art.style.width).toBe('270px');expect(art.style.height).toBe('286px');
  const style=getComputedStyle(svg);
  expect(style.width).toBe('100%');
  expect(['','none']).toContain(style.maxHeight);
});
it('ignores a detached image error after the character image changes',async()=>{
  const avatar=ref('old-avatar');const broken=vi.fn();const root=document.createElement('div');document.body.append(root);
  const app=createApp({setup:()=>()=>h(PetArtwork,{avatar:avatar.value,name:'Fixture',emotion:'平静',scale:1,onBroken:broken})});apps.push(app);app.mount(root);await nextTick();
  const previous=root.querySelector('img')!;avatar.value='new-avatar';await nextTick();
  previous.dispatchEvent(new Event('error'));
  expect(broken).not.toHaveBeenCalled();expect(root.querySelector('img')!.getAttribute('src')).toBe('new-avatar');
});
