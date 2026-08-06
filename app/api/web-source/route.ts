type Candidate = { title: string; url: string; score: number };

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&(?:amp|#0*38);/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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

function scoreTitle(query: string, title: string) {
  const wanted = normalize(query);
  const found = normalize(title);
  if (!wanted || !found) return 0;
  if (wanted === found) return 100;
  if (found.startsWith(wanted) || wanted.startsWith(found)) return 82;
  if (found.includes(wanted) || wanted.includes(found)) return 70;
  const wantedWords = new Set(wanted.split(" "));
  const foundWords = new Set(found.split(" "));
  const overlap = [...wantedWords].filter((word) => foundWords.has(word)).length;
  return Math.round((overlap / Math.max(wantedWords.size, foundWords.size)) * 60);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 120) {
    return Response.json({ error: "Neplatný název mangy." }, { status: 400 });
  }

  const searchUrl = `https://www.mangaread.org/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
  try {
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 Manga Reader local source resolver" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Provider odpověděl ${response.status}`);
    const html = await response.text();
    const candidates = new Map<string, Candidate>();
    const linkPattern = /<a[^>]+href=["'](https:\/\/www\.mangaread\.org\/manga\/[^"'?#]+\/)["'][^>]*>([\s\S]*?)<\/a>/gi;

    for (const match of html.matchAll(linkPattern)) {
      const title = plainText(match[2]);
      if (!title) continue;
      const candidate = { title, url: match[1], score: scoreTitle(query, title) };
      const previous = candidates.get(candidate.url);
      if (!previous || candidate.score > previous.score) candidates.set(candidate.url, candidate);
    }

    const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 30) {
      return Response.json({ provider: "MangaRead", mode: "search", searchUrl });
    }
    return Response.json({ provider: "MangaRead", mode: "direct", searchUrl, ...best });
  } catch {
    return Response.json({ error: "Vyhledávání na MangaRead je dočasně nedostupné.", provider: "MangaRead", mode: "search", searchUrl }, { status: 502 });
  }
}