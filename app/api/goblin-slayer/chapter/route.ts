function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1]
    .replace(/&#0*38;|&amp;/g, "&")
    .replace(/&#0*39;|&apos;/g, "'")
    .trim();
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";

  let chapterUrl: URL;
  try {
    chapterUrl = new URL(rawUrl);
  } catch {
    return Response.json({ error: "Nepovolený odkaz kapitoly." }, { status: 400 });
  }
  if (chapterUrl.protocol !== "https:" || chapterUrl.hostname !== "goblinslayerfree.com" || !/^\/manga\/goblin-slayer-chapter-[0-9]+(?:\.[0-9]+)?\/$/.test(chapterUrl.pathname)) {
    return Response.json({ error: "Nepovolený odkaz kapitoly." }, { status: 400 });
  }

  try {
    const response = await fetch(chapterUrl, {
      headers: { "User-Agent": "Mozilla/5.0 Manga Reader local page viewer" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Zdroj odpověděl ${response.status}`);
    const html = await response.text();
    const images: string[] = [];

    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const alt = attribute(tag, "alt") ?? "";
      if (!/^Goblin Slayer Chapter [0-9.]+ image /i.test(alt)) continue;
      const src = attribute(tag, "data-src") ?? attribute(tag, "src");
      if (!src) continue;
      const imageUrl = new URL(src, chapterUrl);
      if (imageUrl.protocol !== "https:" || !["img.mangarchive.com", "goblinslayerfree.com"].includes(imageUrl.hostname)) continue;
      if (!images.includes(imageUrl.toString())) images.push(imageUrl.toString());
    }

    if (!images.length) throw new Error("Kapitola neobsahuje žádné listy");
    return Response.json({ chapterUrl: chapterUrl.toString(), pageCount: images.length, images });
  } catch {
    return Response.json({ error: "Listy kapitoly se nepodařilo načíst." }, { status: 502 });
  }
}