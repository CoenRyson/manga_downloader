"use client";

import { ChangeEvent, CSSProperties, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type Chapter = { id: string; number: number; title: string; pages: number; remoteId?: string; language?: string; externalUrl?: string };
type Volume = { id: string; number: number; title: string; year: string; chapters: Chapter[] };
type LocalPage = { name: string; url: string; fallbackUrl?: string };
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
};

type View = "home" | "library" | "detail" | "reader" | "webreader" | "downloads" | "settings";
type ReadingLanguage = "cs" | "en";
type ExportRecord = { id: string; title: string; format: "CBZ" | "PDF" | "EPUB"; when: string };
type RemoteStatus = "idle" | "loading" | "ready" | "partial" | "error";
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
  const authors = item.relationships?.filter((relationship) => relationship.type === "author").map((relationship) => relationship.attributes?.name).filter(Boolean) as string[] | undefined;
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
    ratingCount: item.favourites,
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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs").replace(/[^a-z0-9]+/g, " ").trim();
}

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

function searchScore(book: Manga, query: string) {
  if (!query) return 0;
  const title = normalizeSearch(book.title);
  const czechTitle = normalizeSearch(book.czechTitle);
  const aliases = book.aliases.map(normalizeSearch);
  const exact = title === query || czechTitle === query || aliases.includes(query);
  const starts = title.startsWith(query) || czechTitle.startsWith(query) || aliases.some((alias) => alias.startsWith(query));
  const doujinshiPenalty = !query.includes("doujinshi") && /doujinshi|anthology|coloring book/.test(title) ? 35 : 0;
  const sourcePriority: Record<Manga["source"], number> = { local: -3, web: -2, mangadex: 0, anilist: 5, jikan: 7, googlebooks: 9, openlibrary: 11 };
  return (exact ? 0 : starts ? 10 : 20) + doujinshiPenalty + sourcePriority[book.source];
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

function parseProgress(value?: string) {
  const [languagePart, positionPart] = value?.includes("|") ? value.split("|", 2) : [undefined, value ?? ""];
  const language = languagePart === "cs" || languagePart === "en" ? languagePart : undefined;
  return { language, position: positionPart.split(".").map(Number) };
}

function progressLabel(value?: string) {
  const parsed = parseProgress(value);
  return `${parsed.language ? `${parsed.language.toUpperCase()} · ` : ""}${parsed.position.filter(Number.isFinite).join(".")}`;
}

function openExternal(url?: string) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  } catch { /* Neplatný externí odkaz ignorujeme. */ }
}

function webReaderSourceFor(book: Manga): WebReaderSource {
  const names = [book.title, book.czechTitle].map(normalizeSearch);
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

function ComicSheet({ book, currentChapter, page, localPage, onImageLoad }: { book: Manga; currentChapter: Chapter; page: number; localPage?: LocalPage; onImageLoad?: (image: HTMLImageElement) => void }) {
  if (localPage) return <article className="comic-sheet image-sheet" style={{ "--book-accent": book.accent, "--book-soft": book.accentSoft } as CSSProperties}><img src={localPage.url} alt={`${book.title}, stránka ${page}`} referrerPolicy="no-referrer" onLoad={(event) => onImageLoad?.(event.currentTarget)} onError={(event) => {
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
  const [view, setView] = useState<View>("home");
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
  const [readerScale, setReaderScale] = useState(100);
  const [readerFitSize, setReaderFitSize] = useState<{ width: number; height: number } | null>(null);
  const [readerPage, setReaderPage] = useState(0);
  const [chapterPanel, setChapterPanel] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importTitle, setImportTitle] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState("");
  const [exports, setExports] = useState<ExportRecord[]>([]);
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
    queueMicrotask(() => {
      try { if (storedLibrary) setLibraryIds(JSON.parse(storedLibrary)); } catch { window.localStorage.removeItem("shiori-library"); }
      try { if (storedProgress) setProgress(JSON.parse(storedProgress)); } catch { window.localStorage.removeItem("shiori-progress"); }
      try { if (storedCompleted) setCompleted(JSON.parse(storedCompleted)); } catch { window.localStorage.removeItem("shiori-completed"); }
      try { if (storedRecent) setRecentIds(JSON.parse(storedRecent)); } catch { window.localStorage.removeItem("shiori-recent"); }
      try { if (storedCatalogue) setStoredBooks(JSON.parse(storedCatalogue)); } catch { window.localStorage.removeItem("manga-reader-books"); }
    });
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
        params.append("contentRating[]", "safe");
        params.append("contentRating[]", "suggestive");
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
          const graphQuery = `query SearchManga($search: String) { Page(page: 1, perPage: 12) { media(search: $search, type: MANGA, isAdult: false, sort: SEARCH_MATCH) { id title { romaji english native } description coverImage { extraLarge large } siteUrl status startDate { year } genres averageScore meanScore favourites staff(perPage: 2) { nodes { name { full } } } } } }`;
          const response = await fetch("https://graphql.anilist.co", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: graphQuery, variables: { search: title } }),
          });
          if (!response.ok) throw new Error(`AniList ${response.status}`);
          const payload = await response.json() as { data?: { Page?: { media?: AniListItem[] } } };
          return (payload.data?.Page?.media ?? []).map(mapAniListItem);
        })());
      }
      if (useJikan) {
        requests.push((async () => {
          const url = new URL("https://api.jikan.moe/v4/manga");
          url.searchParams.set("q", title);
          url.searchParams.set("limit", "12");
          url.searchParams.set("sfw", "true");
          url.searchParams.set("order_by", "score");
          url.searchParams.set("sort", "desc");
          const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Jikan ${response.status}`);
          const payload = await response.json() as { data?: JikanItem[] };
          return (payload.data ?? []).map(mapJikanItem);
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
    const merged = new Map<string, Manga>();
    for (const book of [...storedBooks, ...discoveryBooks, ...mangaDexBooks, ...localBooks]) {
      const existing = merged.get(book.id);
      if (!existing || bookRichness(book) >= bookRichness(existing)) merged.set(book.id, book);
    }
    return [...merged.values()];
  }, [localBooks, mangaDexBooks, discoveryBooks, storedBooks]);
  const selected = catalogue.find((book) => book.id === selectedId) ?? emptySelection;
  const selectedVolume = selected.volumes.find((volume) => volume.id === volumeId) ?? selected.volumes[0];
  const selectedChapter = selectedVolume.chapters.find((item) => item.id === chapterId) ?? selectedVolume.chapters[0];

  const filterBaseBooks = useMemo(() => {
    const normalized = normalizeSearch(query);
    return catalogue.filter((book) => {
      const sourceMatch = sourceFilter === "all" || sourceFilter === "readable" && (book.source === "mangadex" || book.source === "local" || book.source === "web") || book.source === sourceFilter;
      const text = normalizeSearch([book.title, book.czechTitle, book.author, ...book.aliases].join(" "));
      return sourceMatch && (!normalized || text.includes(normalized));
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
      return searchScore(a, normalized) - searchScore(b, normalized) || bookRichness(b) - bookRichness(a) || a.title.localeCompare(b.title, "cs");
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
      const searchable = normalizeSearch([book.title, book.czechTitle, ...book.aliases].join(" "));
      if (seen.has(key) || !searchable.includes(normalized)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => searchScore(a, normalized) - searchScore(b, normalized) || (b.rating ?? -1) - (a.rating ?? -1)).slice(0, 6);
  }, [catalogue, query]);

  const activeSuggestionIndex = suggestions.length ? Math.min(Math.max(suggestionIndex, 0), suggestions.length - 1) : -1;

  useEffect(() => {
    setSuggestionIndex(0);
  }, [query]);

  const libraryBooks = catalogue.filter((book) => libraryIds.includes(book.id));
  const isCompletedBook = (book: Manga) => {
    const record = completed[book.id];
    return Boolean(record && chapterStats(book).total <= record.chapterCount);
  };
  const readingBooks = catalogue.filter((book) => Boolean(progress[book.id]) && !isCompletedBook(book));
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
      const next = { ...current };
      delete next[book.id];
      safeSetItem("shiori-progress", JSON.stringify(next));
      return next;
    });
    setNotice(`${book.title} odebrána z pokračování ve čtení`);
  };


  const goHome = () => {
    setQuery("");
    setSuggestionIndex(0);
    setSourceFilter("all");
    setView("home");
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
    setView(target);
    if (book.source === "web" && chapterStats(book).external > 0) {
      setVolumeId(book.volumes[0].id);
      setChapterId(book.volumes[0].chapters[0].id);
      return book;
    }
    setRemoteBookLoading(true);
    try {
      const response = await fetch(`/api/native-source?title=${encodeURIComponent(book.title)}`);
      if (!response.ok) throw new Error(`Native source ${response.status}`);
      const payload = await response.json() as {
        provider: string;
        grouping: "volume" | "automatic";
        chapterCount: number;
        matchedTitle: string;
        score: number;
        volumes: { number: number; title: string; chapters: { number: number; label: string; url: string }[] }[];
      };
      const volumes: Volume[] = payload.volumes.map((volume) => ({
        id: `web-${safeName(payload.provider)}-v-${volume.number}`,
        number: volume.number,
        title: volume.title,
        year: book.year,
        chapters: volume.chapters.map((chapter) => ({
          id: `web-${safeName(payload.provider)}-ch-${chapter.label}`,
          number: chapter.number,
          title: `Kapitola ${chapter.label}`,
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
    setView(target);
    if (chapterStats(book).total > 0) {
      const defaultLanguage: ReadingLanguage = languageChapterCount(book, "cs") > 0 ? "cs" : "en";
      const defaultVolumes = volumesInLanguage(book, defaultLanguage);
      setMangaLanguage(defaultLanguage);
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
      const defaultVolumes = volumesInLanguage(loaded, defaultLanguage);
      setMangaLanguage(defaultLanguage);
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

  const loadGoblinSlayerBook = async (book: Manga, target: View = "detail") => {
    rememberBook(book);
    setSelectedId(book.id);
    setView(target);
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
        chapterCount: number;
        volumes: { number: number; title: string; chapters: { number: number; label: string; url: string }[] }[];
      };
      const volumes: Volume[] = payload.volumes.map((volume) => ({
        id: `web-gs-v-${volume.number}`,
        number: volume.number,
        title: volume.title,
        year: book.year,
        chapters: volume.chapters.map((chapter) => ({
          id: `web-gs-ch-${chapter.label}`,
          number: chapter.number,
          title: `Kapitola ${chapter.label}`,
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
      setNotice(`${payload.chapterCount} kapitol rozděleno do ${volumes.length} svazků`);
    } catch {
      setNotice("Seznam Goblin Slayer se nepodařilo načíst. Webový režim zůstává dostupný.");
    } finally {
      setRemoteBookLoading(false);
    }
  };

  useEffect(() => {
    const names = [selected.title, selected.czechTitle, ...selected.aliases].map(normalizeSearch);
    const isGoblinSlayer = names.includes("goblin slayer");
    const isDandadan = names.includes("dandadan") || names.includes("dan da dan");
    const alreadyLoaded = selected.source === "web" && chapterStats(selected).external > 0;
    if (view === "detail" && isGoblinSlayer && !alreadyLoaded && !remoteBookLoading) {
      void loadGoblinSlayerBook(selected, "detail");
    }
    if (view === "detail" && isDandadan && !alreadyLoaded && !remoteBookLoading) {
      void loadNativeWebBook(selected, "detail");
    }
  }, [view, selected.id, selected.source]);

  const chooseBook = (book: Manga, target: View = "detail") => {
    const names = [book.title, book.czechTitle, ...book.aliases].map(normalizeSearch);
    if (names.includes("goblin slayer")) {
      void loadGoblinSlayerBook(book, target);
      return;
    }
    if (names.includes("dandadan") || names.includes("dan da dan")) {
      void loadNativeWebBook(book, target);
      return;
    }
    if (book.source === "mangadex") {
      void loadMangaDexBook(book, target);
      return;
    }
    if (["anilist", "googlebooks", "jikan", "openlibrary"].includes(book.source)) {
      void loadNativeWebBook(book, target);
      return;
    }
    rememberBook(book);
    setSelectedId(book.id); setVolumeId(book.volumes[0].id); setChapterId(book.volumes[0].chapters[0].id); setView(target);
  };

  const openChapter = async (book: Manga, volume: Volume, item: Chapter) => {
    const loadId = ++chapterLoadIdRef.current;
    setNotice("");
    setReaderScale(100);
    setReaderFitSize(null);
    setChapterPanel(false);
    persistBook(book);
    if (item.externalUrl && book.source === "web") {
      setSelectedId(book.id); setVolumeId(volume.id); setChapterId(item.id); setView("reader");
      if (item.language === "cs" || item.language === "en") setMangaLanguage(item.language);
      setReaderPage(0);
      const next = { ...progress, [book.id]: `${item.language === "cs" || item.language === "en" ? `${item.language}|` : ""}${volume.number}.${item.number}` };
      setProgress(next); safeSetItem("shiori-progress", JSON.stringify(next));
      if (!remotePages[item.id]) {
        setReaderLoading(true);
        try {
          const response = await fetch(`/api/native-source/chapter?url=${encodeURIComponent(item.externalUrl)}`);
          if (!response.ok) throw new Error(`Goblin Slayer pages ${response.status}`);
          const payload = await response.json() as { images: string[] };
          const pages = payload.images.map((url, index) => ({ name: `Stránka ${index + 1}`, url }));
          if (!pages.length) throw new Error("Prázdná kapitola");
          setRemotePages((current) => ({ ...current, [item.id]: pages }));
          return pages.length;
        } catch {
          if (chapterLoadIdRef.current === loadId) setNotice("Listy kapitoly se nepodařilo načíst. Zkuste kapitolu znovu.");
          return item.pages;
        } finally {
          if (chapterLoadIdRef.current === loadId) setReaderLoading(false);
        }
      }
      return remotePages[item.id]?.length ?? item.pages;
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
        setView("webreader");
      } catch { setNotice("Externí kapitola nemá platný webový odkaz."); }
      return item.pages;
    }
    setSelectedId(book.id); setVolumeId(volume.id); setChapterId(item.id); setView("reader");
    if (item.language === "cs" || item.language === "en") setMangaLanguage(item.language);
    setReaderPage(0);
    const next = { ...progress, [book.id]: `${item.language === "cs" || item.language === "en" ? `${item.language}|` : ""}${volume.number}.${item.number}` };
    setProgress(next); safeSetItem("shiori-progress", JSON.stringify(next));
    if (book.source === "mangadex" && item.remoteId && !remotePages[item.remoteId]) {
      setReaderLoading(true);
      try {
        const response = await fetch(`/api/mangadex-chapter?id=${encodeURIComponent(item.remoteId)}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`MangaDex pages ${response.status}`);
        const payload = await response.json() as { baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } };
        const sourceFiles = payload.chapter.dataSaver.length ? payload.chapter.dataSaver : payload.chapter.data;
        const proxyImage = (url: string) => `/api/mangadex-image?url=${encodeURIComponent(url)}`;
        const pages = sourceFiles.map((fileName, index) => ({
          name: payload.chapter.data[index] ?? fileName,
          url: proxyImage(payload.chapter.dataSaver.length ? `${payload.baseUrl}/data-saver/${payload.chapter.hash}/${fileName}` : `${payload.baseUrl}/data/${payload.chapter.hash}/${fileName}`),
          fallbackUrl: payload.chapter.data[index] ? proxyImage(`${payload.baseUrl}/data/${payload.chapter.hash}/${payload.chapter.data[index]}`) : undefined,
        }));
        setRemotePages((current) => ({ ...current, [item.remoteId as string]: pages }));
        return pages.length;
      } catch {
        if (chapterLoadIdRef.current === loadId) setNotice("Stránky kapitoly se nepodařilo načíst. Otevřete ji přímo na MangaDexu.");
        return item.pages;
      } finally {
        if (chapterLoadIdRef.current === loadId) setReaderLoading(false);
      }
    }
    const cachedKey = book.source === "web" ? item.id : item.remoteId;
    if (cachedKey && remotePages[cachedKey]) return remotePages[cachedKey].length;
    if (book.localPages) return book.localPages.length;
    return item.pages;
  };

  const readerRemoteKey = selected.source === "web" ? selectedChapter.id : selectedChapter.remoteId;
  const readerPageCount = readerRemoteKey
    ? remotePages[readerRemoteKey]?.length ?? selectedChapter.pages
    : selected.localPages?.length ?? selectedChapter.pages;
  const readerLanguage = selected.source === "mangadex" && (selectedChapter.language === "cs" || selectedChapter.language === "en") ? selectedChapter.language : undefined;
  const readerNavigationVolumes = readerLanguage ? volumesInLanguage(selected, readerLanguage) : selected.volumes;
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
  nextReaderPageRef.current = nextReaderPage;
  previousReaderPageRef.current = previousReaderPage;

  useEffect(() => {
    if (view !== "reader") return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowRight") { event.preventDefault(); nextReaderPageRef.current(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); previousReaderPageRef.current(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        readerScrollRef.current?.scrollBy({ top: event.key === "ArrowDown" ? 120 : -120, behavior: "smooth" });
      }
      if (event.key === "Escape") setView("detail");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view]);

  useEffect(() => {
    if (view !== "reader") return;
    queueMicrotask(() => setProgress((current) => {
      const languagePrefix = selectedChapter.language === "cs" || selectedChapter.language === "en" ? `${selectedChapter.language}|` : "";
      const next = { ...current, [selected.id]: `${languagePrefix}${selectedVolume.number}.${selectedChapter.number}.${readerPage + 1}` };
      safeSetItem("shiori-progress", JSON.stringify(next));
      return next;
    }));
  }, [readerPage, view, selected.id, selectedVolume.number, selectedChapter.number, selectedChapter.language]);

  useEffect(() => {
    if (view !== "reader") return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = readerScrollRef.current;
      if (!viewport) return;
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      if (readerPage === 0 || readerScale !== 100) viewport.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, readerPage, readerScale, readerLoading, chapterPanel]);

  useEffect(() => {
    if (readerPageCount > 0 && readerPage >= readerPageCount) queueMicrotask(() => setReaderPage(readerPageCount - 1));
  }, [readerPage, readerPageCount]);

  const toggleLibrary = (book: Manga) => {
    const next = libraryIds.includes(book.id) ? libraryIds.filter((id) => id !== book.id) : [...libraryIds, book.id];
    setLibraryIds(next); safeSetItem("shiori-library", JSON.stringify(next));
    if (next.includes(book.id)) persistBook(book);
    setNotice(next.includes(book.id) ? "Přidáno do místní knihovny" : "Odebráno z knihovny");
  };

  const searchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredBooks.length) setHighlightedIndex((current) => Math.min(current + 1, filteredBooks.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredBooks.length) setHighlightedIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter" && filteredBooks[activeIndex]) chooseBook(filteredBooks[activeIndex]);
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

  const currentExportPages = () => selected.localPages ?? (selectedChapter.remoteId ? remotePages[selectedChapter.remoteId] ?? [] : []);

  const collectExportPages = async () => {
    const pageRefs = currentExportPages();
    if (pageRefs.length === 0) throw new Error("Kapitola zatím nemá načtené stránky");
    return Promise.all(pageRefs.map(async (page, index) => {
      let response = await fetch(page.url, { headers: { Accept: "image/*" }, referrerPolicy: "no-referrer" });
      if (!response.ok && page.fallbackUrl) response = await fetch(page.fallbackUrl, { headers: { Accept: "image/*" }, referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Stránka ${index + 1}: ${response.status}`);
      const extensionFromName = page.name.split(".").pop()?.toLowerCase();
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      const extension = extensionFromName && ["jpg", "jpeg", "png", "webp"].includes(extensionFromName)
        ? extensionFromName
        : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const mediaType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      return { data: new Uint8Array(await response.arrayBuffer()), extension, mediaType };
    }));
  };

  const saveCbz = async () => {
    setExporting(true);
    setNotice("Stahuji stránky a připravuji CBZ…");
    try {
      const pages = await collectExportPages();
      const encoder = new TextEncoder();
      const archive = zipStore([
        ...pages.map((page, index) => ({ name: `${String(index + 1).padStart(3, "0")}.${page.extension}`, data: page.data })),
        { name: "README.txt", data: encoder.encode(`${selected.title}\n${selected.czechTitle}\n\n${selected.license}\nKapitola ${selectedChapter.number}: ${selectedChapter.title}\n\nExportováno lokálně v aplikaci Manga Reader.`) },
      ]);
      const blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/vnd.comicbook+zip" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${safeName(selected.title)}-chapter-${selectedChapter.number}.cbz`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExports((current) => [{ id: `${Date.now()}`, title: `${selected.title} · kap. ${selectedChapter.number}`, format: "CBZ", when: "Právě teď" }, ...current]);
      setNotice("CBZ bylo uloženo do Stažených souborů");
    } catch { setNotice("CBZ se nepodařilo vytvořit. Zdroj mohl odmítnout stažení obrázků."); }
    finally { setExporting(false); }
  };

  const saveEpub = async () => {
    setExporting(true);
    setNotice("Stahuji stránky a připravuji EPUB…");
    try {
      const pages = await collectExportPages();
      const encoder = new TextEncoder();
      const title = escapeXml(`${selected.title} — ${selectedChapter.title}`);
      const author = escapeXml(selected.author);
      const pageFiles = pages.map((page, index) => ({ ...page, fileName: `page-${String(index + 1).padStart(3, "0")}.${page.extension}` }));
      const manifestImages = pageFiles.map((page, index) => `<item id="img${index + 1}" href="images/${page.fileName}" media-type="${page.mediaType}"${index === 0 ? ' properties="cover-image"' : ""}/>`).join("");
      const manifestPages = pageFiles.map((_, index) => `<item id="p${index + 1}" href="pages/p${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("");
      const spine = pageFiles.map((_, index) => `<itemref idref="p${index + 1}"/>`).join("");
      const navItems = pageFiles.map((_, index) => `<li><a href="pages/p${index + 1}.xhtml">Stránka ${index + 1}</a></li>`).join("");
      const files: { name: string; data: Uint8Array }[] = [
        { name: "mimetype", data: encoder.encode("application/epub+zip") },
        { name: "META-INF/container.xml", data: encoder.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
        { name: "OEBPS/content.opf", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">shiori-${Date.now()}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>cs</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifestImages}${manifestPages}</manifest><spine page-progression-direction="rtl">${spine}</spine></package>`) },
        { name: "OEBPS/nav.xhtml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body><nav epub:type="toc"><h1>${title}</h1><ol>${navItems}</ol></nav></body></html>`) },
        ...pageFiles.map((page, index) => ({ name: `OEBPS/pages/p${index + 1}.xhtml`, data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Stránka ${index + 1}</title><meta name="viewport" content="width=device-width,height=device-height"/><style>html,body{margin:0;padding:0;background:#111;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img src="../images/${page.fileName}" alt="Stránka ${index + 1}"/></body></html>`) })),
        ...pageFiles.map((page) => ({ name: `OEBPS/images/${page.fileName}`, data: page.data })),
      ];
      const archive = zipStore(files);
      const blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/epub+zip" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${safeName(selected.title)}-chapter-${selectedChapter.number}.epub`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExports((current) => [{ id: `${Date.now()}`, title: `${selected.title} · kap. ${selectedChapter.number}`, format: "EPUB", when: "Právě teď" }, ...current]);
      setNotice("EPUB bylo uloženo do Stažených souborů");
    } catch { setNotice("EPUB se nepodařilo vytvořit. Zdroj mohl odmítnout stažení obrázků."); }
    finally { setExporting(false); }
  };

  const printPdf = () => {
    if (currentExportPages().length === 0) { setNotice("Nejdřív načtěte stránky kapitoly"); return; }
    setPrinting(true);
    setNotice("Připravuji všechny stránky pro PDF…");
    window.setTimeout(async () => {
      const images = [...document.querySelectorAll<HTMLImageElement>(".print-pages img")];
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
      setExports((current) => [{ id: `${Date.now()}`, title: `${selected.title} · kap. ${selectedChapter.number}`, format: "PDF", when: "Právě teď" }, ...current]);
      window.print();
      setPrinting(false);
    }, 100);
  };

  const resumeReading = (book: Manga) => {
    if (book.source === "mangadex" && chapterStats(book).total === 0) {
      void loadMangaDexBook(book);
      return;
    }
    const saved = parseProgress(progress[book.id]);
    const candidateVolumes = saved.language ? volumesInLanguage(book, saved.language) : book.volumes;
    const volume = candidateVolumes.find((item) => item.number === saved.position[0]) ?? candidateVolumes[0] ?? book.volumes[0];
    const item = volume.chapters.find((entry) => entry.number === saved.position[1] && (!saved.language || entry.language === saved.language)) ?? volume.chapters[0];
    if (saved.language) setMangaLanguage(saved.language);
    void openChapter(book, volume, item).then(() => setReaderPage(Math.max(0, (saved.position[2] ?? 1) - 1)));
  };

  const renderHome = () => {
    const visibleResumeBooks = readingBooks;
    const visibleCompletedBooks = completedBooks;
    const renderReadingCards = (books: Manga[], completedView = false) => books.length ? books.map((book) => <article className="manga-resume-card" key={book.id}><button className="resume-open" onClick={() => completedView ? chooseBook(book) : resumeReading(book)}><Cover book={book} compact /><span><small>{completedView ? "DOKONČENO" : `POZICE ${progressLabel(progress[book.id])}`}</small><strong>{book.title}</strong><i>{book.czechTitle}</i></span><b>{completedView ? "✓" : "→"}</b></button>{!completedView && <button className="resume-remove" onClick={() => removeFromContinue(book)} aria-label={`Odebrat ${book.title} z pokračování`}>×</button>}</article>) : <div className="manga-empty-library"><span>{completedView ? "ZATÍM NIC DOKONČENÉHO" : "ZATÍM NIC ROZČTENÉHO"}</span><strong>{completedView ? "Po poslední kapitole můžete mangu označit jako dokončenou." : "Každá manga se po otevření první kapitoly objeví zde."}</strong></div>;
    return <div className="screen manga-home">
      <div className="manga-home-shade" />
      <header className="manga-home-brand"><button onClick={goHome}><i><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z" /></svg></i><span><strong>MANGA READER</strong><small>LOCAL EDITION</small></span></button><div className="manga-home-actions"><nav className="home-nav" aria-label="Hlavní navigace"><button className="active" onClick={goHome}>Domů</button><button onClick={() => setView("library")}>Knihovna</button><button onClick={() => setView("downloads")}>Stažené</button><button onClick={() => setView("settings")}>Nastavení</button></nav><button className={`theme-toggle ${theme === "light" ? "to-dark" : "to-light"}`} onClick={toggleTheme} aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"} title={theme === "light" ? "Tmavý režim" : "Světlý režim"}>{theme === "light" ? "☾" : "☀"}</button><button className="manga-home-import" onClick={() => setImportOpen(true)}>＋ Vlastní manga</button></div></header>
      <section className="manga-search-core">
        <span>NAJDI. OTEVŘI. ČTI.</span>
        <label><i>⌕</i><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); if (suggestions.length) setSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1)); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); if (suggestions.length) setSuggestionIndex((current) => Math.max(current - 1, 0)); return; }
          if (event.key === "Enter") {
            const book = suggestions[activeSuggestionIndex];
            if (book) { setQuery(book.title); chooseBook(book); } else { setSourceFilter("all"); setView("library"); }
            return;
          }
          if (event.key === "Escape") setQuery("");
        }} placeholder="Název mangy česky, anglicky nebo japonsky…" autoComplete="off" autoFocus /><button onClick={() => { setSourceFilter("all"); setView("library"); }}>HLEDAT</button></label>
        {suggestions.length > 0 && <div className="search-suggestions" role="listbox" aria-label="Návrhy mang">{suggestions.map((book, index) => <button key={book.id} type="button" role="option" aria-selected={index === activeSuggestionIndex} className={index === activeSuggestionIndex ? "active" : ""} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => { setQuery(book.title); chooseBook(book); }}><span><strong>{book.title}</strong><small>{book.czechTitle}</small></span><b>{typeof book.rating === "number" ? `★ ${book.rating.toFixed(1)}` : "—"}</b><i>→</i></button>)}</div>}
        <small>MangaDex + automatický webový výběr pro čtení · další katalogy pro přesné názvy a obálky</small>
      </section>
      <section className="manga-home-tabs">
        <nav><button className={homeTab === "continue" ? "active" : ""} onClick={() => setHomeTab("continue")}>▶ Rozečtené <em>{readingBooks.length}</em></button><button className={homeTab === "completed" ? "active" : ""} onClick={() => setHomeTab("completed")}>✓ Dokončené <em>{completedBooks.length}</em></button><button className={homeTab === "downloads" ? "active" : ""} onClick={() => setHomeTab("downloads")}>⇩ Stažení</button></nav>
        {homeTab === "continue" ? <div className={`manga-resume-row ${visibleResumeBooks.length ? "" : "empty"}`}>{renderReadingCards(visibleResumeBooks)}</div> : homeTab === "completed" ? <div className={`manga-resume-row ${visibleCompletedBooks.length ? "" : "empty"}`}>{renderReadingCards(visibleCompletedBooks, true)}</div> : <div className="manga-download-row"><button onClick={() => setView("downloads")}><b>CBZ</b><span>Komiksové čtečky</span></button><button onClick={() => setView("downloads")}><b>EPUB</b><span>E‑book čtečky</span></button><button onClick={() => setView("downloads")}><b>PDF</b><span>Tisk a archiv</span></button><button className="import-format" onClick={() => setImportOpen(true)}><b>＋</b><span>Načíst vlastní listy</span></button></div>}
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
    const detailVolumes = selected.source === "mangadex" ? volumesInLanguage(selected, activeLanguage) : selected.volumes;
    const detailBook = { ...selected, volumes: detailVolumes };
    const primaryChapter = firstReadableChapter(detailBook) ?? (selected.source === "web" ? detailVolumes.flatMap((volume) => volume.chapters.map((item) => ({ volume, item }))).find(({ item }) => Boolean(item.externalUrl)) : undefined);
    const stats = chapterStats(detailBook);
    const chooseReadingLanguage = (language: ReadingLanguage) => {
      const languageVolumes = volumesInLanguage(selected, language);
      const languageBook = { ...selected, volumes: languageVolumes };
      const first = firstReadableChapter(languageBook) ?? languageVolumes.flatMap((volume) => volume.chapters.map((item) => ({ volume, item }))).find(({ item }) => item.pages > 0 || Boolean(item.externalUrl));
      setMangaLanguage(language);
      setNotice("");
      if (first) { setVolumeId(first.volume.id); setChapterId(first.item.id); }
    };
    const isGoblinSlayer = normalizeSearch(selected.title) === "goblin slayer";
    const embeddedReader = webReaderSourceFor(selected);
    const openEmbeddedReader = async () => {
      let resolved = embeddedReader;
      setWebReaderResolving(true);
      try {
        if (embeddedReader.mode === "search") {
          const response = await fetch(`/api/web-source?q=${encodeURIComponent(selected.title)}`);
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
      setView("webreader");
    };
    return <div className="screen detail-screen">
      <button className="back-button" onClick={() => setView("library")}>← Zpět do knihovny</button>
      <div className="detail-hero">
        <Cover book={selected} />
        <div className="detail-copy">
          <span className={`source-label ${selected.source}`}>{sourceTitle(selected.source)}</span><h1>{selected.title}</h1><h2>{selected.czechTitle}</h2><p>{selected.description}</p>
          <dl><div><dt>Autor</dt><dd>{selected.author}</dd></div><div><dt>Rok</dt><dd>{selected.year}</dd></div><div><dt>Hodnocení</dt><dd>{typeof selected.rating === "number" ? `★ ${ratingLabel(selected)} · ${ratingMeta(selected)}` : "Bez dostupného hodnocení"}</dd></div><div><dt>Stav</dt><dd>{selected.status}</dd></div><div><dt>Zdroj</dt><dd>{selected.license}</dd></div></dl>
          <div className={`source-choice ${primaryChapter ? "internal" : embeddedReader.mode}`}><b>AUTOMATICKÝ VÝBĚR</b><span>{primaryChapter ? `${sourceTitle(selected.source)} · nativní čtečka Manga Readeru` : embeddedReader.source}</span><small>{primaryChapter ? "Kapitola se otevře bez menu a rozhraní zdrojového webu." : embeddedReader.reason}</small></div>
          <div className="detail-actions">
            <button className="primary-button" disabled={remoteBookLoading || webReaderResolving} onClick={() => primaryChapter ? openChapter(selected, primaryChapter.volume, primaryChapter.item) : openEmbeddedReader()}>{remoteBookLoading ? "Načítám kapitoly…" : webReaderResolving ? "Hledám nejlepší zdroj…" : primaryChapter ? "▶ Číst v aplikaci" : embeddedReader.mode === "direct" ? "▶ Číst ve webovém režimu" : "⌕ Najít nejlepší webový zdroj"}</button>
            <button onClick={() => toggleLibrary(selected)}>{libraryIds.includes(selected.id) ? "✓ V knihovně" : "+ Do knihovny"}</button>
            {primaryChapter && selected.source !== "web" && <button disabled={webReaderResolving} onClick={openEmbeddedReader}>{webReaderResolving ? "Hledám…" : "Zkusit webový zdroj"}</button>}
            {selected.source === "mangadex" && <button onClick={() => openExternal(`https://mangadex.org/title/${selected.remoteId}`)}>MangaDex ↗</button>}
            {isGoblinSlayer && <button onClick={() => openExternal("https://global.manga-up.com/manga/108")}>MANGA UP! EN ↗</button>}
            {isGoblinSlayer && <button onClick={() => openExternal("https://yenpress.com/series/goblin-slayer-manga-serial")}>Yen Press EN ↗</button>}
            {selected.officialUrl && <button onClick={() => openExternal(selected.officialUrl)}>{selected.source === "anilist" ? "Otevřít AniList ↗" : selected.source === "googlebooks" ? "Otevřít náhled ↗" : selected.source === "jikan" ? "Otevřít MyAnimeList ↗" : selected.source === "openlibrary" ? "Otevřít Open Library ↗" : "Oficiální vydání ↗"}</button>}
          </div>
        </div>
      </div>
      <section className="volume-section">
        <div className="block-heading"><div><span className="overline">OBSAH</span><h2>Svazky a kapitoly</h2></div><span>{remoteBookLoading ? "Načítám…" : stats.internal > 0 ? `${stats.internal} čitelných kapitol` : stats.external > 0 ? `${stats.external} ${selected.source === "web" ? "webových" : "externích"} kapitol` : "automatické webové hledání"}</span></div>
        {selected.source === "mangadex" && <div className="language-tabs" aria-label="Jazyk vydání"><button className={activeLanguage === "cs" ? "active" : ""} disabled={czechChapterCount === 0} onClick={() => chooseReadingLanguage("cs")}><b>ČEŠTINA</b><span>{czechChapterCount} kapitol</span></button><button className={activeLanguage === "en" ? "active" : ""} disabled={englishChapterCount === 0} onClick={() => chooseReadingLanguage("en")}><b>ENGLISH</b><span>{englishChapterCount} chapters</span></button></div>}
        {selected.source === "mangadex" && <p className={`source-note ${stats.internal > 0 ? "readable" : ""}`}>{stats.internal > 0 ? `Zobrazeno je pouze ${activeLanguage === "cs" ? "české" : "anglické"} vydání: ${stats.internal} kapitol lze číst přímo v aplikaci. Jazyky se už v seznamu ani při přechodu mezi kapitolami nemíchají.` : "Pro zvolený jazyk nejsou na MangaDexu čitelné stránky."}</p>}
        {["anilist", "googlebooks", "jikan", "openlibrary"].includes(selected.source) && <p className="source-note catalogue-only">Tento záznam poskytuje název, autora a obálku. Tlačítko čtení samo zkusí MangaDex a potom kompatibilní vestavěný web.</p>}
        {selected.source === "web" && <p className="source-note readable">{selected.license.startsWith("MangaRead") ? "Manga Reader našel živý seznam kapitol a seřadil jej do přehledných skupin po deseti; nejde o oficiální členění svazků." : "Manga Reader načetl pouze živý seznam kapitol a rozdělil jej podle vydaných svazků."} Kliknutí otevře vybranou kapitolu v nativní čtečce; obrázky se předem nestahují ani neukládají.</p>}
        {detailVolumes.map((volume) => <div className="volume-row" key={volume.id}><div className="volume-number"><strong>{String(volume.number).padStart(2, "0")}</strong><span>SV.</span></div><div className="volume-meta"><strong>{volume.title}</strong><span>{volume.year} · {volume.chapters.filter((item) => item.pages > 0 || item.externalUrl).length} dostupných</span></div><div className="chapter-list">{volume.chapters.map((item) => <button key={item.id} onClick={() => openChapter(selected, volume, item)} disabled={remoteBookLoading || item.pages === 0 && !item.externalUrl}><span>{String(item.number).padStart(2, "0")}</span><strong>{item.title}</strong><small>{selected.source === "web" ? "WEB · EN" : item.language ? item.language.toUpperCase() : ""}{item.language && item.pages ? " · " : ""}{selected.source === "web" ? "" : item.externalUrl ? "externí" : item.pages > 0 ? `${item.pages} stran` : "nedostupné"}</small><i>{item.externalUrl && selected.source !== "web" ? "↗" : "→"}</i></button>)}</div></div>)}
      </section>
    </div>
    ;
  };

  const renderReader = () => {
    const remoteKey = selected.source === "web" ? selectedChapter.id : selectedChapter.remoteId;
    const fetchedPages = remoteKey ? remotePages[remoteKey] : undefined;
    const pages = selected.source === "mangadex" || selected.source === "web" ? fetchedPages ?? [] : selected.localPages ?? Array.from({ length: selectedChapter.pages }, (_, index) => ({ name: `${index + 1}`, url: "" }));
    const displayChapter = selected.source === "mangadex" || selected.source === "web" ? { ...selectedChapter, pages: pages.length } : selectedChapter;
    const visiblePage = pages[readerPage];
    const fitReaderImage = (image: HTMLImageElement) => {
      const viewport = readerScrollRef.current;
      if (!viewport || !image.naturalWidth || !image.naturalHeight) return;
      const ratio = Math.min(Math.max(120, viewport.clientWidth - 172) / image.naturalWidth, Math.max(120, viewport.clientHeight) / image.naturalHeight);
      setReaderFitSize({ width: Math.floor(image.naturalWidth * ratio), height: Math.floor(image.naturalHeight * ratio) });
    };
    return <div className="reader-screen">
      <div className="reader-toolbar"><button onClick={() => setView("detail")}>← <span>Zpět</span></button><div className="reader-title"><div className="reader-title-text"><strong>{selected.title}</strong><small>{selectedChapter.language ? `${selectedChapter.language.toUpperCase()} · ` : ""}Svazek {selectedVolume.number} · Kapitola {selectedChapter.number}: {selectedChapter.title}</small></div>{pages.length > 0 && <div className="reader-page-counter"><strong>{readerPage + 1} / {pages.length}</strong><span>← → listování · ↑ ↓ posouvání stránky</span></div>}</div><div className="reader-controls"><button onClick={() => setReaderScale((value) => Math.max(60, value - 10))} aria-label="Zmenšit" title="Zmenšit stránku">−</button><span>{readerScale}%</span><button onClick={() => setReaderScale((value) => Math.min(160, value + 10))} aria-label="Zvětšit" title="Zvětšit stránku">＋</button><button onClick={() => setReaderScale(100)} aria-label="Přizpůsobit stránku" title="Přizpůsobit oknu">FIT</button>{readerAtEnd && <button className="finish-reader" onClick={() => markCompleted(selected)}>HOTOVO ✓</button>}{selected.source === "mangadex" && <button onClick={() => openExternal(`https://mangadex.org/chapter/${selectedChapter.remoteId}`)}>MD ↗</button>}<button onClick={printPdf} disabled={selected.source === "web" || readerLoading || pages.length === 0 || printing}>{printing ? "PDF…" : "PDF"}</button><button onClick={saveEpub} disabled={selected.source === "web" || exporting || readerLoading || pages.length === 0}>EPUB</button><button className="accent-button" onClick={saveCbz} disabled={selected.source === "web" || exporting || readerLoading || pages.length === 0}>{exporting ? "BALÍM…" : "CBZ"}</button><button onClick={() => setChapterPanel((value) => !value)} aria-label="Přepnout panel kapitol">☰</button></div></div>
      <div className={`reader-body ${chapterPanel ? "with-panel" : ""}`}>
        <div className="pages-scroll" ref={readerScrollRef} tabIndex={0} aria-label="Čtečka po jedné stránce">
          {readerLoading && <div className="reader-message"><i /><strong>{selected.source === "web" ? "Načítám listy kapitoly…" : "Načítám stránky z MangaDexu…"}</strong><span>Kapitola zůstává pouze v paměti této relace.</span></div>}
          {!readerLoading && selected.source === "mangadex" && pages.length === 0 && <div className="reader-message"><strong>Stránky nejsou dostupné</strong><span>Zkuste kapitolu otevřít přímo v oficiální čtečce MangaDex.</span><button onClick={() => openExternal(`https://mangadex.org/chapter/${selectedChapter.remoteId}`)}>Otevřít MangaDex ↗</button></div>}
          {!readerLoading && selected.source === "web" && pages.length === 0 && <div className="reader-message"><strong>Listy se nepodařilo načíst</strong><span>Zdroj mohl kapitolu dočasně změnit.</span><button onClick={() => openChapter(selected, selectedVolume, selectedChapter)}>Zkusit znovu</button></div>}
          {!readerLoading && visiblePage && <div className="reader-page-stage" style={{ width: `${Math.max(100, readerScale)}%`, height: `${Math.max(100, readerScale)}%` }}>
            <button className="reader-arrow previous" onClick={previousReaderPage} aria-label="Předchozí stránka">‹</button>
            <div className="reader-single-page" style={readerScale === 100 && readerFitSize ? { width: `${readerFitSize.width}px`, height: `${readerFitSize.height}px` } : { width: `${Math.min(100, readerScale)}%`, height: `${Math.min(100, readerScale)}%` }}><ComicSheet book={selected} currentChapter={displayChapter} page={readerPage + 1} localPage={visiblePage} onImageLoad={fitReaderImage} /></div>
            <button className="reader-arrow next" onClick={nextReaderPage} aria-label="Další stránka">›</button>
          </div>}
          {printing && pages.length > 0 && <div className="print-pages" aria-hidden="true">{pages.map((localPage, index) => <ComicSheet key={`print-${selectedChapter.id}-${index}`} book={selected} currentChapter={displayChapter} page={index + 1} localPage={localPage} />)}</div>}
        </div>
        {chapterPanel && <aside className="reader-chapters"><header><strong>Obsah {readerLanguage ? `· ${readerLanguage.toUpperCase()}` : ""}</strong><button onClick={() => setChapterPanel(false)}>×</button></header>{readerNavigationVolumes.map((volume) => <div className="reader-volume" key={volume.id}><span>SV. {String(volume.number).padStart(2, "0")} · {volume.title}</span>{volume.chapters.map((item) => <button className={volume.id === selectedVolume.id && item.id === selectedChapter.id ? "active" : ""} key={item.id} onClick={() => openChapter(selected, volume, item)}><i>{String(item.number).padStart(2, "0")}</i><strong>{item.title}</strong><small>{item.language?.toUpperCase() ?? item.pages}</small></button>)}</div>)}</aside>}
      </div>
    </div>;
  };

  const renderWebReader = () => webReader && <div className="web-reader-screen">
    <div className="web-reader-toolbar">
      <button onClick={() => setView("detail")}>← <span>Zpět na detail</span></button>
      <div><strong>{webReader.title}</strong><small>{webReader.source}</small></div>
      <div className="web-reader-actions"><button onClick={() => setWebReaderUrl(webReader.startUrl)}>{webReader.startLabel}</button><button onClick={() => setWebReaderUrl(webReader.homeUrl)}>{webReader.homeLabel}</button></div>
    </div>
    <div className="web-reader-notice">{webReader.mode === "direct" ? "NEJLEPŠÍ SHODA" : "VÝSLEDKY HLEDÁNÍ"} · obsah zůstává na zdrojové stránce · export je vypnutý</div>
    <iframe key={webReaderUrl} src={webReaderUrl} title={`${webReader.title} — webová čtečka`} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
  </div>;

  const renderDownloads = () => <div className="screen simple-screen"><div className="screen-heading"><div><span className="overline">LOKÁLNÍ EXPORTY</span><h1>Stažené</h1><p>CBZ a EPUB se ukládají přímo. PDF otevře systémový dialog pro tisk a uložení.</p></div></div><div className="format-cards"><article><span>CBZ</span><h2>Pro čtečky komiksů</h2><p>Obrázky ve správném pořadí, zabalené do standardního formátu Comic Book ZIP.</p></article><article><span>EPUB</span><h2>Pro elektronické čtečky</h2><p>Obrázkový EPUB 3 s pevně seřazenými stránkami a navigací.</p></article><article><span>PDF</span><h2>Pro tisk a archiv</h2><p>V čtečce klikněte na PDF a v dialogu vyberte „Uložit jako PDF“.</p></article></div><section className="history"><h2>Historie této relace</h2>{exports.length ? exports.map((item) => <div key={item.id}><span className="file-icon">{item.format}</span><strong>{item.title}</strong><small>{item.when}</small></div>) : <p>Zatím jste nic neexportovali.</p>}</section></div>;

  const renderSettings = () => <div className="screen simple-screen"><div className="screen-heading"><div><span className="overline">NASTAVENÍ A SOUKROMÍ</span><h1>Místní aplikace</h1><p>Manga Reader nevyžaduje účet a neposílá historii čtení na vlastní server.</p></div></div><div className="settings-list"><article className="theme-settings"><div><strong>Rezim zobrazeni</strong><p>Volba plati pro celou aplikaci a ulozi se pro priste.</p></div><div className="theme-choice"><button className={theme === "light" ? "active" : ""} onClick={() => { setTheme("light"); safeSetItem("manga-reader-theme", "light"); }}>Denni</button><button className={theme === "dark" ? "active" : ""} onClick={() => { setTheme("dark"); safeSetItem("manga-reader-theme", "dark"); }}>Nocni</button></div></article><article><div><strong>Historie čtení</strong><p>Ukládá se pouze v tomto prohlížeči.</p></div><span className="status-pill">LOKÁLNĚ</span></article><article><div><strong>Importované obrázky</strong><p>Zůstanou dostupné do zavření nebo obnovení aplikace.</p></div><span className="status-pill">DOČASNĚ</span></article><article><div><strong>MangaDex</strong><p>Katalog i stránky dostupných kapitol se načítají přímo z oficiálního API.</p></div><span className="status-pill online">KAPITOLY</span></article><article><div><strong>AniList + MyAnimeList</strong><p>Dva rozsáhlé manga katalogy pro alternativní názvy, autory a obálky.</p></div><span className="status-pill anilist">KATALOG</span></article><article><div><strong>Google Books + Open Library</strong><p>Další vydání, knihovní záznamy a legální náhledy, pokud jsou dostupné.</p></div><span className="status-pill googlebooks">NÁHLEDY</span></article><article><div><strong>Lokální export</strong><p>Otevřenou kapitolu lze uložit jako CBZ, EPUB nebo vytisknout do PDF. Používejte jen obsah, který smíte stáhnout.</p></div><span className="status-pill online">AKTIVNÍ</span></article></div></div>;

  return (
    <main className="desktop-app" data-theme={theme}>
      <div className="app-frame">
        {view !== "reader" && view !== "webreader" && view !== "home" && <aside className="app-sidebar"><button className="app-logo" onClick={goHome}><span><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z" /></svg></span><strong>MANGA</strong><small>READER</small></button><nav><button className={view === "home" ? "active" : ""} onClick={goHome}><i>⌂</i>Domů</button><button className={view === "library" || view === "detail" ? "active" : ""} onClick={() => setView("library")}><i>▦</i>Knihovna</button><button className={view === "downloads" ? "active" : ""} onClick={() => setView("downloads")}><i>⇩</i>Stažené</button><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><i>⚙</i>Nastavení</button></nav><div className="sidebar-library"><div><span>MOJE KNIHOVNA</span><button onClick={() => setImportOpen(true)}>＋</button></div>{libraryBooks.slice(0, 4).map((book) => <button key={book.id} onClick={() => chooseBook(book)}><span style={{ background: book.accent }} /><div><strong>{book.title}</strong><small>{progress[book.id] ? `Pozice ${progressLabel(progress[book.id])}` : book.czechTitle}</small></div></button>)}</div><button className="import-side" onClick={() => setImportOpen(true)}><i>＋</i><span><strong>Importovat mangu</strong><small>JPG, PNG nebo WEBP</small></span></button></aside>}
        <section className={`workspace ${view === "reader" || view === "webreader" ? "reader-workspace" : ""} ${view === "home" ? "home-workspace" : ""}`}>
          {view !== "reader" && view !== "webreader" && view !== "home" && <header className="workspace-header"><label className="global-search"><span>⌕</span><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setSourceFilter("all"); if (view !== "library") setView("library"); }} onKeyDown={searchKey} placeholder="Název mangy česky nebo anglicky…" aria-label="Hledat mangu" /><kbd>ENTER</kbd></label><button className="header-import" onClick={() => setImportOpen(true)}>＋</button><button className={`theme-toggle ${theme === "light" ? "to-dark" : "to-light"}`} onClick={toggleTheme} aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"} title={theme === "light" ? "Tmavý režim" : "Světlý režim"}>{theme === "light" ? "☾" : "☀"}</button></header>}
          {view === "home" && renderHome()}{view === "library" && renderLibrary()}{view === "detail" && renderDetail()}{view === "reader" && renderReader()}{view === "webreader" && renderWebReader()}{view === "downloads" && renderDownloads()}{view === "settings" && renderSettings()}
        </section>
      </div>

      {importOpen && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setImportOpen(false)}><form className="import-dialog" onSubmit={importLocal}><header><div><span>LOKÁLNÍ IMPORT</span><h2>Načíst vlastní mangu</h2></div><button type="button" onClick={() => setImportOpen(false)}>×</button></header><p>Vyberte obrázky jedné kapitoly. Seřadí se podle názvu souboru a zůstanou pouze v paměti tohoto zařízení.</p><label>Název mangy<input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="Např. Moje manga" required autoFocus /></label><label className="file-drop"><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => setImportFiles(Array.from(event.target.files ?? []))} required /><span>▧</span><strong>{importFiles.length ? `${importFiles.length} obrázků vybráno` : "Vybrat stránky"}</strong><small>PNG, JPG nebo WEBP · označte všechny stránky najednou</small></label><div className="dialog-actions"><button type="button" onClick={() => setImportOpen(false)}>Zrušit</button><button className="primary-button" type="submit" disabled={!importTitle.trim() || importFiles.length === 0}>Načíst do knihovny</button></div></form></div>}
      {notice && <button className="app-toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
    </main>
  );
}