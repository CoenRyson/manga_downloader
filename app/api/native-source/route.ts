type ChapterLink = { number: number; label: string; title?: string; url: string };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function plainText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#0*160;/g, " ").replace(/&amp;|&#0*38;/g, "&").replace(/\s+/g, " ").trim();
}

function scoreTitle(query: string, title: string) {
  const wanted = normalize(query);
  const found = normalize(title);
  if (wanted === found) return 100;
  if (found.startsWith(wanted) || wanted.startsWith(found)) return 82;
  if (found.includes(wanted) || wanted.includes(found)) return 70;
  const words = new Set(wanted.split(" "));
  const overlap = [...words].filter((word) => found.split(" ").includes(word)).length;
  return Math.round((overlap / Math.max(1, words.size)) * 55);
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
  return { provider: "Dandadan Manga Online" as const, grouping: "volume", seriesUrl: "https://dandadanmanga-online.net/", chapters };
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
async function mangaRead(title: string) {
  const searchUrl = `https://www.mangaread.org/?s=${encodeURIComponent(title)}&post_type=wp-manga`;
  const searchResponse = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local source resolver" }, signal: AbortSignal.timeout(15000) });
  if (!searchResponse.ok) throw new Error(`MangaRead search ${searchResponse.status}`);
  const searchHtml = await searchResponse.text();
  const candidates: { title: string; url: string; score: number }[] = [];
  const resultPattern = /<a[^>]+href=["'](https:\/\/www\.mangaread\.org\/manga\/[^"'?#]+\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of searchHtml.matchAll(resultPattern)) {
    const resultTitle = plainText(match[2]);
    if (resultTitle) candidates.push({ title: resultTitle, url: match[1], score: scoreTitle(title, resultTitle) });
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 30) throw new Error("MangaRead nenalezl shodu");
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
  const title = new URL(request.url).searchParams.get("title")?.trim() ?? "";
  if (title.length < 2 || title.length > 120) return Response.json({ error: "Neplatný název mangy." }, { status: 400 });
  try {
    const normalized = normalize(title);
    const result = normalized === "dandadan" || normalized === "dan da dan" ? await dandadan() : (normalized === "berserk" || normalized.startsWith("berserk ")) ? await berserk() : await mangaRead(title);
    if (!result.chapters.length) throw new Error("Prázdný seznam kapitol");
    return Response.json({
      provider: result.provider,
      grouping: result.grouping,
      seriesUrl: result.seriesUrl,
      chapterCount: result.chapters.length,
      volumes: groupChapters(result.chapters),
      matchedTitle: "matchedTitle" in result ? result.matchedTitle : title,
      score: "score" in result ? result.score : 100,
    });
  } catch {
    return Response.json({ error: "Nativní zdroj se nepodařilo načíst." }, { status: 404 });
  }
}
