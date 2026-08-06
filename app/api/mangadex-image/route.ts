function allowedMangaDexImage(url: URL) {
  return url.protocol === "https:"
    && /^[a-z0-9-]+\.mangadex\.network$/i.test(url.hostname)
    && /^\/(?:data|data-saver)\/[a-f0-9]+\/[^/]+$/i.test(url.pathname);
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";

  let imageUrl: URL;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return Response.json({ error: "Nepovolená adresa obrázku." }, { status: 400 });
  }
  if (!allowedMangaDexImage(imageUrl)) {
    return Response.json({ error: "Nepovolená adresa obrázku." }, { status: 400 });
  }

  try {
    const requestedRange = request.headers.get("range");
    const range = requestedRange && /^bytes=\d+-\d*$/i.test(requestedRange) ? requestedRange : undefined;
    const response = await fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
        "User-Agent": "Manga Reader local image proxy",
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`MangaDex image ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) throw new Error("MangaDex nevrátil obrázek");

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        ...(response.headers.get("content-range") ? { "Content-Range": response.headers.get("content-range") as string } : {}),
        ...(response.headers.get("accept-ranges") ? { "Accept-Ranges": response.headers.get("accept-ranges") as string } : {}),
      },
    });
  } catch {
    return Response.json({ error: "Obrázek MangaDexu se nepodařilo načíst." }, { status: 502 });
  }
}