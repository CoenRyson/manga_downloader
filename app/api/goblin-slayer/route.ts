type ChapterLink = { number: number; label: string; url: string };

const volumeRanges = [
  [1, 1, 4], [2, 5, 9], [3, 10, 15], [4, 16, 21], [5, 22, 26],
  [6, 27, 30], [7, 31, 35], [8, 36, 40], [9, 41, 44], [10, 45, 51],
  [11, 52, 57], [12, 58, 64], [13, 65, 72], [14, 73, 79], [15, 80, 87],
  [16, 88, 95], [17, 96, 103],
] as const;

function volumeFor(chapter: number) {
  return volumeRanges.find(([, first, last]) => chapter >= first && chapter < last + 1)?.[0] ?? 18;
}

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
      const volume = volumeFor(chapter.number);
      grouped.set(volume, [...(grouped.get(volume) ?? []), chapter]);
    }

    const volumes = [...grouped.entries()].sort(([a], [b]) => a - b).map(([number, items]) => ({
      number,
      title: number === 18 ? "Novější kapitoly · svazek zatím nepotvrzen" : `Goblin Slayer · svazek ${number}`,
      chapters: items,
    }));
    return Response.json({ source: "GoblinSlayerFree", chapterCount: chapters.length, volumes });
  } catch {
    return Response.json({ error: "Seznam Goblin Slayer se nepodařilo načíst." }, { status: 502 });
  }
}