function allowedImage(url: URL) {
  if (url.protocol !== "https:") return false;
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
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body) return Response.json({ error: `Zdroj obrázku odpověděl ${response.status}.` }, { status: 502 });
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
        "Content-Length": response.headers.get("content-length") ?? "",
      },
    });
  } catch {
    return Response.json({ error: "Obrázek se nepodařilo načíst." }, { status: 502 });
  }
}
