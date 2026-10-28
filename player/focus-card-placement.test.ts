import {describe,expect,it} from 'vitest'
import {cardOverlapArea,placeCardOutsideFocus} from './focus-card-placement'
const rect=(left:number,top:number,width:number,height:number)=>({left,top,right:left+width,bottom:top+height})
const box=(p:{left:number;top:number},card:ReturnType<typeof rect>)=>rect(p.left,p.top,card.right-card.left,card.bottom-card.top)
describe('authored focus areas stay outside the actual card',()=>{
 it('moves a large centered card clear of several areas and the red arrow shaft',()=>{const card=rect(340,280,600,330),areas=[rect(10,540,180,30),rect(10,570,180,30),rect(435,330,264,110),rect(392,375,43,20)],p=placeCardOutsideFocus(card,{width:1280,height:900},areas,[rect(0,540,200,40)])!;expect(p).not.toBeNull();for(const area of areas)expect(cardOverlapArea(box(p,card),area)).toBe(0);expect(cardOverlapArea(box(p,card),rect(0,540,200,40))).toBe(0)})
 it('considers arrow extents even when the yellow focus rectangle itself was already clear',()=>{const card=rect(100,100,200,120),area=rect(320,120,50,60),arrow=rect(278,138,42,24),p=placeCardOutsideFocus(card,{width:800,height:600},[area,arrow])!;expect(p).not.toBeNull();expect(cardOverlapArea(box(p,card),arrow)).toBe(0);expect(cardOverlapArea(box(p,card),area)).toBe(0)})
 it('leaves legacy placement byte-for-byte unchanged without authored focus areas',()=>{expect(placeCardOutsideFocus(rect(100,100,200,120),{width:800,height:600},[],[rect(50,50,400,400)])).toBeNull()})
 it('keeps an already clear placement stable as geometry updates',()=>{expect(placeCardOutsideFocus(rect(400,300,200,120),{width:800,height:600},[rect(100,100,50,50)])).toBeNull()})
 it('keeps all edges inside a narrow viewport and protects the real interaction target',()=>{const card=rect(250,180,320,260),area=rect(250,180,240,100),primary=rect(12,12,160,170),p=placeCardOutsideFocus(card,{width:640,height:680},[area],[primary])!,b=box(p,card);expect(b.left).toBeGreaterThanOrEqual(12);expect(b.top).toBeGreaterThanOrEqual(12);expect(b.right).toBeLessThanOrEqual(628);expect(b.bottom).toBeLessThanOrEqual(668);expect(cardOverlapArea(b,area)).toBe(0);expect(cardOverlapArea(b,primary)).toBe(0)})
 it('uses the least covered on-screen fallback when every placement intersects authored focus',()=>{const card=rect(180,120,250,200),areas=[rect(0,0,800,600),rect(150,100,300,300)],p=placeCardOutsideFocus(card,{width:800,height:600},areas)!;expect(p).not.toBeNull();const b=box(p,card);expect(cardOverlapArea(b,areas[1])).toBe(0);expect(cardOverlapArea(b,areas[0])).toBe(50000)})
})

