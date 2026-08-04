export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const mangaId = incoming.searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(mangaId)) {
    return Response.json({ error: "Neplatné ID mangy." }, { status: 400 });
  }

  try {
    const target = new URL(`https://api.mangadex.org/manga/${mangaId}/feed`);
    for (const [key, value] of incoming.searchParams) {
      if (key === "id") continue;
      target.searchParams.append(key, value);
    }

    const response = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "Manga Reader local search proxy" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`MangaDex feed ${response.status}`);

    const payload = await response.json();
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Seznam kapitol z MangaDexu je dočasně nedostupný." }, { status: 502 });
  }
}