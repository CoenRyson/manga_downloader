import { bestAliasScore } from "../../title-matching.ts";

type Candidate = { title: string; url: string; score: number };

function plainText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#0*160;/g, " ")
    .replace(/&amp;|&#0*38;/g, "&")
    .replace(/&quot;|&#0*34;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  let queryTitles = [query];
  try {
    const parsed = JSON.parse(params.get("titles") ?? "[]");
    if (Array.isArray(parsed)) queryTitles = [...new Set([query, ...parsed].filter((value): value is string => typeof value === "string" && value.trim().length > 1 && value.trim().length <= 120))].slice(0, 4);
  } catch { /* fallback na hlavní titul */ }
  if (query.length < 2 || query.length > 120) {
    return Response.json({ error: "Neplatný název mangy." }, { status: 400 });
  }

  const searchUrl = `https://www.mangaread.org/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
  try {
    const candidates = new Map<string, Candidate>();
    const linkPattern = /<a[^>]+href=["'](https:\/\/www\.mangaread\.org\/manga\/[^"'?#]+\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const searches = await Promise.allSettled(queryTitles.map(async (title) => {
      const url = `https://www.mangaread.org/?s=${encodeURIComponent(title)}&post_type=wp-manga`;
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local source resolver" }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Provider odpověděl ${response.status}`);
      return response.text();
    }));
    for (const result of searches) {
      if (result.status !== "fulfilled") continue;
      for (const match of result.value.matchAll(linkPattern)) {
        const title = plainText(match[2]);
        if (!title) continue;
        const candidate = { title, url: match[1], score: bestAliasScore(queryTitles, title) };
        const previous = candidates.get(candidate.url);
        if (!previous || candidate.score > previous.score) candidates.set(candidate.url, candidate);
      }
    }

    const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 55) {
      return Response.json({ provider: "MangaRead", mode: "search", searchUrl }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" } });
    }
    return Response.json({ provider: "MangaRead", mode: "direct", searchUrl, ...best }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" } });
  } catch {
    return Response.json({ error: "Vyhledávání na MangaRead je dočasně nedostupné.", provider: "MangaRead", mode: "search", searchUrl }, { status: 502 });
  }
}
