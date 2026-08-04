import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const API = "https://api.mangadex.org";
const REPORT_PATH = resolve("reports/chainsaw-full-audit.json");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
      if (response.status !== 429 && response.status < 500) return response;
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
      await response.body?.cancel();
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(8000, 400 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      await wait(Math.min(8000, 400 * 2 ** attempt));
    }
  }
  throw lastError ?? new Error(`Po ${attempts} pokusech bez odpovědi: ${url}`);
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

async function probe(url) {
  const response = await fetchWithRetry(url, { headers: { Accept: "image/*", Range: "bytes=0-31" } });
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    valid: (response.status === 200 || response.status === 206) && contentType.startsWith("image/") && Boolean(imageSignature(bytes)),
    status: response.status,
    contentType,
    signature: imageSignature(bytes),
    byteCount: bytes.length,
  };
}

const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
const failures = report.pageFailures ?? [];
const chapterIds = [...new Set(failures.map((failure) => failure.chapterId))];
console.log(`Opakuji ${failures.length} listů z ${chapterIds.length} kapitol pomaleji a přímo proti CDN…`);

let chapterDone = 0;
const metadataEntries = await parallel(chapterIds, 3, async (chapterId) => {
  try {
    const response = await fetchWithRetry(`${API}/at-home/server/${chapterId}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`at-home ${response.status}`);
    return [chapterId, await response.json()];
  } catch (error) {
    return [chapterId, { error: error instanceof Error ? error.message : String(error) }];
  } finally {
    chapterDone += 1;
    if (chapterDone % 25 === 0 || chapterDone === chapterIds.length) console.log(`Metadata ${chapterDone}/${chapterIds.length}`);
  }
});
const metadata = new Map(metadataEntries);

let pageDone = 0;
const retries = await parallel(failures, 5, async (failure) => {
  const payload = metadata.get(failure.chapterId);
  const pageIndex = failure.page - 1;
  const hash = payload?.chapter?.hash;
  const saverName = payload?.chapter?.dataSaver?.[pageIndex];
  const originalName = payload?.chapter?.data?.[pageIndex];
  let saver;
  let original;
  if (hash && saverName) {
    try { saver = await probe(`${payload.baseUrl}/data-saver/${hash}/${saverName}`); } catch (error) { saver = { valid: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  if (!saver?.valid && hash && originalName) {
    try { original = await probe(`${payload.baseUrl}/data/${hash}/${originalName}`); } catch (error) { original = { valid: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  pageDone += 1;
  if (pageDone % 250 === 0 || pageDone === failures.length) console.log(`Listy ${pageDone}/${failures.length}`);
  return {
    ...failure,
    ok: Boolean(saver?.valid || original?.valid),
    used: saver?.valid ? "data-saver-direct-retry" : original?.valid ? "original-direct-retry" : "failed",
    saver,
    original,
  };
});

const recovered = retries.filter((item) => item.ok);
const remaining = retries.filter((item) => !item.ok);
report.finishedAt = new Date().toISOString();
report.auditRetry = {
  reason: "První hromadný průchod vyčerpal síťová spojení lokálního vývojového serveru; neúspěšné listy byly opakovány pomaleji přímo proti stejné MangaDex CDN.",
  attempted: retries.length,
  recovered: recovered.length,
  remainingFailures: remaining.length,
};
report.pageFailures = remaining;
report.recoveredAfterThrottle = recovered.map(({ saver, original, ...item }) => item);

for (const language of ["cs", "en"]) {
  const recoveredForLanguage = recovered.filter((item) => item.language === language).length;
  const remainingForLanguage = remaining.filter((item) => item.language === language).length;
  report.languages[language].passedPages += recoveredForLanguage;
  report.languages[language].failedPages = remainingForLanguage;
  report.languages[language].originalFallbackPages += recovered.filter((item) => item.language === language && item.used === "original-direct-retry").length;
}

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ report: REPORT_PATH, attempted: retries.length, recovered: recovered.length, remainingFailures: remaining.length, languages: report.languages }, null, 2));
