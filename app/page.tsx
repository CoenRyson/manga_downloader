"use client";
/* eslint-disable @next/next/no-img-element -- reader pages include blob URLs and allowlisted proxy URLs that Next Image cannot safely optimize */

import { ChangeEvent, CSSProperties, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { bestAliasScore, mangaIdentityMatches, matchesMangaQuery, normalizeTitle, titleSearchTier } from "./title-matching";
import { createImagePdf } from "./pdf-utils";
import { mapWithConcurrency } from "./export-utils";
import { readerFixtureBook } from "./reader-fixture";
import {
  makeExportFileName,
  readableExportLabel,
  sanitizeDownloadName,
  saveDownloadBlob,
} from "./download-utils";
import {
  chapterPageCacheKey,
  epubLanguage,
  findReadingProgress,
  makeProgress,
  migrateReadingProgressStore,
  parseReadingProgress,
  progressDisplayLabel,
  removeReadingProgress,
  saveReadingProgress,
} from "./reader-utils";

type Chapter = { id: string; number: number; label?: string; title: string; pages: number; remoteId?: string; language?: string; externalUrl?: string };
type Volume = { id: string; number: number; sortKey?: number; displayLabel?: string; confirmed?: boolean; title: string; year: string; chapters: Chapter[] };
type LocalPage = { name: string; url: string; fallbackUrl?: string; thumbnailUrl?: string; thumbnailFallbackUrl?: string };

type ExportedPage = { name: string; data: Uint8Array; extension: string; mediaType: string };
type CompletionRecord = { chapterCount: number; completedAt: string };
type Manga = {
  id: string;
  title: string;
  czechTitle: string;
  aliases: string[];
  author: string;
  description: string;
  genres: string[];
  year: string;
  rating?: number;
  ratingCount?: number;
  favourites?: number;
  ratingSource?: string;
  status: string;
  license: string;
  source: "local" | "web" | "mangadex" | "anilist" | "googlebooks" | "jikan" | "openlibrary";
  accent: string;
  accentSoft: string;
  volumes: Volume[];
  localPages?: LocalPage[];
  remoteId?: string;
  coverUrl?: string;
  officialUrl?: string;
  mergedIds?: string[];
  mergedSources?: Manga["source"][];
};

type View = "home" | "library" | "detail" | "reader" | "webreader" | "downloads" | "settings";
type ReadingLanguage = "cs" | "en";
type ExportRecord = { id: string; title: string; format: "CBZ" | "PDF" | "EPUB" | "KINDLE"; when: string };
type DownloadFormat = "CBZ" | "EPUB" | "PDF" | "KINDLE";
type DownloadMode = "volumes" | "chapters";
type RemoteStatus = "idle" | "loading" | "ready" | "partial" | "error";
const CATALOGUE_CACHE_VERSION = "2026-08-search-v4";
type ReaderHistoryState = { mangaReaderView: View; selectedId?: string; volumeId?: string; chapterId?: string; readerPage?: number };
type WebReaderSource = {
  title: string;
  source: string;
  startUrl: string;
  homeUrl: string;
  mode: "direct" | "search";
  reason: string;
  startLabel: string;
  homeLabel: string;
};

type MangaDexRelationship = { type: string; attributes?: { fileName?: string; name?: string } };
type MangaDexItem = {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    year?: number | null;
    status?: string;
    links?: Record<string, string> | null;
    tags?: { attributes?: { name?: Record<string, string> } }[];
  };
  relationships?: MangaDexRelationship[];
};

type GoogleBookItem = {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    categories?: string[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    averageRating?: number;
    ratingsCount?: number;
    previewLink?: string;
    infoLink?: string;
  };
  accessInfo?: { viewability?: string; webReaderLink?: string };
};

type AniListItem = {
  id: number;
  format?: string;
  title?: { romaji?: string; english?: string; native?: string };
  description?: string;
  coverImage?: { extraLarge?: string; large?: string };
  siteUrl?: string;
  status?: string;
  startDate?: { year?: number };
  genres?: string[];
  averageScore?: number;
  meanScore?: number;
  favourites?: number;
  staff?: { nodes?: { name?: { full?: string } }[] };
};

type JikanItem = {
  mal_id: number;
  type?: string;
  url?: string;
  title?: string;
  title_english?: string;
  title_japanese?: string;
  synopsis?: string;
  images?: { jpg?: { large_image_url?: string; image_url?: string }; webp?: { large_image_url?: string } };
  status?: string;
  published?: { from?: string };
  genres?: { name?: string }[];
  authors?: { name?: string }[];
  score?: number;
  scored_by?: number;
};

type OpenLibraryItem = {
  key: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  public_scan_b?: boolean;
  edition_count?: number;
};

type MangaDexStatistics = { statistics?: Record<string, { rating?: { average?: number; bayesian?: number; distribution?: Record<string, number> }; follows?: number }> };

const mangaDexPlaceholder = (id: string): Volume[] => [{ id: `${id}-pending`, number: 0, title: "Načítám kapitoly…", year: "", chapters: [{ id: `${id}-pending-chapter`, number: 0, title: "Kapitoly se načítají", pages: 0 }] }];

function refreshCachedBook(book: Manga) {
  if (book.source !== "web") return { ...book, mergedIds: undefined, mergedSources: undefined };
  const source: Manga["source"] | undefined = book.id.startsWith("md-") ? "mangadex"
    : book.id.startsWith("al-") ? "anilist"
      : book.id.startsWith("gb-") ? "googlebooks"
        : book.id.startsWith("jk-") ? "jikan"
          : book.id.startsWith("ol-") ? "openlibrary"
            : undefined;
  if (!source) return undefined;
  return { ...book, source, volumes: mangaDexPlaceholder(book.remoteId ?? book.id), mergedIds: undefined, mergedSources: undefined };
}

const emptySelection: Manga = {
  id: "", title: "", czechTitle: "", aliases: [], author: "", description: "", genres: [], year: "", status: "", license: "", source: "local",
  accent: "#7d1b22", accentSoft: "#eee9e1", volumes: [{ id: "", number: 0, title: "", year: "", chapters: [{ id: "", number: 0, title: "", pages: 0 }] }],
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0); u16(lv, 8, 0);
    u16(lv, 10, dosTime); u16(lv, 12, dosDate); u32(lv, 14, checksum);
    u32(lv, 18, file.data.length); u32(lv, 22, file.data.length); u16(lv, 26, name.length); u16(lv, 28, 0);
    local.set(name, 30); local.set(file.data, 30 + name.length); localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0); u16(cv, 10, 0);
    u16(cv, 12, dosTime); u16(cv, 14, dosDate); u32(cv, 16, checksum);
    u32(cv, 20, file.data.length); u32(cv, 24, file.data.length); u16(cv, 28, name.length);
    u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
    central.set(name, 46); centralParts.push(central); offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, files.length);
  u16(ev, 10, files.length); u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
  const result = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}

function safeName(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function safeSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function localizedText(values?: Record<string, string>, preferred = ["cs", "en", "ja-ro"]) {
  if (!values) return "";
  for (const language of preferred) if (values[language]) return values[language];
  return Object.values(values)[0] ?? "";
}

function mapMangaDexItem(item: MangaDexItem): Manga {
  const attributes = item.attributes;
  const cover = item.relationships?.find((relationship) => relationship.type === "cover_art")?.attributes?.fileName;
  const authors = item.relationships?.filter((relationship) => relationship.type === "author" || relationship.type === "artist").map((relationship) => relationship.attributes?.name).filter(Boolean) as string[] | undefined;
  const altValues = (attributes.altTitles ?? []).flatMap((entry) => Object.values(entry));
  const englishTitle = localizedText(attributes.title, ["en", "ja-ro", "cs"]);
  const czechTitle = attributes.title.cs ?? (attributes.altTitles ?? []).find((entry) => entry.cs)?.cs ?? altValues.find((value) => value !== englishTitle) ?? "MangaDex titul";
  const officialUrl = attributes.links?.engtl ?? attributes.links?.raw;
  const tags = (attributes.tags ?? []).map((tag) => localizedText(tag.attributes?.name, ["cs", "en"])).filter(Boolean).slice(0, 3);
  return {
    id: `md-${item.id}`,
    remoteId: item.id,
    title: englishTitle || czechTitle || "Bez názvu",
    czechTitle,
    aliases: [englishTitle, czechTitle, ...altValues].filter(Boolean).map((value) => value.toLocaleLowerCase("cs")),
    author: authors?.join(", ") || "MangaDex",
    description: localizedText(attributes.description, ["cs", "en"]) || "Popis není v tomto jazyce dostupný.",
    genres: tags.length ? tags : ["Manga"],
    year: attributes.year ? String(attributes.year) : "—",
    status: attributes.status === "completed" ? "Dokončeno" : attributes.status === "ongoing" ? "Vychází" : attributes.status ?? "—",
    license: "Čtení na MangaDexu",
    source: "mangadex",
    accent: "#ff6740",
    accentSoft: "#ffe1d8",
    coverUrl: cover ? `https://uploads.mangadex.org/covers/${item.id}/${cover}.512.jpg` : undefined,
    officialUrl: officialUrl?.startsWith("http") ? officialUrl : undefined,
    volumes: mangaDexPlaceholder(item.id),
  };
}

function cleanMarkup(value?: string) {
  return (value ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function mapGoogleBook(item: GoogleBookItem): Manga {
  const info = item.volumeInfo ?? {};
  const title = info.title?.trim() || "Bez názvu";
  const preview = item.accessInfo?.webReaderLink ?? info.previewLink ?? info.infoLink;
  const viewability = item.accessInfo?.viewability ?? "NO_PAGES";
  const image = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
  return {
    id: `gb-${item.id}`,
    title,
    czechTitle: info.subtitle || "Google Books vydání",
    aliases: [title, info.subtitle ?? ""].filter(Boolean).map((value) => value.toLocaleLowerCase("cs")),
    author: info.authors?.join(", ") || "Neuvedený autor",
    description: cleanMarkup(info.description) || "Popis vydání není dostupný.",
    genres: info.categories?.slice(0, 3) ?? ["Kniha"],
    year: info.publishedDate?.slice(0, 4) || "—",
    rating: typeof info.averageRating === "number" ? info.averageRating * 2 : undefined,
    ratingCount: info.ratingsCount,
    ratingSource: typeof info.averageRating === "number" ? "Google Books" : undefined,
    status: viewability === "ALL_PAGES" ? "Plný náhled" : viewability === "PARTIAL" ? "Částečný náhled" : "Katalog",
    license: "Google Books",
    source: "googlebooks",
    accent: "#4285f4",
    accentSoft: "#dce7ff",
    coverUrl: image?.replace(/^http:\/\//, "https://"),
    officialUrl: preview,
    volumes: mangaDexPlaceholder(`gb-${item.id}`),
  };
}

function mapAniListItem(item: AniListItem): Manga {
  const title = item.title?.english ?? item.title?.romaji ?? item.title?.native ?? "Bez názvu";
  const alternate = item.title?.native ?? item.title?.romaji ?? "AniList titul";
  return {
    id: `al-${item.id}`,
    title,
    czechTitle: alternate,
    aliases: [item.title?.english, item.title?.romaji, item.title?.native].filter(Boolean).map((value) => (value as string).toLocaleLowerCase("cs")),
    author: item.staff?.nodes?.map((node) => node.name?.full).filter(Boolean).join(", ") || "AniList",
    description: cleanMarkup(item.description) || "Popis titulu není dostupný.",
    genres: item.genres?.slice(0, 3) ?? ["Manga"],
    year: item.startDate?.year ? String(item.startDate.year) : "—",
    rating: typeof (item.averageScore ?? item.meanScore) === "number" ? (item.averageScore ?? item.meanScore)! / 10 : undefined,
    favourites: item.favourites,
    ratingSource: typeof (item.averageScore ?? item.meanScore) === "number" ? "AniList" : undefined,
    status: item.status === "FINISHED" ? "Dokončeno" : item.status === "RELEASING" ? "Vychází" : item.status ?? "Katalog",
    license: "AniList katalog",
    source: "anilist",
    accent: "#2e9ef7",
    accentSoft: "#d9efff",
    coverUrl: item.coverImage?.extraLarge ?? item.coverImage?.large,
    officialUrl: item.siteUrl,
    volumes: mangaDexPlaceholder(`al-${item.id}`),
  };
}

function mapJikanItem(item: JikanItem): Manga {
  const title = item.title_english ?? item.title ?? item.title_japanese ?? "Bez názvu";
  const alternate = item.title_japanese ?? item.title ?? "MyAnimeList titul";
  return {
    id: `jk-${item.mal_id}`,
    title,
    czechTitle: alternate,
    aliases: [item.title, item.title_english, item.title_japanese].filter(Boolean).map((value) => (value as string).toLocaleLowerCase("cs")),
    author: item.authors?.map((author) => author.name).filter(Boolean).join(", ") || "MyAnimeList",
    description: cleanMarkup(item.synopsis) || "Popis titulu není dostupný.",
    genres: item.genres?.map((genre) => genre.name).filter(Boolean).slice(0, 3) as string[] || ["Manga"],
    year: item.published?.from?.slice(0, 4) || "—",
    rating: item.score,
    ratingCount: item.scored_by,
    ratingSource: typeof item.score === "number" ? "MyAnimeList" : undefined,
    status: item.status ?? "Katalog",
    license: "MyAnimeList přes Jikan",
    source: "jikan",
    accent: "#e24545",
    accentSoft: "#f7dada",
    coverUrl: item.images?.webp?.large_image_url ?? item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url,
    officialUrl: item.url,
    volumes: mangaDexPlaceholder(`jk-${item.mal_id}`),
  };
}

function mapOpenLibraryItem(item: OpenLibraryItem): Manga {
  const title = item.title?.trim() || "Bez názvu";
  return {
    id: `ol-${item.key.replace(/\W/g, "")}`,
    title,
    czechTitle: item.public_scan_b ? "Dostupné v digitální knihovně" : "Open Library vydání",
    aliases: [title].map((value) => value.toLocaleLowerCase("cs")),
    author: item.author_name?.join(", ") || "Neuvedený autor",
    description: `${item.edition_count ?? 1} evidovaných vydání v otevřeném knihovním katalogu.`,
    genres: ["Knihovna", "Manga"],
    year: item.first_publish_year ? String(item.first_publish_year) : "—",
    status: item.public_scan_b ? "Digitální výpůjčka / náhled" : "Katalog",
    license: "Open Library",
    source: "openlibrary",
    accent: "#f0a33a",
    accentSoft: "#f8e7c7",
    coverUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : undefined,
    officialUrl: `https://openlibrary.org${item.key}`,
    volumes: mangaDexPlaceholder(`ol-${item.key.replace(/\W/g, "")}`),
  };
}

function sourceTitle(source: Manga["source"]) {
  if (source === "mangadex") return "MANGADEX";
  if (source === "anilist") return "ANILIST";
  if (source === "googlebooks") return "GOOGLE BOOKS";
  if (source === "jikan") return "MYANIMELIST";
  if (source === "openlibrary") return "OPEN LIBRARY";
  if (source === "web") return "WEBOVÝ ZDROJ";
  if (source === "local") return "MÍSTNÍ";
  return "MÍSTNÍ";
}

function normalizeSearch(value: string) {
  return normalizeTitle(value);
}

const READER_FIT_MODE_STORAGE_KEY = "manga-reader-fit-mode";
const READER_SCALE_STORAGE_KEY = "manga-reader-scale";

function chapterStats(book: Manga) {
  const chapters = book.volumes.flatMap((volume) => volume.chapters);
  return {
    internal: chapters.filter((item) => item.pages > 0 && !item.externalUrl).length,
    external: chapters.filter((item) => Boolean(item.externalUrl)).length,
    total: chapters.filter((item) => item.pages > 0 || item.externalUrl).length,
  };
}

function ratingLabel(book: Manga) {
  return typeof book.rating === "number" ? `${book.rating.toFixed(1)} / 10` : "Bez hodnocení";
}

function ratingMeta(book: Manga) {
  if (typeof book.rating !== "number") return "Katalog zatím skóre neposkytl";
  const count = book.ratingCount ? ` · ${book.ratingCount.toLocaleString("cs-CZ")} hodnocení` : "";
  return `${book.ratingSource ?? "Katalog"}${count}`;
}

function bookRichness(book: Manga) {
  const stats = chapterStats(book);
  return stats.internal * 100 + stats.external * 10 + (book.coverUrl ? 2 : 0) + (book.description ? 1 : 0);
}

function readingCapability(book: Manga) {
  const stats = chapterStats(book);
  const sourcePriority: Record<Manga["source"], number> = { local: 40, web: 30, mangadex: 20, anilist: 0, googlebooks: 0, jikan: 0, openlibrary: 0 };
  return stats.internal * 10000 + stats.external * 1000 + sourcePriority[book.source];
}

function mergeCatalogueBooks(left: Manga, right: Manga) {
  if (left.id === right.id) {
    const winner = bookRichness(right) >= bookRichness(left) ? right : left;
    const other = winner === right ? left : right;
    return { ...winner, volumes: chapterStats(other).total > chapterStats(winner).total ? other.volumes : winner.volumes };
  }

  const primary = readingCapability(right) > readingCapability(left) ? right : left;
  const metadata = bookRichness(right) > bookRichness(left) ? right : left;
  const ratingBook = typeof primary.rating === "number" ? primary : metadata;
  return {
    ...primary,
    aliases: [...new Set([...primary.aliases, ...metadata.aliases, metadata.title, metadata.czechTitle])].filter(Boolean),
    description: primary.description.length >= metadata.description.length ? primary.description : metadata.description,
    genres: [...new Set([...primary.genres, ...metadata.genres])].slice(0, 6),
    coverUrl: primary.coverUrl ?? metadata.coverUrl,
    officialUrl: primary.officialUrl ?? metadata.officialUrl,
    rating: ratingBook.rating,
    ratingCount: ratingBook.ratingCount,
    favourites: primary.favourites ?? metadata.favourites,
    ratingSource: ratingBook.ratingSource,
    mergedIds: [...new Set([primary.id, metadata.id, ...(primary.mergedIds ?? []), ...(metadata.mergedIds ?? [])])],
    mergedSources: [...new Set([primary.source, metadata.source, ...(primary.mergedSources ?? []), ...(metadata.mergedSources ?? [])])],
  };
}

function searchScore(book: Manga, query: string) {
  if (!query) return 0;
  const sourcePriority: Record<Manga["source"], number> = { local: -3, web: -2, mangadex: 0, anilist: 5, jikan: 7, googlebooks: 9, openlibrary: 11 };
  return titleSearchTier(book, query) + sourcePriority[book.source];
}

function firstReadableChapter(book: Manga) {
  for (const volume of book.volumes) {
    const item = volume.chapters.find((chapterItem) => chapterItem.pages > 0 && !chapterItem.externalUrl);
    if (item) return { volume, item };
  }
  return undefined;
}

function volumesInLanguage(book: Manga, language: ReadingLanguage) {
  if (book.source !== "mangadex") return book.volumes;
  return book.volumes.map((volume) => ({
    ...volume,
    chapters: volume.chapters.filter((chapter) => chapter.language === language),
  })).filter((volume) => volume.chapters.length > 0);
}

function languageChapterCount(book: Manga, language: ReadingLanguage) {
  return volumesInLanguage(book, language).reduce((total, volume) => total + volume.chapters.filter((chapter) => chapter.pages > 0 || chapter.externalUrl).length, 0);
}

function readableChapterCount(book: Manga) {
  if (book.source !== "mangadex") return chapterStats(book).internal;
  const czech = languageChapterCount(book, "cs");
  const english = languageChapterCount(book, "en");
  return czech || english;
}

function progressLabel(value?: string) {
  return progressDisplayLabel(value);
}

const GENERIC_AUTHOR_PLACEHOLDERS = new Set(["mangadex", "neuveden autor", "anilist", "myanimelist"].map(normalizeSearch));
const normalizedNameCache = new WeakMap<Manga, string[]>();

function normalizedNamesFor(book: Manga) {
  let cached = normalizedNameCache.get(book);
  if (!cached) {
    cached = [book.title, book.czechTitle, ...book.aliases].map(normalizeSearch).filter(Boolean);
    normalizedNameCache.set(book, cached);
  }
  return cached;
}

function mangaIdentityMatches(left: Manga, right: Manga) {
  const leftNames = new Set(normalizedNamesFor(left));
  const rightNames = normalizedNamesFor(right);
  if (rightNames.some((name) => leftNames.has(name))) return true;
  const leftAuthor = normalizeSearch(left.author);
  const rightAuthor = normalizeSearch(right.author);
  const authorsMatch = leftAuthor === rightAuthor && leftAuthor.length > 2 && !GENERIC_AUTHOR_PLACEHOLDERS.has(leftAuthor);
  const yearsMatch = Boolean(left.year && right.year && left.year === right.year);
  if (!authorsMatch && !yearsMatch) return false;
  // Only merge near-identical titles (minor formatting/romanization drift), not
  // spin-offs, specials or artbooks that merely share the base title as a prefix —
  // those are distinct works, even by the same author/year (e.g. "Death Note" vs.
  // "Death Note: Never Complete" or "... (Official Colored)").
  return rightNames.some((rightName) => [...leftNames].some((leftName) => {
    const longer = Math.max(leftName.length, rightName.length);
    const shorter = Math.min(leftName.length, rightName.length);
    return shorter >= 7 && longer - shorter <= 6 && (leftName.includes(rightName) || rightName.includes(leftName));
  }));
}

function volumeSortKey(volume: Volume) {
  return volume.sortKey ?? volume.number;
}

function volumeDisplayLabel(volume: Volume) {
  if (volume.displayLabel) return volume.displayLabel;
  if (volume.number >= 100000) return "BEZ SVAZKU";
  return `SV. ${String(volume.number).padStart(2, "0")}`;
}

function chapterDisplayNumber(chapter: Pick<Chapter, "number" | "label">) {
  return chapter.label ?? String(chapter.number);
}

function volumeTitle(volume: Volume) {
  return volume.title || (volume.number >= 100000 ? "Kapitoly bez svazku" : `Svazek ${volume.number}`);
}

function openExternal(url?: string) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  } catch { /* Neplatný externí odkaz ignorujeme. */ }
}

function webReaderSourceFor(book: Manga): WebReaderSource {
  const names = [book.title, book.czechTitle, ...book.aliases].map(normalizeSearch);
  if (names.some((name) => name === "goblin slayer")) return {
    title: book.title,
    source: "GoblinSlayerFree · přímá shoda · EN",
    startUrl: "https://goblinslayerfree.com/manga/goblin-slayer-chapter-1/",
    homeUrl: "https://goblinslayerfree.com/",
    mode: "direct",
    reason: "Přesná shoda názvu a přímý seznam kapitol.",
    startLabel: "Kapitola 1",
    homeLabel: "Seznam kapitol",
  };
  if (names.some((name) => name === "dandadan" || name === "dan da dan")) return {
    title: book.title,
    source: "Dandadan Manga Online · přímá shoda · EN",
    startUrl: "https://dandadanmanga-online.net/manga/dandadan-chapter-1/",
    homeUrl: "https://dandadanmanga-online.net/",
    mode: "direct",
    reason: "Přesná shoda názvu a přímý seznam kapitol.",
    startLabel: "Kapitola 1",
    homeLabel: "Seznam kapitol",
  };

  const searchUrl = `https://www.mangaread.org/?s=${encodeURIComponent(book.title)}&post_type=wp-manga`;
  return {
    title: book.title,
    source: "MangaRead · automatické hledání · EN",
    startUrl: searchUrl,
    homeUrl: searchUrl,
    mode: "search",
    reason: "Přímé kapitoly nebyly nalezeny; otevírám výsledky obecného manga katalogu.",
    startLabel: "Výsledky hledání",
    homeLabel: "Hledat znovu",
  };
}

function Cover({ book, compact = false }: { book: Manga; compact?: boolean }) {
  return (
    <div className={`book-cover ${compact ? "compact" : ""}`} style={{ "--book-accent": book.accent, "--book-soft": book.accentSoft } as CSSProperties}>
      {book.localPages?.[0] || book.coverUrl ? <img src={book.localPages?.[0]?.url ?? book.coverUrl} alt="" referrerPolicy="no-referrer" /> : <>
        <span className="cover-series">{sourceTitle(book.source)}</span>
        <div className="cover-disc" /><div className="cover-line line-one" /><div className="cover-line line-two" />
        <strong>{book.title}</strong><small>{book.czechTitle}</small><b>{book.year}</b>
      </>}
    </div>
  );
}

function ComicSheet({ book, currentChapter, page, localPage }: { book: Manga; currentChapter: Chapter; page: number; localPage?: LocalPage }) {
  if (localPage) return <article className="comic-sheet image-sheet" style={{ "--book-accent": book.accent, "--book-soft": book.accentSoft } as CSSProperties}><img src={localPage.url} alt={`${book.title}, stránka ${page}`} referrerPolicy="no-referrer" onError={(event) => {
    if (!localPage.fallbackUrl || event.currentTarget.dataset.fallbackApplied) return;
    event.currentTarget.dataset.fallbackApplied = "true";
    event.currentTarget.src = localPage.fallbackUrl;
  }} /></article>;
  const captions = ["Začalo to obyčejným tichem.", "Tohle místo na mapě nebylo.", "Zpráva přišla o den dřív.", "Nikdo se neměl otočit.", "Dveře přesto zůstaly otevřené.", "Pokračování příště."];
  return (
    <article className={`comic-sheet comic-layout-${page % 3}`} style={{ "--book-accent": book.accent, "--book-soft": book.accentSoft } as CSSProperties}>
      <header><span>{book.title}</span><span>KAP. {currentChapter.number} · {currentChapter.title}</span></header>
      <div className="comic-grid">
        <div className="comic-panel panel-a"><div className="comic-sun" /><span className="caption">{captions[(page - 1) % captions.length]}</span></div>
        <div className="comic-panel panel-b"><i>…</i><span className="bubble">Slyšíš to taky?</span></div>
        <div className="comic-panel panel-c"><div className="speed-lines" /><span className="sfx">KRRR</span></div>
        <div className="comic-panel panel-d"><span className="bubble dark">Neohlížej se.</span></div>
      </div>
      <footer><span>MANGA READER</span><span>{page} / {currentChapter.pages}</span></footer>
    </article>
  );
}

export default function Home() {
  const [view, setViewState] = useState<View>("home");
  const navigate = (nextView: View) => {
    setViewState(nextView);
    if (typeof window !== "undefined" && view !== nextView) {
      window.history.pushState({ mangaReaderView: nextView }, "", window.location.href);
    }
  };
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(window.localStorage.getItem("manga-reader-theme") === "dark" ? "dark" : "light");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      safeSetItem("manga-reader-theme", next);
      return next;
    });
  };
  const [homeTab, setHomeTab] = useState<"continue" | "completed" | "downloads">("continue");
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [localBooks, setLocalBooks] = useState<Manga[]>([]);
  const [mangaDexBooks, setMangaDexBooks] = useState<Manga[]>([]);
  const [discoveryBooks, setDiscoveryBooks] = useState<Manga[]>([]);
  const [storedBooks, setStoredBooks] = useState<Manga[]>([]);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>("idle");
  const [discoveryStatus, setDiscoveryStatus] = useState<RemoteStatus>("idle");
  const [remoteBookLoading, setRemoteBookLoading] = useState(false);
  const [remotePages, setRemotePages] = useState<Record<string, LocalPage[]>>({});
  const [readerLoading, setReaderLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [volumeId, setVolumeId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [libraryIds, setLibraryIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<Record<string, CompletionRecord>>({});
  const [sourceFilter, setSourceFilter] = useState<"all" | "readable" | Manga["source"]>("all");
  const [yearFilter, setYearFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [minRating, setMinRating] = useState("");
  const [sortMode, setSortMode] = useState<"relevance" | "rating" | "newest" | "oldest">("relevance");
  const [mangaLanguage, setMangaLanguage] = useState<ReadingLanguage>("cs");
  const [languageByBook, setLanguageByBook] = useState<Record<string, ReadingLanguage>>({});
  const [readerScale, setReaderScale] = useState(100);
  const [readerFitMode, setReaderFitMode] = useState<"fit" | "manual">("fit");
  const [readerPage, setReaderPage] = useState(0);
  const [chapterPanel, setChapterPanel] = useState(true);
  const [readerMenuOpen, setReaderMenuOpen] = useState(false);

  useEffect(() => {
    const restore = (state?: Partial<ReaderHistoryState> | null) => {
      if (!state?.mangaReaderView) return false;
      setViewState(state.mangaReaderView);
      if (typeof state.selectedId === "string") setSelectedId(state.selectedId);
      if (typeof state.volumeId === "string") setVolumeId(state.volumeId);
      if (typeof state.chapterId === "string") setChapterId(state.chapterId);
      if (typeof state.readerPage === "number") setReaderPage(Math.max(0, state.readerPage));
      return true;
    };
    if (!restore(window.history.state as Partial<ReaderHistoryState> | null)) {
      window.history.replaceState({ ...window.history.state, mangaReaderView: "home" }, "", window.location.href);
    }
    const handlePopState = (event: PopStateEvent) => { restore(event.state as Partial<ReaderHistoryState> | null); };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const current = window.history.state as Partial<ReaderHistoryState> | null;
    if (current?.mangaReaderView !== view) return;
    const state: ReaderHistoryState = { mangaReaderView: view, selectedId, volumeId, chapterId, readerPage };
    window.history.replaceState(state, "", window.location.href);
  }, [view, selectedId, volumeId, chapterId, readerPage]);
  const [readerPanelTab, setReaderPanelTab] = useState<"contents" | "pages">("contents");
  const [importOpen, setImportOpen] = useState(false);
  const [importTitle, setImportTitle] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState("");
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("CBZ");
  const [downloadMode, setDownloadMode] = useState<DownloadMode>("volumes");
  const [downloadName, setDownloadName] = useState("");
  const [downloadChapterIds, setDownloadChapterIds] = useState<string[]>([]);
  const [downloadVolumeIds, setDownloadVolumeIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [webReader, setWebReader] = useState<WebReaderSource>();
  const [webReaderUrl, setWebReaderUrl] = useState("");
  const [webReaderResolving, setWebReaderResolving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const chapterLoadIdRef = useRef(0);
  const catalogueItemRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const storedLibrary = window.localStorage.getItem("shiori-library");
    const storedProgress = window.localStorage.getItem("shiori-progress");
    const storedCompleted = window.localStorage.getItem("shiori-completed");
    const storedRecent = window.localStorage.getItem("shiori-recent");
    const storedCatalogue = window.localStorage.getItem("manga-reader-books");
    const storedCatalogueVersion = window.localStorage.getItem("manga-reader-cache-version");
    const storedLanguages = window.localStorage.getItem("manga-reader-languages");
    const storedReaderFitMode = window.localStorage.getItem(READER_FIT_MODE_STORAGE_KEY);
    const storedReaderScale = Number(window.localStorage.getItem(READER_SCALE_STORAGE_KEY));
    queueMicrotask(() => {
      try { if (storedLibrary) setLibraryIds(JSON.parse(storedLibrary)); } catch { window.localStorage.removeItem("shiori-library"); }
      try {
        if (storedProgress) {
          const migrated = migrateReadingProgressStore(JSON.parse(storedProgress));
          setProgress(migrated);
          safeSetItem("shiori-progress", JSON.stringify(migrated));
        }
      } catch { window.localStorage.removeItem("shiori-progress"); }
      try { if (storedCompleted) setCompleted(JSON.parse(storedCompleted)); } catch { window.localStorage.removeItem("shiori-completed"); }
      try { if (storedRecent) setRecentIds(JSON.parse(storedRecent)); } catch { window.localStorage.removeItem("shiori-recent"); }
      try {
        if (storedCatalogue) {
          const parsed = JSON.parse(storedCatalogue) as unknown;
          if (!Array.isArray(parsed)) throw new Error("Neplatná cache katalogu");
          const migrated = storedCatalogueVersion === CATALOGUE_CACHE_VERSION
            ? parsed as Manga[]
            : (parsed as Manga[]).map((book) => book && refreshCachedBook(book)).filter((book): book is Manga => Boolean(book));
          setStoredBooks(migrated);
          if (storedCatalogueVersion !== CATALOGUE_CACHE_VERSION) safeSetItem("manga-reader-books", JSON.stringify(migrated));
        }
        safeSetItem("manga-reader-cache-version", CATALOGUE_CACHE_VERSION);
      } catch {
        window.localStorage.removeItem("manga-reader-books");
        safeSetItem("manga-reader-cache-version", CATALOGUE_CACHE_VERSION);
      }
      try { if (storedLanguages) setLanguageByBook(JSON.parse(storedLanguages)); } catch { window.localStorage.removeItem("manga-reader-languages"); }
      if (storedReaderFitMode === "manual") setReaderFitMode("manual");
      if (Number.isFinite(storedReaderScale) && storedReaderScale >= 60 && storedReaderScale <= 160) setReaderScale(storedReaderScale);
    });
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("readerFixture") === "1") {
      const fixture = readerFixtureBook as Manga;
      setLocalBooks([fixture]);
      const currentHistory = window.history.state as Partial<ReaderHistoryState> | null;
      if (currentHistory?.mangaReaderView === "reader") {
        setSelectedId(currentHistory.selectedId ?? fixture.id);
        setVolumeId(currentHistory.volumeId ?? fixture.volumes[0].id);
        setChapterId(currentHistory.chapterId ?? fixture.volumes[0].chapters[0].id);
      } else {
        setSelectedId(fixture.id);
        setVolumeId(fixture.volumes[0].id);
        setChapterId(fixture.volumes[0].chapters[0].id);
        setViewState("detail");
        window.history.replaceState({ mangaReaderView: "detail", selectedId: fixture.id, volumeId: fixture.volumes[0].id, chapterId: fixture.volumes[0].chapters[0].id, readerPage: 0 }, "", window.location.href);
      }
    }
  }, []);

  useEffect(() => {
    const title = query.trim();
    if (title.length < 2 || (sourceFilter !== "all" && sourceFilter !== "readable" && sourceFilter !== "mangadex")) {
      queueMicrotask(() => setRemoteStatus("idle"));
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRemoteStatus("loading");
      try {
        const params = new URLSearchParams();
        params.set("title", title);
        params.set("limit", "12");
        params.append("includes[]", "cover_art");
        params.append("includes[]", "author");
        params.append("includes[]", "artist");
        params.append("contentRating[]", "safe");
        params.append("contentRating[]", "suggestive");
        params.append("contentRating[]", "erotica");
        const response = await fetch(`/api/mangadex-search?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`MangaDex ${response.status}`);
        const payload = await response.json() as { data?: MangaDexItem[] };
        const initialIncoming = (payload.data ?? []).map(mapMangaDexItem);
        let incoming = initialIncoming;
        try {
          const statisticsParams = new URLSearchParams();
          for (const book of initialIncoming) if (book.remoteId) statisticsParams.append("manga[]", book.remoteId);
          const statisticsResponse = await fetch(`/api/mangadex-search/statistics?${statisticsParams.toString()}`, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (statisticsResponse.ok) {
            const statistics = await statisticsResponse.json() as MangaDexStatistics;
            incoming = initialIncoming.map((book) => {
              const item = book.remoteId ? statistics.statistics?.[book.remoteId] : undefined;
              const distribution = item?.rating?.distribution;
              const ratingCount = distribution ? Object.values(distribution).reduce((total, count) => total + count, 0) : undefined;
              const rating = item?.rating?.bayesian ?? item?.rating?.average;
              return typeof rating === "number" ? { ...book, rating, ratingCount, ratingSource: "MangaDex" } : book;
            });
          }
        } catch { /* Výsledky bez hodnocení zůstávají použitelné. */ }
        setMangaDexBooks((current) => {
          const merged = new Map(current.map((book) => [book.id, book]));
          for (const book of incoming) merged.set(book.id, { ...book, volumes: merged.get(book.id)?.volumes ?? book.volumes });
          return [...merged.values()].slice(-48);
        });
        setRemoteStatus("ready");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setRemoteStatus("error");
      }
    }, 420);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, sourceFilter]);

  useEffect(() => {
    const title = query.trim();
    const useAniList = sourceFilter === "all" || sourceFilter === "anilist";
    const useGoogleBooks = sourceFilter === "all" || sourceFilter === "googlebooks";
    const useJikan = sourceFilter === "all" || sourceFilter === "jikan";
    const useOpenLibrary = sourceFilter === "all" || sourceFilter === "openlibrary";
    if (title.length < 2 || (!useAniList && !useGoogleBooks && !useJikan && !useOpenLibrary)) {
      queueMicrotask(() => setDiscoveryStatus("idle"));
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDiscoveryStatus("loading");
      const requests: Promise<Manga[]>[] = [];
      if (useGoogleBooks) {
        requests.push((async () => {
          const url = new URL("https://www.googleapis.com/books/v1/volumes");
          url.searchParams.set("q", `intitle:${title} manga`);
          url.searchParams.set("maxResults", "12");
          url.searchParams.set("printType", "books");
          url.searchParams.set("orderBy", "relevance");
          const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Google Books ${response.status}`);
          const payload = await response.json() as { items?: GoogleBookItem[] };
          return (payload.items ?? []).map(mapGoogleBook);
        })());
      }
      if (useAniList) {
        requests.push((async () => {
          const graphQuery = `query SearchManga($search: String) { Page(page: 1, perPage: 24) { media(search: $search, type: MANGA, isAdult: false, sort: SEARCH_MATCH) { id format title { romaji english native } description coverImage { extraLarge large } siteUrl status startDate { year } genres averageScore meanScore favourites staff(perPage: 2) { nodes { name { full } } } } } }`;
          const response = await fetch("https://graphql.anilist.co", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: graphQuery, variables: { search: title } }),
          });
          if (!response.ok) throw new Error(`AniList ${response.status}`);
          const payload = await response.json() as { data?: { Page?: { media?: AniListItem[] } } };
          return (payload.data?.Page?.media ?? []).filter((item) => item.format !== "NOVEL").slice(0, 12).map(mapAniListItem);
        })());
      }
      if (useJikan) {
        requests.push((async () => {
          const url = new URL("https://api.jikan.moe/v4/manga");
          url.searchParams.set("q", title);
          url.searchParams.set("limit", "24");
          url.searchParams.set("sfw", "true");
          url.searchParams.set("order_by", "score");
          url.searchParams.set("sort", "desc");
          const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Jikan ${response.status}`);
          const payload = await response.json() as { data?: JikanItem[] };
          return (payload.data ?? []).filter((item) => item.type !== "Light Novel" && item.type !== "Novel").slice(0, 12).map(mapJikanItem);
        })());
      }
      if (useOpenLibrary) {
        requests.push((async () => {
          const url = new URL("https://openlibrary.org/search.json");
          url.searchParams.set("q", `${title} manga`);
          url.searchParams.set("limit", "12");
          url.searchParams.set("lang", "cs");
          url.searchParams.set("fields", "key,title,author_name,first_publish_year,cover_i,public_scan_b,edition_count");
          const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Open Library ${response.status}`);
          const payload = await response.json() as { docs?: OpenLibraryItem[] };
          return (payload.docs ?? []).map(mapOpenLibraryItem);
        })());
      }
      const results = await Promise.allSettled(requests);
      if (controller.signal.aborted) return;
      const incoming = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      setDiscoveryBooks((current) => {
        const merged = new Map(current.map((book) => [book.id, book]));
        for (const book of incoming) merged.set(book.id, book);
        return [...merged.values()].slice(-72);
      });
      const fulfilledCount = results.filter((result) => result.status === "fulfilled").length;
      setDiscoveryStatus(fulfilledCount === results.length ? "ready" : fulfilledCount > 0 ? "partial" : "error");
    }, 470);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, sourceFilter]);

  const catalogue = useMemo(() => {
    const merged: Manga[] = [];
    for (const book of [...storedBooks, ...discoveryBooks, ...mangaDexBooks, ...localBooks]) {
      const existingIndex = merged.findIndex((existing) => existing.id === book.id || existing.source !== "local" && book.source !== "local" && mangaIdentityMatches(existing, book));
      if (existingIndex < 0) {
        merged.push(book);
        continue;
      }
      merged[existingIndex] = mergeCatalogueBooks(merged[existingIndex], book);
    }
    return merged;
  }, [localBooks, mangaDexBooks, discoveryBooks, storedBooks]);
  const selected = catalogue.find((book) => book.id === selectedId || book.mergedIds?.includes(selectedId)) ?? emptySelection;
  const selectedVolume = selected.volumes.find((volume) => volume.id === volumeId) ?? selected.volumes[0];
  const selectedChapter = selectedVolume.chapters.find((item) => item.id === chapterId) ?? selectedVolume.chapters[0];
  const selectedDownloadLanguage: ReadingLanguage = selected.source !== "mangadex" || languageChapterCount(selected, mangaLanguage) > 0
    ? mangaLanguage
    : languageChapterCount(selected, "cs") > 0 ? "cs" : "en";
  const downloadVolumes = selected.source === "mangadex" ? volumesInLanguage(selected, selectedDownloadLanguage) : selected.volumes;

  const filterBaseBooks = useMemo(() => {
    const normalized = normalizeSearch(query);
    return catalogue.filter((book) => {
      const sources = new Set([book.source, ...(book.mergedSources ?? [])]);
      const sourceMatch = sourceFilter === "all" || sourceFilter === "readable" && [...sources].some((source) => source === "mangadex" || source === "local" || source === "web") || sources.has(sourceFilter as Manga["source"]);
      return sourceMatch && matchesMangaQuery(book, normalized);
    });
  }, [catalogue, query, sourceFilter]);

  const availableYears = useMemo(() => {
    const counts = new Map<string, number>();
    filterBaseBooks.forEach((book) => { if (/^\d{4}$/.test(book.year)) counts.set(book.year, (counts.get(book.year) ?? 0) + 1); });
    return [...counts.entries()].sort(([a], [b]) => Number(b) - Number(a));
  }, [filterBaseBooks]);
  const availableGenres = useMemo(() => {
    const counts = new Map<string, number>();
    filterBaseBooks.forEach((book) => book.genres.filter(Boolean).forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1)));
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, "cs"));
  }, [filterBaseBooks]);

  useEffect(() => {
    if (yearFilter && !availableYears.some(([year]) => year === yearFilter)) setYearFilter("");
    if (genreFilter && !availableGenres.some(([genre]) => genre === genreFilter)) setGenreFilter("");
  }, [availableGenres, availableYears, genreFilter, yearFilter]);

  const filteredBooks = useMemo(() => {
    const normalized = normalizeSearch(query);
    const requiredRating = Number(minRating);
    return filterBaseBooks.filter((book) => {
      const yearMatch = !yearFilter || book.year === yearFilter;
      const genreMatch = !genreFilter || book.genres.some((genre) => genre === genreFilter);
      const ratingMatch = !requiredRating || (typeof book.rating === "number" && book.rating >= requiredRating);
      return yearMatch && genreMatch && ratingMatch;
    }).sort((a, b) => {
      if (sortMode === "rating") return (b.rating ?? -1) - (a.rating ?? -1) || searchScore(a, normalized) - searchScore(b, normalized);
      if (sortMode === "newest") return Number(b.year) - Number(a.year) || searchScore(a, normalized) - searchScore(b, normalized);
      if (sortMode === "oldest") return Number(a.year) - Number(b.year) || searchScore(a, normalized) - searchScore(b, normalized);
      return searchScore(a, normalized) - searchScore(b, normalized) || (b.rating ?? -1) - (a.rating ?? -1) || bookRichness(b) - bookRichness(a) || a.title.localeCompare(b.title, "cs");
    });
  }, [filterBaseBooks, genreFilter, minRating, query, sortMode, yearFilter]);

  const activeIndex = filteredBooks.length ? Math.min(Math.max(highlightedIndex, 0), filteredBooks.length - 1) : -1;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, yearFilter, genreFilter, minRating, sortMode]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const activeBook = filteredBooks[activeIndex];
    if (!activeBook) return;
    catalogueItemRefs.current.get(activeBook.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, filteredBooks]);

  const suggestions = useMemo(() => {
    const normalized = normalizeSearch(query);
    if (normalized.length < 2) return [];
    const seen = new Set<string>();
    return catalogue.filter((book) => {
      const key = normalizeSearch(book.title);
      if (seen.has(key) || !matchesMangaQuery(book, normalized)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => searchScore(a, normalized) - searchScore(b, normalized) || (b.rating ?? -1) - (a.rating ?? -1)).slice(0, 6);
  }, [catalogue, query]);

  const activeSuggestionIndex = suggestions.length ? Math.min(Math.max(suggestionIndex, 0), suggestions.length - 1) : -1;

  useEffect(() => {
    setSuggestionIndex(0);
  }, [query]);

  const storageKeys = (book: Manga) => [book.id, ...(book.mergedIds ?? [])];
  const storedValue = <T,>(values: Record<string, T>, book: Manga) => storageKeys(book).map((id) => values[id]).find((value) => value !== undefined);
  const storedBookProgress = (book: Manga, language?: ReadingLanguage) => findReadingProgress(progress, storageKeys(book), language);
  const inLibrary = (book: Manga) => storageKeys(book).some((id) => libraryIds.includes(id));
  const libraryBooks = catalogue.filter(inLibrary);
  const isCompletedBook = (book: Manga) => {
    const record = storedValue(completed, book);
    return Boolean(record && chapterStats(book).total <= record.chapterCount);
  };
  const readingBooks = catalogue.filter((book) => Boolean(storedBookProgress(book)) && !isCompletedBook(book));
  const completedBooks = catalogue.filter(isCompletedBook);

  const persistBook = (book: Manga) => {
    if (!book.id || book.source === "local") return;
    setStoredBooks((current) => {
      const next = [book, ...current.filter((item) => item.id !== book.id)].slice(0, 40);
      safeSetItem("manga-reader-books", JSON.stringify(next));
      return next;
    });
  };

  const rememberBook = (book: Manga) => {
    const next = [book.id, ...recentIds.filter((id) => id !== book.id)].slice(0, 8);
    setRecentIds(next);
    safeSetItem("shiori-recent", JSON.stringify(next));
    persistBook(book);
  };

  const removeFromContinue = (book: Manga) => {
    setProgress((current) => {
      const next = removeReadingProgress(current, storageKeys(book));
      safeSetItem("shiori-progress", JSON.stringify(next));
      return next;
    });
    setNotice(`${book.title} odebrána z pokračování ve čtení`);
  };


  const goHome = () => {
    setQuery("");
    setSuggestionIndex(0);
    setSourceFilter("all");
    navigate("home");
  };

  const markCompleted = (book: Manga) => {
    const next = { ...completed, [book.id]: { chapterCount: chapterStats(book).total, completedAt: new Date().toISOString() } };
    setCompleted(next);
    safeSetItem("shiori-completed", JSON.stringify(next));
    setHomeTab("completed");
    goHome();
    setNotice(`${book.title} je označena jako dokončená`);
  };

  const loadNativeWebBook = async (book: Manga, target: View = "detail") => {
    rememberBook(book);
    setSelectedId(book.id);
    navigate(target);
    if (book.source === "web" && chapterStats(book).external > 0) {
      setVolumeId(book.volumes[0].id);
      setChapterId(book.volumes[0].chapters[0].id);
      return book;
    }
    setRemoteBookLoading(true);
    try {
      const resolverTitles = [book.title, book.czechTitle, ...book.aliases].filter(Boolean);
      const response = await fetch(`/api/native-source?title=${encodeURIComponent(book.title)}&titles=${encodeURIComponent(JSON.stringify(resolverTitles))}`);
      if (!response.ok) throw new Error(`Native source ${response.status}`);
      const payload = await response.json() as {
        provider: string;
        seriesUrl: string;
        grouping: "volume" | "automatic";
        chapterCount: number;
        matchedTitle: string;
        score: number;
        volumes: { number: number; title: string; confirmed?: boolean; chapters: { number: number; label: string; title?: string; url: string }[] }[];
      };
      const webSeriesKey = `${safeName(book.id)}-${safeName(payload.provider)}`;
      const volumes: Volume[] = payload.volumes.map((volume) => ({
        id: `web-${webSeriesKey}-v-${volume.number}`,
        number: 100000 + volume.number,
        sortKey: 100000 + volume.number,
        displayLabel: "BEZ SVAZKU",
        confirmed: Boolean(volume.confirmed),
        title: volume.confirmed ? volume.title : volume.title || "Kapitoly bez potvrzeného svazku",
        year: book.year,
        chapters: volume.chapters.map((chapter) => ({
          id: `web-${webSeriesKey}-ch-${chapter.label}`,
          number: chapter.number,
          label: chapter.label,
          title: `Kapitola ${chapter.title ?? chapter.label}`,
          pages: 0,
          language: "en",
          externalUrl: chapter.url,
        })),
      }));
      if (!volumes.length) throw new Error("Prázdný obsah");
      const loaded: Manga = {
        ...book,
        source: "web",
        license: `${payload.provider} · živý seznam kapitol`,
        volumes,
      };
      setStoredBooks((current) => {
        const next = [loaded, ...current.filter((item) => item.id !== loaded.id)].slice(0, 40);
        safeSetItem("manga-reader-books", JSON.stringify(next));
        return next;
      });
      setSelectedId(loaded.id);
      setVolumeId(volumes[0].id);
      setChapterId(volumes[0].chapters[0].id);
      setNotice(payload.grouping === "volume"
        ? `${payload.chapterCount} kapitol rozděleno do ${volumes.length} svazků`
        : `${payload.chapterCount} kapitol nalezeno na ${payload.provider} · automatické skupiny`);
      return loaded;
    } catch {
      setNotice("Nativní seznam kapitol se pro tento titul nepodařilo načíst.");
      return undefined;
    } finally {
      setRemoteBookLoading(false);
    }
  };

  const loadMangaDexBook = async (book: Manga, target: View = "detail") => {
    if (!book.remoteId) return;
    rememberBook(book);
    setSelectedId(book.id);
    navigate(target);
    if (chapterStats(book).total > 0) {
      const defaultLanguage: ReadingLanguage = languageChapterCount(book, "cs") > 0 ? "cs" : "en";
      const preferredLanguage: ReadingLanguage = languageByBook[book.id] && languageChapterCount(book, languageByBook[book.id]) > 0 ? languageByBook[book.id] : defaultLanguage;
      const defaultVolumes = volumesInLanguage(book, preferredLanguage);
      setMangaLanguage(preferredLanguage);
      setVolumeId(defaultVolumes[0]?.id ?? book.volumes[0].id);
      setChapterId(defaultVolumes[0]?.chapters[0]?.id ?? book.volumes[0].chapters[0].id);
      return;
    }
    setRemoteBookLoading(true);
    try {
      const chapters: { id: string; attributes: { volume?: string | null; chapter?: string | null; title?: string | null; pages?: number; translatedLanguage?: string; externalUrl?: string | null } }[] = [];
      let offset = 0;
      let total = 1;
      while (offset < total) {
        const params = new URLSearchParams();
        params.set("id", book.remoteId);
        params.set("limit", "100");
        params.set("offset", String(offset));
        params.append("translatedLanguage[]", "cs");
        params.append("translatedLanguage[]", "en");
        params.set("order[volume]", "asc");
        params.set("order[chapter]", "asc");
        const response = await fetch(`/api/mangadex-feed?${params.toString()}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`MangaDex feed ${response.status}`);
        const payload = await response.json() as { data?: typeof chapters; total?: number };
        chapters.push(...(payload.data ?? []));
        total = payload.total ?? chapters.length;
        offset += 100;
        if (offset < total) await new Promise((resolve) => window.setTimeout(resolve, 230));
      }

      const volumeMap = new Map<string, Map<string, Chapter>>();
      for (const remoteChapter of chapters) {
        const attributes = remoteChapter.attributes;
        const volumeKey = attributes.volume || "Bez svazku";
        const list = volumeMap.get(volumeKey) ?? new Map<string, Chapter>();
        const parsedNumber = Number.parseFloat(attributes.chapter ?? "");
        const chapterKey = `${attributes.chapter ?? remoteChapter.id}:${attributes.translatedLanguage ?? "en"}`;
        const candidate: Chapter = {
          id: `md-ch-${remoteChapter.id}`,
          remoteId: remoteChapter.id,
          number: Number.isFinite(parsedNumber) ? parsedNumber : list.size + 1,
          title: attributes.title?.trim() || `Kapitola ${attributes.chapter ?? list.size + 1}`,
          pages: attributes.pages ?? 0,
          language: attributes.translatedLanguage ?? "en",
          externalUrl: attributes.externalUrl ?? undefined,
        };
        const existing = list.get(chapterKey);
        if (!existing || candidate.pages > existing.pages || Boolean(existing.externalUrl) && !candidate.externalUrl) list.set(chapterKey, candidate);
        volumeMap.set(volumeKey, list);
      }
      const volumes: Volume[] = [...volumeMap.entries()].map(([label, chapterMap], index) => ({
        id: `md-${book.remoteId}-v-${label}`,
        number: label === "Bez svazku" ? 100000 + index : Number.parseFloat(label) || index + 1,
        sortKey: label === "Bez svazku" ? 100000 + index : Number.parseFloat(label) || index + 1,
        displayLabel: label === "Bez svazku" ? "BEZ SVAZKU" : undefined,
        title: label === "Bez svazku" ? "Kapitoly bez svazku" : `Volume ${label}`,
        year: book.year,
        chapters: [...chapterMap.values()].sort((a, b) => a.number - b.number),
      })).sort((a, b) => a.number - b.number);
      const hasReadableChapter = volumes.some((volume) => volume.chapters.some((chapter) => chapter.pages > 0 && !chapter.externalUrl));
      if (!hasReadableChapter) {
        const nativeBook = await loadNativeWebBook(book, target);
        if (nativeBook) return;
      }
      const loaded = { ...book, volumes: volumes.length ? volumes : mangaDexPlaceholder(book.remoteId) };
      setMangaDexBooks((current) => {
        const exists = current.some((item) => item.id === loaded.id);
        return exists ? current.map((item) => item.id === loaded.id ? loaded : item) : [loaded, ...current];
      });
      const defaultLanguage: ReadingLanguage = languageChapterCount(loaded, "cs") > 0 ? "cs" : "en";
      const preferredLanguage: ReadingLanguage = languageByBook[book.id] && languageChapterCount(loaded, languageByBook[book.id]) > 0 ? languageByBook[book.id] : defaultLanguage;
      const defaultVolumes = volumesInLanguage(loaded, preferredLanguage);
      setMangaLanguage(preferredLanguage);
      setVolumeId(defaultVolumes[0]?.id ?? loaded.volumes[0].id);
      setChapterId(defaultVolumes[0]?.chapters[0]?.id ?? loaded.volumes[0].chapters[0].id);
      persistBook(loaded);
      if (!chapters.length) setNotice("Pro češtinu ani angličtinu nejsou dostupné kapitoly");
    } catch {
      setNotice("MangaDex se nepodařilo načíst. Zkuste hledání později.");
    } finally {
      setRemoteBookLoading(false);
    }
  };

  const findMangaDexEquivalent = async (book: Manga) => {
    const titles = [book.title, book.czechTitle, ...book.aliases].filter(Boolean);
    const params = new URLSearchParams();
    params.set("title", book.title);
    params.set("limit", "12");
    params.append("includes[]", "cover_art");
    params.append("includes[]", "author");
    params.append("includes[]", "artist");
    params.append("contentRating[]", "safe");
    params.append("contentRating[]", "suggestive");
    params.append("contentRating[]", "erotica");
    const response = await fetch(`/api/mangadex-search?${params.toString()}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return undefined;
    const payload = await response.json() as { data?: MangaDexItem[] };
    const candidates = (payload.data ?? []).map(mapMangaDexItem).map((candidate) => ({
      candidate,
      score: bestAliasScore(titles, candidate.title),
    })).sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best || best.score < 88 || !mangaIdentityMatches(book, best.candidate)) return undefined;
    return best.candidate;
  };

  const loadMetadataBook = async (book: Manga, target: View = "detail") => {
    setSelectedId(book.id);
    navigate(target);
    setRemoteBookLoading(true);
    let mangaDexBook: Manga | undefined;
    try {
      mangaDexBook = await findMangaDexEquivalent(book);
    } catch { /* Webový resolver zůstává záloha. */ }
    setRemoteBookLoading(false);
    if (mangaDexBook) {
      await loadMangaDexBook(mangaDexBook, target);
      return;
    }
    await loadNativeWebBook(book, target);
  };

  const loadGoblinSlayerBook = async (book: Manga, target: View = "detail") => {
    rememberBook(book);
    setSelectedId(book.id);
    navigate(target);
    if (book.source === "web" && chapterStats(book).external > 0) {
      setVolumeId(book.volumes[0].id);
      setChapterId(book.volumes[0].chapters[0].id);
      return;
    }
    setRemoteBookLoading(true);
    try {
      const response = await fetch("/api/goblin-slayer");
      if (!response.ok) throw new Error(`Goblin Slayer index ${response.status}`);
      const payload = await response.json() as {
        grouping: "automatic";
        chapterCount: number;
        volumes: { number: number; title: string; confirmed?: boolean; chapters: { number: number; label: string; title?: string; url: string }[] }[];
      };
      const volumes: Volume[] = payload.volumes.map((volume) => ({
        id: `web-gs-v-${volume.number}`,
        number: 100000 + volume.number,
        sortKey: 100000 + volume.number,
        displayLabel: "BEZ SVAZKU",
        confirmed: Boolean(volume.confirmed),
        title: volume.title || "Kapitoly bez potvrzeného svazku",
        year: book.year,
        chapters: volume.chapters.map((chapter) => ({
          id: `web-gs-ch-${chapter.label}`,
          number: chapter.number,
          label: chapter.label,
          title: `Kapitola ${chapter.title ?? chapter.label}`,
          pages: 0,
          language: "en",
          externalUrl: chapter.url,
        })),
      }));
      if (!volumes.length) throw new Error("Prázdný obsah");
      const loaded: Manga = {
        ...book,
        source: "web",
        license: "GoblinSlayerFree · živý seznam kapitol",
        volumes,
      };
      setStoredBooks((current) => {
        const next = [loaded, ...current.filter((item) => item.id !== loaded.id)].slice(0, 40);
        safeSetItem("manga-reader-books", JSON.stringify(next));
        return next;
      });
      setSelectedId(loaded.id);
      setVolumeId(volumes[0].id);
      setChapterId(volumes[0].chapters[0].id);
      setNotice(`${payload.chapterCount} kapitol nalezeno · ${volumes.length} automatických skupin bez potvrzeného svazku`);
    } catch {
      setNotice("Seznam Goblin Slayer se nepodařilo načíst. Webový režim zůstává dostupný.");
    } finally {
      setRemoteBookLoading(false);
    }
  };

  const loadNativeWebBookRef = useRef(loadNativeWebBook);
  const loadGoblinSlayerBookRef = useRef(loadGoblinSlayerBook);
  loadNativeWebBookRef.current = loadNativeWebBook;
  loadGoblinSlayerBookRef.current = loadGoblinSlayerBook;

  useEffect(() => {
    const names = [selected.title, selected.czechTitle, ...selected.aliases].map(normalizeSearch);
    const isGoblinSlayer = names.includes("goblin slayer");
    const isDandadan = names.includes("dandadan") || names.includes("dan da dan");
    const isBerserk = names.includes("berserk");
    const alreadyLoaded = selected.source === "web" && chapterStats(selected).external > 0;
    if (view === "detail" && isGoblinSlayer && !alreadyLoaded && !remoteBookLoading) {
      void loadGoblinSlayerBookRef.current(selected, "detail");
    }
    if (view === "detail" && isDandadan && !alreadyLoaded && !remoteBookLoading) {
      void loadNativeWebBookRef.current(selected, "detail");
    }
    if (view === "detail" && isBerserk && !alreadyLoaded && !remoteBookLoading) {
      void loadNativeWebBookRef.current(selected, "detail");
    }
  }, [view, selected, remoteBookLoading]);

  const chooseBook = (book: Manga, target: View = "detail") => {
    const names = [book.title, book.czechTitle, ...book.aliases].map(normalizeSearch);
    if (names.includes("goblin slayer")) {
      void loadGoblinSlayerBook(book, target);
      return;
    }
    if (names.includes("dandadan") || names.includes("dan da dan") || names.includes("berserk")) {
      void loadNativeWebBook(book, target);
      return;
    }
    if (book.source === "mangadex") {
      void loadMangaDexBook(book, target);
      return;
    }
    if (["anilist", "googlebooks", "jikan", "openlibrary"].includes(book.source)) {
      void loadMetadataBook(book, target);
      return;
    }
    rememberBook(book);
    setSelectedId(book.id); setVolumeId(book.volumes[0].id); setChapterId(book.volumes[0].chapters[0].id); navigate(target);
  };

  const openChapter = async (book: Manga, volume: Volume, item: Chapter, initialPage = 0) => {
    const loadId = ++chapterLoadIdRef.current;
    setNotice("");
    setReaderPanelTab("contents");
    setChapterPanel(false);
    setReaderMenuOpen(false);
    if (item.language === "cs" || item.language === "en") {
      setMangaLanguage(item.language);
      setLanguageByBook((current) => {
        const next = { ...current, [book.id]: item.language as ReadingLanguage };
        safeSetItem("manga-reader-languages", JSON.stringify(next));
        return next;
      });
    }
    persistBook(book);
    if (item.externalUrl && book.source === "web") {
      const pageCacheKey = chapterPageCacheKey(book, item);
      setSelectedId(book.id); setVolumeId(volume.id); setChapterId(item.id); navigate("reader");
      if (item.language === "cs" || item.language === "en") setMangaLanguage(item.language);
      setReaderPage(initialPage);
      const progressLanguage = item.language === "cs" || item.language === "en" ? item.language : undefined;
      setProgress((current) => {
        const next = saveReadingProgress(current, book.id, makeProgress(progressLanguage, volumeSortKey(volume), item, initialPage + 1));
        safeSetItem("shiori-progress", JSON.stringify(next));
        return next;
      });
      if (!remotePages[pageCacheKey]) {
        setReaderLoading(true);
        try {
          const response = await fetch(`/api/native-source/chapter?url=${encodeURIComponent(item.externalUrl)}`);
          if (!response.ok) throw new Error(`Goblin Slayer pages ${response.status}`);
          const payload = await response.json() as { images: string[] };
          const pages = payload.images.map((url, index) => ({ name: `Stránka ${index + 1}`, url }));
          if (!pages.length) throw new Error("Prázdná kapitola");
          setRemotePages((current) => ({ ...current, [pageCacheKey]: pages }));
          return pages.length;
        } catch {
          if (chapterLoadIdRef.current === loadId) setNotice("Listy kapitoly se nepodařilo načíst. Zkuste kapitolu znovu.");
          return item.pages;
        } finally {
          if (chapterLoadIdRef.current === loadId) setReaderLoading(false);
        }
      }
      return remotePages[pageCacheKey]?.length ?? item.pages;
    }
    if (item.externalUrl) {
      try {
        const url = new URL(item.externalUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Nepodporovaný odkaz");
        const embedded = {
          title: book.title,
          source: `${url.hostname.replace(/^www\./, "")} · externí kapitola z katalogu`,
          startUrl: url.toString(),
          homeUrl: url.toString(),
          mode: "direct" as const,
          reason: "Katalog poskytl přímý odkaz; otevírám jej uvnitř sandboxované čtečky.",
          startLabel: "Otevřená kapitola",
          homeLabel: "Načíst znovu",
        };
        setWebReader(embedded);
        setWebReaderUrl(embedded.startUrl);
        navigate("webreader");
      } catch { setNotice("Externí kapitola nemá platný webový odkaz."); }
      return item.pages;
    }
    setSelectedId(book.id); setVolumeId(volume.id); setChapterId(item.id); navigate("reader");
    if (item.language === "cs" || item.language === "en") setMangaLanguage(item.language);
    setReaderPage(initialPage);
    const progressLanguage = item.language === "cs" || item.language === "en" ? item.language : undefined;
    setProgress((current) => {
      const next = saveReadingProgress(current, book.id, makeProgress(progressLanguage, volumeSortKey(volume), item, initialPage + 1));
      safeSetItem("shiori-progress", JSON.stringify(next));
      return next;
    });
    if (book.source === "mangadex" && item.remoteId && !remotePages[item.remoteId]) {
      setReaderLoading(true);
      try {
        const response = await fetch(`/api/mangadex-chapter?id=${encodeURIComponent(item.remoteId)}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`MangaDex pages ${response.status}`);
        const payload = await response.json() as { baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } };
        const sourceFiles = payload.chapter.dataSaver.length ? payload.chapter.dataSaver : payload.chapter.data;
        const proxyImage = (url: string) => `/api/mangadex-image?url=${encodeURIComponent(url)}`;
        const pages = sourceFiles.map((fileName, index) => {
          const dataSaverUrl = payload.chapter.dataSaver[index]
            ? proxyImage(`${payload.baseUrl}/data-saver/${payload.chapter.hash}/${payload.chapter.dataSaver[index]}`)
            : undefined;
          const fullUrl = payload.chapter.data[index]
            ? proxyImage(`${payload.baseUrl}/data/${payload.chapter.hash}/${payload.chapter.data[index]}`)
            : undefined;
          return {
            name: payload.chapter.data[index] ?? fileName,
            url: dataSaverUrl ?? fullUrl ?? "",
            fallbackUrl: dataSaverUrl ? fullUrl : undefined,
            thumbnailUrl: dataSaverUrl ?? fullUrl,
            thumbnailFallbackUrl: dataSaverUrl ? fullUrl : undefined,
          };
        });
        setRemotePages((current) => ({ ...current, [item.remoteId as string]: pages }));
        return pages.length;
      } catch {
        if (chapterLoadIdRef.current === loadId) setNotice("Stránky kapitoly se nepodařilo načíst. Otevřete ji přímo na MangaDexu.");
        return item.pages;
      } finally {
        if (chapterLoadIdRef.current === loadId) setReaderLoading(false);
      }
    }
    const cachedKey = chapterPageCacheKey(book, item);
    if (cachedKey && remotePages[cachedKey]) return remotePages[cachedKey].length;
    if (book.localPages) return book.localPages.length;
    return item.pages;
  };

  const readerRemoteKey = chapterPageCacheKey(selected, selectedChapter);
  const readerPageCount = readerRemoteKey
    ? remotePages[readerRemoteKey]?.length ?? selectedChapter.pages
    : selected.localPages?.length ?? selectedChapter.pages;
  const readerLanguage = selected.source === "mangadex" && (selectedChapter.language === "cs" || selectedChapter.language === "en") ? selectedChapter.language : undefined;
  const readerNavigationVolumes = (readerLanguage ? volumesInLanguage(selected, readerLanguage) : selected.volumes).slice().sort((a, b) => volumeSortKey(a) - volumeSortKey(b));
  const readerVolumeIndex = readerNavigationVolumes.findIndex((volume) => volume.id === selectedVolume.id);
  const readerNavigationVolume = readerNavigationVolumes.find((volume) => volume.id === selectedVolume.id) ?? readerNavigationVolumes[0];
  const readerChapterIndex = readerNavigationVolume.chapters.findIndex((chapter) => chapter.id === selectedChapter.id);
  const readerAtEnd = readerPage >= Math.max(0, readerPageCount - 1) && readerVolumeIndex === readerNavigationVolumes.length - 1 && readerChapterIndex === readerNavigationVolume.chapters.length - 1;

  const nextReaderPage = () => {
    if (readerLoading) return;
    if (readerPage < Math.max(0, readerPageCount - 1)) {
      setReaderPage((page) => page + 1);
      return;
    }
    const navigationVolume = readerNavigationVolumes.find((volume) => volume.id === selectedVolume.id) ?? readerNavigationVolumes[0];
    const currentChapterIndex = navigationVolume.chapters.findIndex((chapter) => chapter.id === selectedChapter.id);
    const nextChapter = navigationVolume.chapters[currentChapterIndex + 1];
    if (nextChapter) { void openChapter(selected, selectedVolume, nextChapter); return; }
    const currentVolumeIndex = readerNavigationVolumes.findIndex((volume) => volume.id === selectedVolume.id);
    const nextVolume = readerNavigationVolumes[currentVolumeIndex + 1];
    if (nextVolume?.chapters[0]) { void openChapter(selected, nextVolume, nextVolume.chapters[0]); return; }
    setNotice("Jste na konci dostupného obsahu");
  };

  const previousReaderPage = () => {
    if (readerLoading) return;
    if (readerPage > 0) {
      setReaderPage((page) => page - 1);
      return;
    }
    const navigationVolume = readerNavigationVolumes.find((volume) => volume.id === selectedVolume.id) ?? readerNavigationVolumes[0];
    const currentChapterIndex = navigationVolume.chapters.findIndex((chapter) => chapter.id === selectedChapter.id);
    const previousChapter = navigationVolume.chapters[currentChapterIndex - 1];
    if (previousChapter) {
      void openChapter(selected, selectedVolume, previousChapter).then((pageCount) => setReaderPage(Math.max(0, pageCount - 1)));
      return;
    }
    const currentVolumeIndex = readerNavigationVolumes.findIndex((volume) => volume.id === selectedVolume.id);
    const previousVolume = readerNavigationVolumes[currentVolumeIndex - 1];
    const lastChapter = previousVolume?.chapters[previousVolume.chapters.length - 1];
    if (previousVolume && lastChapter) void openChapter(selected, previousVolume, lastChapter).then((pageCount) => setReaderPage(Math.max(0, pageCount - 1)));
  };

  const nextReaderPageRef = useRef(nextReaderPage);
  const previousReaderPageRef = useRef(previousReaderPage);
  const navigateRef = useRef(navigate);
  nextReaderPageRef.current = nextReaderPage;
  previousReaderPageRef.current = previousReaderPage;
  navigateRef.current = navigate;

  useEffect(() => {
    if (view !== "reader") return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowRight") { event.preventDefault(); nextReaderPageRef.current(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); previousReaderPageRef.current(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        readerScrollRef.current?.scrollBy({ top: event.key === "ArrowDown" ? 120 : -120, behavior: "smooth" });
      }
      if (event.key === "Escape") {
        if (readerMenuOpen) setReaderMenuOpen(false);
        else if (chapterPanel) setChapterPanel(false);
        else navigateRef.current("detail");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, chapterPanel, readerMenuOpen]);

  useEffect(() => {
    if (view !== "reader") return;
    const selectedVolumeKey = volumeSortKey(selectedVolume);
    queueMicrotask(() => setProgress((current) => {
      const progressLanguage = selectedChapter.language === "cs" || selectedChapter.language === "en" ? selectedChapter.language : undefined;
      const next = saveReadingProgress(current, selected.id, makeProgress(progressLanguage, selectedVolumeKey, selectedChapter, readerPage + 1));
      safeSetItem("shiori-progress", JSON.stringify(next));
      return next;
    }));
  }, [readerPage, view, selected.id, selectedVolume, selectedChapter]);

  useEffect(() => {
    if (view !== "reader") return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = readerScrollRef.current;
      if (!viewport) return;
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      if (readerPage === 0 || readerFitMode !== "fit") viewport.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, readerPage, readerScale, readerFitMode, readerLoading, chapterPanel]);

  const changeReaderScale = (delta: number) => {
    setReaderFitMode("manual");
    safeSetItem(READER_FIT_MODE_STORAGE_KEY, "manual");
    setReaderScale((value) => {
      const next = Math.max(60, Math.min(160, value + delta));
      safeSetItem(READER_SCALE_STORAGE_KEY, String(next));
      return next;
    });
  };

  const enableReaderFit = () => {
    setReaderFitMode("fit");
    setReaderScale(100);
    safeSetItem(READER_FIT_MODE_STORAGE_KEY, "fit");
    safeSetItem(READER_SCALE_STORAGE_KEY, "100");
  };

  useEffect(() => {
    if (readerPageCount > 0 && readerPage >= readerPageCount) queueMicrotask(() => setReaderPage(readerPageCount - 1));
  }, [readerPage, readerPageCount]);

  const toggleLibrary = (book: Manga) => {
    const next = inLibrary(book) ? libraryIds.filter((id) => !storageKeys(book).includes(id)) : [...libraryIds, book.id];
    setLibraryIds(next); safeSetItem("shiori-library", JSON.stringify(next));
    if (next.includes(book.id)) persistBook(book);
    setNotice(next.includes(book.id) ? "Přidáno do místní knihovny" : "Odebráno z knihovny");
  };

  const submitGlobalSearch = () => {
    setSourceFilter("all");
    const book = filteredBooks[activeIndex];
    if (book) chooseBook(book);
    else navigate("library");
  };

  const searchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredBooks.length) setHighlightedIndex((current) => Math.min(current + 1, filteredBooks.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredBooks.length) setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") { event.preventDefault(); submitGlobalSearch(); return; }
    if (event.key === "Escape") { setQuery(""); searchRef.current?.blur(); }
  };

  const importLocal = (event: FormEvent) => {
    event.preventDefault();
    if (!importTitle.trim() || importFiles.length === 0) return;
    const pages = [...importFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    const id = `local-${Date.now()}`;
    const book: Manga = {
      id, title: importTitle.trim(), czechTitle: "Místní import", aliases: [importTitle.trim().toLowerCase()], author: "Vlastní soubory",
      description: `${pages.length} obrázků načtených pouze do této relace. Soubory neopustí zařízení.`, genres: ["Místní"], year: String(new Date().getFullYear()),
      status: "Místní", license: "Vlastní obsah", source: "local", accent: "#4058d6", accentSoft: "#c9d1ff",
      volumes: [{ id: `${id}-v1`, number: 1, title: "Importovaný sešit", year: String(new Date().getFullYear()), chapters: [{ id: "c1", number: 1, title: "Importované stránky", pages: pages.length }] }],
      localPages: pages,
    };
    setLocalBooks((current) => [book, ...current]);
    const nextLibrary = [...libraryIds, id]; setLibraryIds(nextLibrary); safeSetItem("shiori-library", JSON.stringify(nextLibrary));
    setImportOpen(false); setImportTitle(""); setImportFiles([]); chooseBook(book); setNotice("Manga byla načtena lokálně");
  };

  const fetchChapterExportPages = async (chapter: Chapter) => {
    if (selected.source === "local") return selected.localPages ?? [];
    if (selected.source === "web" && chapter.externalUrl) {
      const response = await fetch(`/api/native-source/chapter?url=${encodeURIComponent(chapter.externalUrl)}`);
      if (!response.ok) throw new Error(`Web chapter ${response.status}`);
      const payload = await response.json() as { images: string[] };
      return payload.images.map((url, index) => ({ name: `Stránka ${index + 1}`, url }));
    }
    if (selected.source === "mangadex" && chapter.remoteId) {
      const response = await fetch(`/api/mangadex-chapter?id=${encodeURIComponent(chapter.remoteId)}`);
      if (!response.ok) throw new Error(`MangaDex chapter ${response.status}`);
      const payload = await response.json() as { baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } };
      const files = payload.chapter.dataSaver.length ? payload.chapter.dataSaver : payload.chapter.data;
      const full = payload.chapter.dataSaver.length ? "data-saver" : "data";
      return files.map((file, index) => ({
        name: payload.chapter.data[index] ?? file,
        url: `/api/mangadex-image?url=${encodeURIComponent(`${payload.baseUrl}/${full}/${payload.chapter.hash}/${file}`)}`,
      }));
    }
    return [];
  };

  const collectCompleteExportPages = async (chapterIds?: string[]) => {
    if (selected.source === "local") return chapterIds && chapterIds.length === 0 ? [] : collectExportPages();
    const selectedIds = chapterIds === undefined ? undefined : new Set(chapterIds);
    const chapters = selected.volumes.flatMap((volume) => volume.chapters).filter((chapter) => !selectedIds || selectedIds.has(chapter.id)).sort((a, b) => a.number - b.number);
    const result: ExportedPage[] = [];
    for (const chapter of chapters) {
      const refs = await fetchChapterExportPages(chapter);
      const pages = await mapWithConcurrency(refs, 6, async (page, index) => {
        const exportUrl = /^https:\/\//i.test(page.url) ? `/api/native-source/image?url=${encodeURIComponent(page.url)}` : page.url;
        const response = await fetch(exportUrl, { headers: { Accept: "image/*" }, referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error(`Kapitola ${chapterDisplayNumber(chapter)}, stránka ${index + 1}: ${response.status}`);
        const extensionFromName = page.name.split(".").pop()?.toLowerCase();
        const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
        const extension = extensionFromName && ["jpg", "jpeg", "png", "webp"].includes(extensionFromName) ? extensionFromName : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
        const mediaType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        return { name: `chapter-${chapterDisplayNumber(chapter)}-${String(index + 1).padStart(3, "0")}.${extension}`, data: new Uint8Array(await response.arrayBuffer()), extension, mediaType };
      });
      result.push(...pages);
    }
    return result;
  };
  const currentExportPages = () => {
    if (selected.localPages) return selected.localPages;
    const remoteKey = chapterPageCacheKey(selected, selectedChapter);
    return remoteKey ? remotePages[remoteKey] ?? [] : [];
  };

  const collectExportPages = async () => {
    const pageRefs = currentExportPages();
    if (pageRefs.length === 0) throw new Error("Kapitola zatím nemá načtené stránky");
    const exportImageUrl = (url: string) => /^https:\/\//i.test(url) ? `/api/native-source/image?url=${encodeURIComponent(url)}` : url;
    return mapWithConcurrency(pageRefs, 6, async (page, index) => {
      let response = await fetch(exportImageUrl(page.url), { headers: { Accept: "image/*" }, referrerPolicy: "no-referrer" });
      if (!response.ok && page.fallbackUrl) response = await fetch(exportImageUrl(page.fallbackUrl), { headers: { Accept: "image/*" }, referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Stránka ${index + 1}: ${response.status}`);
      const extensionFromName = page.name.split(".").pop()?.toLowerCase();
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      const extension = extensionFromName && ["jpg", "jpeg", "png", "webp"].includes(extensionFromName)
        ? extensionFromName
        : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const mediaType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      return { name: page.name, data: new Uint8Array(await response.arrayBuffer()), extension, mediaType };
    });
  };

  const saveCbz = async (pageOverride?: ExportedPage[], complete = false, exportTitle = selected.title, exportLabel = "") => {
    setExporting(true);
    setNotice("Stahuji stránky a připravuji CBZ…");
    try {
      const pages = pageOverride ?? await collectExportPages();
      const encoder = new TextEncoder();
      const archive = zipStore([
        ...pages.map((page, index) => ({ name: `${String(index + 1).padStart(3, "0")}.${page.extension}`, data: page.data })),
        { name: "README.txt", data: encoder.encode(`${selected.title}\n${selected.czechTitle}\n\n${selected.license}\nKapitola ${chapterDisplayNumber(selectedChapter)}: ${selectedChapter.title}\n\nExportováno lokálně v aplikaci Manga Reader.`) },
      ]);
      const blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/vnd.comicbook+zip" });
      const fileLabel = exportLabel || (complete ? "complete" : `chapter-${chapterDisplayNumber(selectedChapter)}`);
      const destination = await saveDownloadBlob(blob, makeExportFileName(exportTitle, fileLabel, "cbz"), exportTitle);
      setExports((current) => [{ id: `${Date.now()}`, title: `${selected.title} · kap. ${chapterDisplayNumber(selectedChapter)}`, format: "CBZ", when: "Právě teď" }, ...current]);
      setNotice(destination === "local" ? `CBZ bylo uloženo do Stažené soubory\\${sanitizeDownloadName(exportTitle)}` : "CBZ bylo uloženo do Stažených souborů");
      return true;
    } catch { setNotice("CBZ se nepodařilo vytvořit. Zdroj mohl odmítnout stažení obrázků."); return false; }
    finally { setExporting(false); }
  };

  const saveEpub = async (kindle = false, pageOverride?: ExportedPage[], complete = false, exportTitle = selected.title, exportLabel = "", exportLanguage = selectedChapter.language ?? "cs") => {
    setExporting(true);
    setNotice("Stahuji stránky a připravuji EPUB…");
    try {
      const pages = pageOverride ?? await collectExportPages();
      const encoder = new TextEncoder();
      const title = escapeXml(complete ? exportTitle : `${exportTitle} — ${selectedChapter.title}`);
      const author = escapeXml(selected.author);
      const pageFiles = pages.map((page, index) => ({ ...page, fileName: `page-${String(index + 1).padStart(3, "0")}.${page.extension}` }));
      const manifestImages = pageFiles.map((page, index) => `<item id="img${index + 1}" href="images/${page.fileName}" media-type="${page.mediaType}"${index === 0 ? ' properties="cover-image"' : ""}/>`).join("");
      const manifestPages = pageFiles.map((_, index) => `<item id="p${index + 1}" href="pages/p${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("");
      const spine = pageFiles.map((_, index) => `<itemref idref="p${index + 1}"/>`).join("");
      const navItems = pageFiles.map((_, index) => `<li><a href="pages/p${index + 1}.xhtml">Stránka ${index + 1}</a></li>`).join("");
      const files: { name: string; data: Uint8Array }[] = [
        { name: "mimetype", data: encoder.encode("application/epub+zip") },
        { name: "META-INF/container.xml", data: encoder.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
        { name: "OEBPS/content.opf", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">shiori-${Date.now()}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>${epubLanguage(exportLanguage)}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta><meta name="cover" content="img1"/><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:orientation">auto</meta><meta property="rendition:spread">both</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifestImages}${manifestPages}</manifest><spine page-progression-direction="rtl">${spine}</spine></package>`) },
        { name: "OEBPS/nav.xhtml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body><nav epub:type="toc"><h1>${title}</h1><ol>${navItems}</ol></nav></body></html>`) },
        ...pageFiles.map((page, index) => ({ name: `OEBPS/pages/p${index + 1}.xhtml`, data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Stránka ${index + 1}</title><meta name="viewport" content="width=device-width,height=device-height"/><style>html,body{margin:0;padding:0;background:#111;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img src="../images/${page.fileName}" alt="Stránka ${index + 1}"/></body></html>`) })),
        ...pageFiles.map((page) => ({ name: `OEBPS/images/${page.fileName}`, data: page.data })),
      ];
      const archive = zipStore(files);
      const blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/epub+zip" });
      const fileLabel = exportLabel || (complete ? "complete" : `chapter-${chapterDisplayNumber(selectedChapter)}`);
      const destination = await saveDownloadBlob(blob, makeExportFileName(exportTitle, fileLabel, "epub", kindle), exportTitle);
      setExports((current) => [{ id: `${Date.now()}`, title: `${selected.title} · kap. ${chapterDisplayNumber(selectedChapter)}`, format: kindle ? "KINDLE" : "EPUB", when: "Právě teď" }, ...current]);
      setNotice(destination === "local" ? `EPUB bylo uloženo do Stažené soubory\\${sanitizeDownloadName(exportTitle)}` : "EPUB bylo uloženo do Stažených souborů");
      return true;
    } catch { setNotice("EPUB se nepodařilo vytvořit. Zdroj mohl odmítnout stažení obrázků."); return false; }
    finally { setExporting(false); }
  };

  const printPdf = async (pageOverride?: ExportedPage[], complete = false, exportTitle = selected.title, exportLabel = "") => {
    if (!pageOverride?.length && currentExportPages().length === 0) { setNotice("Nejdřív načtěte stránky kapitoly"); return; }
    setPrinting(true);
    setNotice("Připravuji PDF ke stažení…");
    try {
      const pdf = await createImagePdf(pageOverride ?? await collectExportPages());
      const fileLabel = exportLabel || (complete ? "complete" : `chapter-${chapterDisplayNumber(selectedChapter)}`);
      const destination = await saveDownloadBlob(new Blob([pdf], { type: "application/pdf" }), makeExportFileName(exportTitle, fileLabel, "pdf"), exportTitle);
      setExports((current) => [{ id: `${Date.now()}`, title: `${selected.title} · kap. ${chapterDisplayNumber(selectedChapter)}`, format: "PDF", when: "Právě teď" }, ...current]);
      setNotice(destination === "local" ? `PDF bylo uloženo do Stažené soubory\\${sanitizeDownloadName(exportTitle)}` : "PDF bylo staženo do Stažených souborů");
      return true;
    } catch {
      setNotice("PDF se nepodařilo vytvořit. Zdroj mohl odmítnout stažení obrázků.");
      return false;
    } finally {
      setPrinting(false);
    }
  };

  const exportVolumeNumber = (volume: Volume) => {
    if (volume.number < 100000 && Number.isFinite(volume.number)) return Math.max(1, Math.trunc(volume.number));
    const ordered = selected.volumes.slice().sort((left, right) => volumeSortKey(left) - volumeSortKey(right));
    return Math.max(1, ordered.findIndex((item) => item.id === volume.id) + 1);
  };
  const exportVolumeLabel = (volume: Volume) => `volume-${String(exportVolumeNumber(volume)).padStart(2, "0")}`;

  const downloadSelected = async (format: DownloadFormat, groups: { ids: string[]; label: string }[], exportTitle: string) => {
    const count = groups.length;
    if (selected.source === "mangadex" && count === 0) { setNotice("Nejdřív načtěte kapitoly MangaDexu"); return; }
    setExporting(true);
    setNotice(`Připravuji export (${count} souborů)…`);
    try {
      for (const [index, group] of groups.entries()) {
        const volumeForGroup = group.label.startsWith("volume-") ? downloadVolumes.find((volume) => group.ids.some((id) => volume.chapters.some((chapter) => chapter.id === id))) : undefined;
        const groupLabel = volumeForGroup ? exportVolumeLabel(volumeForGroup) : group.label;
        setNotice(`Stahuji soubor ${index + 1}/${count}: ${readableExportLabel(groupLabel)}…`);
        const pages = await collectCompleteExportPages(group.ids);
        if (!pages.length) throw new Error("Kompletní titul nemá dostupné stránky");
        let saved = false;
        if (format === "CBZ") saved = await saveCbz(pages, true, exportTitle, groupLabel);
        else if (format === "PDF") saved = Boolean(await printPdf(pages, true, exportTitle, groupLabel));
        else {
          const exportLanguage = downloadVolumes.flatMap((volume) => volume.chapters).find((chapter) => group.ids.includes(chapter.id))?.language ?? selectedDownloadLanguage;
          saved = await saveEpub(format === "KINDLE", pages, true, exportTitle, groupLabel, exportLanguage);
        }
        if (!saved) throw new Error("Soubor se nepodařilo uložit");
      }
    } catch {
      setExporting(false);
      setNotice("Mangu se nepodařilo stáhnout. Některá kapitola nemá dostupné obrázky nebo nelze zapisovat do složky Stažené soubory.");
    }
  };

  const resumeReading = (book: Manga) => {
    if (book.source === "mangadex" && chapterStats(book).total === 0) {
      void loadMangaDexBook(book);
      return;
    }
    const saved = parseReadingProgress(storedBookProgress(book));
    if (!saved) { chooseBook(book); return; }
    const candidateVolumes = saved.language ? volumesInLanguage(book, saved.language) : book.volumes;
    const savedVolume = candidateVolumes.find((item) => volumeSortKey(item) === saved.volumeSortKey || item.number === saved.volumeSortKey);
    const orderedVolumes = savedVolume ? [savedVolume, ...candidateVolumes.filter((item) => item.id !== savedVolume.id)] : candidateVolumes;
    let volume = savedVolume ?? candidateVolumes[0] ?? book.volumes[0];
    let item = saved.chapterId
      ? orderedVolumes.flatMap((candidate) => candidate.chapters.map((chapter) => ({ candidate, chapter }))).find(({ chapter }) => chapter.id === saved.chapterId)
      : undefined;
    if (!item) {
      item = orderedVolumes.flatMap((candidate) => candidate.chapters.map((chapter) => ({ candidate, chapter }))).find(({ chapter }) =>
        (!saved.language || chapter.language === saved.language)
        && (saved.chapterLabel ? chapterDisplayNumber(chapter) === saved.chapterLabel : chapter.number === saved.chapterNumber));
    }
    if (item) volume = item.candidate;
    const chapter = item?.chapter ?? volume.chapters[0];
    if (saved.language) setMangaLanguage(saved.language);
    void openChapter(book, volume, chapter, Math.max(0, saved.page - 1));
  };

  const renderHome = () => {
    const visibleResumeBooks = readingBooks;
    const visibleCompletedBooks = completedBooks;
    const renderReadingCards = (books: Manga[], completedView = false) => books.length ? books.map((book) => <article className="manga-resume-card" key={book.id}><button className="resume-open" onClick={() => completedView ? chooseBook(book) : resumeReading(book)}><Cover book={book} compact /><span><small>{completedView ? "DOKONČENO" : `POZICE ${progressLabel(storedBookProgress(book))}`}</small><strong>{book.title}</strong><i>{book.czechTitle}</i></span><b>{completedView ? "✓" : "→"}</b></button>{!completedView && <button className="resume-remove" onClick={() => removeFromContinue(book)} aria-label={`Odebrat ${book.title} z pokračování`}>×</button>}</article>) : <div className="manga-empty-library"><span>{completedView ? "ZATÍM NIC DOKONČENÉHO" : "ZATÍM NIC ROZČTENÉHO"}</span><strong>{completedView ? "Po poslední kapitole můžete mangu označit jako dokončenou." : "Každá manga se po otevření první kapitoly objeví zde."}</strong></div>;
    return <div className="screen manga-home">
      <div className="manga-home-shade" />
      <header className="manga-home-brand"><button onClick={goHome}><i><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z" /></svg></i><span><strong>MANGA READER</strong><small>LOCAL EDITION</small></span></button><div className="manga-home-actions"><nav className="home-nav" aria-label="Hlavní navigace"><button className="active" onClick={goHome}>Domů</button><button onClick={() => navigate("library")}>Knihovna</button><button onClick={() => navigate("downloads")}>Stažené</button><button onClick={() => navigate("settings")}>Nastavení</button></nav><button className={`theme-toggle ${theme === "light" ? "to-dark" : "to-light"}`} onClick={toggleTheme} aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"} title={theme === "light" ? "Tmavý režim" : "Světlý režim"}>{theme === "light" ? "☾" : "☀"}</button><button className="manga-home-import" onClick={() => setImportOpen(true)}>＋ Vlastní manga</button></div></header>
      <section className="manga-search-core">
        <span>NAJDI. OTEVŘI. ČTI.</span>
        <label><i>⌕</i><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); if (suggestions.length) setSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1)); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); if (suggestions.length) setSuggestionIndex((current) => Math.max(current - 1, 0)); return; }
          if (event.key === "Enter") {
            const book = suggestions[activeSuggestionIndex];
            if (book) { setQuery(book.title); chooseBook(book); } else { setSourceFilter("all"); navigate("library"); }
            return;
          }
          if (event.key === "Escape") setQuery("");
        }} placeholder="Název mangy česky, anglicky nebo japonsky…" autoComplete="off" autoFocus /><button onClick={() => { setSourceFilter("all"); navigate("library"); }}>HLEDAT</button></label>
        {suggestions.length > 0 && <div className="search-suggestions" role="listbox" aria-label="Návrhy mang">{suggestions.map((book, index) => <button key={book.id} type="button" role="option" aria-selected={index === activeSuggestionIndex} className={index === activeSuggestionIndex ? "active" : ""} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => { setQuery(book.title); chooseBook(book); }}><span><strong>{book.title}</strong><small>{book.czechTitle}</small></span><b>{typeof book.rating === "number" ? `★ ${book.rating.toFixed(1)}` : "—"}</b><i>→</i></button>)}</div>}
        <small>MangaDex + automatický webový výběr pro čtení · další katalogy pro přesné názvy a obálky</small>
      </section>
      <section className="manga-home-tabs">
        <nav><button className={homeTab === "continue" ? "active" : ""} onClick={() => setHomeTab("continue")}>▶ Rozečtené <em>{readingBooks.length}</em></button><button className={homeTab === "completed" ? "active" : ""} onClick={() => setHomeTab("completed")}>✓ Dokončené <em>{completedBooks.length}</em></button><button className={homeTab === "downloads" ? "active" : ""} onClick={() => setHomeTab("downloads")}>⇩ Stažení</button></nav>
        {homeTab === "continue" ? <div className={`manga-resume-row ${visibleResumeBooks.length ? "" : "empty"}`}>{renderReadingCards(visibleResumeBooks)}</div> : homeTab === "completed" ? <div className={`manga-resume-row ${visibleCompletedBooks.length ? "" : "empty"}`}>{renderReadingCards(visibleCompletedBooks, true)}</div> : <div className="manga-download-row"><button onClick={() => navigate("downloads")}><b>CBZ</b><span>Komiksové čtečky</span></button><button onClick={() => navigate("downloads")}><b>EPUB</b><span>E‑book čtečky</span></button><button onClick={() => navigate("downloads")}><b>PDF</b><span>Tisk a archiv</span></button><button className="import-format" onClick={() => setImportOpen(true)}><b>＋</b><span>Načíst vlastní listy</span></button></div>}
      </section>
    </div>;
  };

  const renderLibrary = () => (
    <div className="screen library-screen">
      <div className="screen-heading"><div><span className="overline">ČITELNÉ KAPITOLY · 5 KATALOGŮ · MÍSTNÍ SOUBORY</span><h1>{query ? `Výsledky pro „${query}“` : "Knihovna"}</h1><p>{filteredBooks.length} titulů · přesné názvy a čitelné zdroje jsou vždy první</p></div><button className="primary-button" onClick={() => setImportOpen(true)}>＋ Importovat obrázky</button></div>
      <div className="source-tabs"><button className={sourceFilter === "readable" ? "active" : ""} onClick={() => setSourceFilter("readable")}>Číst v aplikaci</button><button className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>Všechny katalogy</button><button className={sourceFilter === "mangadex" ? "active" : ""} onClick={() => setSourceFilter("mangadex")}>MangaDex</button><button className={sourceFilter === "anilist" ? "active" : ""} onClick={() => setSourceFilter("anilist")}>AniList</button><button className={sourceFilter === "googlebooks" ? "active" : ""} onClick={() => setSourceFilter("googlebooks")}>Google Books</button><button className={sourceFilter === "jikan" ? "active" : ""} onClick={() => setSourceFilter("jikan")}>MyAnimeList</button><button className={sourceFilter === "openlibrary" ? "active" : ""} onClick={() => setSourceFilter("openlibrary")}>Open Library</button><button className={sourceFilter === "local" ? "active" : ""} onClick={() => setSourceFilter("local")}>Moje soubory</button></div>
      <div className="catalogue-filters" aria-label="Filtry výsledků"><div className="filter-heading"><strong>UPŘESNIT VÝSLEDKY</strong><small>{filteredBooks.length} z {filterBaseBooks.length} titulů</small></div><label>Rok<select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}><option value="">Všechny roky ({filterBaseBooks.length})</option>{availableYears.map(([year, count]) => <option key={year} value={year}>{year} ({count})</option>)}</select></label><label>Žánr<select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)}><option value="">Všechny žánry</option>{availableGenres.map(([genre, count]) => <option key={genre} value={genre}>{genre} ({count})</option>)}</select></label><label>Hodnocení<select value={minRating} onChange={(event) => setMinRating(event.target.value)}><option value="">Bez minima</option><option value="9">9,0 a více</option><option value="8">8,0 a více</option><option value="7">7,0 a více</option><option value="6">6,0 a více</option></select></label><label>Řazení<select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}><option value="relevance">Relevance</option><option value="rating">Nejlépe hodnocené</option><option value="newest">Nejnovější</option><option value="oldest">Nejstarší</option></select></label>{(yearFilter || genreFilter || minRating || sortMode !== "relevance") && <button type="button" onClick={() => { setYearFilter(""); setGenreFilter(""); setMinRating(""); setSortMode("relevance"); }}>Resetovat filtry</button>}</div>
      {(yearFilter || genreFilter || minRating) && <div className="active-filters" aria-label="Aktivní filtry">{yearFilter && <button onClick={() => setYearFilter("")}>Rok: {yearFilter} ×</button>}{genreFilter && <button onClick={() => setGenreFilter("")}>Žánr: {genreFilter} ×</button>}{minRating && <button onClick={() => setMinRating("")}>★ {minRating},0+ ×</button>}</div>}
      {(remoteStatus === "loading" || discoveryStatus === "loading") && query.trim().length >= 2 && <div className="provider-status"><i /> Prohledávám MangaDex, AniList, Google Books, MyAnimeList a Open Library…</div>}
      {(remoteStatus === "error" || discoveryStatus === "error" || discoveryStatus === "partial") && <div className="provider-status error"><i /> Některý online katalog je právě omezený. Výsledky z ostatních zdrojů a místní knihovna fungují dál.</div>}
      {filteredBooks.length > 0 ? <div className="catalogue-grid">{filteredBooks.map((book, index) => { const stats = chapterStats(book); return <article ref={(node) => { if (node) catalogueItemRefs.current.set(book.id, node); else catalogueItemRefs.current.delete(book.id); }} className={`catalogue-item${index === activeIndex ? " active" : ""}`} key={book.id} onMouseEnter={() => setHighlightedIndex(index)}><button className="cover-button" onClick={() => chooseBook(book)}><Cover book={book} /></button><div><div className="catalogue-labels"><span className={`source-label ${book.source}`}>{sourceTitle(book.source)}</span><span className={`rating-pill ${typeof book.rating === "number" ? "ready" : ""}`} title={ratingMeta(book)}>★ {ratingLabel(book)}</span>{book.source === "mangadex" && <span className={`readability-pill ${stats.internal > 0 ? "ready" : ""}`}>{stats.internal > 0 ? `${readableChapterCount(book)} ČITELNÝCH` : "OVĚŘIT KAPITOLY"}</span>}</div><button className="title-button" onClick={() => chooseBook(book)}>{book.title}</button><p>{book.czechTitle}</p><small>{book.author} · {ratingMeta(book)}</small></div></article>; })}</div> : <div className="no-results"><strong>{remoteStatus === "loading" || discoveryStatus === "loading" ? "Prohledávám online katalogy…" : "Titul nebyl nalezen"}</strong><p>Zkuste český, anglický nebo původní název. Pro vlastní legálně získané stránky použijte místní import.</p><button onClick={() => setImportOpen(true)}>Importovat vlastní soubory</button></div>}
    </div>
  );

  const renderDetail = () => {
    const czechChapterCount = selected.source === "mangadex" ? languageChapterCount(selected, "cs") : 0;
    const englishChapterCount = selected.source === "mangadex" ? languageChapterCount(selected, "en") : 0;
    const activeLanguage: ReadingLanguage = mangaLanguage === "cs" && czechChapterCount > 0 || englishChapterCount === 0 ? "cs" : "en";
    const detailVolumes = (selected.source === "mangadex" ? volumesInLanguage(selected, activeLanguage) : selected.volumes).slice().sort((a, b) => volumeSortKey(a) - volumeSortKey(b));
    const detailBook = { ...selected, volumes: detailVolumes };
    const primaryChapter = firstReadableChapter(detailBook) ?? (selected.source === "web" ? detailVolumes.flatMap((volume) => volume.chapters.map((item) => ({ volume, item }))).find(({ item }) => Boolean(item.externalUrl)) : undefined);
    const stats = chapterStats(detailBook);
    const availableDownloadChapters = detailVolumes.flatMap((volume) => volume.chapters).filter((chapter) => chapter.pages > 0 || chapter.externalUrl);
    const openDownload = (format: DownloadFormat, mode: DownloadMode = "volumes") => {
      setDownloadFormat(format);
      setDownloadMode(mode);
      setDownloadName(selected.title);
      setDownloadChapterIds(availableDownloadChapters.map((chapter) => chapter.id));
      setDownloadVolumeIds(detailVolumes.filter((volume) => volume.chapters.some((chapter) => chapter.pages > 0 || chapter.externalUrl)).map((volume) => volume.id));
      setDownloadOpen(true);
    };
    const chooseReadingLanguage = (language: ReadingLanguage) => {
      const languageVolumes = volumesInLanguage(selected, language);
      const languageBook = { ...selected, volumes: languageVolumes };
      const first = firstReadableChapter(languageBook) ?? languageVolumes.flatMap((volume) => volume.chapters.map((item) => ({ volume, item }))).find(({ item }) => item.pages > 0 || Boolean(item.externalUrl));
      setMangaLanguage(language);
      setLanguageByBook((current) => {
        const next = { ...current, [selected.id]: language };
        safeSetItem("manga-reader-languages", JSON.stringify(next));
        return next;
      });
      setNotice("");
      if (first) { setVolumeId(first.volume.id); setChapterId(first.item.id); }
    };
    const selectedNames = [selected.title, selected.czechTitle, ...selected.aliases].map(normalizeSearch);
    const isGoblinSlayer = selectedNames.some((name) => name === "goblin slayer" || name.includes("goblin slayer"));
    const embeddedReader = webReaderSourceFor(selected);
    const openEmbeddedReader = async () => {
      let resolved = embeddedReader;
      setWebReaderResolving(true);
      try {
        if (embeddedReader.mode === "search") {
          const resolverTitles = [selected.title, selected.czechTitle, ...selected.aliases].filter(Boolean);
          const response = await fetch(`/api/web-source?q=${encodeURIComponent(selected.title)}&titles=${encodeURIComponent(JSON.stringify(resolverTitles))}`);
          const result = await response.json() as { mode?: string; provider?: string; searchUrl?: string; title?: string; url?: string; score?: number };
          if (response.ok && result.mode === "direct" && result.url && result.searchUrl) {
            resolved = {
              ...embeddedReader,
              source: `${result.provider ?? "MangaRead"} · automatická shoda ${result.score ?? 0} % · EN`,
              startUrl: result.url,
              homeUrl: result.searchUrl,
              mode: "direct",
              reason: `Resolver našel nejbližší shodu „${result.title ?? selected.title}“ bez načítání obrázků.`,
              startLabel: "Vybraný titul",
              homeLabel: "Hledat znovu",
            };
          }
        }
      } catch { /* Vyhledávací stránka zůstane bezpečnou zálohou. */ }
      finally { setWebReaderResolving(false); }
      setWebReader(resolved);
      setWebReaderUrl(resolved.startUrl);
      navigate("webreader");
    };
    return <div className="screen detail-screen">
      <button className="back-button" onClick={() => navigate("library")}>← Zpět do knihovny</button>
      <div className="detail-hero">
        <Cover book={selected} />
        <div className="detail-copy">
          <span className={`source-label ${selected.source}`}>{sourceTitle(selected.source)}</span><h1>{selected.title}</h1><h2>{selected.czechTitle}</h2><p>{selected.description}</p>
          <dl><div><dt>Autor</dt><dd>{selected.author}</dd></div><div><dt>Rok</dt><dd>{selected.year}</dd></div><div><dt>Hodnocení</dt><dd>{typeof selected.rating === "number" ? `★ ${ratingLabel(selected)} · ${ratingMeta(selected)}` : "Bez dostupného hodnocení"}</dd></div><div><dt>Stav</dt><dd>{selected.status}</dd></div><div><dt>Zdroj</dt><dd>{selected.license}</dd></div></dl>
          <div className={`source-choice ${primaryChapter ? "internal" : embeddedReader.mode}`}><b>AUTOMATICKÝ VÝBĚR</b><span>{primaryChapter ? `${sourceTitle(selected.source)} · nativní čtečka Manga Readeru` : embeddedReader.source}</span><small>{primaryChapter ? "Kapitola se otevře bez menu a rozhraní zdrojového webu." : embeddedReader.reason}</small></div>
          <div className="detail-actions">
            <button className="primary-button" disabled={remoteBookLoading || webReaderResolving} onClick={() => primaryChapter ? openChapter(selected, primaryChapter.volume, primaryChapter.item) : openEmbeddedReader()}>{remoteBookLoading ? "Načítám kapitoly…" : webReaderResolving ? "Hledám nejlepší zdroj…" : primaryChapter ? "▶ Číst v aplikaci" : embeddedReader.mode === "direct" ? "▶ Číst ve webovém režimu" : "⌕ Najít nejlepší webový zdroj"}</button>
            <button onClick={() => toggleLibrary(selected)}>{inLibrary(selected) ? "✓ V knihovně" : "+ Do knihovny"}</button>
            {primaryChapter && selected.source !== "web" && <button disabled={webReaderResolving} onClick={openEmbeddedReader}>{webReaderResolving ? "Hledám…" : "Zkusit webový zdroj"}</button>}
            {selected.source === "mangadex" && <button onClick={() => openExternal(`https://mangadex.org/title/${selected.remoteId}`)}>MangaDex ↗</button>}
            {isGoblinSlayer && <button onClick={() => openExternal("https://global.manga-up.com/manga/108")}>MANGA UP! EN ↗</button>}
            {isGoblinSlayer && <button onClick={() => openExternal("https://yenpress.com/series/goblin-slayer-manga-serial")}>Yen Press EN ↗</button>}
            {selected.officialUrl && <button onClick={() => openExternal(selected.officialUrl)}>{selected.source === "anilist" ? "Otevřít AniList ↗" : selected.source === "googlebooks" ? "Otevřít náhled ↗" : selected.source === "jikan" ? "Otevřít MyAnimeList ↗" : selected.source === "openlibrary" ? "Otevřít Open Library ↗" : "Oficiální vydání ↗"}</button>}
          </div>
        </div>
      </div>
      <section className="complete-download"><div><span className="overline">STAŽENÍ TITULU</span><strong>Vybrat kapitoly ke stažení</strong><small>Vyberete formát, název i rozsah. Svazky a kapitoly se pojmenují podle mangy.</small></div><div className="complete-download-actions"><button onClick={() => openDownload("CBZ")} disabled={remoteBookLoading || exporting}>STÁHNOUT</button></div></section>
      <section className="volume-section">
        <div className="block-heading"><div><span className="overline">OBSAH</span><h2>{selected.source === "web" && detailVolumes.every((volume) => !volume.confirmed) ? "Skupiny a kapitoly" : "Svazky a kapitoly"}</h2></div><span>{remoteBookLoading ? "Načítám…" : stats.internal > 0 ? `${stats.internal} čitelných kapitol` : stats.external > 0 ? `${stats.external} ${selected.source === "web" ? "webových" : "externích"} kapitol` : "automatické webové hledání"}</span></div>
        {selected.source === "mangadex" && <div className="language-tabs" aria-label="Jazyk vydání"><button className={activeLanguage === "cs" ? "active" : ""} disabled={czechChapterCount === 0} onClick={() => chooseReadingLanguage("cs")}><b>ČEŠTINA</b><span>{czechChapterCount} kapitol</span></button><button className={activeLanguage === "en" ? "active" : ""} disabled={englishChapterCount === 0} onClick={() => chooseReadingLanguage("en")}><b>ENGLISH</b><span>{englishChapterCount} chapters</span></button></div>}
        {selected.source === "mangadex" && <p className={`source-note ${stats.internal > 0 ? "readable" : ""}`}>{stats.internal > 0 ? `Zobrazeno je pouze ${activeLanguage === "cs" ? "české" : "anglické"} vydání: ${stats.internal} kapitol lze číst přímo v aplikaci. Jazyky se už v seznamu ani při přechodu mezi kapitolami nemíchají.` : "Pro zvolený jazyk nejsou na MangaDexu čitelné stránky."}</p>}
        {["anilist", "googlebooks", "jikan", "openlibrary"].includes(selected.source) && <p className="source-note catalogue-only">Tento záznam poskytuje název, autora a obálku. Tlačítko čtení samo zkusí MangaDex a potom kompatibilní vestavěný web.</p>}
        {selected.source === "web" && <p className="source-note readable">{detailVolumes.every((volume) => !volume.confirmed) ? "Manga Reader našel živý seznam kapitol a seřadil jej do přehledných automatických skupin; nejde o oficiální členění svazků." : "Manga Reader načetl živý seznam kapitol s potvrzeným členěním svazků."} Kliknutí otevře vybranou kapitolu v nativní čtečce; obrázky se předem nestahují ani neukládají.</p>}
        {detailVolumes.map((volume) => <div className="volume-row" key={volume.id}><div className="volume-number"><strong>{volume.number >= 100000 ? "—" : String(volume.number).padStart(2, "0")}</strong><span>{volume.number >= 100000 ? "BEZ" : "SV."}</span></div><div className="volume-meta"><strong>{volumeTitle(volume)}</strong><span>{volume.year} · {volume.chapters.filter((item) => item.pages > 0 || item.externalUrl).length} dostupných</span></div><div className="chapter-list">{volume.chapters.map((item) => <button key={item.id} onClick={() => openChapter(selected, volume, item)} disabled={remoteBookLoading || item.pages === 0 && !item.externalUrl}><span>{chapterDisplayNumber(item)}</span><strong>{item.title}</strong><small>{selected.source === "web" ? "WEB · EN" : item.language ? item.language.toUpperCase() : ""}{item.language && item.pages ? " · " : ""}{selected.source === "web" ? "" : item.externalUrl ? "externí" : item.pages > 0 ? `${item.pages} stran` : "nedostupné"}</small><i>{item.externalUrl && selected.source !== "web" ? "↗" : "→"}</i></button>)}</div></div>)}
      </section>
    </div>
    ;
  };

  const renderReader = () => {
    const remoteKey = chapterPageCacheKey(selected, selectedChapter);
    const fetchedPages = remoteKey ? remotePages[remoteKey] : undefined;
    const pages = selected.source === "mangadex" || selected.source === "web" ? fetchedPages ?? [] : selected.localPages ?? Array.from({ length: selectedChapter.pages }, (_, index) => ({ name: `${index + 1}`, url: "" }));
    const displayChapter = selected.source === "mangadex" || selected.source === "web" ? { ...selectedChapter, pages: pages.length } : selectedChapter;
    const visiblePage = pages[readerPage];
    const readerPageKey = `${selectedChapter.id}:${readerPage}`;
    return <div className="reader-screen" data-reader-fit-mode={readerFitMode}>
      <div className="reader-toolbar" data-testid="reader-toolbar">
        <button onClick={() => navigate("detail")}>← <span>Zpět</span></button>
        <div className="reader-title"><div className="reader-title-text"><strong>{selected.title}</strong><small>{selectedChapter.language ? `${selectedChapter.language.toUpperCase()} · ` : ""}{volumeTitle(selectedVolume)} · Kapitola {chapterDisplayNumber(selectedChapter)}: {selectedChapter.title}</small></div>{pages.length > 0 && <div className="reader-page-counter" data-testid="reader-page-counter"><strong>{readerPage + 1} / {pages.length}</strong><span>← → listování · ↑ ↓ posouvání stránky</span></div>}</div>
        <div className="reader-controls">
          <button onClick={() => changeReaderScale(-10)} aria-label="Zmenšit" title="Zmenšit stránku">−</button>
          <span data-testid="reader-zoom-value">{readerFitMode === "fit" ? "FIT" : `${readerScale}%`}</span>
          <button onClick={() => changeReaderScale(10)} aria-label="Zvětšit" title="Zvětšit stránku">＋</button>
          <button onClick={enableReaderFit} aria-label="Přizpůsobit stránku" title="Přizpůsobit oknu">FIT</button>
          {readerAtEnd && <button className="finish-reader reader-secondary-action" onClick={() => markCompleted(selected)}>HOTOVO ✓</button>}
          {selected.source === "mangadex" && <button className="reader-secondary-action" onClick={() => openExternal(`https://mangadex.org/chapter/${selectedChapter.remoteId}`)}>MD ↗</button>}
          <button className="reader-secondary-action" onClick={() => void printPdf()} disabled={readerLoading || pages.length === 0 || printing}>{printing ? "PDF…" : "PDF"}</button>
          <button className="reader-secondary-action" onClick={() => void saveEpub()} disabled={exporting || readerLoading || pages.length === 0}>EPUB</button>
          <button className="reader-secondary-action" onClick={() => saveEpub(true)} disabled={exporting || readerLoading || pages.length === 0}>KINDLE</button>
          <button className="reader-overflow-toggle" onClick={() => setReaderMenuOpen((value) => !value)} aria-label="Další možnosti" aria-expanded={readerMenuOpen}>•••</button>
          <button className="reader-sidebar-toggle" onClick={() => setChapterPanel((value) => !value)} aria-label="Přepnout panel kapitol" aria-expanded={chapterPanel}>☰</button>
          {readerMenuOpen && <div className="reader-overflow-menu" role="menu">
            {readerAtEnd && <button role="menuitem" onClick={() => markCompleted(selected)}>HOTOVO ✓</button>}
            {selected.source === "mangadex" && <button role="menuitem" onClick={() => openExternal(`https://mangadex.org/chapter/${selectedChapter.remoteId}`)}>MangaDex ↗</button>}
            <button role="menuitem" onClick={() => { setReaderMenuOpen(false); void printPdf(); }} disabled={readerLoading || pages.length === 0 || printing}>{printing ? "PDF…" : "PDF"}</button>
            <button role="menuitem" onClick={() => { setReaderMenuOpen(false); void saveEpub(); }} disabled={exporting || readerLoading || pages.length === 0}>EPUB</button>
            <button role="menuitem" onClick={() => { setReaderMenuOpen(false); void saveEpub(true); }} disabled={exporting || readerLoading || pages.length === 0}>KINDLE</button>
          </div>}
        </div>
      </div>
      <div className={`reader-body ${chapterPanel ? "with-panel" : ""}`}>
        <div className="reader-viewport" data-testid="reader-viewport">
          <div className="pages-scroll" ref={readerScrollRef} tabIndex={0} aria-label="Čtečka po jedné stránce" data-testid="pages-scroll">
            {readerLoading && <div className="reader-message"><i /><strong>{selected.source === "web" ? "Načítám listy kapitoly…" : "Načítám stránky z MangaDexu…"}</strong><span>Kapitola zůstává pouze v paměti této relace.</span></div>}
            {!readerLoading && selected.source === "mangadex" && pages.length === 0 && <div className="reader-message"><strong>Stránky nejsou dostupné</strong><span>Zkuste kapitolu otevřít přímo v oficiální čtečce MangaDex.</span><button onClick={() => openExternal(`https://mangadex.org/chapter/${selectedChapter.remoteId}`)}>Otevřít MangaDex ↗</button></div>}
            {!readerLoading && selected.source === "web" && pages.length === 0 && <div className="reader-message"><strong>Listy se nepodařilo načíst</strong><span>Zdroj mohl kapitolu dočasně změnit.</span><button onClick={() => openChapter(selected, selectedVolume, selectedChapter)}>Zkusit znovu</button></div>}
            {!readerLoading && visiblePage && <div className="reader-page-stage" style={readerFitMode === "fit" ? { width: "100%", height: "100%" } : { width: `${Math.max(100, readerScale)}%`, height: `${Math.max(100, readerScale)}%` }}>
              <div className={`reader-single-page ${readerFitMode}`} data-testid="reader-page" data-reader-page-key={readerPageKey} style={readerFitMode === "fit" ? undefined : { width: `${Math.min(100, readerScale)}%`, height: `${Math.min(100, readerScale)}%` }}><ComicSheet key={readerPageKey} book={selected} currentChapter={displayChapter} page={readerPage + 1} localPage={visiblePage} /></div>
            </div>}
            {printing && pages.length > 0 && <div className="print-pages" aria-hidden="true">{pages.map((localPage, index) => <ComicSheet key={`print-${selectedChapter.id}-${index}`} book={selected} currentChapter={displayChapter} page={index + 1} localPage={localPage} />)}</div>}
          </div>
          {!readerLoading && visiblePage && <div className="reader-navigation-overlay" aria-hidden="false">
            <button className="reader-arrow previous" onClick={previousReaderPage} aria-label="Předchozí stránka">‹</button>
            <button className="reader-arrow next" onClick={nextReaderPage} aria-label="Další stránka">›</button>
          </div>}
        </div>
        {chapterPanel && <aside className="reader-chapters" data-testid="reader-sidebar"><header><strong>ČTEČKA</strong><button onClick={() => setChapterPanel(false)} aria-label="Zavřít panel kapitol">×</button></header><nav className="reader-panel-tabs" aria-label="Reader panel"><button className={readerPanelTab === "contents" ? "active" : ""} onClick={() => setReaderPanelTab("contents")}>OBSAH</button><button className={readerPanelTab === "pages" ? "active" : ""} onClick={() => setReaderPanelTab("pages")}>STRÁNKY</button></nav>{readerPanelTab === "contents" ? readerNavigationVolumes.map((volume) => <div className="reader-volume" key={volume.id}><span>{volumeDisplayLabel(volume)} · {volumeTitle(volume)}</span>{volume.chapters.map((item) => <button className={volume.id === selectedVolume.id && item.id === selectedChapter.id ? "active" : ""} key={item.id} onClick={() => openChapter(selected, volume, item)}><i>{chapterDisplayNumber(item)}</i><strong>{item.title}</strong><small>{item.language?.toUpperCase() ?? item.pages}</small></button>)}</div>) : <div className="reader-page-grid">{pages.map((page, index) => <button className={readerPage === index ? "active" : ""} key={`${selectedChapter.id}-thumb-${index}`} onClick={() => setReaderPage(index)} aria-label={`Přejít na stránku ${index + 1}`} aria-current={readerPage === index ? "page" : undefined}><ReaderThumbnail page={page} pageNumber={index + 1} /><span>{index + 1}</span></button>)}</div>}</aside>}
      </div>
    </div>;
  };

  const renderWebReader = () => webReader && <div className="web-reader-screen">
    <div className="web-reader-toolbar">
      <button onClick={() => navigate("detail")}>← <span>Zpět na detail</span></button>
      <div><strong>{webReader.title}</strong><small>{webReader.source}</small></div>
      <div className="web-reader-actions"><button onClick={() => setWebReaderUrl(webReader.startUrl)}>{webReader.startLabel}</button><button onClick={() => setWebReaderUrl(webReader.homeUrl)}>{webReader.homeLabel}</button></div>
    </div>
    <div className="web-reader-notice">{webReader.mode === "direct" ? "NEJLEPŠÍ SHODA" : "VÝSLEDKY HLEDÁNÍ"} · obsah zůstává na zdrojové stránce · export je vypnutý</div>
    <iframe key={webReaderUrl} src={webReaderUrl} title={`${webReader.title} — webová čtečka`} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
  </div>;

  const renderDownloads = () => <div className="screen simple-screen"><div className="screen-heading"><div><span className="overline">LOKÁLNÍ EXPORTY</span><h1>Stažené</h1><p>CBZ, EPUB, Kindle EPUB i PDF se vytvářejí a ukládají přímo.</p></div></div><div className="format-cards"><article><span>CBZ</span><h2>Pro čtečky komiksů</h2><p>Obrázky ve správném pořadí, zabalené do standardního formátu Comic Book ZIP.</p></article><article><span>EPUB</span><h2>Pro elektronické čtečky</h2><p>Obrázkový EPUB 3 s pevně seřazenými stránkami a navigací.</p></article><article><span>KINDLE</span><h2>Pro Send to Kindle</h2><p>Kindle-friendly EPUB s obalem, metadaty a manga pořadím stránek.</p></article><article><span>PDF</span><h2>Pro tisk a archiv</h2><p>PDF se po vytvoření rovnou stáhne bez dalšího nastavování.</p></article></div><section className="history"><h2>Historie této relace</h2>{exports.length ? exports.map((item) => <div key={item.id}><span className="file-icon">{item.format}</span><strong>{item.title}</strong><small>{item.when}</small></div>) : <p>Zatím jste nic neexportovali.</p>}</section></div>;

  const renderSettings = () => <div className="screen simple-screen"><div className="screen-heading"><div><span className="overline">NASTAVENÍ A SOUKROMÍ</span><h1>Místní aplikace</h1><p>Manga Reader nevyžaduje účet a neposílá historii čtení na vlastní server.</p></div></div><div className="settings-list"><article className="theme-settings"><div><strong>Režim zobrazení</strong><p>Volba platí pro celou aplikaci a uloží se pro příště.</p></div><div className="theme-choice"><button className={theme === "light" ? "active" : ""} onClick={() => { setTheme("light"); safeSetItem("manga-reader-theme", "light"); }}>Denní</button><button className={theme === "dark" ? "active" : ""} onClick={() => { setTheme("dark"); safeSetItem("manga-reader-theme", "dark"); }}>Noční</button></div></article><article><div><strong>Historie čtení</strong><p>Ukládá se pouze v tomto prohlížeči.</p></div><span className="status-pill">LOKÁLNĚ</span></article><article><div><strong>Importované obrázky</strong><p>Zůstanou dostupné do zavření nebo obnovení aplikace.</p></div><span className="status-pill">DOČASNĚ</span></article><article><div><strong>MangaDex</strong><p>Katalog i stránky dostupných kapitol se načítají přímo z oficiálního API.</p></div><span className="status-pill online">KAPITOLY</span></article><article><div><strong>AniList + MyAnimeList</strong><p>Dva rozsáhlé manga katalogy pro alternativní názvy, autory a obálky.</p></div><span className="status-pill anilist">KATALOG</span></article><article><div><strong>Google Books + Open Library</strong><p>Další vydání, knihovní záznamy a legální náhledy, pokud jsou dostupné.</p></div><span className="status-pill googlebooks">NÁHLEDY</span></article><article><div><strong>Lokální export</strong><p>Otevřenou kapitolu lze uložit jako CBZ, EPUB, Kindle EPUB nebo PDF. Používejte jen obsah, který smíte stáhnout.</p></div><span className="status-pill online">AKTIVNÍ</span></article></div></div>;

  return (
    <main className="desktop-app" data-theme={theme}>
      <div className="app-frame">
        {view !== "reader" && view !== "webreader" && view !== "home" && <aside className="app-sidebar"><button className="app-logo" onClick={goHome}><span><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z" /></svg></span><strong>MANGA</strong><small>READER</small></button><nav><button className={view === "home" ? "active" : ""} onClick={goHome}><i>⌂</i>Domů</button><button className={view === "library" || view === "detail" ? "active" : ""} onClick={() => navigate("library")}><i>▦</i>Knihovna</button><button className={view === "downloads" ? "active" : ""} onClick={() => navigate("downloads")}><i>⇩</i>Stažené</button><button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}><i>⚙</i>Nastavení</button></nav><div className="sidebar-library"><div><span>MOJE KNIHOVNA</span><button onClick={() => setImportOpen(true)}>＋</button></div>{libraryBooks.slice(0, 4).map((book) => { const savedProgress = storedBookProgress(book); return <button key={book.id} onClick={() => chooseBook(book)}><span style={{ background: book.accent }} /><div><strong>{book.title}</strong><small>{savedProgress ? `Pozice ${progressLabel(savedProgress)}` : book.czechTitle}</small></div></button>; })}</div><button className="import-side" onClick={() => setImportOpen(true)}><i>＋</i><span><strong>Importovat mangu</strong><small>JPG, PNG nebo WEBP</small></span></button></aside>}
        <section className={`workspace ${view === "reader" || view === "webreader" ? "reader-workspace" : ""} ${view === "home" ? "home-workspace" : ""}`}>
          {view !== "reader" && view !== "webreader" && view !== "home" && <header className="workspace-header"><label className="global-search"><span>⌕</span><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setSourceFilter("all"); if (view !== "library") navigate("library"); }} onKeyDown={searchKey} placeholder="Název mangy česky nebo anglicky…" aria-label="Hledat mangu" /><button type="button" className="search-enter" onClick={submitGlobalSearch}>ENTER</button></label><button className="header-import" onClick={() => setImportOpen(true)}>＋</button><button className={`theme-toggle ${theme === "light" ? "to-dark" : "to-light"}`} onClick={toggleTheme} aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"} title={theme === "light" ? "Tmavý režim" : "Světlý režim"}>{theme === "light" ? "☾" : "☀"}</button></header>}
          {view === "home" && renderHome()}{view === "library" && renderLibrary()}{view === "detail" && renderDetail()}{view === "reader" && renderReader()}{view === "webreader" && renderWebReader()}{view === "downloads" && renderDownloads()}{view === "settings" && renderSettings()}
        </section>
      </div>

      {importOpen && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setImportOpen(false)}><form className="import-dialog" onSubmit={importLocal}><header><div><span>LOKÁLNÍ IMPORT</span><h2>Načíst vlastní mangu</h2></div><button type="button" onClick={() => setImportOpen(false)}>×</button></header><p>Vyberte obrázky jedné kapitoly. Seřadí se podle názvu souboru a zůstanou pouze v paměti tohoto zařízení.</p><label>Název mangy<input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="Např. Moje manga" required autoFocus /></label><label className="file-drop"><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => setImportFiles(Array.from(event.target.files ?? []))} required /><span>▧</span><strong>{importFiles.length ? `${importFiles.length} obrázků vybráno` : "Vybrat stránky"}</strong><small>PNG, JPG nebo WEBP · označte všechny stránky najednou</small></label><div className="dialog-actions"><button type="button" onClick={() => setImportOpen(false)}>Zrušit</button><button className="primary-button" type="submit" disabled={!importTitle.trim() || importFiles.length === 0}>Načíst do knihovny</button></div></form></div>}
      {notice && <button className="app-toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      {downloadOpen && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDownloadOpen(false)}><form className="download-dialog-v2" onSubmit={(event) => { event.preventDefault(); setDownloadOpen(false); const groups = (downloadMode === "volumes" ? downloadVolumeIds.map((id) => { const volume = downloadVolumes.find((item) => item.id === id); return { ids: volume?.chapters.filter((chapter) => chapter.pages > 0 || chapter.externalUrl).map((chapter) => chapter.id) ?? [], label: volume ? exportVolumeLabel(volume) : id }; }) : downloadChapterIds.map((id) => { const chapter = downloadVolumes.flatMap((volume) => volume.chapters).find((item) => item.id === id); return { ids: [id], label: chapter ? `chapter-${chapterDisplayNumber(chapter)}` : id }; })).filter((group) => group.ids.length > 0); void downloadSelected(downloadFormat, groups, downloadName.trim() || selected.title); }}><header><div><span>EXPORT MANGY</span><h2>Vyberte stažení</h2></div><button type="button" onClick={() => setDownloadOpen(false)}>×</button></header><label>Název složky a souborů<input value={downloadName} onChange={(event) => setDownloadName(event.target.value)} placeholder="Název složky a souborů" autoFocus /></label><div className="download-folder-note selected"><strong>Automatické uložení: Stažené soubory\{sanitizeDownloadName(downloadName || selected.title)}</strong><span>Nic dalšího nevybíráte. Reader složku podle názvu mangy sám vytvoří a pozdější sešity uloží do stejné složky.</span><small>Ukázka: {makeExportFileName(downloadName || selected.title, downloadMode === "volumes" ? "volume-01" : "chapter-1", downloadFormat === "CBZ" ? "cbz" : downloadFormat === "PDF" ? "pdf" : "epub", downloadFormat === "KINDLE")}</small></div><div className="download-scope-choice"><span>Co stáhnout</span><div><button type="button" className={downloadMode === "volumes" ? "active" : ""} onClick={() => setDownloadMode("volumes")}>SEŠITY</button><button type="button" className={downloadMode === "chapters" ? "active" : ""} onClick={() => setDownloadMode("chapters")}>KAPITOLY</button></div></div><div className="download-format-choice"><span>Formát</span><div>{(["CBZ", "EPUB", "PDF", "KINDLE"] as DownloadFormat[]).map((format) => <button type="button" className={downloadFormat === format ? "active" : ""} key={format} onClick={() => setDownloadFormat(format)}>{format}</button>)}</div></div><div className="download-selection-head"><strong>{downloadMode === "volumes" ? `Sešity (${downloadVolumeIds.length})` : `Kapitoly (${downloadChapterIds.length})`}</strong><div><button type="button" onClick={() => downloadMode === "volumes" ? setDownloadVolumeIds(downloadVolumes.filter((volume) => volume.chapters.some((chapter) => chapter.pages > 0 || chapter.externalUrl)).map((volume) => volume.id)) : setDownloadChapterIds(downloadVolumes.flatMap((volume) => volume.chapters).filter((chapter) => chapter.pages > 0 || chapter.externalUrl).map((chapter) => chapter.id))}>Stáhnout vše</button><button type="button" onClick={() => downloadMode === "volumes" ? setDownloadVolumeIds([]) : setDownloadChapterIds([])}>Zrušit výběr</button></div></div>{downloadMode === "volumes" ? <div className="download-chapter-list">{downloadVolumes.map((volume) => { const available = volume.chapters.filter((chapter) => chapter.pages > 0 || chapter.externalUrl); return available.length ? <label className="download-volume-option" key={volume.id}><input type="checkbox" checked={downloadVolumeIds.includes(volume.id)} onChange={(event) => setDownloadVolumeIds((current) => event.target.checked ? [...current, volume.id] : current.filter((id) => id !== volume.id))} /><strong>{volumeDisplayLabel(volume)}</strong><span>{volumeTitle(volume)} · {available.length} kapitol</span></label> : null; })}</div> : <div className="download-chapter-list">{downloadVolumes.map((volume) => { const chapters = volume.chapters.filter((chapter) => chapter.pages > 0 || chapter.externalUrl); return chapters.length ? <fieldset key={volume.id}><legend>{volumeTitle(volume)}</legend>{chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" checked={downloadChapterIds.includes(chapter.id)} onChange={(event) => setDownloadChapterIds((current) => event.target.checked ? [...current, chapter.id] : current.filter((id) => id !== chapter.id))} /><span>{chapterDisplayNumber(chapter)}</span><strong>{chapter.title}</strong></label>)}</fieldset> : null; })}</div>}<div className="dialog-actions"><button type="button" onClick={() => setDownloadOpen(false)}>Zrušit</button><button className="primary-button" type="submit" disabled={!downloadName.trim() || (downloadMode === "volumes" ? downloadVolumeIds.length === 0 : downloadChapterIds.length === 0) || exporting}>Stáhnout {downloadFormat}</button></div></form></div>}
    </main>
  );
}

function ReaderThumbnail({ page, pageNumber }: { page: LocalPage; pageNumber: number }) {
  const source = page.thumbnailUrl ?? page.url;
  const fallback = page.thumbnailFallbackUrl ?? page.fallbackUrl;
  return <img src={source} alt="" loading="lazy" decoding="async" data-testid={`reader-thumbnail-${pageNumber}`} onError={(event) => {
    if (!fallback || event.currentTarget.dataset.fallbackApplied) return;
    event.currentTarget.dataset.fallbackApplied = "true";
    event.currentTarget.src = fallback;
  }} />;
}
