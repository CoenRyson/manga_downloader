const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function GET(request: Request) {
  const chapterId = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(chapterId)) {
    return Response.json({ error: "Neplatné ID kapitoly." }, { status: 400 });
  }

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`https://api.mangadex.org/at-home/server/${chapterId}`, {
        headers: { Accept: "application/json", "User-Agent": "Manga Reader local chapter loader" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const payload = await response.json();
        return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
      }
      if (response.status !== 429 && response.status < 500) break;
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(6000, 350 * 2 ** attempt));
    } catch {
      await wait(Math.min(6000, 350 * 2 ** attempt));
    }
  }

  return Response.json({ error: "Metadata kapitoly MangaDex jsou dočasně nedostupná." }, { status: 502 });
}