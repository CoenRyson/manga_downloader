"use client";

import { PointerEvent as ReactPointerEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  containedImageRect,
  fitNormalizedPoints,
  moveNormalizedSelection,
  normalizeDragSelection,
  normalizeLassoSelection,
  NormalizedRect,
  OcrCandidate,
  pickBestOcrCandidate,
  PixelRect,
  Point,
  prepareTextForTranslation,
  resolveJapaneseLayout,
  resizeNormalizedSelection,
  SelectionResizeHandle,
  selectedTextOrAll,
  selectionToSourcePixels,
} from "./translation-utils";

type LanguageCode = "cs" | "en" | "ja" | "de" | "pl";
type JapaneseLayout = "auto" | "vertical" | "horizontal";
type TranslationStage = "select" | "crop" | "ocr" | "translate" | "ready" | "error";
type OcrMode = "auto" | "tesseract";
type SelectionMode = "lasso" | "rectangle";
type SelectionEditGesture = {
  handle?: SelectionResizeHandle;
  kind: "move" | "resize";
  originalLasso: Point[];
  originalSelection: NormalizedRect;
  start: Point;
};

const selectionResizeHandles: SelectionResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type ReaderTranslationProps = {
  open: boolean;
  pageKey: string;
  preferredImageUrl?: string;
  defaultSourceLanguage: LanguageCode;
  imageRef: RefObject<HTMLImageElement | null>;
  pageContainerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

type BrowserTranslator = {
  translate: (text: string) => Promise<string>;
  destroy?: () => void;
};

type TranslatorDownloadEvent = Event & { loaded?: number };
type TranslatorMonitor = { addEventListener: (type: "downloadprogress", listener: (event: TranslatorDownloadEvent) => void) => void };
type TranslatorFactory = {
  create: (options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: TranslatorMonitor) => void;
  }) => Promise<BrowserTranslator>;
};

type PreparedTranslator = Promise<{ translator: BrowserTranslator; error?: never } | { translator?: never; error: unknown }>;
type TranslationSnapshot = {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  japaneseLayout: JapaneseLayout;
  ocrMode: OcrMode;
};

type OcrWorker = {
  recognize: (input: Blob) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

type OcrCropVariant = {
  blob: Blob;
  height: number;
  label: string;
  width: number;
};

type OcrProgress = { progress: number; status: string };
type OcrProgressBridge = { listener?: (message: OcrProgress) => void };
type PaddleOcrResult = {
  items: Array<{ text: string; score: number }>;
};
type PaddleOcrEngine = {
  predict: (input: Blob | Blob[], params?: Record<string, unknown>) => Promise<PaddleOcrResult[]>;
  dispose: () => Promise<void>;
};
type PaddleOcrTestGlobals = typeof globalThis & {
  __mangaDisablePaddleOcr?: boolean;
  __mangaPaddleOcrFactory?: () => Promise<PaddleOcrEngine>;
};

const languageLabels: Record<LanguageCode, string> = {
  cs: "Čeština",
  en: "English",
  ja: "日本語",
  de: "Deutsch",
  pl: "Polski",
};

let ocrWorkerPromise: Promise<OcrWorker> | undefined;
let ocrWorkerLanguage = "";
let ocrProgressBridge: OcrProgressBridge | undefined;
let paddleOcrPromise: Promise<PaddleOcrEngine> | undefined;

async function getPaddleOcr() {
  const testGlobals = globalThis as PaddleOcrTestGlobals;
  if (testGlobals.__mangaDisablePaddleOcr) throw new Error("PaddleOCR je v tomto testu vypnuté.");
  if (!paddleOcrPromise) {
    const nextEngine = testGlobals.__mangaPaddleOcrFactory
      ? testGlobals.__mangaPaddleOcrFactory()
      : import("@paddleocr/paddleocr-js").then(async ({ PaddleOCR }) => PaddleOCR.create({
        textDetectionModelName: "PP-OCRv6_small_det",
        textDetectionModelAsset: { url: "/api/ocr-model?model=det" },
        textRecognitionModelName: "PP-OCRv6_small_rec",
        textRecognitionModelAsset: { url: "/api/ocr-model?model=rec" },
        worker: false,
        ortOptions: {
          backend: "auto",
          numThreads: 1,
        },
        textDetectionBatchSize: 2,
        textRecognitionBatchSize: 8,
      }) as Promise<PaddleOcrEngine>);
    const guardedEngine = nextEngine.catch((error) => {
      if (paddleOcrPromise === guardedEngine) paddleOcrPromise = undefined;
      throw error;
    });
    paddleOcrPromise = guardedEngine;
  }
  return paddleOcrPromise;
}

function terminateOcrWorker() {
  const workerPromise = ocrWorkerPromise;
  if (ocrProgressBridge) ocrProgressBridge.listener = undefined;
  ocrWorkerPromise = undefined;
  ocrWorkerLanguage = "";
  ocrProgressBridge = undefined;
  if (workerPromise) void workerPromise.then((worker) => worker.terminate()).catch(() => undefined);
}

function tesseractSpec(language: LanguageCode, japaneseLayout: JapaneseLayout) {
  if (language === "ja" && japaneseLayout === "vertical") return { languages: ["jpn_vert", "eng"], pageSegmentation: "5" };
  if (language === "ja") return { languages: ["jpn", "eng"], pageSegmentation: "6" };
  const languages = language === "cs" ? ["ces", "eng"]
    : language === "de" ? ["deu", "eng"]
      : language === "pl" ? ["pol", "eng"]
        : ["eng"];
  return { languages, pageSegmentation: "6" };
}

async function getOcrWorker(language: LanguageCode, japaneseLayout: JapaneseLayout, onProgress: (message: OcrProgress) => void) {
  const { languages: trainedLanguages, pageSegmentation } = tesseractSpec(language, japaneseLayout);
  const languageKey = `${trainedLanguages.join("+")}:${pageSegmentation}`;
  if (!ocrWorkerPromise || ocrWorkerLanguage !== languageKey) {
    const previousWorker = ocrWorkerPromise;
    if (ocrProgressBridge) ocrProgressBridge.listener = undefined;
    const progressBridge: OcrProgressBridge = { listener: onProgress };
    ocrProgressBridge = progressBridge;
    ocrWorkerLanguage = languageKey;
    const nextWorker = (async () => {
      if (previousWorker) await previousWorker.then((worker) => worker.terminate()).catch(() => undefined);
      const { createWorker, OEM } = await import("tesseract.js");
      const worker = await createWorker(trainedLanguages, OEM.LSTM_ONLY, {
        workerPath: "/ocr/tesseract/worker.min.js",
        corePath: "/ocr/tesseract/core",
        langPath: "/ocr/tesseract/lang",
        logger: (message) => progressBridge.listener?.(message),
      }) as OcrWorker;
      await worker.setParameters({
        tessedit_pageseg_mode: pageSegmentation,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    })();
    const workerPromise: Promise<OcrWorker> = nextWorker.catch((error) => {
      if (ocrWorkerPromise === workerPromise) {
        progressBridge.listener = undefined;
        ocrWorkerPromise = undefined;
        ocrWorkerLanguage = "";
        ocrProgressBridge = undefined;
      }
      throw error;
    });
    ocrWorkerPromise = workerPromise;
  } else if (ocrProgressBridge) {
    ocrProgressBridge.listener = onProgress;
  }
  return ocrWorkerPromise;
}

function ocrSafeUrl(url: string) {
  if (/^https:\/\//i.test(url)) {
    const hostname = new URL(url).hostname;
    const endpoint = hostname === "uploads.mangadex.org" || /\.mangadex\.network$/i.test(hostname)
      ? "/api/mangadex-image"
      : "/api/native-source/image";
    return `${endpoint}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function loadImageBlob(url: string, signal?: AbortSignal) {
  const response = await fetch(ocrSafeUrl(url), { headers: { Accept: "image/*" }, referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error("Vybraný obrázek se nepodařilo načíst pro OCR.");
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/") && !url.startsWith("blob:")) throw new Error("Zdroj nevrátil obrázek.");
  const blob = await response.blob();
  if (blob.size > 30 * 1024 * 1024) throw new Error("Obrázek je pro OCR příliš velký.");
  return blob;
}

async function imageFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Obrázek se pro OCR nepodařilo včas dekódovat.")), 15_000);
      image.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Obrázek se pro OCR nepodařilo dekódovat."));
      };
      image.src = objectUrl;
    });
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Výřez se nepodařilo vytvořit.")),
    "image/png",
  ));
}

function otsuThreshold(histogram: Uint32Array, total: number) {
  let weightedTotal = 0;
  for (let value = 0; value < 256; value += 1) weightedTotal += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestThreshold = 127;
  let bestVariance = -1;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = value;
    }
  }
  return bestThreshold;
}

async function createOcrVariants(canvas: HTMLCanvasElement, padding: number): Promise<OcrCropVariant[]> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Prohlížeč neumí předzpracovat výřez pro OCR.");
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  const histogram = new Uint32Array(256);
  for (let index = 0, pixel = 0; index < source.data.length; index += 4, pixel += 1) {
    const value = Math.round(source.data[index] * 0.299 + source.data[index + 1] * 0.587 + source.data[index + 2] * 0.114);
    gray[pixel] = value;
    histogram[value] += 1;
  }

  const percentile = (ratio: number) => {
    const target = gray.length * ratio;
    let count = 0;
    for (let value = 0; value < 256; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return 255;
  };
  const low = percentile(0.02);
  const high = Math.max(low + 24, percentile(0.98));
  const threshold = otsuThreshold(histogram, gray.length);
  let innerDark = 0;
  let innerTotal = 0;
  for (let y = padding; y < canvas.height - padding; y += 1) {
    for (let x = padding; x < canvas.width - padding; x += 1) {
      innerDark += gray[y * canvas.width + x] <= threshold ? 1 : 0;
      innerTotal += 1;
    }
  }
  const invertBinary = innerDark > innerTotal * 0.55;

  const makeVariant = async (label: string, transform: (value: number) => number) => {
    const target = document.createElement("canvas");
    target.width = canvas.width;
    target.height = canvas.height;
    const targetContext = target.getContext("2d");
    if (!targetContext) throw new Error("Prohlížeč neumí vytvořit OCR variantu.");
    const output = targetContext.createImageData(canvas.width, canvas.height);
    for (let pixel = 0, index = 0; pixel < gray.length; pixel += 1, index += 4) {
      const value = transform(gray[pixel]);
      output.data[index] = value;
      output.data[index + 1] = value;
      output.data[index + 2] = value;
      output.data[index + 3] = 255;
    }
    targetContext.putImageData(output, 0, 0);
    return { blob: await canvasToPng(target), width: target.width, height: target.height, label };
  };

  const original = { blob: await canvasToPng(canvas), width: canvas.width, height: canvas.height, label: "originál" };
  const contrast = await makeVariant("vyšší kontrast", (value) => Math.max(0, Math.min(255, Math.round((value - low) * 255 / (high - low)))));
  const binary = await makeVariant("černobílá", (value) => {
    const dark = value <= threshold;
    return dark !== invertBinary ? 0 : 255;
  });
  return [original, contrast, binary];
}

async function cropDrawable(
  drawable: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  selection: NormalizedRect,
  lasso?: Point[],
) {
    const crop = selectionToSourcePixels(selection, sourceWidth, sourceHeight);
    if (!crop) throw new Error("Výběr nemá platnou velikost.");
    const shortestSide = Math.max(1, Math.min(crop.width, crop.height));
    const scale = Math.min(8, Math.max(1, 520 / shortestSide), 4096 / crop.width, 4096 / crop.height);
    const padding = 32;
    const outputWidth = Math.max(1, Math.round(crop.width * scale));
    const outputHeight = Math.max(1, Math.round(crop.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth + padding * 2;
    canvas.height = outputHeight + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Prohlížeč neumí připravit výřez pro OCR.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (lasso && lasso.length >= 3) {
      context.save();
      context.beginPath();
      lasso.forEach((point, index) => {
        const x = padding + ((point.x * sourceWidth - crop.left) / crop.width) * outputWidth;
        const y = padding + ((point.y * sourceHeight - crop.top) / crop.height) * outputHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.clip();
    }
    context.drawImage(drawable, crop.left, crop.top, crop.width, crop.height, padding, padding, outputWidth, outputHeight);
    if (lasso && lasso.length >= 3) context.restore();
    return createOcrVariants(canvas, padding);
}

function canDrawImageDirectly(image: HTMLImageElement) {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
  try {
    const source = new URL(image.currentSrc || image.src, window.location.href);
    return source.origin === window.location.origin || source.protocol === "blob:" || source.protocol === "data:" || image.crossOrigin === "anonymous";
  } catch {
    return false;
  }
}

async function cropFetchedImage(url: string, selection: NormalizedRect, lasso?: Point[], signal?: AbortSignal) {
  const sourceBlob = await loadImageBlob(url, signal);
  const { image, objectUrl } = await imageFromBlob(sourceBlob);
  try {
    return await cropDrawable(image, image.naturalWidth, image.naturalHeight, selection, lasso);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function cropSelection(visibleImage: HTMLImageElement, preferredUrl: string, selection: NormalizedRect, lasso?: Point[], signal?: AbortSignal) {
  const visibleUrl = visibleImage.currentSrc || visibleImage.src;
  const resolvedPreferredUrl = new URL(preferredUrl, window.location.href).href;
  const resolvedVisibleUrl = new URL(visibleUrl, window.location.href).href;
  let preferredError: unknown;

  if (resolvedPreferredUrl !== resolvedVisibleUrl) {
    try {
      return await cropFetchedImage(preferredUrl, selection, lasso, signal);
    } catch (error) {
      preferredError = error;
    }
  }
  if (canDrawImageDirectly(visibleImage)) {
    try {
      return await cropDrawable(visibleImage, visibleImage.naturalWidth, visibleImage.naturalHeight, selection, lasso);
    } catch {
      // A remotely redirected image can still taint a canvas; retry from our image proxy.
    }
  }
  try {
    return await cropFetchedImage(visibleUrl || preferredUrl, selection, lasso, signal);
  } catch (error) {
    throw preferredError ?? error;
  }
}

async function recognizeOcrVariants(
  worker: OcrWorker,
  variants: OcrCropVariant[],
  language: LanguageCode,
  japaneseLayout: JapaneseLayout,
  onAttempt: (attempt: number, total: number, label: string) => void,
) {
  const configuredPsm = tesseractSpec(language, japaneseLayout).pageSegmentation;
  const first = variants[0];
  const primaryPsm = language !== "ja" && first.width > first.height * 2.8 ? "7" : configuredPsm;
  const candidates: OcrCandidate[] = [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    onAttempt(index + 1, variants.length, variant.label);
    await worker.setParameters({ tessedit_pageseg_mode: primaryPsm });
    const result = await worker.recognize(variant.blob);
    candidates.push({
      text: result.data.text.trim(),
      confidence: result.data.confidence,
      variant: `${variant.label}:psm${primaryPsm}`,
    });
  }

  let best = pickBestOcrCandidate(candidates, language);
  if (language !== "ja") {
    const fallbackPsm = primaryPsm === "7" ? "13" : "11";
    const fallbackVariant = variants.find((variant) => variant.label === "vyšší kontrast") ?? variants[0];
    onAttempt(variants.length + 1, variants.length + 1, "alternativní rozložení");
    await worker.setParameters({ tessedit_pageseg_mode: fallbackPsm });
    const result = await worker.recognize(fallbackVariant.blob);
    candidates.push({
      text: result.data.text.trim(),
      confidence: result.data.confidence,
      variant: `${fallbackVariant.label}:psm${fallbackPsm}`,
    });
    best = pickBestOcrCandidate(candidates, language);
  }
  await worker.setParameters({ tessedit_pageseg_mode: configuredPsm });
  return best;
}

async function recognizePaddleVariants(
  engine: PaddleOcrEngine,
  variants: OcrCropVariant[],
  language: LanguageCode,
) {
  const selectedVariants = variants.filter((variant) => variant.label === "originál" || variant.label === "vyšší kontrast");
  const results = await engine.predict(selectedVariants.map((variant) => variant.blob), {
    textDetBoxThresh: 0.4,
    textDetUnclipRatio: 1.8,
    textRecScoreThresh: 0.25,
  });
  const candidates = results.map((result, index): OcrCandidate => {
    const usableItems = result.items.filter((item) => item.text.trim());
    const confidence = usableItems.length
      ? usableItems.reduce((total, item) => total + item.score, 0) / usableItems.length * 100
      : 0;
    return {
      text: usableItems.map((item) => item.text.trim()).join(language === "ja" ? "" : "\n"),
      confidence,
      variant: `PaddleOCR · ${selectedVariants[index]?.label ?? "automaticky"}`,
    };
  });
  return pickBestOcrCandidate(candidates, language);
}

const translatorCache = new Map<string, Promise<BrowserTranslator>>();

function destroyTranslatorCache(exceptKey?: string) {
  for (const [key, translator] of translatorCache) {
    if (key === exceptKey) continue;
    translatorCache.delete(key);
    void translator.then((session) => session.destroy?.()).catch(() => undefined);
  }
}

function prepareOnDeviceTranslator(sourceLanguage: LanguageCode, targetLanguage: LanguageCode, onDownload: (progress?: number) => void): PreparedTranslator {
  if (sourceLanguage === targetLanguage) {
    return Promise.resolve({ translator: { translate: async (text) => text } });
  }
  const factory = (globalThis as typeof globalThis & { Translator?: TranslatorFactory }).Translator;
  if (!factory?.create) return Promise.resolve({ error: new Error("Lokální překladač není v tomto prohlížeči dostupný. Použijte aktuální desktopový Chrome.") });

  const key = `${sourceLanguage}:${targetLanguage}`;
  destroyTranslatorCache(key);
  let translatorPromise = translatorCache.get(key);
  if (!translatorPromise) {
    try {
      // This call deliberately happens synchronously inside pointerup/click. Chrome
      // requires a user gesture when it needs to download a language pack.
      translatorPromise = factory.create({
        sourceLanguage,
        targetLanguage,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => onDownload(event.loaded));
        },
      });
      translatorCache.set(key, translatorPromise);
      void translatorPromise.catch(() => {
        if (translatorCache.get(key) === translatorPromise) translatorCache.delete(key);
      });
    } catch (error) {
      return Promise.resolve({ error });
    }
  }
  return translatorPromise.then((translator) => ({ translator }), (error) => ({ error }));
}

async function translateBestAvailable(
  text: string,
  snapshot: TranslationSnapshot,
  preparedTranslator: PreparedTranslator,
  signal: AbortSignal,
) {
  if (snapshot.sourceLanguage === snapshot.targetLanguage) return { text, provider: "Bez překladu" };
  const prepared = await preparedTranslator;
  if (signal.aborted) return null;
  if ("error" in prepared) throw prepared.error;
  const translation = (await prepared.translator.translate(text)).trim();
  return { text: translation, provider: "Chrome v zařízení" };
}

function externalTranslationUrl(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode) {
  const params = new URLSearchParams({ sl: sourceLanguage, tl: targetLanguage, text, op: "translate" });
  return `https://translate.google.com/?${params.toString()}`;
}

function pointerPoint(event: ReactPointerEvent<HTMLDivElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function ReaderTranslation({
  open,
  pageKey,
  preferredImageUrl,
  defaultSourceLanguage,
  imageRef,
  pageContainerRef,
  onClose,
}: ReaderTranslationProps) {
  const [imageBounds, setImageBounds] = useState<PixelRect | null>(null);
  const [selection, setSelection] = useState<NormalizedRect | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("lasso");
  const [selectionEditing, setSelectionEditing] = useState(false);
  const [lassoDraft, setLassoDraft] = useState<Point[]>([]);
  const [lassoPoints, setLassoPoints] = useState<Point[]>([]);
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>(defaultSourceLanguage);
  const [japaneseLayout, setJapaneseLayout] = useState<JapaneseLayout>("auto");
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>(defaultSourceLanguage === "cs" ? "en" : "cs");
  const [ocrMode, setOcrMode] = useState<OcrMode>("auto");
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [translatedFragment, setTranslatedFragment] = useState("");
  const [selectedFragment, setSelectedFragment] = useState("");
  const [stage, setStage] = useState<TranslationStage>("select");
  const [panelVisible, setPanelVisible] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [ocrProvider, setOcrProvider] = useState("");
  const [status, setStatus] = useState("Označte celou bublinu. Rozpoznání i překlad se spustí samy.");
  const [error, setError] = useState("");
  const sourceTextRef = useRef<HTMLTextAreaElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const operationRevisionRef = useRef(0);
  const activeOperationRef = useRef<"" | "ocr" | "translate">("");
  const operationAbortRef = useRef<AbortController | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const selectionEditGestureRef = useRef<SelectionEditGesture | null>(null);

  const busy = stage === "crop" || stage === "ocr" || stage === "translate";

  const invalidateOperation = useCallback(() => {
    operationRevisionRef.current += 1;
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    if (activeOperationRef.current === "ocr") terminateOcrWorker();
    if (activeOperationRef.current === "translate") destroyTranslatorCache();
    activeOperationRef.current = "";
    activePointerIdRef.current = null;
    selectionEditGestureRef.current = null;
  }, []);

  const beginOperation = (kind: "ocr" | "translate", nextStage: TranslationStage) => {
    operationAbortRef.current?.abort();
    if (activeOperationRef.current === "ocr") terminateOcrWorker();
    if (activeOperationRef.current === "translate") destroyTranslatorCache();
    const revision = operationRevisionRef.current + 1;
    const controller = new AbortController();
    operationRevisionRef.current = revision;
    operationAbortRef.current = controller;
    activeOperationRef.current = kind;
    setStage(nextStage);
    return { revision, signal: controller.signal };
  };

  const operationIsCurrent = (revision: number) => operationRevisionRef.current === revision
    && operationAbortRef.current !== null
    && !operationAbortRef.current.signal.aborted;

  const measureImage = useCallback(() => {
    const image = imageRef.current;
    const container = pageContainerRef.current;
    if (!image || !container) return setImageBounds(null);
    const imageBox = image.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const content = getComputedStyle(image).objectFit === "contain"
      ? containedImageRect(image.naturalWidth, image.naturalHeight, imageBox.width, imageBox.height)
      : { left: 0, top: 0, width: imageBox.width, height: imageBox.height };
    if (!content) return setImageBounds(null);
    setImageBounds({
      left: imageBox.left - containerBox.left + content.left,
      top: imageBox.top - containerBox.top + content.top,
      width: content.width,
      height: content.height,
    });
  }, [imageRef, pageContainerRef]);

  useEffect(() => {
    invalidateOperation();
    setSelection(null);
    setDragStart(null);
    setLassoDraft([]);
    setLassoPoints([]);
    setSelectionEditing(false);
    setSourceText("");
    setTranslatedText("");
    setTranslatedFragment("");
    setSelectedFragment("");
    setProvider("");
    setOcrProvider("");
    setPanelVisible(open);
    setEditorOpen(open);
    setStage("select");
    setError("");
    setStatus("Označte celou bublinu. Rozpoznání i překlad se spustí samy.");
  }, [invalidateOperation, open, pageKey]);

  useEffect(() => {
    if (open) return;
    invalidateOperation();
    terminateOcrWorker();
    destroyTranslatorCache();
    setSelection(null);
    setDragStart(null);
    setLassoDraft([]);
    setLassoPoints([]);
    setSelectionEditing(false);
    setSourceText("");
    setTranslatedText("");
    setTranslatedFragment("");
    setSelectedFragment("");
    setProvider("");
    setOcrProvider("");
    setError("");
    setPanelVisible(false);
    setEditorOpen(false);
    setStage("select");
    setStatus("Označte celou bublinu. Rozpoznání i překlad se spustí samy.");
  }, [invalidateOperation, open]);

  useEffect(() => () => {
    invalidateOperation();
    terminateOcrWorker();
    destroyTranslatorCache();
  }, [invalidateOperation]);

  useEffect(() => {
    invalidateOperation();
    setSourceLanguage(defaultSourceLanguage);
    setTargetLanguage((current) => current === defaultSourceLanguage ? (defaultSourceLanguage === "cs" ? "en" : "cs") : current);
  }, [defaultSourceLanguage, invalidateOperation]);

  useEffect(() => {
    if (!open) return;
    const image = imageRef.current;
    const container = pageContainerRef.current;
    const frame = window.requestAnimationFrame(measureImage);
    image?.addEventListener("load", measureImage);
    window.addEventListener("resize", measureImage);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measureImage);
    if (image) observer?.observe(image);
    if (container) observer?.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      image?.removeEventListener("load", measureImage);
      window.removeEventListener("resize", measureImage);
      observer?.disconnect();
    };
  }, [imageRef, measureImage, open, pageContainerRef, pageKey]);

  const selectionStyle = useMemo(() => selection && imageBounds ? {
    left: `${selection.x * imageBounds.width}px`,
    top: `${selection.y * imageBounds.height}px`,
    width: `${selection.width * imageBounds.width}px`,
    height: `${selection.height * imageBounds.height}px`,
  } : undefined, [imageBounds, selection]);
  const lassoPath = useMemo(() => {
    if (!imageBounds) return "";
    const points = lassoDraft.length > 0
      ? lassoDraft
      : lassoPoints.map((point) => ({ x: point.x * imageBounds.width, y: point.y * imageBounds.height }));
    if (points.length < 2) return "";
    return `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}${lassoDraft.length ? "" : " Z"}`;
  }, [imageBounds, lassoDraft, lassoPoints]);

  if (!open) return null;

  const clearForNewSelection = () => {
    setSourceText("");
    setTranslatedText("");
    setTranslatedFragment("");
    setSelectedFragment("");
    setProvider("");
    setOcrProvider("");
    setError("");
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (activePointerIdRef.current !== null) return;
    const point = pointerPoint(event);
    if (selectionEditing && selection && imageBounds) {
      const handle = (event.target as HTMLElement).dataset.selectionHandle as SelectionResizeHandle | undefined;
      const normalizedPoint = { x: point.x / imageBounds.width, y: point.y / imageBounds.height };
      const insideSelection = normalizedPoint.x >= selection.x
        && normalizedPoint.x <= selection.x + selection.width
        && normalizedPoint.y >= selection.y
        && normalizedPoint.y <= selection.y + selection.height;
      if (!handle && !insideSelection) {
        setStatus("Táhněte uvnitř výběru pro posun, nebo použijte některý z osmi bodů pro změnu velikosti.");
        return;
      }
      event.preventDefault();
      activePointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      selectionEditGestureRef.current = {
        handle,
        kind: handle ? "resize" : "move",
        originalLasso: lassoPoints,
        originalSelection: selection,
        start: point,
      };
      setStatus(handle ? "Tažením upravte velikost výběru." : "Tažením posuňte výběr na správné místo.");
      return;
    }
    event.preventDefault();
    invalidateOperation();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setSelection(null);
    setLassoPoints([]);
    setLassoDraft(selectionMode === "lasso" ? [point] : []);
    setPanelVisible(false);
    setEditorOpen(false);
    setStage("select");
    clearForNewSelection();
    setStatus(selectionMode === "lasso"
      ? "Držte tlačítko a obtáhněte celou bublinu. Po puštění se okolí vybělí."
      : "Táhněte až k opačnému rohu obdélníku.");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId || !imageBounds) return;
    event.preventDefault();
    const point = pointerPoint(event);
    const editGesture = selectionEditGestureRef.current;
    if (selectionEditing && editGesture) {
      const deltaX = (point.x - editGesture.start.x) / imageBounds.width;
      const deltaY = (point.y - editGesture.start.y) / imageBounds.height;
      const nextSelection = editGesture.kind === "move"
        ? moveNormalizedSelection(editGesture.originalSelection, deltaX, deltaY)
        : resizeNormalizedSelection(
          editGesture.originalSelection,
          editGesture.handle ?? "se",
          deltaX,
          deltaY,
          16 / imageBounds.width,
          16 / imageBounds.height,
        );
      setSelection(nextSelection);
      if (editGesture.originalLasso.length >= 3) {
        setLassoPoints(fitNormalizedPoints(editGesture.originalLasso, editGesture.originalSelection, nextSelection));
      }
      return;
    }
    if (!dragStart) return;
    if (selectionMode === "lasso") {
      const previous = lassoDraft.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 3) return;
      const nextDraft = [...lassoDraft, point];
      setLassoDraft(nextDraft);
      const normalized = normalizeLassoSelection(nextDraft, imageBounds.width, imageBounds.height, 1);
      if (normalized) setSelection(normalized.bounds);
      return;
    }
    const next = normalizeDragSelection(dragStart, point, imageBounds.width, imageBounds.height, 1);
    if (next) setSelection(next);
  };

  const runSelectionPipeline = async (
    area: NormalizedRect,
    image: HTMLImageElement,
    sourceUrl: string,
    snapshot: TranslationSnapshot,
    revision: number,
    signal: AbortSignal,
    preparedTranslator: PreparedTranslator,
    lasso?: Point[],
  ) => {
    let recognizedText = "";
    let ocrWorkerReady = false;
    setError("");
    setStatus("Připravuji výřez…");
    try {
      const cropVariants = await cropSelection(image, sourceUrl, area, lasso, signal);
      if (!operationIsCurrent(revision)) return;
      setStage("ocr");
      let result: OcrCandidate | null = null;
      let usedFallback = false;
      if (snapshot.ocrMode === "auto") {
        try {
          setStatus("Načítám PaddleOCR PP-OCRv6… poprvé se model stáhne automaticky.");
          const paddle = await getPaddleOcr();
          if (!operationIsCurrent(revision)) return;
          setStatus("PaddleOCR hledá text a porovnává originál s vyšším kontrastem…");
          result = await recognizePaddleVariants(paddle, cropVariants, snapshot.sourceLanguage);
          if (!result?.text.trim()) throw new Error("PaddleOCR ve výběru nenašlo čitelný text.");
          setOcrProvider("PaddleOCR PP-OCRv6");
        } catch {
          if (!operationIsCurrent(revision)) return;
          usedFallback = true;
          setStatus("PaddleOCR si s výřezem neporadilo. Zkouším původní Tesseract…");
        }
      }
      if (!result) {
        const worker = await getOcrWorker(snapshot.sourceLanguage, snapshot.japaneseLayout, ({ progress, status: ocrStatus }) => {
          if (!operationIsCurrent(revision)) return;
          const percent = Number.isFinite(progress) ? ` ${Math.round(progress * 100)} %` : "";
          setStatus(ocrStatus.includes("recognizing")
            ? `Tesseract rozpoznává text ve vybrané oblasti…${percent}`
            : `Načítám Tesseract OCR…${percent}`);
        });
        ocrWorkerReady = true;
        if (!operationIsCurrent(revision)) return;
        setStatus("Tesseract porovnává několik úprav obrazu pro stylizované písmo…");
        result = await recognizeOcrVariants(
          worker,
          cropVariants,
          snapshot.sourceLanguage,
          snapshot.japaneseLayout,
          (attempt, total, label) => {
            if (!operationIsCurrent(revision)) return;
            setStatus(`Tesseract rozpoznává font · ${label} (${attempt}/${total})…`);
          },
        );
        setOcrProvider(usedFallback ? "Tesseract · automatická záloha" : "Tesseract");
      }
      if (!operationIsCurrent(revision)) return;
      recognizedText = result?.text.trim() ?? "";
      if (!recognizedText) throw new Error("Ve výběru se nepodařilo najít čitelný text. Zvětšete oblast nebo text napište ručně.");
      setSourceText(recognizedText);
      setTranslatedText("");
      setTranslatedFragment(recognizedText);
      setSelectedFragment("");
      setPanelVisible(true);
      setEditorOpen(false);
      setStatus(`OCR: ${result?.variant ?? "automaticky"}. Překládám…`);
    } catch (reason) {
      if (!operationIsCurrent(revision)) return;
      if (ocrWorkerReady) terminateOcrWorker();
      setError(reason instanceof Error ? reason.message : "OCR se nepodařilo spustit.");
      setStatus("Text můžete přepsat ručně a pokračovat překladem.");
      setPanelVisible(true);
      setEditorOpen(true);
      setStage("error");
      activeOperationRef.current = "";
      operationAbortRef.current = null;
      return;
    }

    if (!operationIsCurrent(revision)) return;
    activeOperationRef.current = "translate";
    setStage("translate");
    setStatus("Překládám celou bublinu v souvislém kontextu…");
    try {
      const preparedText = prepareTextForTranslation(recognizedText, snapshot.sourceLanguage);
      const result = await translateBestAvailable(
        preparedText,
        snapshot,
        preparedTranslator,
        signal,
      );
      if (!operationIsCurrent(revision) || !result) return;
      setTranslatedText(result.text);
      setProvider(result.provider);
      setStage("ready");
      setStatus("Hotovo · překlad proběhl přímo v tomto zařízení.");
    } catch (reason) {
      if (!operationIsCurrent(revision)) return;
      setError(reason instanceof Error ? reason.message : "Překlad se nepodařilo spustit.");
      setStatus("OCR text zůstal zachovaný. Můžete ho opravit nebo otevřít externí překladač.");
      setEditorOpen(true);
      setStage("error");
    } finally {
      if (operationIsCurrent(revision)) {
        activeOperationRef.current = "";
        operationAbortRef.current = null;
      }
    }
  };

  const startSelectionPipeline = (area: NormalizedRect, snapshot: TranslationSnapshot, lasso = lassoPoints) => {
    const image = imageRef.current;
    const sourceUrl = preferredImageUrl || image?.currentSrc || image?.src || "";
    if (!image || !sourceUrl) return;
    const resolvedSnapshot = snapshot.sourceLanguage === "ja" ? {
      ...snapshot,
      japaneseLayout: resolveJapaneseLayout(
        snapshot.japaneseLayout,
        area.width * (image.naturalWidth || imageBounds?.width || 1),
        area.height * (image.naturalHeight || imageBounds?.height || 1),
      ) as JapaneseLayout,
    } : snapshot;
    const { revision, signal } = beginOperation("ocr", "crop");
    const preparedTranslator: PreparedTranslator = prepareOnDeviceTranslator(resolvedSnapshot.sourceLanguage, resolvedSnapshot.targetLanguage, (progress) => {
      if (!operationIsCurrent(revision) || activeOperationRef.current !== "translate") return;
      const percent = typeof progress === "number" ? ` ${Math.round(progress * 100)} %` : "";
      setStatus(`Stahuji lokální jazykový balíček…${percent}`);
    });
    setSelection(area);
    setSelectionEditing(false);
    setPanelVisible(false);
    setEditorOpen(false);
    clearForNewSelection();
    void runSelectionPipeline(area, image, sourceUrl, resolvedSnapshot, revision, signal, preparedTranslator, lasso.length >= 3 ? lasso : undefined);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    if (selectionEditing && selectionEditGestureRef.current) {
      activePointerIdRef.current = null;
      selectionEditGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setStatus("Výběr je upravený. Stiskněte Enter a OCR se spustí znovu.");
      return;
    }
    const start = dragStart;
    const bounds = imageBounds;
    const draft = lassoDraft;
    activePointerIdRef.current = null;
    setDragStart(null);
    setLassoDraft([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start || !bounds) {
      setSelection(null);
      setLassoPoints([]);
      setPanelVisible(true);
      setEditorOpen(true);
      setStage("select");
      setStatus("Výběr se přerušil. Zkuste bublinu označit znovu.");
      return;
    }
    const minimum = event.pointerType === "touch" ? 14 : 8;
    const finishedLasso = selectionMode === "lasso"
      ? normalizeLassoSelection([...draft, pointerPoint(event)], bounds.width, bounds.height, minimum)
      : null;
    const next = selectionMode === "lasso"
      ? finishedLasso?.bounds ?? null
      : normalizeDragSelection(start, pointerPoint(event), bounds.width, bounds.height, minimum);
    if (!next || (selectionMode === "lasso" && !finishedLasso)) {
      setSelection(null);
      setLassoPoints([]);
      setPanelVisible(true);
      setEditorOpen(true);
      setStage("select");
      setStatus(selectionMode === "lasso"
        ? "Laso musí bublinu uzavřít. Obtáhněte ji jedním souvislým tahem."
        : "Výběr byl příliš malý. Obtáhněte celou bublinu.");
      return;
    }
    const finalLasso = finishedLasso?.points ?? [];
    setLassoPoints(finalLasso);
    startSelectionPipeline(next, { sourceLanguage, targetLanguage, japaneseLayout, ocrMode }, finalLasso);
  };

  const currentTextFragment = () => selectedTextOrAll(
    sourceText,
    sourceTextRef.current?.selectionStart,
    sourceTextRef.current?.selectionEnd,
  );

  const updateSelectedFragment = () => {
    const fragment = currentTextFragment();
    setSelectedFragment(fragment === sourceText.trim() ? "" : fragment);
  };

  const startTextTranslation = (text: string, snapshot: TranslationSnapshot) => {
    const preparedText = prepareTextForTranslation(text, snapshot.sourceLanguage);
    if (!preparedText) return;
    const { revision, signal } = beginOperation("translate", "translate");
    const preparedTranslator: PreparedTranslator = prepareOnDeviceTranslator(snapshot.sourceLanguage, snapshot.targetLanguage, (progress) => {
      if (!operationIsCurrent(revision) || activeOperationRef.current !== "translate") return;
      const percent = typeof progress === "number" ? ` ${Math.round(progress * 100)} %` : "";
      setStatus(`Stahuji lokální jazykový balíček…${percent}`);
    });
    setError("");
    setTranslatedText("");
    setTranslatedFragment(text);
    setProvider("");
    setPanelVisible(true);
    setStatus("Překládám…");
    void (async () => {
      try {
        const result = await translateBestAvailable(
          preparedText,
          snapshot,
          preparedTranslator,
          signal,
        );
        if (!operationIsCurrent(revision) || !result) return;
        setTranslatedText(result.text);
        setProvider(result.provider);
        setStage("ready");
        setStatus("Hotovo · překlad proběhl přímo v tomto zařízení.");
      } catch (reason) {
        if (!operationIsCurrent(revision)) return;
        setError(reason instanceof Error ? reason.message : "Překlad se nepodařilo spustit.");
        setStatus("Text zůstal zachovaný. Můžete ho opravit nebo otevřít externí překladač.");
        setStage("error");
        setEditorOpen(true);
      } finally {
        if (operationIsCurrent(revision)) {
          activeOperationRef.current = "";
          operationAbortRef.current = null;
        }
      }
    })();
  };

  const runTranslation = () => {
    const text = currentTextFragment();
    if (!text || busy) return;
    startTextTranslation(text, { sourceLanguage, targetLanguage, japaneseLayout, ocrMode });
  };

  const copyTranslation = async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setStatus("Překlad byl zkopírován.");
    } catch {
      setError("Kopírování se nepodařilo. Označte text v poli ručně.");
    }
  };

  const openGoogleLensFallback = async () => {
    const image = imageRef.current;
    const sourceUrl = preferredImageUrl || image?.currentSrc || image?.src || "";
    if (!image || !selection || !sourceUrl || busy) return;

    const popup = window.open("", "_blank");
    if (!popup) {
      setError("Prohlížeč zablokoval nový panel. Povolte vyskakovací okna a zkuste Google Lens znovu.");
      return;
    }
    popup.document.title = "Výřez pro Google Lens";
    popup.document.body.textContent = "Připravuji výřez…";

    try {
      const variants = await cropSelection(image, sourceUrl, selection, lassoPoints.length >= 3 ? lassoPoints : undefined);
      const original = variants.find((variant) => variant.label === "originál") ?? variants[0];
      if (!original || popup.closed) throw new Error("Výřez se nepodařilo připravit.");
      const objectUrl = URL.createObjectURL(original.blob);
      const document = popup.document;
      document.documentElement.lang = "cs";
      document.body.replaceChildren();
      document.body.style.cssText = "box-sizing:border-box;min-height:100vh;margin:0;padding:32px;color:#f4f6ff;background:#111521;font:16px/1.55 system-ui,sans-serif;text-align:center";

      const heading = document.createElement("h1");
      heading.textContent = "Výřez je připravený pro Google Lens";
      heading.style.cssText = "margin:0 0 8px;font-size:24px";
      const instructions = document.createElement("p");
      instructions.textContent = "Klikněte na obrázek pravým tlačítkem, zvolte „Vyhledat pomocí Google Lens“ a potom v Lens vyberte Přeložit.";
      instructions.style.cssText = "max-width:720px;margin:0 auto 22px;color:#b8c1d9";
      const cropImage = document.createElement("img");
      cropImage.src = objectUrl;
      cropImage.alt = "Výřez manga bubliny pro Google Lens";
      cropImage.style.cssText = "display:block;max-width:min(900px,100%);max-height:65vh;margin:0 auto 22px;border:1px solid #3a435b;border-radius:10px;background:#fff;object-fit:contain";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;gap:10px";
      const lensLink = document.createElement("a");
      lensLink.href = "https://lens.google.com/";
      lensLink.target = "_blank";
      lensLink.rel = "noopener noreferrer";
      lensLink.textContent = "Otevřít web Google Lens ↗";
      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = "manga-bublina-pro-lens.png";
      downloadLink.textContent = "Stáhnout výřez";
      for (const link of [lensLink, downloadLink]) {
        link.style.cssText = "padding:10px 14px;color:#fff;border:1px solid #6579e6;border-radius:8px;background:#5267d8;text-decoration:none;font-weight:700";
      }
      actions.append(lensLink, downloadLink);
      document.body.append(heading, instructions, cropImage, actions);
      popup.addEventListener("beforeunload", () => URL.revokeObjectURL(objectUrl), { once: true });
      setStatus("Výřez je v novém panelu. Pravým tlačítkem na obrázek otevřete Google Lens a zvolte Přeložit.");
    } catch (reason) {
      if (!popup.closed) popup.document.body.textContent = "Výřez se nepodařilo připravit. Zavřete tento panel a zkuste větší oblast.";
      setError(reason instanceof Error ? reason.message : "Výřez pro Google Lens se nepodařilo připravit.");
    }
  };

  const changeSourceLanguage = (language: LanguageCode) => {
    const nextTarget = language === targetLanguage ? (language === "cs" ? "en" : "cs") : targetLanguage;
    setSourceLanguage(language);
    setTargetLanguage(nextTarget);
    setTranslatedText("");
    if (selection) startSelectionPipeline(selection, { sourceLanguage: language, targetLanguage: nextTarget, japaneseLayout, ocrMode });
  };

  const changeTargetLanguage = (language: LanguageCode) => {
    setTargetLanguage(language);
    setTranslatedText("");
    if (sourceText.trim()) startTextTranslation(sourceText, { sourceLanguage, targetLanguage: language, japaneseLayout, ocrMode });
  };

  const changeJapaneseLayout = (layout: JapaneseLayout) => {
    setJapaneseLayout(layout);
    if (selection) startSelectionPipeline(selection, { sourceLanguage, targetLanguage, japaneseLayout: layout, ocrMode });
  };

  const changeOcrMode = (mode: OcrMode) => {
    setOcrMode(mode);
    setTranslatedText("");
    setOcrProvider("");
    if (selection) startSelectionPipeline(selection, { sourceLanguage, targetLanguage, japaneseLayout, ocrMode: mode }, lassoPoints);
  };

  const editSourceText = (text: string) => {
    invalidateOperation();
    setSourceText(text);
    setTranslatedText("");
    setTranslatedFragment("");
    setSelectedFragment("");
    setProvider("");
    setError("");
    setStage("ready");
    setStatus("Text je upravený. Přeložte celý text, nebo v něm označte jen slovo.");
  };

  const editImageSelection = () => {
    if (!selection) return;
    invalidateOperation();
    setSelectionEditing(true);
    setPanelVisible(false);
    setStage("select");
    setStatus("Táhněte uvnitř pro posun, body mění velikost. Enter výběr potvrdí.");
    window.requestAnimationFrame(() => selectionLayerRef.current?.focus({ preventScroll: true }));
  };

  const confirmImageSelection = () => {
    if (!selection) return;
    setSelectionEditing(false);
    startSelectionPipeline(selection, { sourceLanguage, targetLanguage, japaneseLayout, ocrMode }, lassoPoints);
  };

  const changeSelectionMode = (mode: SelectionMode) => {
    invalidateOperation();
    setSelectionMode(mode);
    setSelectionEditing(false);
    setSelection(null);
    setDragStart(null);
    setLassoDraft([]);
    setLassoPoints([]);
    setPanelVisible(false);
    setEditorOpen(false);
    setStage("select");
    clearForNewSelection();
    setStatus(mode === "lasso"
      ? "Držte tlačítko a volně obtáhněte celou bublinu."
      : "Tažením vytvořte obdélník kolem textu.");
  };

  const chooseAnotherArea = () => {
    invalidateOperation();
    setSelection(null);
    setSelectionEditing(false);
    setDragStart(null);
    setLassoDraft([]);
    setLassoPoints([]);
    setPanelVisible(true);
    setEditorOpen(true);
    setStage("select");
    clearForNewSelection();
    setStatus(selectionMode === "lasso"
      ? "Držte tlačítko a volně obtáhněte celou bublinu."
      : "Tažením vytvořte obdélník kolem textu.");
  };

  const startImageSelection = () => {
    setPanelVisible(false);
    setEditorOpen(false);
    setStatus(selectionMode === "lasso"
      ? "Držte tlačítko a volně obtáhněte celou bublinu."
      : "Tažením vytvořte obdélník kolem textu.");
  };

  const closeTranslator = () => {
    invalidateOperation();
    onClose();
  };

  const fallbackText = translatedFragment || currentTextFragment();
  const panelSide = selection && selection.x + selection.width / 2 > 0.5 ? "left" : "right";

  return <>
    {imageBounds && <div
      ref={selectionLayerRef}
      className="reader-translation-layer"
      data-testid="translation-selection-layer"
      data-editing={selectionEditing ? "true" : "false"}
      style={{ left: imageBounds.left, top: imageBounds.top, width: imageBounds.width, height: imageBounds.height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (selectionEditing && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          confirmImageSelection();
        }
      }}
      tabIndex={selectionEditing ? 0 : -1}
      onLostPointerCapture={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        invalidateOperation();
        setDragStart(null);
        setLassoDraft([]);
        setLassoPoints([]);
        setSelectionEditing(false);
        setSelection(null);
        setPanelVisible(true);
        setEditorOpen(true);
        setStage("select");
        setStatus("Výběr se přerušil. Zkuste bublinu označit znovu.");
      }}
      onPointerCancel={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        activePointerIdRef.current = null;
        invalidateOperation();
        setDragStart(null);
        setLassoDraft([]);
        setLassoPoints([]);
        setSelectionEditing(false);
        setSelection(null);
        setPanelVisible(true);
        setEditorOpen(true);
        setStage("select");
        setStatus("Výběr byl zrušen. Zkuste oblast označit znovu.");
      }}
      aria-label="Výběr textu z manga stránky"
    >
      {!selectionEditing && <div className="reader-translation-selection-modes" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className={selectionMode === "lasso" ? "active" : ""} aria-label="Volný výběr lasem" aria-pressed={selectionMode === "lasso"} disabled={busy} onClick={() => changeSelectionMode("lasso")}>✦ LASO</button>
        <button type="button" className={selectionMode === "rectangle" ? "active" : ""} aria-label="Obdélníkový výběr" aria-pressed={selectionMode === "rectangle"} disabled={busy} onClick={() => changeSelectionMode("rectangle")}>□ OBDÉLNÍK</button>
      </div>}
      {!selection && !dragStart && <span className="reader-translation-hint">{selectionMode === "lasso" ? "OBTÁHNĚTE BUBLINU LASEM" : "OZNAČTE BUBLINU OBDÉLNÍKEM"}</span>}
      {busy && !panelVisible && <output className="reader-translation-progress" aria-live="polite">{status}</output>}
      {selectionMode === "rectangle" && selectionStyle && <i className="reader-translation-selection" data-testid="translation-selection" style={selectionStyle} />}
      {selectionMode === "lasso" && lassoPath && <svg className="reader-translation-lasso" data-testid="translation-selection" viewBox={`0 0 ${imageBounds.width} ${imageBounds.height}`} preserveAspectRatio="none" aria-hidden="true"><path d={lassoPath} /></svg>}
      {selectionEditing && selectionStyle && <div className="reader-translation-edit-box" style={selectionStyle}>{selectionResizeHandles.map((handle) => <i key={handle} data-selection-handle={handle} />)}</div>}
      {selectionEditing && <>
        <output className="reader-translation-edit-status" aria-live="polite">{status}</output>
        <div className="reader-translation-edit-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={confirmImageSelection}>POTVRDIT A ZNOVU ROZPOZNAT · ENTER</button>
          <button type="button" onClick={chooseAnotherArea}>NOVÝ VÝBĚR</button>
        </div>
      </>}
    </div>}
    {panelVisible && <section className="reader-translation-panel" data-side={panelSide} role="dialog" aria-label="Překlad textu z mangy" onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") closeTranslator();
    }}>
      <header>
        <div><span>{languageLabels[sourceLanguage]} → {languageLabels[targetLanguage]}</span><strong>Překlad bubliny</strong></div>
        <button type="button" onClick={closeTranslator} aria-label="Zavřít překladač">×</button>
      </header>
      <p className="reader-translation-status" aria-live="polite">{status}</p>
      {(selection || sourceText.trim()) && <label className="reader-translation-result">
        <span>{translatedFragment && translatedFragment !== sourceText.trim() ? "PŘEKLAD OZNAČENÉ ČÁSTI" : "PŘEKLAD CELÉ BUBLINY"}</span>
        <textarea aria-label="Překlad" value={translatedText} onChange={(event) => setTranslatedText(event.target.value)} placeholder={stage === "translate" ? "Překládám…" : "Překlad se objeví zde…"} disabled={stage === "translate"} />
      </label>}
      {selection && <div className="reader-translation-actions">
        <button className="reader-translation-copy" type="button" onClick={() => void copyTranslation()} disabled={!translatedText || busy}>KOPÍROVAT PŘEKLAD</button>
        <button className="reader-translation-edit" type="button" onClick={editImageSelection} disabled={busy}>UPRAVIT VÝBĚR</button>
        <button className="reader-translation-reselect" type="button" onClick={chooseAnotherArea}>↺ JINÁ BUBLINA</button>
        <button className="reader-translation-lens" type="button" onClick={() => void openGoogleLensFallback()} disabled={busy} title="Ruční záloha pro problematické fonty bez API a přihlášení">GOOGLE LENS · PROBLEMATICKÝ FONT ↗</button>
      </div>}
      {!selection && <button className="reader-translation-select-start" type="button" onClick={startImageSelection}>OZNAČIT BUBLINU</button>}
      {error && <div className="reader-translation-error" role="alert"><strong>Nepodařilo se</strong><span>{error}</span>{fallbackText && <button type="button" onClick={() => window.open(externalTranslationUrl(fallbackText, sourceLanguage, targetLanguage), "_blank", "noopener,noreferrer")}>Otevřít externí překladač ↗</button>}</div>}
      <details className="reader-translation-editor" open={editorOpen} onToggle={(event) => setEditorOpen(event.currentTarget.open)}>
        <summary>{selection ? "Upravit rozpoznání nebo přeložit jen slovo" : "Nastavení překladu"}</summary>
        <div className="reader-translation-languages">
          <label>Text je v<select value={sourceLanguage} onChange={(event) => changeSourceLanguage(event.target.value as LanguageCode)} aria-label="Jazyk zdrojového textu" disabled={stage === "crop" || stage === "ocr"}>{(["en", "ja", "cs", "de", "pl"] as LanguageCode[]).map((language) => <option value={language} key={language}>{languageLabels[language]}</option>)}</select></label>
          <span>→</span>
          <label>Přeložit do<select value={targetLanguage} onChange={(event) => changeTargetLanguage(event.target.value as LanguageCode)} aria-label="Cílový jazyk" disabled={stage === "crop" || stage === "ocr"}>{(["cs", "en", "de", "pl"] as LanguageCode[]).map((language) => <option value={language} key={language}>{languageLabels[language]}</option>)}</select></label>
        </div>
        <label className="reader-translation-mode">Čtení textu<select value={ocrMode} onChange={(event) => changeOcrMode(event.target.value as OcrMode)} aria-label="OCR model" disabled={stage === "crop" || stage === "ocr"}><option value="auto">PaddleOCR · doporučeno</option><option value="tesseract">Tesseract · původní</option></select><small>Při potížích se automaticky zkusí Tesseract.</small></label>
        <div className="reader-translation-mode"><span>Překlad</span><strong>Chrome · v zařízení</strong><small>Bez účtu a bez API klíče.</small></div>
        {sourceLanguage === "ja" && <label className="reader-translation-direction">Směr japonského textu<select value={japaneseLayout} onChange={(event) => changeJapaneseLayout(event.target.value as JapaneseLayout)} aria-label="Směr japonského textu" disabled={stage === "crop" || stage === "ocr"}><option value="auto">Automaticky</option><option value="vertical">Svisle</option><option value="horizontal">Vodorovně</option></select></label>}
        <label className="reader-translation-field">Rozpoznaný text <small>text lze opravit nebo v něm myší označit část</small><textarea ref={sourceTextRef} value={sourceText} onChange={(event) => editSourceText(event.target.value)} onSelect={updateSelectedFragment} onKeyUp={updateSelectedFragment} onPointerUp={updateSelectedFragment} placeholder="OCR text se objeví zde, případně ho napište ručně…" disabled={stage === "crop" || stage === "ocr"} /></label>
        <button className="reader-translation-submit" type="button" onClick={runTranslation} disabled={!sourceText.trim() || busy} aria-label="Přeložit označený nebo celý text">{stage === "translate" ? "PŘEKLÁDÁM…" : selectedFragment ? "PŘELOŽIT OZNAČENOU ČÁST" : "PŘELOŽIT UPRAVENÝ TEXT"}</button>
      </details>
      <div className="reader-translation-footer"><span>{ocrProvider ? `OCR: ${ocrProvider}. ` : ""}{provider ? `Překladač: ${provider}. ` : ""}Bez účtu a API klíče.</span></div>
    </section>}
  </>;
}
