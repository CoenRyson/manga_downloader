export async function GET(request: Request) {
  const incomingParams = new URL(request.url).searchParams;

  try {
    const target = new URL("https://api.mangadex.org/statistics/manga");
    target.search = incomingParams.toString();

    const response = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "Manga Reader local search proxy" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`MangaDex ${response.status}`);

    const payload = await response.json();
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Statistiky MangaDexu jsou dočasně nedostupné." }, { status: 502 });
  }
}