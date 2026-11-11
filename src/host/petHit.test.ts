// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { contains, hitsPetContent, imageBounds } from './petHit';
afterEach(() => { document.body.innerHTML = ''; });
it('does not intercept the transparent avatar layout rectangle', () => {
  document.body.innerHTML = '<section class="pet-window"><button class="pet-avatar"><svg></svg></button></section>';
  const avatar = document.querySelector('.pet-avatar')!;
  avatar.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300 } as DOMRect);
  expect(hitsPetContent({ x: 10, y: 10 })).toBe(false);
  expect(contains({ x: 300, y: 10 }, avatar.getBoundingClientRect())).toBe(false);
});
it('returns visible image pixels in original coordinates instead of its transparent canvas size', () => {
  const image=document.createElement('img'); Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:8},naturalHeight:{value:6},currentSrc:{value:'fixture'}});
  const data=new Uint8ClampedArray(8*6*4); data[(1*8+2)*4+3]=255; data[(4*8+5)*4+3]=255;
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=(()=>({drawImage:()=>{},getImageData:()=>({data})})) as any;
  try { expect(imageBounds(image)).toEqual({x:2,y:1,width:4,height:4}); }
  finally { HTMLCanvasElement.prototype.getContext=original; }
});

it('accepts visible controls but ignores hidden toolbar geometry', () => {
  document.body.innerHTML = '<header data-pet-hit style="opacity:0;visibility:hidden"></header><form data-pet-hit></form>';
  document.querySelector('header')!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40 } as DOMRect);
  document.querySelector('form')!.getBoundingClientRect = () => ({ left: 0, top: 100, width: 100, height: 40 } as DOMRect);
  expect(hitsPetContent({ x: 20, y: 20 })).toBe(false);
  expect(hitsPetContent({ x: 20, y: 120 })).toBe(true);
});
