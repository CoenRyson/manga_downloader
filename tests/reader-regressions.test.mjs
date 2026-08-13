import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bestAliasScore, mangaIdentityMatches, matchesMangaQuery, normalizeTitle, titleSearchTier } from "../app/title-matching.ts";
import { mapWithConcurrency } from "../app/export-utils.ts";
import { epubLanguage, makeProgress, parseReadingProgress } from "../app/reader-utils.ts";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const nativeSource = await readFile(new URL("../app/api/native-source/route.ts", import.meta.url), "utf8");
const nativeChapter = await readFile(new URL("../app/api/native-source/chapter/route.ts", import.meta.url), "utf8");
const nativeImage = await readFile(new URL("../app/api/native-source/image/route.ts", import.meta.url), "utf8");
const goblinSource = await readFile(new URL("../app/api/goblin-slayer/route.ts", import.meta.url), "utf8");
const webSource = await readFile(new URL("../app/api/web-source/route.ts", import.meta.url), "utf8");
const titleMatching = await readFile(new URL("../app/title-matching.ts", import.meta.url), "utf8");

test("reader keeps fit/manual modes and recalculates around sidebar/resize", () => {
  assert.match(page, /readerFitMode/);
  assert.match(page, /addEventListener\("resize"/);
  assert.match(page, /readerPanelTab/);
  assert.match(page, /loading="lazy"/);
});

test("global search submits with Enter and its visible hint is clickable", () => {
  assert.match(page, /const submitGlobalSearch = \(\) =>/);
  assert.match(page, /event\.key === "Enter"[^\n]*submitGlobalSearch\(\)/);
  assert.match(page, /className="search-enter" onClick=\{submitGlobalSearch\}/);
  assert.doesNotMatch(page, /<kbd>ENTER<\/kbd>/);
});

test("DXD ranks as a title token and metadata records prefer an exact MangaDex reader", () => {
  assert.equal(bestAliasScore(["High School DxD", "ハイスクールD×D"], "High School DxD"), 100);
  assert.equal(titleSearchTier({ title: "High School DxD", aliases: ["ハイスクールD×D"] }, "DXD"), 10);
  assert.ok(titleSearchTier({ title: "DxD Joker" }, "DXD") > titleSearchTier({ title: "High School DxD" }, "DXD"));
  assert.ok(titleSearchTier({ title: "Junior High School DxD" }, "DXD") > titleSearchTier({ title: "High School DxD" }, "DXD"));
  assert.match(page, /const findMangaDexEquivalent = async/);
  assert.match(page, /best\.score < 88 \|\| !mangaIdentityMatches\(book, best\.candidate\)/);
  assert.match(page, /void loadMetadataBook\(book, target\)/);
});

test("search cache migration drops stale web matches but keeps user data stores", () => {
  assert.match(page, /CATALOGUE_CACHE_VERSION = "2026-08-search-v3"/);
  assert.match(page, /function refreshCachedBook/);
  assert.match(page, /volumes: mangaDexPlaceholder\(book\.remoteId \?\? book\.id\)/);
  assert.match(page, /mergedIds: undefined, mergedSources: undefined/);
  assert.match(page, /storedLibrary/);
  assert.match(page, /storedProgress/);
});

test("Darling in the Franxx and Evangelion keep their main and variant mappings separate", () => {
  const darling = { id: "md-42caa178", title: "DARLING in the FRANXX", author: "Code:000, Yabuki Kentarou", year: "2018" };
  const darlingChibi = { id: "md-5d95a1d5", title: "DARLING in the FRANXX!", author: "mato", year: "2018" };
  const darlingColored = { id: "md-65a3a15e", title: "DARLING in the FRANXX (Fan Colored)", aliases: ["DARLING in the FRANXX"], author: "Code:000", year: "2018" };
  const evangelion = { id: "md-aaedcbda", title: "Neon Genesis Evangelion", author: "Sadamoto Yoshiyuki, Anno Hideaki", year: "1994" };
  const evangelionColored = { id: "md-dc33209f", title: "Neon Genesis Evangelion (Official Colored)", aliases: ["Neon Genesis Evangelion"], author: "Sadamoto Yoshiyuki", year: "2014" };
  assert.equal(mangaIdentityMatches(darling, darlingChibi), false);
  assert.equal(mangaIdentityMatches(darling, darlingColored), false);
  assert.equal(mangaIdentityMatches(evangelion, evangelionColored), false);
  assert.equal(mangaIdentityMatches(darling, evangelion), false);
  assert.ok(titleSearchTier(darling, "Darling in the Franxx") < titleSearchTier(darlingChibi, "Darling in the Franxx"));
  assert.match(page, /relationship\.type === "author" \|\| relationship\.type === "artist"/);
  assert.equal([...page.matchAll(/params\.append\("includes\[\]", "artist"\)/g)].length, 2);
});

test("catalogue search excludes light novels and does not merge conflicting years", () => {
  const manga = { id: "manga", title: "High School DxD", author: "Ichiei Ishibumi", year: "2010" };
  const novel = { id: "novel", title: "High School DxD", author: "Ichiei Ishibumi", year: "2008" };
  assert.equal(mangaIdentityMatches(manga, novel), false);
  assert.equal(mangaIdentityMatches(
    { title: "Vagabond", author: "Takehiko Inoue", year: "1998" },
    { title: "Vagabond (Hong Kong Colored Version)", aliases: ["Vagabond"], author: "Takehiko Inoue", year: "1998" },
  ), false);
  assert.match(page, /item\.format !== "NOVEL"/);
  assert.match(page, /item\.type !== "Light Novel"/);
  assert.match(page, /perPage: 24/);
  assert.match(page, /searchParams\.set\("limit", "24"\)/);
  assert.match(page, /filter\(\(item\) => item\.format !== "NOVEL"\)\.slice\(0, 12\)/);
});

test("navigation and progress retain language, chapter and page", () => {
  assert.match(page, /ArrowRight/);
  assert.match(page, /ArrowLeft/);
  assert.match(page, /Escape/);
  assert.match(page, /makeProgress\(progressLanguage/);
  assert.match(page, /volumeSortKey\(selectedVolume\)/);
  assert.match(page, /volume\.number >= 100000 \? "—" : String\(volume\.number\)/);
});

test("progress parser keeps legacy positions and language-specific pages", () => {
  assert.deepEqual(parseReadingProgress("2.14"), { language: undefined, position: [2, 14] });
  assert.deepEqual(parseReadingProgress(makeProgress("en", 100001, 14, 7)), { language: "en", position: [100001, 14, 7] });
  assert.equal(epubLanguage("en"), "en");
  assert.equal(epubLanguage("cs"), "cs");
});

test("Berserk resolver uses readberserk chapters and CDN pages", () => {
  assert.match(nativeSource, /readberserk\\.com/);
  assert.match(nativeChapter, /cdn\.readberserk\.com/);
  assert.match(nativeImage, /allowedImage/);
  assert.match(page, /exportImageUrl/);
  assert.match(page, /selected\.source === "web" \? selectedChapter\.id : selectedChapter\.remoteId/);
});

test("unconfirmed grouping never relies on hardcoded Dandadan/Goblin volume ranges", () => {
  assert.doesNotMatch(nativeSource, /dandadanRanges/);
  assert.doesNotMatch(nativeSource, /Dandadan.*svazek \$\{number\}/);
  assert.doesNotMatch(goblinSource, /volumeRanges/);
  assert.match(nativeSource, /Kapitoly bez potvrzeného svazku/);
  assert.match(nativeSource, /grouping: "automatic"/);
});

test("EPUB and Kindle share dynamic language metadata and Kindle filename", () => {
  assert.match(page, /dc:language>\$\{epubLanguage\(exportLanguage\)\}/);
  assert.match(page, /kindle \? "-kindle" : ""/);
  assert.match(page, /format: kindle \? "KINDLE" : "EPUB"/);
});

test("detail page exposes complete manga export through the shared exporters", () => {
  assert.match(page, /collectCompleteExportPages/);
  assert.match(page, /complete-download/);
  assert.match(page, /fileSuffix/);
  assert.match(page, /volume-/);
  assert.match(page, /chapter-/);
  assert.match(page, /downloadMode/);
  assert.match(page, /downloadVolumeIds/);
  assert.match(page, /downloadSelected/);
  assert.equal([...page.matchAll(/className="download-dialog-v2"/g)].length, 1);
  assert.doesNotMatch(page, /className="download-dialog"/);
});

test("resolver accepts aliases and rejects low confidence direct matches", () => {
  assert.match(page, /JSON\.stringify\(resolverTitles\)/);
  assert.match(webSource, /params\.get\("titles"\)/);
  assert.match(webSource, /best\.score < 55/);
  assert.match(titleMatching, /normalizeTitle/);
  assert.match(titleMatching, /bestAliasScore/);
});

test("AniList favourites is not used as rating count and catalogue has conservative identity merge", () => {
  assert.match(page, /favourites: item\.favourites/);
  assert.doesNotMatch(page, /ratingCount: item\.favourites/);
  assert.match(page, /mangaIdentityMatches/);
});

test("catalogue matching ignores synthetic labels and keeps distinct search results", () => {
  const googleEdition = { id: "gb-1", title: "Berserk Deluxe", czechTitle: "Google Books vydání", aliases: ["Berserk Deluxe"], author: "Kentaro Miura", year: "2019" };
  const unrelatedEdition = { id: "gb-2", title: "Dandadan, Vol. 1", czechTitle: "Google Books vydání", aliases: ["Dandadan"], author: "Yukinobu Tatsu", year: "2022" };
  assert.equal(mangaIdentityMatches(googleEdition, unrelatedEdition), false);
  assert.equal(normalizeTitle("Čarodějův pohřeb!"), "carodejuv pohreb");
  assert.equal(normalizeTitle("葬送のフリーレン"), "葬送のフリーレン");
});

test("Frieren aliases merge only with corroborating metadata", () => {
  const mangaDex = { id: "md-frieren", title: "Frieren: Beyond Journey's End", czechTitle: "Sousou no Frieren", aliases: ["Frieren at the Funeral"], author: "Kanehito Yamada", year: "2020" };
  const aniList = { id: "al-frieren", title: "Sousou no Frieren", czechTitle: "葬送のフリーレン", aliases: ["Frieren: Beyond Journey's End"], author: "Kanehito Yamada", year: "2020" };
  const falsePositive = { id: "al-other", title: "Frieren Fan Anthology", czechTitle: "AniList titul", aliases: ["Frieren"], author: "Various", year: "2024" };
  assert.equal(mangaIdentityMatches(mangaDex, aniList), true);
  assert.equal(mangaIdentityMatches(mangaDex, falsePositive), false);
  assert.equal(matchesMangaQuery(mangaDex, "beyond frieren"), true);
});

test("MangaDex search includes erotica-rated catalogue titles such as Berserk", () => {
  assert.match(page, /params\.append\("contentRating\[\]", "erotica"\)/);
});

test("Berserk routing is exact and local imports are never merged into online records", () => {
  assert.doesNotMatch(nativeSource, /startsWith\("berserk /);
  assert.match(page, /existing\.source !== "local" && book\.source !== "local"/);
});

test("export downloads use bounded concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(maximum <= 3);
});

test("image proxy validates MIME type and disables sniffing", () => {
  assert.match(nativeImage, /contentType\.startsWith\("image\/"\)/);
  assert.match(nativeImage, /"X-Content-Type-Options": "nosniff"/);
  assert.match(nativeImage, /redirect: "manual"/);
});
