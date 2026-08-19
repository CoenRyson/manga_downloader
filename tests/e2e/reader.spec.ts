import { expect, test, type Page } from "@playwright/test";

async function openFixtureChapter(page: Page, chapter = "73.2") {
  await page.goto("/?readerFixture=1");
  const chapterButton = page.locator(".chapter-list button").filter({ has: page.locator("span", { hasText: new RegExp(`^${chapter.replace(".", "\\.")}$`) }) });
  await expect(chapterButton).toBeEnabled();
  await chapterButton.click();
  await expect(page.getByTestId("reader-viewport")).toBeVisible();
  await expect(page.getByTestId("reader-page").locator("img")).toHaveJSProperty("complete", true);
}

async function expectFitInsideViewport(page: Page) {
  await expect.poll(async () => {
    const viewport = await page.getByTestId("reader-viewport").boundingBox();
    const imageLocator = page.getByTestId("reader-page").locator("img");
    const image = await imageLocator.boundingBox();
    const objectFit = await imageLocator.evaluate((element) => getComputedStyle(element).objectFit);
    return Boolean(viewport && image && objectFit === "contain" && image.width <= viewport.width + 1 && image.height <= viewport.height + 1);
  }).toBe(true);
}

async function expectFitAspect(page: Page, expectedRatio: number) {
  await expect.poll(async () => {
    const ratio = await page.getByTestId("reader-page").locator("img").evaluate((image) => image.naturalWidth / image.naturalHeight);
    return Math.abs(ratio - expectedRatio) < 0.02;
  }).toBe(true);
}

test("reader FIT, zoom, viewport overlay and Escape behavior", async ({ page }) => {
  await openFixtureChapter(page);
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");
  await expectFitInsideViewport(page);
  await expectFitAspect(page, 1672 / 941);

  await page.getByRole("button", { name: "Další stránka" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");
  await expectFitInsideViewport(page);
  await expectFitAspect(page, 600 / 1000);
  await page.getByRole("button", { name: "Předchozí stránka" }).click();

  await page.getByRole("button", { name: "Přepnout panel kapitol" }).click();
  await page.locator(".reader-volume button").filter({ hasText: "Test kapitoly 73.1" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");

  await page.getByRole("button", { name: "Zvětšit" }).click();
  await page.getByRole("button", { name: "Zvětšit" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("120%");

  await page.getByRole("button", { name: "Další stránka" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("120%");
  await page.getByRole("button", { name: "Přepnout panel kapitol" }).click();
  await page.locator(".reader-volume button").filter({ hasText: "Test kapitoly 73.2" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("120%");

  const previous = page.getByRole("button", { name: "Předchozí stránka" });
  const before = await previous.boundingBox();
  await page.getByTestId("pages-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
  });
  const after = await previous.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);

  await page.getByRole("button", { name: "Přepnout panel kapitol" }).click();
  await expect(page.getByTestId("reader-sidebar")).toBeVisible();
  const overlayViewport = await page.getByTestId("reader-viewport").boundingBox();
  const overlayArrow = await previous.boundingBox();
  expect(Math.abs((overlayArrow!.y + overlayArrow!.height / 2) - (overlayViewport!.y + overlayViewport!.height / 2))).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader-sidebar")).toBeHidden();
  await expect(page.getByTestId("reader-viewport")).toBeVisible();

  await page.getByRole("button", { name: "Přizpůsobit stránku" }).click();
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");
  await expectFitInsideViewport(page);
});

test("FIT remains measured and saved until zoom is changed manually", async ({ page }) => {
  await openFixtureChapter(page);
  const fittedImage = await page.getByTestId("reader-page").locator("img").boundingBox();
  await page.getByRole("button", { name: "Zvětšit" }).click();
  await page.getByRole("button", { name: "Zvětšit" }).click();
  const zoomedImage = await page.getByTestId("reader-page").locator("img").boundingBox();
  expect(zoomedImage!.width).toBeGreaterThan(fittedImage!.width + 20);
  await page.getByRole("button", { name: "Přizpůsobit stránku" }).click();
  await expectFitInsideViewport(page);
  await expect.poll(async () => (await page.getByTestId("reader-page").locator("img").boundingBox())?.width ?? 0).toBeCloseTo(fittedImage!.width, 0);

  await page.getByRole("button", { name: "Další stránka" }).click();
  await expectFitAspect(page, 600 / 1000);
  await expect(page.locator(".reader-screen")).toHaveAttribute("data-reader-fit-mode", "fit");

  await page.reload();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");
  await expectFitInsideViewport(page);
  await expectFitAspect(page, 600 / 1000);

  await page.getByRole("button", { name: "Zvětšit" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("110%");
  await page.reload();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("110%");
  await expect(page.locator(".reader-screen")).toHaveAttribute("data-reader-fit-mode", "manual");

  await page.getByRole("button", { name: "Přizpůsobit stránku" }).click();
  await page.reload();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");
  await expectFitAspect(page, 600 / 1000);
});

test("next, previous, thumbnail jump, fallback and reload resume", async ({ page }) => {
  await openFixtureChapter(page);
  const counter = page.getByTestId("reader-page-counter").locator("strong");
  await expect(counter).toHaveText("1 / 4");
  await page.getByRole("button", { name: "Další stránka" }).click();
  await expect(counter).toHaveText("2 / 4");
  await page.getByRole("button", { name: "Předchozí stránka" }).click();
  await expect(counter).toHaveText("1 / 4");

  await page.getByRole("button", { name: "Přepnout panel kapitol" }).click();
  await page.getByRole("button", { name: "STRÁNKY" }).click();
  const firstThumbnail = page.getByTestId("reader-thumbnail-1");
  await expect(firstThumbnail).toHaveAttribute("data-fallback-applied", "true");
  await expect(firstThumbnail).toHaveAttribute("src", /manga-reader-hero-v2\.png/);
  await page.getByRole("button", { name: "Přejít na stránku 3" }).click();
  await expect(counter).toHaveText("3 / 4");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByTestId("reader-page-counter").locator("strong")).toHaveText("3 / 4");
  await page.locator(".reader-toolbar > button").first().click();
  await page.getByRole("button", { name: /Domů$/ }).click();
  await page.locator(".resume-open").filter({ hasText: "Reader Fixture" }).click();
  await expect(page.getByTestId("reader-page-counter").locator("strong")).toHaveText("3 / 4");
});

test("custom download name automatically creates and reuses its Downloads folder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop local download flow");
  const writes: { folder: string; fileName: string; size: number }[] = [];
  await page.route("http://127.0.0.1:14173/download?**", async (route) => {
    const request = route.request();
    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost:4173",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const url = new URL(request.url());
    writes.push({
      folder: url.searchParams.get("title") ?? "",
      fileName: url.searchParams.get("file") ?? "",
      size: request.postDataBuffer()?.byteLength ?? 0,
    });
    await route.fulfill({ status: 200, headers: corsHeaders, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto("/?readerFixture=1");

  const openDialog = page.locator(".complete-download button");
  await openDialog.click();
  const dialog = page.locator(".download-dialog-v2");
  await dialog.getByLabel("Název složky a souborů").fill("Moje Česká Manga");
  await expect(dialog.locator(".download-folder-note")).toContainText("Automatické uložení: Stažené soubory\\Moje Česká Manga");
  await expect(dialog.locator(".download-folder-note")).toContainText("Moje Česká Manga - Sešit 01.cbz");
  await expect(dialog.getByRole("button", { name: /SLOŽKU/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Stáhnout CBZ" }).click();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ folder: "Moje Česká Manga", fileName: "Moje Česká Manga - Sešit 01.cbz" });
  expect(writes[0].size).toBeGreaterThan(0);

  await openDialog.click();
  await dialog.getByLabel("Název složky a souborů").fill("Moje Česká Manga");
  await dialog.getByRole("button", { name: "KAPITOLY", exact: true }).click();
  await dialog.getByRole("button", { name: "Zrušit výběr" }).click();
  await dialog.locator('.download-chapter-list input[type="checkbox"]').first().check();
  await dialog.getByRole("button", { name: "Stáhnout CBZ" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ folder: "Moje Česká Manga", fileName: "Moje Česká Manga - Kapitola 73.cbz" });
  expect(writes[1].size).toBeGreaterThan(0);
});

test("mobile and tablet toolbars have no horizontal overflow", async ({ page }) => {
  await openFixtureChapter(page, "73");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 860 },
    { width: 768, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (viewport.width <= 820) {
      await expect(page.getByRole("button", { name: "Další možnosti" })).toBeVisible();
      await expect(page.locator(".reader-secondary-action").first()).toBeHidden();
    } else {
      await expect(page.getByRole("button", { name: "Další možnosti" })).toBeHidden();
      await expect(page.locator(".reader-secondary-action").first()).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Další možnosti" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "EPUB" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "KINDLE" })).toBeVisible();
});
