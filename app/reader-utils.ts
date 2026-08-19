export type ReadingLanguage = "cs" | "en";

export type ReadingProgress = {
  version: 2;
  language?: ReadingLanguage;
  volumeSortKey: number;
  chapterId?: string;
  chapterNumber?: number;
  chapterLabel?: string;
  page: number;
};

export type ProgressChapter = { id?: string; number?: number; label?: string };
export type ReadingProgressStore = Record<string, string>;

type CacheableBook = { id: string; source: string };
type CacheableChapter = { id: string; remoteId?: string; externalUrl?: string };

const PROGRESS_SCOPE_SEPARATOR = "::";

export function chapterPageCacheKey(book: CacheableBook, chapter: CacheableChapter) {
  if (book.source === "web") {
    return `web:${encodeURIComponent(book.id)}:${encodeURIComponent(chapter.externalUrl ?? chapter.id)}`;
  }
  return chapter.remoteId;
}

function safePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function serializeProgress(progress: ReadingProgress) {
  return JSON.stringify({
    version: 2,
    ...(progress.language ? { language: progress.language } : {}),
    volumeSortKey: progress.volumeSortKey,
    ...(progress.chapterId ? { chapterId: progress.chapterId } : {}),
    ...(Number.isFinite(progress.chapterNumber) ? { chapterNumber: progress.chapterNumber } : {}),
    ...(progress.chapterLabel ? { chapterLabel: progress.chapterLabel } : {}),
    page: safePositiveInteger(progress.page, 1),
  });
}

export function makeProgress(language: ReadingLanguage | undefined, volumeSortKey: number, chapter: ProgressChapter, page: number) {
  return serializeProgress({
    version: 2,
    language,
    volumeSortKey,
    chapterId: chapter.id,
    chapterNumber: chapter.number,
    chapterLabel: chapter.label ?? (Number.isFinite(chapter.number) ? String(chapter.number) : undefined),
    page: safePositiveInteger(page, 1),
  });
}

function parseStructuredProgress(value: string): ReadingProgress | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<ReadingProgress> | null;
    if (!parsed || parsed.version !== 2 || !Number.isFinite(parsed.volumeSortKey)) return undefined;
    const language = parsed.language === "cs" || parsed.language === "en" ? parsed.language : undefined;
    const chapterNumber = Number.isFinite(parsed.chapterNumber) ? Number(parsed.chapterNumber) : undefined;
    const chapterId = typeof parsed.chapterId === "string" && parsed.chapterId ? parsed.chapterId : undefined;
    const chapterLabel = typeof parsed.chapterLabel === "string" && parsed.chapterLabel ? parsed.chapterLabel : undefined;
    if (!chapterId && chapterNumber === undefined && !chapterLabel) return undefined;
    return {
      version: 2,
      language,
      volumeSortKey: Number(parsed.volumeSortKey),
      chapterId,
      chapterNumber,
      chapterLabel,
      page: safePositiveInteger(parsed.page, 1),
    };
  } catch {
    return undefined;
  }
}

function parseLegacyProgress(value: string): ReadingProgress | undefined {
  const separator = value.indexOf("|");
  const languagePart = separator >= 0 ? value.slice(0, separator) : undefined;
  const positionPart = separator >= 0 ? value.slice(separator + 1) : value;
  const language = languagePart === "cs" || languagePart === "en" ? languagePart : undefined;
  const segments = positionPart.split(".");
  if (segments.length < 2 || segments.some((segment) => !/^\d+$/.test(segment))) return undefined;

  const volumeSortKey = Number(segments[0]);
  const hasSavedPage = segments.length >= 3;
  const page = hasSavedPage ? Number(segments.at(-1)) : 1;
  // Legacy values used dots both as field separators and inside decimal chapter
  // numbers. The first segment is the volume, the last is the page, and every
  // segment between them belongs to the exact chapter number.
  const chapterSegments = hasSavedPage ? segments.slice(1, -1) : segments.slice(1);
  const chapterLabel = chapterSegments.join(".");
  const chapterNumber = Number(chapterLabel);
  if (![volumeSortKey, chapterNumber, page].every(Number.isFinite)) return undefined;

  return {
    version: 2,
    language,
    volumeSortKey,
    chapterNumber,
    chapterLabel,
    page: safePositiveInteger(page, 1),
  };
}

export function parseReadingProgress(value?: string) {
  if (!value) return undefined;
  return value.trimStart().startsWith("{") ? parseStructuredProgress(value) : parseLegacyProgress(value);
}

export function progressStorageKey(bookId: string, language?: ReadingLanguage) {
  return language ? `${bookId}${PROGRESS_SCOPE_SEPARATOR}${language}` : bookId;
}

export function saveReadingProgress(store: ReadingProgressStore, bookId: string, value: string) {
  const parsed = parseReadingProgress(value);
  if (!parsed) return store;
  const normalized = serializeProgress(parsed);
  return {
    ...store,
    [bookId]: normalized,
    [progressStorageKey(bookId, parsed.language)]: normalized,
  };
}

export function findReadingProgress(store: ReadingProgressStore, bookIds: string[], language?: ReadingLanguage) {
  if (language) {
    for (const bookId of bookIds) {
      const scoped = store[progressStorageKey(bookId, language)];
      if (scoped) return scoped;
    }
  }
  for (const bookId of bookIds) if (store[bookId]) return store[bookId];
  return undefined;
}

export function removeReadingProgress(store: ReadingProgressStore, bookIds: string[]) {
  const next = { ...store };
  for (const bookId of bookIds) {
    delete next[bookId];
    delete next[progressStorageKey(bookId, "cs")];
    delete next[progressStorageKey(bookId, "en")];
  }
  return next;
}

export function migrateReadingProgressStore(value: unknown): ReadingProgressStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const migrated: ReadingProgressStore = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const parsed = parseReadingProgress(raw);
    if (!parsed) {
      migrated[key] = raw;
      continue;
    }
    const normalized = serializeProgress(parsed);
    migrated[key] = normalized;
    if (!key.includes(PROGRESS_SCOPE_SEPARATOR) && parsed.language) {
      migrated[progressStorageKey(key, parsed.language)] ??= normalized;
    }
  }
  return migrated;
}

export function progressDisplayLabel(value?: string) {
  const progress = parseReadingProgress(value);
  if (!progress) return "—";
  const chapter = progress.chapterLabel ?? progress.chapterNumber ?? progress.chapterId ?? "?";
  return `${progress.language ? `${progress.language.toUpperCase()} · ` : ""}${progress.volumeSortKey}.${chapter}.${progress.page}`;
}

export function fitReaderImageSize(imageWidth: number, imageHeight: number, availableWidth: number, availableHeight: number) {
  if (![imageWidth, imageHeight, availableWidth, availableHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const ratio = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  return { width: Math.max(1, Math.floor(imageWidth * ratio)), height: Math.max(1, Math.floor(imageHeight * ratio)) };
}

export function epubLanguage(language?: string): ReadingLanguage {
  return language === "en" ? "en" : "cs";
}
