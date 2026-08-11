export type ReadingLanguage = "cs" | "en";

export function normalizeTitle(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs").replace(/[^a-z0-9]+/g, " ").trim();
}

export function bestAliasScore(queries: string[], candidate: string) {
  const found = normalizeTitle(candidate);
  return Math.max(0, ...queries.map((query) => {
    const wanted = normalizeTitle(query);
    if (!wanted || !found) return 0;
    if (wanted === found) return 100;
    if (found.startsWith(wanted) || wanted.startsWith(found)) return 82;
    if (found.includes(wanted) || wanted.includes(found)) return 70;
    const wantedWords = new Set(wanted.split(" "));
    const foundWords = new Set(found.split(" "));
    const overlap = [...wantedWords].filter((word) => foundWords.has(word)).length;
    return Math.round((overlap / Math.max(wantedWords.size, foundWords.size)) * 60);
  }));
}

export function makeProgress(language: ReadingLanguage | undefined, volumeSortKey: number, chapter: number, page: number) {
  return `${language ? `${language}|` : ""}${volumeSortKey}.${chapter}.${page}`;
}

export function parseReadingProgress(value?: string) {
  const [languagePart, positionPart] = value?.includes("|") ? value.split("|", 2) : [undefined, value ?? ""];
  const language = languagePart === "cs" || languagePart === "en" ? languagePart : undefined;
  return { language, position: positionPart.split(".").map(Number) };
}

export function epubLanguage(language?: string): ReadingLanguage {
  return language === "en" ? "en" : "cs";
}
