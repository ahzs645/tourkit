import type {CardRect} from './card-placement'
export function cardOverlapArea(a:CardRect,b:CardRect):number{return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))}
/** Preserve legacy placement unless an authored focus annotation would be covered. */
export function placeCardOutsideFocus(card:CardRect,viewport:{width:number;height:number},authored:readonly CardRect[],primary:readonly CardRect[]=[]):{left:number;top:number}|null{
 if(!authored.length||!authored.some(rect=>cardOverlapArea(card,rect)>0))return null
 const width=card.right-card.left,height=card.bottom-card.top,margin=12,maxLeft=Math.max(margin,viewport.width-width-margin),maxTop=Math.max(margin,viewport.height-height-margin)
 const clampX=(x:number)=>Math.max(margin,Math.min(maxLeft,x)),clampY=(y:number)=>Math.max(margin,Math.min(maxTop,y))
 // A free rectangle can be shifted until one edge meets a viewport/obstacle
 // edge. Search those edge intersections instead of only eight fixed spots.
 const xs=new Set([clampX(card.left),margin,maxLeft]),ys=new Set([clampY(card.top),margin,maxTop])
 for(const rect of [...authored,...primary]){xs.add(clampX(rect.left-width));xs.add(clampX(rect.right));ys.add(clampY(rect.top-height));ys.add(clampY(rect.bottom))}
 let best:{left:number;top:number;cost:number;distance:number}|null=null
 for(const left of xs)for(const top of ys){const box={left,top,right:left+width,bottom:top+height},cost=authored.reduce((sum,rect)=>sum+cardOverlapArea(box,rect),0)+1000*primary.reduce((sum,rect)=>sum+cardOverlapArea(box,rect),0),distance=(left-card.left)**2+(top-card.top)**2;if(!best||cost<best.cost||cost===best.cost&&distance<best.distance)best={left,top,cost,distance}}
 const currentCost=authored.reduce((sum,rect)=>sum+cardOverlapArea(card,rect),0)+1000*primary.reduce((sum,rect)=>sum+cardOverlapArea(card,rect),0)
 return best&&best.cost<currentCost?{left:best.left,top:best.top}:null
}

