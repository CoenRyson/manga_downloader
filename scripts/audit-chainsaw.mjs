import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MANGA_ID = "a77742b1-befd-49a4-bff5-1ad4e6b0ef7b";
const API = "https://api.mangadex.org";
const LOCAL_PROXY = "http://localhost:3000/api/mangadex-image";
const REPORT_PATH = resolve("reports/chainsaw-full-audit.json");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 7) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status !== 429 && response.status < 500) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(12000, 500 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      await wait(Math.min(12000, 500 * 2 ** attempt));
    }
  }
  throw lastError ?? new Error(`Po ${attempts} pokusech bez odpovědi: ${url}`);
}

async function loadFeed() {
  const chapters = [];
  let offset = 0;
  let total = 1;
  while (offset < total) {
    const url = new URL(`${API}/manga/${MANGA_ID}/feed`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    url.searchParams.append("translatedLanguage[]", "cs");
    url.searchParams.append("translatedLanguage[]", "en");
    url.searchParams.set("order[volume]", "asc");
    url.searchParams.set("order[chapter]", "asc");
    const response = await fetchWithRetry(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`MangaDex feed ${response.status}`);
    const payload = await response.json();
    chapters.push(...(payload.data ?? []));
    total = payload.total ?? chapters.length;
    offset += 100;
    if (offset < total) await wait(250);
  }
  return chapters;
}

function deduplicate(records) {
  const chapters = new Map();
  for (const record of records) {
    const attributes = record.attributes ?? {};
    const language = attributes.translatedLanguage;
    if (language !== "cs" && language !== "en") continue;
    const key = `${attributes.volume ?? "none"}:${attributes.chapter ?? record.id}:${language}`;
    const candidate = {
      id: record.id,
      language,
      volume: attributes.volume ?? null,
      chapter: attributes.chapter ?? null,
      title: attributes.title?.trim() || `Kapitola ${attributes.chapter ?? "?"}`,
      declaredPages: attributes.pages ?? 0,
      externalUrl: attributes.externalUrl ?? null,
    };
    const current = chapters.get(key);
    if (!current || candidate.declaredPages > current.declaredPages || (current.externalUrl && !candidate.externalUrl)) chapters.set(key, candidate);
  }
  return [...chapters.values()].sort((a, b) => a.language.localeCompare(b.language) || Number(a.chapter) - Number(b.chapter));
}

async function parallel(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function imageSignature(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 3)) === "GIF") return "gif";
  return null;
}

async function probeRemoteImage(remoteUrl) {
  const proxyUrl = `${LOCAL_PROXY}?url=${encodeURIComponent(remoteUrl)}`;
  const response = await fetchWithRetry(proxyUrl, { headers: { Accept: "image/*", Range: "bytes=0-31" } }, 5);
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = imageSignature(bytes);
  const valid = (response.status === 200 || response.status === 206) && contentType.startsWith("image/") && Boolean(signature);
  return { valid, status: response.status, contentType, signature, byteCount: bytes.length };
}

function missingWholeChapters(chapters) {
  const numbers = new Set(chapters.map((item) => Number(item.chapter)).filter(Number.isInteger));
  if (!numbers.size) return [];
  const highest = Math.max(...numbers);
  return Array.from({ length: highest }, (_, index) => index + 1).filter((number) => !numbers.has(number));
}

const startedAt = new Date();
console.log("[1/3] Načítám české a anglické kapitoly Chainsaw Mana…");
const feedRecords = await loadFeed();
const chapters = deduplicate(feedRecords);
const readableChapters = chapters.filter((chapter) => chapter.declaredPages > 0 && !chapter.externalUrl);
console.log(`[1/3] ${feedRecords.length} záznamů, ${chapters.length} kapitol po odstranění duplicit, ${readableChapters.length} čitelných.`);

let metadataDone = 0;
console.log("[2/3] Ověřuji metadata a úplný seznam listů každé kapitoly…");
const chapterAudits = await parallel(readableChapters, 4, async (chapter) => {
  try {
    const response = await fetchWithRetry(`${API}/at-home/server/${chapter.id}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`at-home ${response.status}`);
    const payload = await response.json();
    const hash = payload.chapter?.hash;
    const data = payload.chapter?.data ?? [];
    const dataSaver = payload.chapter?.dataSaver ?? [];
    if (!hash || !payload.baseUrl || (!data.length && !dataSaver.length)) throw new Error("prázdná metadata listů");
    const count = Math.max(data.length, dataSaver.length);
    return {
      ...chapter,
      metadataOk: true,
      metadataPages: count,
      metadataMatchesDeclared: count === chapter.declaredPages,
      pages: Array.from({ length: count }, (_, index) => ({
        language: chapter.language,
        chapterId: chapter.id,
        chapter: chapter.chapter,
        page: index + 1,
        saverUrl: dataSaver[index] ? `${payload.baseUrl}/data-saver/${hash}/${dataSaver[index]}` : null,
        originalUrl: data[index] ? `${payload.baseUrl}/data/${hash}/${data[index]}` : null,
      })),
    };
  } catch (error) {
    return { ...chapter, metadataOk: false, metadataPages: 0, metadataMatchesDeclared: false, pages: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    metadataDone += 1;
    if (metadataDone % 25 === 0 || metadataDone === readableChapters.length) console.log(`[2/3] Kapitoly ${metadataDone}/${readableChapters.length}`);
  }
});

const pageTasks = chapterAudits.flatMap((chapter) => chapter.pages);
let pageDone = 0;
console.log(`[3/3] Kontroluji všech ${pageTasks.length} listů přes lokální Manga Reader…`);
const pageAudits = await parallel(pageTasks, 14, async (page) => {
  let saver;
  if (page.saverUrl) {
    try { saver = await probeRemoteImage(page.saverUrl); } catch (error) { saver = { valid: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  let original;
  if (!saver?.valid && page.originalUrl) {
    try { original = await probeRemoteImage(page.originalUrl); } catch (error) { original = { valid: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  pageDone += 1;
  if (pageDone % 250 === 0 || pageDone === pageTasks.length) console.log(`[3/3] Listy ${pageDone}/${pageTasks.length}`);
  return { language: page.language, chapterId: page.chapterId, chapter: page.chapter, page: page.page, ok: Boolean(saver?.valid || original?.valid), used: saver?.valid ? "data-saver" : original?.valid ? "original-fallback" : "failed", saver, original };
});

const languageSummaries = {};
for (const language of ["cs", "en"]) {
  const languageChapters = chapters.filter((chapter) => chapter.language === language);
  const languageReadable = chapterAudits.filter((chapter) => chapter.language === language);
  const languagePages = pageAudits.filter((page) => page.language === language);
  languageSummaries[language] = {
    label: language === "cs" ? "Čeština" : "English",
    chaptersAfterDeduplication: languageChapters.length,
    readableChapters: languageReadable.length,
    externalChapters: languageChapters.filter((chapter) => Boolean(chapter.externalUrl)).length,
    highestReadableChapter: Math.max(0, ...languageReadable.map((chapter) => Number(chapter.chapter) || 0)),
    missingWholeChapters: missingWholeChapters(languageReadable),
    declaredPages: languageReadable.reduce((sum, chapter) => sum + chapter.declaredPages, 0),
    metadataPages: languageReadable.reduce((sum, chapter) => sum + chapter.metadataPages, 0),
    checkedPages: languagePages.length,
    passedPages: languagePages.filter((page) => page.ok).length,
    originalFallbackPages: languagePages.filter((page) => page.used === "original-fallback").length,
    failedPages: languagePages.filter((page) => !page.ok).length,
  };
}

const report = {
  title: "Chainsaw Man",
  mangaDexId: MANGA_ID,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  sourceRecords: feedRecords.length,
  chaptersAfterDeduplication: chapters.length,
  readableChapters: readableChapters.length,
  externalChapters: chapters.filter((chapter) => Boolean(chapter.externalUrl)).map((chapter) => ({ id: chapter.id, language: chapter.language, chapter: chapter.chapter, title: chapter.title, url: chapter.externalUrl })),
  languages: languageSummaries,
  metadataFailures: chapterAudits.filter((chapter) => !chapter.metadataOk).map(({ pages, ...chapter }) => chapter),
  metadataCountMismatches: chapterAudits.filter((chapter) => chapter.metadataOk && !chapter.metadataMatchesDeclared).map(({ pages, ...chapter }) => chapter),
  pageFailures: pageAudits.filter((page) => !page.ok),
  fallbackPages: pageAudits.filter((page) => page.used === "original-fallback"),
};

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ report: REPORT_PATH, languages: languageSummaries, metadataFailures: report.metadataFailures.length, metadataCountMismatches: report.metadataCountMismatches.length, pageFailures: report.pageFailures.length }, null, 2));
