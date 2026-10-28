/**
 * html2canvas accepts one position per colour stop and cannot resolve calc()
 * lengths. Grid cells that imitate desktop controls use both to paint hard-edged inset fills.
 * Expand their computed vertical gradients into equivalent explicit px stops
 * in the capture clone, so the renderer does not turn the row into a blur.
 */
export function tutorialCaptureGradient(image: string, height: number): string | undefined {
  if (!Number.isFinite(height) || height <= 0 || !image.startsWith("linear-gradient(") || !image.endsWith(")")) return undefined;
  const parts = splitOutsideFunctions(image.slice(16, -1), ",");
  if (["180deg", "to bottom"].includes(parts[0])) parts.shift();
  const stops: string[] = [];
  for (const part of parts) {
    const [color, ...positions] = splitOutsideFunctions(part, " ");
    if (!color || positions.length < 1 || positions.length > 2) return undefined;
    for (const position of positions) {
      const pixels = lengthInPixels(position, height);
      if (pixels === undefined) return undefined;
      stops.push(`${color} ${pixels}px`);
    }
  }
  return stops.length >= 2 ? `linear-gradient(${stops.join(", ")})` : undefined;
}

function lengthInPixels(value: string, height: number): number | undefined {
  const number = "(-?\\d+(?:\\.\\d+)?)";
  const simple = value.match(new RegExp(`^${number}(px|%)?$`));
  if (simple) return Number(simple[1]) * (simple[2] === "%" ? height / 100 : 1);
  const calc = value.match(new RegExp(`^calc\\(${number}%\\s*([+-])\\s*${number}px\\)$`));
  if (calc) return Number(calc[1]) * height / 100 + Number(calc[3]) * (calc[2] === "-" ? -1 : 1);
  return undefined;
}

function splitOutsideFunctions(value: string, separator: string): string[] {
  let depth = 0;
  let start = 0;
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (depth === 0 && value[i] === separator) {
      const part = value.slice(start, i).trim();
      if (part) result.push(part);
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) result.push(last);
  return result;
}

export function normalizeTutorialCaptureGradients(clone: Document): void {
  const view = clone.defaultView;
  if (!view) return;
  clone.querySelectorAll<HTMLElement>(".pb-dw__table > tbody > tr > td").forEach((cell) => {
    const style = view.getComputedStyle(cell);
    // Backgrounds originate at the padding box; borders are outside its height.
    const height = cell.getBoundingClientRect().height - parseFloat(style.borderTopWidth || "0") - parseFloat(style.borderBottomWidth || "0");
    const gradient = tutorialCaptureGradient(style.backgroundImage, height);
    if (gradient) cell.style.setProperty("background-image", gradient, "important");
  });
}

