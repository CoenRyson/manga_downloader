export async function GET(request: Request) {
  const incomingParams = new URL(request.url).searchParams;

  try {
    const target = new URL("https://api.mangadex.org/manga");
    target.search = incomingParams.toString();

    const response = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "Manga Reader local search proxy" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`MangaDex ${response.status}`);

    const payload = await response.json();
    return Response.json(payload, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
  } catch {
    return Response.json({ error: "Vyhledávání na MangaDexu je dočasně nedostupné." }, { status: 502 });
  }
}
