import { bestAliasScore, normalizeTitle } from "../../title-matching.ts";

type ChapterLink = { number: number; label: string; title?: string; url: string };

function plainText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#0*160;/g, " ").replace(/&amp;|&#0*38;/g, "&").replace(/\s+/g, " ").trim();
}

function groupChapters(chapters: ChapterLink[]) {
  const grouped = new Map<number, ChapterLink[]>();
  for (const chapter of chapters) {
    const number = Math.max(1, Math.floor((chapter.number - 1) / 10) + 1);
    grouped.set(number, [...(grouped.get(number) ?? []), chapter]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([number, items]) => ({
    number,
    title: `Kapitoly bez potvrzeného svazku · automatická skupina ${number} · kapitoly ${items[0].label}–${items.at(-1)?.label}`,
    chapters: items,
  }));
}

async function dandadan() {
  const response = await fetch("https://dandadanmanga-online.net/", { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local chapter index" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Dandadan ${response.status}`);
  const html = await response.text();
  const found = new Map<string, ChapterLink>();
  const pattern = /https:\/\/dandadanmanga-online\.net\/manga\/dandadan-chapter-([a-p]0|[0-9]+(?:\.[0-9]+)?)\//gi;
  for (const match of html.matchAll(pattern)) {
    const label = match[1];
    const number = Number(label);
    if (Number.isFinite(number)) found.set(label, { number, label, url: `https://dandadanmanga-online.net/manga/dandadan-chapter-${label}/` });
  }
  const chapters = [...found.values()].sort((a, b) => a.number - b.number);
  return { provider: "Dandadan Manga Online" as const, grouping: "automatic" as const, seriesUrl: "https://dandadanmanga-online.net/", chapters };
}

async function berserk() {
  const response = await fetch("https://readberserk.com/", { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local chapter index" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Read Berserk ${response.status}`);
  const html = await response.text();
  const found = new Map<string, ChapterLink>();
  const pattern = /https:\/\/readberserk\.com\/chapter\/berserk-chapter-([a-p]0|[0-9]+(?:\.[0-9]+)?)\//gi;
  for (const match of html.matchAll(pattern)) {
    const label = match[1].toUpperCase();
    const special = label.match(/^([A-P])0$/);
    const number = special ? (special[1].charCodeAt(0) - 64) / 100 : Number(label);
    if (Number.isFinite(number)) found.set(label, { number, label, title: label === "A0" ? "The Prototype" : undefined, url: `https://readberserk.com/chapter/berserk-chapter-${label.toLowerCase()}/` });
  }
  const chapters = [...found.values()].sort((a, b) => a.number - b.number);
  return { provider: "Read Berserk" as const, grouping: "automatic" as const, seriesUrl: "https://readberserk.com/", chapters };
}
async function mangaRead(titles: string[]) {
  const candidates = new Map<string, { title: string; url: string; score: number }>();
  const resultPattern = /<a[^>]+href=["'](https:\/\/www\.mangaread\.org\/manga\/[^"'?#]+\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const searches = await Promise.allSettled(titles.map(async (title) => {
    const searchUrl = `https://www.mangaread.org/?s=${encodeURIComponent(title)}&post_type=wp-manga`;
    const response = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local source resolver" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`MangaRead search ${response.status}`);
    return response.text();
  }));
  for (const result of searches) {
    if (result.status !== "fulfilled") continue;
    for (const match of result.value.matchAll(resultPattern)) {
      const resultTitle = plainText(match[2]);
      if (!resultTitle) continue;
      const candidate = { title: resultTitle, url: match[1], score: bestAliasScore(titles, resultTitle) };
      if (candidate.score > (candidates.get(candidate.url)?.score ?? -1)) candidates.set(candidate.url, candidate);
    }
  }
  const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 55) throw new Error("MangaRead nenalezl bezpečnou shodu");
  const seriesResponse = await fetch(best.url, { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local chapter index" }, signal: AbortSignal.timeout(15000) });
  if (!seriesResponse.ok) throw new Error(`MangaRead series ${seriesResponse.status}`);
  const seriesHtml = await seriesResponse.text();
  const found = new Map<string, ChapterLink>();
  const escapedSeries = best.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chapterPattern = new RegExp(`${escapedSeries}chapter-([0-9]+(?:\\.[0-9]+)?)(?:-[^/]+)?/`, "gi");
  for (const match of seriesHtml.matchAll(chapterPattern)) {
    const label = match[1];
    const number = Number(label);
    if (Number.isFinite(number)) found.set(label, { number, label, url: match[0] });
  }
  const chapters = [...found.values()].sort((a, b) => a.number - b.number);
  return { provider: "MangaRead" as const, grouping: "automatic", seriesUrl: best.url, matchedTitle: best.title, score: best.score, chapters };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim() ?? "";
  if (title.length < 2 || title.length > 120) return Response.json({ error: "Neplatný název mangy." }, { status: 400 });
  let titles = [title];
  try {
    const parsed = JSON.parse(params.get("titles") ?? "[]");
    if (Array.isArray(parsed)) titles = [...new Set([title, ...parsed].filter((value): value is string => typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120))].slice(0, 4);
  } catch { /* Hlavní titul zůstává bezpečná záloha. */ }
  try {
    const normalizedTitles = titles.map(normalizeTitle);
    const result = normalizedTitles.some((value) => value === "dandadan" || value === "dan da dan") ? await dandadan() : normalizedTitles.includes("berserk") ? await berserk() : await mangaRead(titles);
    if (!result.chapters.length) throw new Error("Prázdný seznam kapitol");
    return Response.json({
      provider: result.provider,
      grouping: result.grouping,
      seriesUrl: result.seriesUrl,
      chapterCount: result.chapters.length,
      volumes: groupChapters(result.chapters),
      matchedTitle: "matchedTitle" in result ? result.matchedTitle : title,
      score: "score" in result ? result.score : 100,
    }, { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } });
  } catch {
    return Response.json({ error: "Nativní zdroj se nepodařilo načíst." }, { status: 404 });
  }
}
