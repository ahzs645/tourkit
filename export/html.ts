import { documentStepTitle, stepParagraphs, type TutorialDocument, type TutorialDocumentStep } from "./document";

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const styles = `
:root{color-scheme:light;font:17px/1.65 system-ui,-apple-system,Segoe UI,sans-serif;color:#172238;background:#f3f6fa}
*{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:auto;padding:48px 32px}
header{border-bottom:4px solid #2563eb;padding-bottom:24px;margin-bottom:32px}
h1{font-size:2.3rem;line-height:1.15;overflow-wrap:anywhere}h2{font-size:1.6rem;line-height:1.3}h3{font-size:1.2rem;line-height:1.4}
p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#174cb6}nav ol{padding-left:24px}
figure{margin:20px 0;break-inside:avoid}figure img{display:block;width:100%;height:auto;border:1px solid #dbe3ef;border-radius:6px}figcaption{color:#516077;font-size:.85rem;margin-top:6px;overflow-wrap:anywhere}
article{background:white;border:1px solid #dbe3ef;border-radius:12px;padding:20px 28px;margin:20px 0;break-inside:avoid}
.meta{color:#516077;font-size:.9rem}.chapter{margin-top:40px}.number{color:#2563eb}
.explanation{border-left:4px solid #2563eb;background:#eff6ff}.explanation[data-kind="warning"]{border-left-color:#b45309;background:#fffbeb}
.explanation[data-kind="tip"]{border-left-color:#047857;background:#ecfdf5}
.controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:24px}
button{font:inherit;padding:8px 22px;border:1px solid #174cb6;border-radius:8px;background:white;color:#174cb6;cursor:pointer}
button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible{outline:3px solid #2563eb;outline-offset:3px}
[hidden]{display:none!important}@media(max-width:600px){main{padding:24px 16px}article{padding:16px}}
@media print{:root{background:white;font-size:11pt}main{max-width:none;padding:0}.controls,nav{display:none}article{border:0;padding:0}h2,h3{break-after:avoid}}
`;

function stepHtml(step: TutorialDocumentStep): string {
  const image = step.screenshot;
  const figure = image ? `<figure><img src="${escapeHtml(image.dataUrl)}" width="${image.width}" height="${image.height}" alt="${escapeHtml(image.alt)}"><figcaption>${escapeHtml(image.caption ?? image.alt)}</figcaption></figure>` : "";
  const explanation = step.contentKind && step.contentKind !== "action";
  return `<article id="step-${step.number}"${explanation ? ` class="explanation" data-kind="${step.contentKind}"` : ""}${step.pageBreakBefore ? ' style="break-before:page"' : ""}><h3>${escapeHtml(documentStepTitle(step))}</h3>${stepParagraphs(step).map((text) => `<p>${escapeHtml(text)}</p>`).join("")}${figure}</article>`;
}

/** No network assets, application URLs, arbitrary markup, or script in a static guide. */
export function tutorialHtml(doc: TutorialDocument, course = false): string {
  const chapters = doc.chapters.map((chapter, index) => `<section class="chapter" id="chapter-${index + 1}"><h2>${escapeHtml(chapter.title)}</h2>${chapter.description ? `<p>${escapeHtml(chapter.description)}</p>` : ""}${chapter.steps.map(stepHtml).join("")}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title)}</title><style>${styles}</style></head><body><main>
<header><p class="meta">Tutorial · ${doc.estimatedMinutes} minutes</p><h1>${escapeHtml(doc.title)}</h1><p>${escapeHtml(doc.description)}</p></header>
${course ? "" : `<nav aria-label="Contents"><h2>Contents</h2><ol>${doc.chapters.map((chapter, index) => `<li><a href="#chapter-${index + 1}">${escapeHtml(chapter.title)}</a></li>`).join("")}</ol></nav>`}
${chapters}
${course ? `<div class="controls"><button id="back" type="button">Back</button><span id="progress" role="status"></span><button id="next" type="button">Next</button></div><p id="tracking" class="meta" role="status"></p><noscript>Enable JavaScript for course navigation and LMS completion tracking. All instructions are shown above.</noscript><script>${SCORM_PLAYER}</script>` : ""}
</main></body></html>`;
}

/** SCORM 1.2 single-SCO reading course. No score: completion means reading every step then Finish. */
export const SCORM_PLAYER = `
(function () {
  var steps = Array.from(document.querySelectorAll('article'));
  var chapters = Array.from(document.querySelectorAll('.chapter'));
  var back = document.getElementById('back'), next = document.getElementById('next');
  var progress = document.getElementById('progress'), tracking = document.getElementById('tracking');
  var api = null, active = false, finished = false, completed = false, started = Date.now(), index = 0, seen = [];
  function find(start) {
    var current = start;
    for (var n = 0; current && n < 20; n++) {
      try { if (current.API) return current.API; if (current.parent === current) break; current = current.parent; }
      catch (_) { break; }
    }
    return null;
  }
  function call(method, key, value) {
    try { return value === undefined ? api[method](key) : api[method](key, value); }
    catch (_) { tracking.textContent = 'LMS tracking is unavailable. You can continue reading.'; return ''; }
  }
  function set(key, value) {
    if (active && String(call('LMSSetValue', key, value)) !== 'true') tracking.textContent = 'The LMS could not save progress.';
  }
  function time() {
    var cs = Math.min(3599999999, Math.max(0, Math.floor((Date.now() - started) / 10)));
    function pad(n, width) { return String(n).padStart(width, '0'); }
    return pad(Math.floor(cs / 360000), 4) + ':' + pad(Math.floor(cs / 6000) % 60, 2) + ':' + pad(Math.floor(cs / 100) % 60, 2) + '.' + pad(cs % 100, 2);
  }
  function save() {
    if (!active) return;
    set('cmi.core.lesson_location', String(index));
    set('cmi.suspend_data', seen.map(function (v) { return v ? '1' : '0'; }).join(''));
    set('cmi.core.session_time', time());
    if (String(call('LMSCommit', '')) !== 'true') tracking.textContent = 'The LMS could not save progress.';
  }
  function render() {
    seen[index] = true;
    steps.forEach(function (step, n) { step.hidden = n !== index; });
    chapters.forEach(function (chapter) { chapter.hidden = !chapter.contains(steps[index]); });
    back.disabled = index === 0;
    next.disabled = false;
    next.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    progress.textContent = 'Step ' + (index + 1) + ' of ' + steps.length;
    save();
  }
  function init() {
    finished = false; started = Date.now();
    api = find(window);
    if (!api) { try { api = find(window.opener); } catch (_) {} }
    active = !!api && String(call('LMSInitialize', '')) === 'true';
    tracking.textContent = active ? 'Progress is saved to your LMS.' : 'Reading offline — LMS tracking is unavailable.';
    if (active) {
      var status = call('LMSGetValue', 'cmi.core.lesson_status');
      completed = status === 'completed' || status === 'passed';
      if (!completed) set('cmi.core.lesson_status', 'incomplete');
      var saved = Number(call('LMSGetValue', 'cmi.core.lesson_location'));
      if (Number.isInteger(saved) && saved >= 0 && saved < steps.length) index = saved;
      var data = String(call('LMSGetValue', 'cmi.suspend_data'));
      seen = steps.map(function (_, n) { return data[n] === '1'; });
    }
    render();
  }
  function focusStep() { var heading = steps[index].querySelector('h3'); heading.tabIndex = -1; heading.focus(); }
  back.onclick = function () { if (index > 0) { index--; render(); focusStep(); } };
  next.onclick = function () {
    if (index < steps.length - 1) { index++; render(); focusStep(); return; }
    var missing = steps.findIndex(function (_, n) { return !seen[n]; });
    if (missing !== -1) { index = missing; render(); focusStep(); return; }
    completed = true; set('cmi.core.lesson_status', 'completed'); set('cmi.core.exit', ''); save();
    progress.textContent = 'Course complete'; next.disabled = true;
  };
  function finish() {
    if (finished || !active) return;
    set('cmi.core.exit', completed ? '' : 'suspend'); save(); call('LMSFinish', ''); active = false; finished = true;
  }
  window.addEventListener('pagehide', finish);
  window.addEventListener('beforeunload', finish);
  window.addEventListener('pageshow', function (event) { if (event.persisted) init(); });
  init();
})();`;

export function scormManifest(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="tourkit_tutorial" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
<metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
<organizations default="course"><organization identifier="course"><title>${escapeHtml(title)}</title><item identifier="lesson" identifierref="content"><title>${escapeHtml(title)}</title></item></organization></organizations>
<resources><resource identifier="content" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource></resources></manifest>`;
}

export async function tutorialScorm(doc: TutorialDocument): Promise<Blob> {
  if (doc.chapters.reduce((n, c) => n + c.steps.length, 0) > 4096) throw new Error("SCORM 1.2 supports at most 4,096 steps in this exporter.");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("imsmanifest.xml", scormManifest(doc.title));
  zip.file("index.html", tutorialHtml(doc, true));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

