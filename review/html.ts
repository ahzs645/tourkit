import { parseReviewBundle, type ReviewFeedbackBundle } from "./model";

/**
 * The self-contained HTML a reviewer sends back: a static page that shows
 * each captured page with its pins, notes and drawings and lists every item,
 * with the whole bundle embedded as JSON. Opening it again (in the share page
 * or the builder) reads that JSON back; its "Continue this review" button
 * opens the shared form and hands the bundle over with postMessage, so the
 * reviewer can add to the same round or start the next one.
 */

export const REVIEW_HTML_DATA_ID = "tourkit-review-feedback";
/** Data ids of review pages written before the kit was published as Tourkit. Still read. */
export const LEGACY_REVIEW_HTML_DATA_IDS = ["webforms-review-feedback"] as const;
export const REVIEW_HTML_DATA_IDS: readonly string[] = [REVIEW_HTML_DATA_ID, ...LEGACY_REVIEW_HTML_DATA_IDS];
/** Hash parameter that asks the share page to accept a bundle from the page that opened it. */
export const REVIEW_HANDOFF_PARAM = "review";
export const REVIEW_HANDOFF_VALUE = "continue";
/** `#review=start`: a review link; the share page opens in feedback mode. */
export const REVIEW_START_VALUE = "start";
export const REVIEW_MESSAGE_READY = "tourkit-review-ready";
export const REVIEW_MESSAGE_BUNDLE = "tourkit-review-bundle";
/** The handoff messages of review pages written before the rename; their embedded script still uses them. */
export const LEGACY_REVIEW_MESSAGE_READY = "webforms-review-ready";
export const LEGACY_REVIEW_MESSAGE_BUNDLE = "webforms-review-bundle";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** A link that opens `url` in review mode (`#…&review=start`); relative links resolve against `origin`. */
export function reviewStartUrl(url: string, origin?: string): string {
  const absolute = new URL(url, origin ?? "http://localhost");
  if (!/^https?:$/.test(absolute.protocol)) throw new Error("A review link must use HTTP or HTTPS.");
  const hash = new URLSearchParams(absolute.hash.replace(/^#/, ""));
  hash.set(REVIEW_HANDOFF_PARAM, REVIEW_START_VALUE);
  absolute.hash = hash.toString();
  return absolute.toString();
}

/** The share URL with the handoff flag in its hash. */
export function reviewHandoffUrl(shareUrl: string): string {
  const url = new URL(shareUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("A review link must use HTTP or HTTPS.");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.set(REVIEW_HANDOFF_PARAM, REVIEW_HANDOFF_VALUE);
  url.hash = hash.toString();
  return url.toString();
}

export function reviewFeedbackHtml(bundle: ReviewFeedbackBundle): string {
  const title = `Review feedback · ${bundle.form.name || "Untitled review"}`;
  let continueUrl: string | null = null;
  try { continueUrl = bundle.form.shareUrl ? reviewHandoffUrl(bundle.form.shareUrl) : null; } catch { /* The review file still works without an executable link. */ }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Tutorial Kit review feedback v${bundle.version}">
<title>${escapeHtml(title)}</title>
<style>${VIEWER_CSS}</style></head>
<body><header><div><h1>${escapeHtml(bundle.form.name || "Untitled review")}</h1><p id="summary"></p></div>
<div class="actions">${continueUrl ? `<button type="button" id="continue" data-url="${escapeHtml(continueUrl)}">Continue this review</button>` : ""}<button type="button" id="print">Print / PDF</button></div></header>
<p class="hint">This file holds the review. Open it again with <b>Continue this review</b>, or open it in the review tools to bring the comments back onto the reviewed page.</p>
<main id="pages"></main><section><h2>All feedback</h2><ol id="items"></ol></section>
<noscript>Enable JavaScript to see the pages. The feedback is embedded in this file.</noscript>
<script id="${REVIEW_HTML_DATA_ID}" type="application/json">${safeJson(bundle)}</script>
<script>${VIEWER_JS}</script></body></html>`;
}

/** The bundle embedded in a review HTML file, or null when the text is not one. */
export function extractReviewBundleFromHtml(html: string): ReviewFeedbackBundle | null {
  const match = REVIEW_HTML_DATA_IDS.map((id) => html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))).find(Boolean);
  if (!match) return null;
  return parseReviewBundle(JSON.parse(match[1]));
}

const VIEWER_CSS = `
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2e;--ink:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;max-width:1200px;margin:auto}
header{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}h1{font-size:20px;margin:0}h2{font-size:16px;margin:24px 0 8px}h3{font-size:14px;margin:0 0 8px}
#summary,.hint,.meta{color:var(--muted)}.hint{font-size:13px}.actions{display:flex;gap:8px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 12px;cursor:pointer}#continue{background:var(--accent);border-color:var(--accent);color:#fff}
.page{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:12px 0;break-inside:avoid}
.shot{position:relative;width:100%;overflow:hidden;border:1px solid var(--line);border-radius:6px;background:#fff}.shot img{display:block;width:100%;height:auto}.shot svg{position:absolute;inset:0;width:100%;height:100%}
ol{padding-left:0;list-style:none}li.item{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;break-inside:avoid}
.num{display:inline-flex;min-width:28px;height:22px;align-items:center;justify-content:center;border-radius:999px;color:#fff;font-weight:600;font-size:12px;margin-right:8px;padding:0 6px}
.text{white-space:pre-wrap;margin:6px 0 0}.pic{display:block;max-width:100%;max-height:420px;margin:8px 0 0;border:1px solid var(--line);border-radius:6px}.reply{border-left:3px solid var(--line);padding-left:8px;margin:6px 0 0}.badge{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-left:6px}
@media print{.actions,.hint{display:none}body{padding:0}}`;

// Plain DOM so the file needs nothing else; every string from the bundle goes in as text.
const VIEWER_JS = `
(function(){
var b=JSON.parse(document.getElementById(${JSON.stringify(REVIEW_HTML_DATA_ID)}).textContent);
function el(t,c,txt){var e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e}
function who(p){if(!p)return"Anonymous";var s=[p.name,p.role].filter(function(x){return x&&x.trim()}).join(", ");return s||"Anonymous"}
var items=b.items.filter(function(i){return!i.deleted}).sort(function(a,c){return a.round-c.round||(a.createdAt<c.createdAt?-1:1)});
var nums={},cnt={};items.forEach(function(i){cnt[i.round]=(cnt[i.round]||0)+1;nums[i.id]=i.round+"."+cnt[i.round]});
var open=items.filter(function(i){return i.status!=="resolved"}).length;
document.getElementById("summary").textContent=b.rounds.length+" round"+(b.rounds.length===1?"":"s")+" · "+items.length+" item"+(items.length===1?"":"s")+" · "+open+" open · "+b.rounds.map(function(r){return"Round "+r.number+": "+who(r.reviewer)}).join(" · ");
var NS="http://www.w3.org/2000/svg";
function svg(t,a){var e=document.createElementNS(NS,t);for(var k in a)e.setAttribute(k,a[k]);return e}
function path(pts){if(!pts||!pts.length)return"";var d="M"+pts[0][0]+" "+pts[0][1];for(var i=1;i<pts.length;i++){var p=pts[i-1],q=pts[i];d+=" Q"+p[0]+" "+p[1]+" "+(p[0]+q[0])/2+" "+(p[1]+q[1])/2}return d}
var pages=document.getElementById("pages");
b.snapshots.slice().sort(function(a,c){return a.round-c.round}).forEach(function(s){
  var box=el("div","page");box.appendChild(el("h3",null,s.page+" · round "+s.round));
  var shot=el("div","shot");var img=el("img");img.src=s.image;img.alt=s.page;shot.appendChild(img);
  var g=svg("svg",{viewBox:"0 0 "+s.width+" "+s.height,preserveAspectRatio:"none"});
  items.forEach(function(i){var o=s.placements[i.id];if(!o)return;var x=o[0]+i.anchor.dx,y=o[1]+i.anchor.dy;
    if(i.kind==="drawing"){g.appendChild(svg("path",{d:path((i.points||[]).map(function(p){return[x+p[0],y+p[1]]})),fill:"none",stroke:i.color,"stroke-width":3,"stroke-linecap":"round","stroke-linejoin":"round"}));}
    else if(i.kind==="sticky"){var fo=svg("foreignObject",{x:x,y:y,width:160,height:72});var note=document.createElementNS("http://www.w3.org/1999/xhtml","div");note.setAttribute("style","box-sizing:border-box;width:160px;height:72px;overflow:hidden;background:#fde68a;border:1px solid #ca8a04;border-radius:4px;padding:4px 6px;font:11px/1.3 system-ui,sans-serif;color:#422006");note.textContent=nums[i.id]+" "+i.text;fo.appendChild(note);g.appendChild(fo);}
    if(i.kind!=="sticky"){g.appendChild(svg("circle",{cx:x,cy:y,r:11,fill:i.color,stroke:"#fff","stroke-width":2}));var n=svg("text",{x:x,y:y+4,"text-anchor":"middle","font-size":10,"font-weight":700,fill:"#fff"});n.textContent=nums[i.id];g.appendChild(n);}
  });
  shot.appendChild(g);box.appendChild(shot);pages.appendChild(box);
});
var list=document.getElementById("items");
items.forEach(function(i){var li=el("li","item");var head=el("div");var n=el("span","num",nums[i.id]);n.style.background=i.color;head.appendChild(n);
  head.appendChild(el("b",null,i.anchor.fieldLabel||i.page));head.appendChild(el("span","badge",i.kind));head.appendChild(el("span","badge",i.status));li.appendChild(head);
  li.appendChild(el("div","meta",i.page+" · "+who(i.author)+" · "+new Date(i.createdAt).toLocaleString()));
  if(i.text)li.appendChild(el("p","text",i.text));
  (i.attachments||[]).forEach(function(a){var im=el("img","pic");im.src=a.image;im.alt=a.name;li.appendChild(im)});
  (i.replies||[]).forEach(function(r){var d=el("div","reply");d.appendChild(el("div","meta",who(r.author)+" · round "+r.round));d.appendChild(el("div","text",r.text));li.appendChild(d)});
  list.appendChild(li)});
document.getElementById("print").onclick=function(){window.print()};
var c=document.getElementById("continue");
if(c)c.onclick=function(){var url=c.getAttribute("data-url");var origin=new URL(url).origin;var w=window.open(url,"_blank");if(!w){alert("Allow pop-ups to continue, or open the share link and choose Open feedback file.");return}
  window.addEventListener("message",function(e){if(e.source===w&&e.origin===origin&&e.data&&e.data.type===${JSON.stringify(REVIEW_MESSAGE_READY)})w.postMessage({type:${JSON.stringify(REVIEW_MESSAGE_BUNDLE)},bundle:b},origin)})};
})();`;

