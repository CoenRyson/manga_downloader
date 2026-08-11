import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const nativeSource = await readFile(new URL("../app/api/native-source/route.ts", import.meta.url), "utf8");
const nativeChapter = await readFile(new URL("../app/api/native-source/chapter/route.ts", import.meta.url), "utf8");
const nativeImage = await readFile(new URL("../app/api/native-source/image/route.ts", import.meta.url), "utf8");
const goblinSource = await readFile(new URL("../app/api/goblin-slayer/route.ts", import.meta.url), "utf8");
const webSource = await readFile(new URL("../app/api/web-source/route.ts", import.meta.url), "utf8");
const utils = await readFile(new URL("../app/reader-utils.ts", import.meta.url), "utf8");

test("reader keeps fit/manual modes and recalculates around sidebar/resize", () => {
  assert.match(page, /readerFitMode/);
  assert.match(page, /addEventListener\("resize"/);
  assert.match(page, /readerPanelTab/);
  assert.match(page, /loading="lazy"/);
});

test("navigation and progress retain language, chapter and page", () => {
  assert.match(page, /ArrowRight/);
  assert.match(page, /ArrowLeft/);
  assert.match(page, /Escape/);
  assert.match(page, /\$\{languagePrefix\}/);
  assert.match(page, /volumeSortKey\(selectedVolume\)/);
  assert.match(page, /volume\.number >= 100000 \? "—" : String\(volume\.number\)/);
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
});

test("EPUB and Kindle share dynamic language metadata and Kindle filename", () => {
  assert.match(page, /dc:language>\$\{selectedChapter\.language \?\? "cs"\}/);
  assert.match(page, /kindle \? "-kindle" : ""/);
  assert.match(page, /format: kindle \? "KINDLE" : "EPUB"/);
});

test("detail page exposes complete manga export through the shared exporters", () => {
  assert.match(page, /collectCompleteExportPages/);
  assert.match(page, /downloadComplete/);
  assert.match(page, /complete-download/);
  assert.match(page, /fileSuffix/);
  assert.match(page, /volume-/);
  assert.match(page, /chapter-/);
  assert.match(page, /downloadMode/);
  assert.match(page, /downloadVolumeIds/);
  assert.match(page, /downloadSelected/);
  assert.match(page, /STÁHNOUT SEŠITY/);
});

test("resolver accepts aliases and rejects low confidence direct matches", () => {
  assert.match(page, /JSON\.stringify\(resolverTitles\)/);
  assert.match(webSource, /params\.get\("titles"\)/);
  assert.match(webSource, /best\.score < 55/);
  assert.match(utils, /normalizeTitle/);
  assert.match(utils, /bestAliasScore/);
});

test("AniList favourites is not used as rating count and catalogue has conservative identity merge", () => {
  assert.match(page, /favourites: item\.favourites/);
  assert.doesNotMatch(page, /ratingCount: item\.favourites/);
  assert.match(page, /mangaIdentityMatches/);
});
