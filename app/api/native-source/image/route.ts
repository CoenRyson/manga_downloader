function allowedImage(url: URL) {
  if (url.protocol !== "https:" || url.port && url.port !== "443") return false;
  if (url.hostname === "cdn.readberserk.com") return url.pathname.includes("/file/");
  if (url.hostname === "img.dandadanmanga-online.net") return url.pathname.includes("/wp-content/uploads/");
  if (url.hostname === "img.mangarchive.com") return true;
  if (url.hostname === "goblinslayerfree.com") return true;
  if (url.hostname === "www.mangaread.org") return url.pathname.includes("/wp-content/uploads/WP-manga/data/");
  return false;
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";
  let imageUrl: URL;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return Response.json({ error: "Nepovolený obrázek." }, { status: 400 });
  }
  if (!allowedImage(imageUrl)) return Response.json({ error: "Nepovolený obrázek." }, { status: 400 });

  try {
    const response = await fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: `${imageUrl.origin}/`,
        "User-Agent": "Mozilla/5.0 Manga Reader local image proxy",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body) return Response.json({ error: `Zdroj obrázku odpověděl ${response.status}.` }, { status: 502 });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) return Response.json({ error: "Zdroj nevrátil obrázek." }, { status: 502 });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 30 * 1024 * 1024) return Response.json({ error: "Obrázek je příliš velký." }, { status: 413 });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 30 * 1024 * 1024) return Response.json({ error: "Obrázek je příliš velký." }, { status: 413 });
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Obrázek se nepodařilo načíst." }, { status: 502 });
  }
}
