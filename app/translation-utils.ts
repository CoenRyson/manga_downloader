export type Point = { x: number; y: number };

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NormalizedLasso = {
  bounds: NormalizedRect;
  points: Point[];
};

export type SelectionResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function containedImageRect(naturalWidth: number, naturalHeight: number, boxWidth: number, boxHeight: number): PixelRect | null {
  if (![naturalWidth, naturalHeight, boxWidth, boxHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    left: (boxWidth - width) / 2,
    top: (boxHeight - height) / 2,
    width,
    height,
  };
}

export function normalizeDragSelection(start: Point, end: Point, width: number, height: number, minimumPixels = 8): NormalizedRect | null {
  if (![start.x, start.y, end.x, end.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const startX = clamp(start.x, 0, width);
  const startY = clamp(start.y, 0, height);
  const endX = clamp(end.x, 0, width);
  const endY = clamp(end.y, 0, height);
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const selectionWidth = Math.abs(endX - startX);
  const selectionHeight = Math.abs(endY - startY);
  if (selectionWidth < minimumPixels || selectionHeight < minimumPixels) return null;
  return {
    x: left / width,
    y: top / height,
    width: selectionWidth / width,
    height: selectionHeight / height,
  };
}

export function normalizeLassoSelection(points: Point[], width: number, height: number, minimumPixels = 8): NormalizedLasso | null {
  if (points.length < 3 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const clamped = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: clamp(point.x, 0, width), y: clamp(point.y, 0, height) }));
  if (clamped.length < 3) return null;
  const left = Math.min(...clamped.map((point) => point.x));
  const right = Math.max(...clamped.map((point) => point.x));
  const top = Math.min(...clamped.map((point) => point.y));
  const bottom = Math.max(...clamped.map((point) => point.y));
  if (right - left < minimumPixels || bottom - top < minimumPixels) return null;
  const doubledArea = Math.abs(clamped.reduce((area, point, index) => {
    const next = clamped[(index + 1) % clamped.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0));
  if (doubledArea < minimumPixels * minimumPixels * 2) return null;
  return {
    bounds: {
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
    },
    points: clamped.map((point) => ({ x: point.x / width, y: point.y / height })),
  };
}

export function moveNormalizedSelection(selection: NormalizedRect, deltaX: number, deltaY: number): NormalizedRect {
  return {
    ...selection,
    x: clamp(selection.x + deltaX, 0, 1 - selection.width),
    y: clamp(selection.y + deltaY, 0, 1 - selection.height),
  };
}

export function resizeNormalizedSelection(
  selection: NormalizedRect,
  handle: SelectionResizeHandle,
  deltaX: number,
  deltaY: number,
  minimumWidth = 0.02,
  minimumHeight = 0.02,
): NormalizedRect {
  let left = selection.x;
  let right = selection.x + selection.width;
  let top = selection.y;
  let bottom = selection.y + selection.height;
  if (handle.includes("w")) left = clamp(left + deltaX, 0, right - minimumWidth);
  if (handle.includes("e")) right = clamp(right + deltaX, left + minimumWidth, 1);
  if (handle.includes("n")) top = clamp(top + deltaY, 0, bottom - minimumHeight);
  if (handle.includes("s")) bottom = clamp(bottom + deltaY, top + minimumHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function fitNormalizedPoints(points: Point[], from: NormalizedRect, to: NormalizedRect) {
  if (from.width <= 0 || from.height <= 0) return points;
  return points.map((point) => ({
    x: to.x + ((point.x - from.x) / from.width) * to.width,
    y: to.y + ((point.y - from.y) / from.height) * to.height,
  }));
}

export function selectionToSourcePixels(selection: NormalizedRect, imageWidth: number, imageHeight: number): PixelRect | null {
  if (![selection.x, selection.y, selection.width, selection.height, imageWidth, imageHeight].every(Number.isFinite) || imageWidth <= 0 || imageHeight <= 0) return null;
  const left = clamp(Math.floor(selection.x * imageWidth), 0, Math.max(0, imageWidth - 1));
  const top = clamp(Math.floor(selection.y * imageHeight), 0, Math.max(0, imageHeight - 1));
  const right = clamp(Math.ceil((selection.x + selection.width) * imageWidth), left + 1, imageWidth);
  const bottom = clamp(Math.ceil((selection.y + selection.height) * imageHeight), top + 1, imageHeight);
  return { left, top, width: right - left, height: bottom - top };
}

export function selectedTextOrAll(text: string, selectionStart?: number | null, selectionEnd?: number | null) {
  const normalized = text.trim();
  if (!normalized) return "";
  if (typeof selectionStart !== "number" || typeof selectionEnd !== "number" || selectionEnd <= selectionStart) return normalized;
  return text.slice(selectionStart, selectionEnd).trim() || normalized;
}

export function prepareTextForTranslation(text: string, language: string) {
  const lines = text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (language === "ja") {
    const japaneseCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const compactLines = lines.map((line) => line
      .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "$1")
      .replace(/\s+/g, " "));
    return compactLines.reduce((result, line) => {
      if (!result) return line;
      const joiner = japaneseCharacter.test(result.at(-1) || "") && japaneseCharacter.test(line.at(0) || "") ? "" : " ";
      return `${result}${joiner}${line}`;
    }, "").trim();
  }
  return lines
    .join(" ")
    .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveJapaneseLayout(preference: "auto" | "vertical" | "horizontal", width: number, height: number) {
  if (preference !== "auto") return preference;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "vertical";
  return width > height * 1.35 ? "horizontal" : "vertical";
}

export type OcrCandidate = {
  text: string;
  confidence: number;
  variant: string;
};

export function scoreOcrCandidate(candidate: OcrCandidate, language: string) {
  const text = candidate.text.trim();
  if (!text) return Number.NEGATIVE_INFINITY;
  const characters = [...text];
  const meaningful = characters.filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
  if (!meaningful) return Number.NEGATIVE_INFINITY;
  const noisy = characters.filter((character) => !/[\p{L}\p{N}\p{P}\p{S}\s]/u.test(character)).length;
  const expressivePunctuation = characters.filter((character) => /[!?…]/u.test(character)).length;
  const words = text.split(/\s+/).filter(Boolean);
  const orphanPenalty = language === "ja"
    ? 0
    : words.filter((word) => /^\p{L}$/u.test(word) && !/^[aAiI]$/.test(word)).length * 2;
  const confidence = Number.isFinite(candidate.confidence) ? candidate.confidence : 0;
  return confidence
    + Math.min(10, meaningful / 3)
    + Math.min(10, expressivePunctuation * 6)
    - (noisy / Math.max(1, characters.length)) * 50
    - orphanPenalty;
}

export function pickBestOcrCandidate(candidates: OcrCandidate[], language: string) {
  return candidates.reduce<OcrCandidate | null>((best, candidate) => {
    if (!best) return candidate.text.trim() ? candidate : null;
    return scoreOcrCandidate(candidate, language) > scoreOcrCandidate(best, language) ? candidate : best;
  }, null);
}
