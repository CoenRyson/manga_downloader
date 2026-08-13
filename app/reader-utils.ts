export type ReadingLanguage = "cs" | "en";

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
