import type { Point } from './petPointer';
import { alphaBounds, type Rect } from './petGeometry';

export function contains(point: Point, rect: { left: number; top: number; width: number; height: number }): boolean {
  return rect.width > 0 && rect.height > 0 && point.x >= rect.left && point.x < rect.left + rect.width
    && point.y >= rect.top && point.y < rect.top + rect.height;
}
const masks = new WeakMap<HTMLImageElement, { source: string; width: number; height: number; data: Uint8ClampedArray; bounds:Rect|null }>();
function imageMask(image:HTMLImageElement) {
  let mask=masks.get(image);
  if(mask && mask.source===image.currentSrc)return mask;
  const canvas=document.createElement('canvas');
  const ratio=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio)); canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return;
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const data=context.getImageData(0,0,canvas.width,canvas.height).data;
  mask={source:image.currentSrc,width:canvas.width,height:canvas.height,data,bounds:alphaBounds(data,canvas.width,canvas.height)};
  masks.set(image,mask);return mask;
}
export function imageBounds(image:HTMLImageElement):Rect|null {
  if(!image.complete || !image.naturalWidth || !image.naturalHeight)return null;
  try {
    const mask=imageMask(image);
    if(mask){const bounds=mask.bounds;return bounds?{x:bounds.x*image.naturalWidth/mask.width,y:bounds.y*image.naturalHeight/mask.height,width:bounds.width*image.naturalWidth/mask.width,height:bounds.height*image.naturalHeight/mask.height}:null;}
  }catch { /* An unreadable image keeps its normal dimensions and interactive fallback. */ }
  return {x:0,y:0,width:image.naturalWidth,height:image.naturalHeight};
}
function imageHit(image: HTMLImageElement, point: Point): boolean {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
  const box = image.getBoundingClientRect();
  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  const rect = { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
  if (!contains(point, rect)) return false;
  try {
    const mask=imageMask(image); if(!mask)return true;
    const x = Math.min(mask.width - 1, Math.floor((point.x - rect.left) / width * mask.width));
    const y = Math.min(mask.height - 1, Math.floor((point.y - rect.top) / height * mask.height));
    return mask.data[(y * mask.width + x) * 4 + 3] > 16;
  } catch { return true; }
}
function shapeHit(shape: SVGGeometryElement, point: Point): boolean {
  const matrix = shape.getScreenCTM();
  if (!matrix) return false;
  try {
    const local = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
    return shape.isPointInFill(local) || shape.isPointInStroke(local);
  } catch { return contains(point, shape.getBoundingClientRect()); }
}
/** Blank areas of the avatar's layout box never become native hit targets. */
export function hitsPetContent(point: Point): boolean {
  for (const element of document.querySelectorAll<HTMLElement>('[data-pet-hit]')) {
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none' || Number.parseFloat(style.opacity) < 0.1) continue;
    if (contains(point, element.getBoundingClientRect())) return true;
  }
  for (const shape of document.querySelectorAll<SVGGeometryElement>('.pet-window [data-pet-shape]')) {
    if (shapeHit(shape, point)) return true;
  }
  const image = document.querySelector<HTMLImageElement>('.pet-window .imported-avatar');
  return image ? imageHit(image, point) : false;
}
