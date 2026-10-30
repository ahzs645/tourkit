import { DEFAULT_BROWSER_CAPTURE_LIMITS, type BrowserCaptureAsset, type BrowserCaptureEvent, type JsonValue } from "./types";

/** Applied to an enclosing document before rrweb is constructed, and every rebuilt head. */
export const BROWSER_CAPTURE_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; object-src 'none'; frame-src about:; form-action 'none'; base-uri 'none'";

const rasterData = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
const fontData = /^data:(?:font\/(?:woff|woff2|ttf|otf)|application\/(?:font-woff|font-sfnt));base64,[A-Za-z0-9+/]+={0,2}$/i;
const networkAttributes = new Set(["src", "srcset", "href", "xlink:href", "action", "formaction", "poster", "data", "background", "ping", "cite", "codebase", "archive", "longdesc", "manifest"]);
type JsonObject = { [key: string]: JsonValue };
class ReplayAssets extends Map<string, string> {
  private remaining = DEFAULT_BROWSER_CAPTURE_LIMITS.maxBytes;
  override get(key: string): string | undefined {
    const resource = super.get(key);
    if (resource) {
      this.remaining -= resource.length;
      if (this.remaining < 0) throw new Error("Embedded assets expand beyond the replay size limit. Split this recording into smaller lessons.");
    }
    return resource;
  }
}
function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function allowedResource(raw: string, assets: Map<string, string>, font = false): string {
  const value = assets.get(raw) ?? raw;
  return rasterData.test(value) || (font && fontData.test(value)) ? value : "";
}

function decodeStylesheet(data: string | undefined): string | undefined {
  if (!data?.startsWith("data:text/css;base64,")) return undefined;
  try { return new TextDecoder().decode(Uint8Array.from(atob(data.slice(21)), (char) => char.charCodeAt(0))); } catch { return undefined; }
}

function cssEscape(input: string, start: number): { value: string; end: number } {
  let at = start + 1;
  let digits = "";
  while (at < input.length && digits.length < 6 && /[0-9a-f]/i.test(input[at]!)) digits += input[at++];
  if (digits) {
    if (/\s/.test(input[at] ?? "")) at++;
    const code = Number.parseInt(digits, 16);
    return { value: code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd", end: at };
  }
  return { value: input[at] ?? "", end: Math.min(input.length, at + 1) };
}

function decodeCss(input: string): string {
  let output = "";
  for (let at = 0; at < input.length;) {
    if (input[at] === "\\") { const escaped = cssEscape(input, at); output += escaped.value; at = escaped.end; }
    else output += input[at++];
  }
  return output;
}

function quotedEnd(input: string, start: number): number {
  const quote = input[start];
  for (let at = start + 1; at < input.length;) {
    if (input[at] === "\\") at = cssEscape(input, at).end;
    else if (input[at++] === quote) return at;
  }
  return input.length;
}

function functionEnd(input: string, start: number): number {
  let depth = 1;
  for (let at = start + 1; at < input.length;) {
    const char = input[at];
    if (char === "'" || char === '"') at = quotedEnd(input, at);
    else if (char === "\\") at = cssEscape(input, at).end;
    else {
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) return at;
      at++;
    }
  }
  return input.length;
}

/** CSS token-aware resource rewrite also handles escaped url identifiers and image-set strings. */
function safeCssTokens(input: string, assets: Map<string, string>, imageStrings = false, depth = 0): string {
  if (depth > 16) return "";
  let output = "";
  for (let at = 0; at < input.length;) {
    const char = input[at]!;
    if (input.startsWith("/*", at)) {
      const end = input.indexOf("*/", at + 2);
      at = end < 0 ? input.length : end + 2;
      output += " "; continue;
    }
    if (char === "'" || char === '"') {
      const end = quotedEnd(input, at);
      output += imageStrings ? `url("${allowedResource(decodeCss(input.slice(at + 1, end - 1)), assets, true)}")` : input.slice(at, end);
      at = end; continue;
    }
    const isAtRule = char === "@";
    if (isAtRule || /[a-zA-Z_\\-]/.test(char)) {
      const start = at;
      if (isAtRule) at++;
      let identifier = "";
      while (at < input.length) {
        if (input[at] === "\\") { const escaped = cssEscape(input, at); identifier += escaped.value; at = escaped.end; }
        else if (/[a-zA-Z0-9_-]/.test(input[at]!)) identifier += input[at++];
        else break;
      }
      let after = at;
      while (/\s/.test(input[after] ?? "")) after++;
      if (isAtRule && identifier.toLowerCase() === "import") {
        while (at < input.length && input[at] !== ";") {
          if (input[at] === "'" || input[at] === '"') at = quotedEnd(input, at);
          else if (input[at] === "(") at = Math.min(input.length, functionEnd(input, at) + 1);
          else at++;
        }
        if (input[at] === ";") at++;
        continue;
      }
      if (!isAtRule && input[after] === "(") {
        const end = functionEnd(input, after);
        const content = input.slice(after + 1, end);
        if (identifier.toLowerCase() === "url") {
          const trimmed = content.trim();
          const raw = (trimmed[0] === '"' || trimmed[0] === "'") ? trimmed.slice(1, -1) : trimmed;
          const url = decodeCss(raw);
          output += `url("${/^#[A-Za-z0-9_.:-]+$/.test(url) ? url : allowedResource(url, assets, true)}")`;
        } else {
          const stringsAreUrls = ["image-set", "-webkit-image-set", "image"].includes(identifier.toLowerCase());
          output += input.slice(start, after + 1) + safeCssTokens(content, assets, stringsAreUrls, depth + 1) + ")";
        }
        at = Math.min(input.length, end + 1); continue;
      }
      output += input.slice(start, at);
      continue;
    }
    output += char; at++;
  }
  return output;
}

function safeCss(css: string, assets: Map<string, string>, depth = 0, visited = new Set<string>()): string {
  // The CSP remains the security boundary, including escaped CSS tokens and image-set().
  // These rewrites preserve embedded resources and avoid noisy blocked requests.
  const inlined = css.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')\s*([^;{}]*);/gi,
    (_match, first: string, second: string, bare: string, fourth: string, fifth: string, media: string) => {
      const url = (first ?? second ?? bare ?? fourth ?? fifth ?? "").trim();
      if (depth >= 8 || visited.has(url)) return "";
      const stylesheet = decodeStylesheet(assets.get(url));
      if (stylesheet === undefined) return "";
      visited.add(url);
      const content = safeCss(stylesheet, assets, depth + 1, visited);
      const condition = media.trim();
      return condition ? (/^(?:screen|print|all|not|only|\()/i.test(condition) ? `@media ${condition}{${content}}` : "") : content;
    });
  return safeCssTokens(inlined, assets);
}

function safeAttributes(attrs: JsonObject, assets: Map<string, string>, tag?: string): JsonObject {
  const safe: JsonObject = {};
  for (const [key, value] of Object.entries(attrs)) {
    const name = key.toLowerCase();
    if (/^on/.test(name) || name === "srcdoc" || name === "http-equiv" || name === "nonce" || name === "integrity" || name === "autofocus" || name === "autoplay" || name === "allow") continue;
    if (name === "sandbox") { safe[key] = "allow-same-origin"; continue; }
    if (name === "style" || name === "_csstext") {
      if (typeof value === "string") safe[key] = safeCss(value, assets);
      else if (object(value)) safe[key] = Object.fromEntries(Object.entries(object(value)!).map(([property, declaration]) => [property,
        typeof declaration === "string" ? safeCss(declaration, assets) : Array.isArray(declaration) ? declaration.map((part) => typeof part === "string" ? safeCss(part, assets) : part) : declaration,
      ]));
      else safe[key] = null;
    } else if (networkAttributes.has(name)) {
      if (typeof value !== "string") { safe[key] = null; continue; }
      if ((name === "href" || name === "xlink:href") && /^#[A-Za-z0-9_.:-]*$/.test(value)) safe[key] = value;
      else if ((["src", "poster", "background"].includes(name) && tag !== "iframe") || (["href", "xlink:href"].includes(name) && tag === "image")) safe[key] = allowedResource(value, assets);
      else safe[key] = null;
    } else if (name === "target" || name === "download") continue;
    else safe[key] = value;
  }
  if (tag === "iframe") { safe.src = "about:blank"; safe.sandbox = "allow-same-origin"; }
  return safe;
}

/**
 * Produces an isolated playback copy. This is not privacy redaction: text and input
 * values remain present, and privacy.mode is never promoted by this function.
 */
export function sanitizeCaptureEventsForReplay(events: BrowserCaptureEvent[], assets: BrowserCaptureAsset[] = []): BrowserCaptureEvent[] {
  const resources = new ReplayAssets(assets.map((asset) => [asset.url, asset.dataUrl]));
  let injectedId = -2_000_000_000;
  const seenMetaIds = new Set<number>();
  const styleTextIds = new Set<number>();
  const styleElementIds = new Set<number>();

  function sanitizeNode(value: JsonValue, parentTag?: string): JsonValue {
    const node = object(value);
    if (!node) return value;
    const out = { ...node };
    const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : undefined;
    if (tag && ["script", "noscript", "base", "meta", "object", "embed", "animate", "animatemotion", "animatetransform", "set"].includes(tag)) {
      if (typeof node.id === "number") seenMetaIds.add(node.id);
      return { type: 5, id: node.id ?? injectedId--, textContent: "tourkit: inactive captured element" };
    }
    if (tag === "link") {
      const attrs = object(node.attributes);
      const href = typeof attrs?.href === "string" ? attrs.href : "";
      // rrweb's inlineStylesheet replaces href/rel with _cssText on the original
      // link node. Preserve that embedded CSS as well as separately bundled links.
      const inlineStylesheet = typeof attrs?._cssText === "string" ? attrs._cssText : undefined;
      const stylesheet = inlineStylesheet ?? decodeStylesheet(resources.get(href));
      if (stylesheet !== undefined && (inlineStylesheet !== undefined || String(attrs?.rel ?? "").toLowerCase().split(/\s+/).includes("stylesheet"))) {
        if (typeof node.id === "number") styleElementIds.add(node.id);
        return { type: 2, tagName: "style", id: node.id ?? injectedId--,
          attributes: typeof attrs?.media === "string" ? { media: attrs.media } : {},
          childNodes: [{ type: 3, id: injectedId--, textContent: safeCss(stylesheet, resources) }] };
      }
      return { type: 5, id: node.id ?? injectedId--, textContent: "tourkit: omitted external link" };
    }
    if (tag === "canvas") {
      out.tagName = "img";
      const attrs = object(node.attributes) ?? {};
      out.attributes = { ...safeAttributes(attrs, resources, "img"), src: typeof attrs.rr_dataURL === "string" ? allowedResource(attrs.rr_dataURL, resources) : "" };
    } else if (object(node.attributes)) out.attributes = safeAttributes(object(node.attributes)!, resources, tag);
    if (tag === "style" && typeof node.id === "number") styleElementIds.add(node.id);
    if (parentTag === "style" && typeof out.textContent === "string") {
      out.textContent = safeCss(out.textContent, resources);
      if (typeof node.id === "number") styleTextIds.add(node.id);
    }
    if (Array.isArray(node.childNodes)) out.childNodes = node.childNodes.map((child) => sanitizeNode(child, tag));
    if (tag === "head") {
      const children = Array.isArray(out.childNodes) ? out.childNodes : [];
      out.childNodes = [{ type: 2, tagName: "meta", id: injectedId--, attributes: { "http-equiv": "Content-Security-Policy", content: BROWSER_CAPTURE_CSP }, childNodes: [] }, ...children];
    }
    return out;
  }

  function sanitizeData(value: JsonValue, key?: string): JsonValue {
    if (Array.isArray(value)) return value.map((item) => sanitizeData(item));
    if (typeof value === "string" && ["rule", "cssText", "_cssText", "style", "replace", "replaceSync"].includes(key ?? "")) return safeCss(value, resources);
    const data = object(value);
    if (!data) return value;
    if (typeof data.type === "number" && (data.tagName !== undefined || data.childNodes !== undefined || data.textContent !== undefined)) return sanitizeNode(data);
    const out: JsonObject = {};
    for (const [field, child] of Object.entries(data)) {
      if (field === "attributes" && object(child)) out[field] = safeAttributes(object(child)!, resources);
      else if (field === "node") out[field] = sanitizeNode(child);
      else out[field] = sanitizeData(child, field);
    }
    if (typeof out.id === "number" && styleTextIds.has(out.id) && typeof out.value === "string") out.value = safeCss(out.value, resources);
    if (typeof out.parentId === "number" && styleElementIds.has(out.parentId) && object(out.node)) out.node = sanitizeNode(out.node!, "style");
    if (out.source === 13 && object(out.set) && typeof object(out.set)!.value === "string") object(out.set)!.value = safeCss(object(out.set)!.value as string, resources);
    return out;
  }

  return events.map((event) => {
    const data = object(event.data);
    // rrweb Font events can construct FontFace in the host realm. Captured CSS/font
    // assets supply fonts inside the isolated document instead.
    if (event.type === 6 || (event.type === 3 && [9, 10].includes(Number(data?.source)))) {
      return { type: 5, timestamp: event.timestamp, data: { tag: "tourkit-omitted-event", payload: null } };
    }
    if (event.type === 2) { seenMetaIds.clear(); styleTextIds.clear(); styleElementIds.clear(); }
    const safe = sanitizeData(event.data);
    const safeObject = object(safe);
    if (event.type === 3 && safeObject && Array.isArray(safeObject.attributes)) {
      safeObject.attributes = safeObject.attributes.filter((entry) => {
        const mutation = object(entry);
        return !mutation || typeof mutation.id !== "number" || !seenMetaIds.has(mutation.id);
      });
    }
    return { type: event.type, timestamp: event.timestamp, data: safe };
  });
}
