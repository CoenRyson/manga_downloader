export type MatchableManga = {
  id?: string;
  title: string;
  czechTitle?: string;
  aliases?: string[];
  author?: string;
  year?: string;
};

const syntheticLabels = new Set([
  "anilist titul",
  "bez nazvu",
  "dostupne v digitalni knihovne",
  "google books vydani",
  "mangadex titul",
  "mistni import",
  "myanimelist titul",
  "open library vydani",
]);

const genericAuthors = new Set([
  "anilist",
  "google books",
  "mangadex",
  "myanimelist",
  "neuvedeny autor",
  "open library",
]);

export function normalizeTitle(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function subtitleStem(value: string) {
  const stem = value.split(/\s(?:-|\u2013|\u2014)\s|:/, 1)[0]?.trim() ?? "";
  return stem.length >= 6 ? stem : value;
}

export function meaningfulTitles(book: MatchableManga) {
  const values = [book.title, book.czechTitle ?? "", ...(book.aliases ?? [])]
    .map(normalizeTitle)
    .filter((value) => value.length >= 2 && !syntheticLabels.has(value));
  return [...new Set(values)];
}

function comparableAuthor(value?: string) {
  const normalized = normalizeTitle(value ?? "");
  return normalized.length >= 3 && !genericAuthors.has(normalized) ? normalized : "";
}

function authorsMatch(left?: string, right?: string) {
  const a = comparableAuthor(left);
  const b = comparableAuthor(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(" ").filter((word) => word.length > 2));
  const bWords = new Set(b.split(" ").filter((word) => word.length > 2));
  return [...aWords].some((word) => bWords.has(word));
}

function yearsMatch(left?: string, right?: string) {
  return /^\d{4}$/.test(left ?? "") && left === right;
}

function yearsConflict(left?: string, right?: string) {
  return /^\d{4}$/.test(left ?? "") && /^\d{4}$/.test(right ?? "") && left !== right;
}

function isEditionTitle(value: string) {
  return /\b(?:vol|volume|tome|book|deluxe|omnibus|edition)\b(?:\s*\d+)?|\bsvazek\s*\d+/.test(value);
}

function isVariantRecord(book: MatchableManga) {
  return [book.title, book.czechTitle ?? ""].map(normalizeTitle).some((value) =>
    /\b(?:anthology|colored|colour|doujinshi|fan colored|official colored|junior|joker|omnibus|prototype)\b/.test(value),
  );
}

function hasTerminalBang(book: MatchableManga) {
  return /!\s*$/.test(book.title) || /!\s*$/.test(book.czechTitle ?? "");
}

export function mangaIdentityMatches(left: MatchableManga, right: MatchableManga) {
  if (left.id && right.id && left.id === right.id) return true;
  const leftNames = meaningfulTitles(left);
  const rightNames = meaningfulTitles(right);
  if (!leftNames.length || !rightNames.length) return false;
  if (leftNames.some(isEditionTitle) !== rightNames.some(isEditionTitle)) return false;
  if (isVariantRecord(left) !== isVariantRecord(right)) return false;
  if (hasTerminalBang(left) !== hasTerminalBang(right)) return false;
  if (yearsConflict(left.year, right.year)) return false;

  const corroborated = authorsMatch(left.author, right.author) || yearsMatch(left.year, right.year);
  if (!corroborated) return false;

  const rightSet = new Set(rightNames);
  if (leftNames.some((name) => rightSet.has(name))) return true;

  const rightStems = new Set(rightNames.map(subtitleStem));
  if (leftNames.map(subtitleStem).some((name) => rightStems.has(name))) return true;

  return leftNames.some((leftName) => rightNames.some((rightName) => {
    const shorter = Math.min(leftName.length, rightName.length);
    return shorter >= 10 && (leftName.includes(rightName) || rightName.includes(leftName));
  }));
}

export function matchesMangaQuery(book: MatchableManga, query: string) {
  const normalized = normalizeTitle(query);
  if (!normalized) return true;
  const searchable = normalizeTitle([book.title, book.czechTitle ?? "", ...(book.aliases ?? []), book.author ?? ""].join(" "));
  if (searchable.includes(normalized)) return true;
  const words = normalized.split(" ").filter(Boolean);
  return words.length > 1 && words.every((word) => searchable.split(" ").includes(word));
}

export function titleSearchTier(book: MatchableManga, query: string) {
  const normalized = normalizeTitle(query);
  if (!normalized) return 0;
  const titles = meaningfulTitles(book);
  const exact = titles.includes(normalized);
  const starts = titles.some((title) => title.startsWith(normalized));
  const shortToken = normalized.length <= 4 && titles.some((title) => title.split(" ").includes(normalized));
  const queryWords = new Set(normalized.split(" "));
  const variantPenalty = titles.some((title) => title.split(" ").some((word) =>
    !queryWords.has(word) && /^(?:anthology|colored|colour|doujinshi|junior|joker|omnibus|prototype)$/.test(word),
  )) ? 25 : 0;
  const punctuationPenalty = !/!\s*$/.test(query) && hasTerminalBang(book) ? 25 : 0;
  return (exact ? 0 : starts || shortToken ? 10 : 20) + variantPenalty + punctuationPenalty;
}

export function bestAliasScore(queries: string[], candidate: string) {
  const found = normalizeTitle(candidate);
  return Math.max(0, ...queries.map((query) => {
    const wanted = normalizeTitle(query);
    if (!wanted || !found) return 0;
    if (wanted === found) return 100;
    if (subtitleStem(wanted) === subtitleStem(found)) return 88;
    if (found.startsWith(wanted) || wanted.startsWith(found)) return 82;
    if (found.includes(wanted) || wanted.includes(found)) return 70;
    const wantedWords = new Set(wanted.split(" "));
    const foundWords = new Set(found.split(" "));
    const overlap = [...wantedWords].filter((word) => foundWords.has(word)).length;
    return Math.round((overlap / Math.max(wantedWords.size, foundWords.size)) * 60);
  }));
}
