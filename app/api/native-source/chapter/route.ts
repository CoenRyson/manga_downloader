function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1].replace(/&#0*38;|&amp;/g, "&").replace(/&#0*39;|&apos;/g, "'").trim();
}

function allowedChapter(url: URL) {
  if (url.protocol !== "https:" || url.port && url.port !== "443") return false;
  if (url.hostname === "goblinslayerfree.com") return /^\/manga\/goblin-slayer-chapter-[0-9]+(?:\.[0-9]+)?\/$/.test(url.pathname);
  if (url.hostname === "dandadanmanga-online.net") return /^\/manga\/dandadan-chapter-[0-9]+(?:\.[0-9]+)?\/$/.test(url.pathname);
  if (url.hostname === "www.mangaread.org") return /^\/manga\/[^/]+\/chapter-[0-9]+(?:\.[0-9]+)?(?:-[^/]+)?\/$/.test(url.pathname);
  if (url.hostname === "readberserk.com") return /^\/chapter\/berserk-chapter-(?:[a-p]0|[0-9]+(?:\.[0-9]+)?)\/$/.test(url.pathname);
  return false;
}

function validImageFor(chapterHost: string, image: URL, tag: string) {
  if (image.protocol !== "https:" || image.port && image.port !== "443") return false;
  if (chapterHost === "goblinslayerfree.com") {
    return ["img.mangarchive.com", "goblinslayerfree.com"].includes(image.hostname) && /^Goblin Slayer Chapter [0-9.]+ image /i.test(attribute(tag, "alt") ?? "");
  }
  if (chapterHost === "dandadanmanga-online.net") {
    return image.hostname === "img.dandadanmanga-online.net" && image.pathname.includes("/wp-content/uploads/") && Boolean(attribute(tag, "data-full-image"));
  }
  if (chapterHost === "readberserk.com") return image.hostname === "cdn.readberserk.com" && image.pathname.includes("/file/") && /pages__img/i.test(attribute(tag, "class") ?? "");
  return image.hostname === "www.mangaread.org" && image.pathname.includes("/wp-content/uploads/WP-manga/data/") && /wp-manga-chapter-img/i.test(attribute(tag, "class") ?? "");
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";

  let chapterUrl: URL;
  try {
    chapterUrl = new URL(rawUrl);
  } catch {
    return Response.json({ error: "Nepovolený odkaz kapitoly." }, { status: 400 });
  }
  if (!allowedChapter(chapterUrl)) return Response.json({ error: "Nepovolený odkaz kapitoly." }, { status: 400 });

  try {
    const response = await fetch(chapterUrl, { headers: { "User-Agent": "Mozilla/5.0 Manga Reader local page viewer" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Zdroj odpověděl ${response.status}`);
    const html = await response.text();
    const images: string[] = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = attribute(tag, "data-full-image") ?? attribute(tag, "data-src") ?? attribute(tag, "src");
      if (!src || src.startsWith("data:")) continue;
      const imageUrl = new URL(src, chapterUrl);
      if (validImageFor(chapterUrl.hostname, imageUrl, tag) && !images.includes(imageUrl.toString())) images.push(imageUrl.toString());
    }
    if (!images.length) throw new Error("Kapitola neobsahuje žádné listy");
    return Response.json({ provider: chapterUrl.hostname, chapterUrl: chapterUrl.toString(), pageCount: images.length, images });
  } catch {
    return Response.json({ error: "Listy kapitoly se nepodařilo načíst." }, { status: 502 });
  }
}
