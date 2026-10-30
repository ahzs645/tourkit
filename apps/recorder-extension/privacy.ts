import type { BrowserCaptureEvent, JsonValue } from "../../browser-capture/types";
import type { Rect } from "./protocol";

/** Stable opaque identifiers prevent signed resource URLs entering the archive. */
export function resourceKey(raw: string, base?: string): string {
  let url: string;
  try { url = new URL(raw, base).href; } catch { return ""; }
  if (!/^https?:\/\//i.test(url)) return "";
  if (/^https:\/\/capture\.invalid\/assets\/[0-9a-f]{16}$/.test(url)) return url;
  return privateResourceKey(url);
}

/** Opaque identity also supports embedded private images without retaining their bytes. */
export function privateResourceKey(url: string): string {
  let a = 2166136261;
  let b = 2246822519;
  for (let index = 0; index < url.length; index++) {
    a = Math.imul(a ^ url.charCodeAt(index), 16777619);
    b = Math.imul(b ^ url.charCodeAt(index), 3266489917);
  }
  return `https://capture.invalid/assets/${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

export function safeSource(raw: string): { origin: string; path: string } {
  try { const url = new URL(raw); return { origin: url.origin, path: url.pathname }; }
  catch { return { origin: "https://capture.invalid", path: "/" }; }
}

const embeddedResource = /^data:(?:image\/(?:png|jpeg|gif|webp)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|font-sfnt));base64,[A-Za-z0-9+/]+={0,2}$/i;

function cssEscape(source: string, offset: number): { text: string; end: number } {
  let index = offset + 1;
  if (source[index] === "\r" && source[index + 1] === "\n") return { text: "", end: index + 2 };
  if (/[\r\n\f]/.test(source[index] || "")) return { text: "", end: index + 1 };
  const hex = source.slice(index).match(/^[0-9a-f]{1,6}/i)?.[0];
  if (hex) {
    index += hex.length;
    if (/\s/.test(source[index] || "")) index++;
    const point = parseInt(hex, 16);
    return { text: point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "�", end: index };
  }
  return { text: source[index] || "", end: Math.min(source.length, index + 1) };
}

function cssString(source: string, offset: number): { text: string; end: number } {
  const quote = source[offset]; let index = offset + 1; let text = "";
  while (index < source.length) {
    if (source[index] === quote) return { text, end: index + 1 };
    if (source[index] === "\\") { const escaped = cssEscape(source, index); text += escaped.text; index = escaped.end; }
    else { text += source[index]; index++; }
  }
  return { text: "", end: source.length };
}

const quoteCss = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\f]/g, "\\a ")}"`;

/** Token-aware URL handling covers escaped identifiers, comments and image-set strings. */
export function rewriteCss(css: string, base: string, onResource?: (url: string) => unknown): string {
  const rewrite = (raw: string) => {
    if (raw.startsWith("#")) return raw;
    if (embeddedResource.test(raw)) return onResource?.(raw) === false ? "" : raw;
    if (/^data:/i.test(raw)) return "";
    try {
      const url = new URL(raw, base);
      if (!/^https?:$/.test(url.protocol)) return "";
      if (url.hostname !== "capture.invalid" && onResource?.(url.href) === false) return "";
      return resourceKey(url.href);
    } catch { return ""; }
  };
  const output: string[] = [];
  const functions: string[] = [];
  let index = 0; let importPending = false; let lastName = "";
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      const close = css.indexOf("*/", index + 2);
      index = close < 0 ? css.length : close + 2; output.push(" "); continue;
    }
    const character = css[index];
    if (character === '"' || character === "'") {
      const token = cssString(css, index);
      const inImageSet = functions.some((name) => name === "image-set" || name === "-webkit-image-set" || name === "src");
      const looksLikeUrl = /^(?:https?:|data:|blob:|javascript:|[./])/i.test(token.text) || /\.(?:css|eot|woff2?|ttf|otf|png|gif|jpe?g|webp|svg|avif)(?:[?#].*)?$/i.test(token.text);
      output.push(quoteCss(importPending || inImageSet || looksLikeUrl ? rewrite(token.text) : token.text));
      importPending = false; index = token.end; continue;
    }
    if (/[A-Za-z_-]/.test(character) || character === "\\") {
      const start = index; let name = "";
      while (index < css.length && (/[A-Za-z0-9_-]/.test(css[index]) || css[index] === "\\")) {
        if (css[index] === "\\") { const escaped = cssEscape(css, index); name += escaped.text; index = escaped.end; }
        else name += css[index++];
      }
      const lower = name.toLowerCase();
      let next = index;
      while (/\s/.test(css[next] || "")) next++;
      if (lower === "url" && css[next] === "(") {
        index = next + 1; while (/\s/.test(css[index] || "")) index++;
        let raw = "";
        if (css[index] === '"' || css[index] === "'") { const token = cssString(css, index); raw = token.text; index = token.end; }
        else {
          while (index < css.length && css[index] !== ")") {
            if (css[index] === "\\") { const escaped = cssEscape(css, index); raw += escaped.text; index = escaped.end; }
            else raw += css[index++];
          }
          raw = raw.trim();
        }
        while (index < css.length && css[index] !== ")") index++;
        if (css[index] === ")") index++;
        output.push(`url(${quoteCss(raw.includes("(") ? "" : rewrite(raw))})`);
        importPending = false; lastName = ""; continue;
      }
      if (lower === "import" && css[start - 1] === "@") importPending = true;
      lastName = lower;
      // Normalize function names so a replay sanitizer never misses escaped URL-capable syntax.
      output.push(css[next] === "(" ? name : css.slice(start, index));
      continue;
    }
    if (character === "(") { functions.push(lastName); lastName = ""; }
    if (character === ")") functions.pop();
    if (character === ";" || character === "}") { importPending = false; lastName = ""; }
    output.push(character); index++;
  }
  return output.join("");
}

export interface CapturePrivacyState { styleNodeIds: Set<number>; styleTextNodeIds: Set<number> }
export const createCapturePrivacyState = (): CapturePrivacyState => ({ styleNodeIds: new Set(), styleTextNodeIds: new Set() });

/** rrweb performs input and marked-text masking; this removes URL secrets before persistence. */
export function privatizeEvent(event: BrowserCaptureEvent, base: string, onResource?: (url: string) => unknown, state = createCapturePrivacyState()): BrowserCaptureEvent {
  const urlValue = (value: string, isAsset = false): string => {
    if (value.startsWith("#")) return value;
    if (embeddedResource.test(value)) return isAsset && onResource?.(value) === false ? "" : value;
    try {
      const url = new URL(value, base);
      if (!/^https?:$/.test(url.protocol)) return "";
      if (isAsset && onResource?.(url.href) === false) return "";
      return resourceKey(url.href);
    } catch { return ""; }
  };
  const styleValue = (value: JsonValue): JsonValue => {
    if (typeof value === "string") return rewriteCss(value, base, onResource);
    if (Array.isArray(value)) return value.map(styleValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, styleValue(child)]));
    return value;
  };
  const walk = (value: JsonValue, parentKey = "", parentTag = ""): JsonValue => {
    if (Array.isArray(value)) return value.map((child) => walk(child, parentKey, parentTag));
    if (value && typeof value === "object") {
      const object = value as Record<string, JsonValue>;
      const tag = typeof object.tagName === "string" ? object.tagName.toLowerCase() : "";
      if (tag === "style" && typeof object.id === "number") state.styleNodeIds.add(object.id);
      if (parentTag === "style" && object.type === 3 && typeof object.id === "number") state.styleTextNodeIds.add(object.id);
      const out: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(object)) {
        if (key === "attributes" && child && typeof child === "object" && !Array.isArray(child)) {
          const attributes: Record<string, JsonValue> = {};
          for (const [name, attr] of Object.entries(child)) {
            if (/^on/i.test(name) || /^(nonce|integrity|crossorigin|ping|srcdoc)$/i.test(name)) continue;
            if (name === "style" || name === "_cssText") { attributes[name] = styleValue(attr); continue; }
            if (typeof attr !== "string") { attributes[name] = attr; continue; }
            if (name === "value" || /(?:password|authorization|access.?token|refresh.?token|secret)/i.test(name)) { attributes[name] = ""; continue; }
            if (name === "srcset") {
              attributes[name] = attr.split(/,\s*/).map((entry) => {
                const [url, ...size] = entry.trim().split(/\s+/);
                return `${urlValue(url, true)} ${size.join(" ")}`.trim();
              }).join(", ");
            } else if (["src", "href", "poster", "action", "formaction", "xlink:href"].includes(name)) {
              const asset = ["img", "image", "link", "source"].includes(tag) || name === "poster";
              attributes[name] = urlValue(attr, asset);
            } else attributes[name] = attr;
          }
          out[key] = attributes;
        } else if (key === "href" && typeof child === "string") out[key] = urlValue(child);
        else if ((key === "rule" || key === "cssText" || key === "style" || key === "textContent" && parentTag === "style"
          || key === "value" && (parentKey === "set" || typeof object.id === "number" && state.styleTextNodeIds.has(object.id))) && typeof child === "string") out[key] = rewriteCss(child, base, onResource);
        else out[key] = walk(child, key, tag || (key === "node" && typeof object.parentId === "number" && state.styleNodeIds.has(object.parentId) ? "style" : parentTag));
      }
      // Mask input mutation payloads even if the source recorder changes its defaults.
      if (object.source === 5 && typeof object.text === "string") out.text = object.text ? "••••" : "";
      return out;
    }
    if (typeof value === "string" && parentKey === "_cssText") return rewriteCss(value, base, onResource);
    return value;
  };
  return { type: event.type, timestamp: event.timestamp, data: walk(event.data) };
}

export function redactionRects(rects: readonly Rect[], width: number, height: number, scaleX = 1, scaleY = 1): Rect[] {
  return rects.filter((rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)
    .map((rect) => {
      const left = Math.max(0, (rect.x - 4) * scaleX);
      const top = Math.max(0, (rect.y - 4) * scaleY);
      const right = Math.min(width, (rect.x + rect.width + 4) * scaleX);
      const bottom = Math.min(height, (rect.y + rect.height + 4) * scaleY);
      return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }).filter((rect) => rect.width && rect.height);
}
