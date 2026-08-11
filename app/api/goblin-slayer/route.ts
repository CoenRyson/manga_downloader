type ChapterLink = { number: number; label: string; url: string };

export async function GET() {
  try {
    const response = await fetch("https://goblinslayerfree.com/", {
      headers: { "User-Agent": "Mozilla/5.0 Manga Reader local chapter index" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Zdroj odpověděl ${response.status}`);
    const html = await response.text();
    const found = new Map<string, ChapterLink>();
    const chapterPattern = /https:\/\/goblinslayerfree\.com\/manga\/goblin-slayer-chapter-([0-9]+(?:\.[0-9]+)?)\//gi;

    for (const match of html.matchAll(chapterPattern)) {
      const label = match[1];
      const number = Number(label);
      if (!Number.isFinite(number)) continue;
      found.set(label, { number, label, url: `https://goblinslayerfree.com/manga/goblin-slayer-chapter-${label}/` });
    }

    const chapters = [...found.values()].sort((a, b) => a.number - b.number);
    if (!chapters.length) throw new Error("Seznam kapitol je prázdný");
    const grouped = new Map<number, ChapterLink[]>();
    for (const chapter of chapters) {
      const volume = Math.max(1, Math.floor((chapter.number - 1) / 10) + 1);
      grouped.set(volume, [...(grouped.get(volume) ?? []), chapter]);
    }

    const volumes = [...grouped.entries()].sort(([a], [b]) => a - b).map(([number, items]) => ({
      number,
      title: `Kapitoly bez potvrzeného svazku · automatická skupina ${number}`,
      chapters: items,
    }));
    return Response.json({ source: "GoblinSlayerFree", chapterCount: chapters.length, volumes });
  } catch {
    return Response.json({ error: "Seznam Goblin Slayer se nepodařilo načíst." }, { status: 502 });
  }
}
