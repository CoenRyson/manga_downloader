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

async function selectReaderRegion(page: Page, from = { x: 0.2, y: 0.2 }, to = { x: 0.65, y: 0.5 }, mode: "lasso" | "rectangle" = "rectangle") {
  const startSelection = page.getByRole("button", { name: "OZNAČIT BUBLINU" });
  if (await startSelection.isVisible()) await startSelection.click();
  const layer = page.getByTestId("translation-selection-layer");
  await expect(layer).toBeVisible();
  const modeButton = page.getByRole("button", { name: mode === "lasso" ? "Volný výběr lasem" : "Obdélníkový výběr" });
  if (await modeButton.getAttribute("aria-pressed") !== "true") await modeButton.click();
  const bounds = await layer.boundingBox();
  expect(bounds).toBeTruthy();
  if (mode === "lasso") {
    const left = bounds!.x + bounds!.width * from.x;
    const right = bounds!.x + bounds!.width * to.x;
    const top = bounds!.y + bounds!.height * from.y;
    const bottom = bounds!.y + bounds!.height * to.y;
    const points = [
      { x: left, y: top },
      { x: (left + right) / 2, y: top },
      { x: right, y: top },
      { x: right, y: (top + bottom) / 2 },
      { x: right, y: bottom },
      { x: (left + right) / 2, y: bottom },
      { x: left, y: bottom },
      { x: left, y: (top + bottom) / 2 },
      { x: left, y: top },
    ];
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId("translation-selection")).toBeVisible();
    return;
  }
  await page.mouse.move(bounds!.x + bounds!.width * from.x, bounds!.y + bounds!.height * from.y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * to.x, bounds!.y + bounds!.height * to.y);
  await page.mouse.up();
  await expect(page.getByTestId("translation-selection")).toBeVisible();
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
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("100%");
  await page.getByRole("button", { name: "Zvětšit" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("110%");

  await page.getByRole("button", { name: "Další stránka" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("110%");
  await page.getByRole("button", { name: "Přepnout panel kapitol" }).click();
  await page.locator(".reader-volume button").filter({ hasText: "Test kapitoly 73.2" }).click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("110%");

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
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("100%");
  await page.reload();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("100%");
  await expect(page.locator(".reader-screen")).toHaveAttribute("data-reader-fit-mode", "manual");

  await page.getByRole("button", { name: "Přizpůsobit stránku" }).click();
  await page.reload();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("FIT");
  await expectFitAspect(page, 600 / 1000);
});

test("selected bubble text can be edited, partially selected and translated locally", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction test; mobile overflow is covered separately.");
  await page.route("**/ocr/tesseract/worker.min.js", (route) => route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__mangaDisablePaddleOcr", { configurable: true, value: true });
    Object.defineProperty(globalThis, "Translator", {
      configurable: true,
      value: {
        create: async () => ({
          translate: async (text: string) => {
            if (text === "stale") await new Promise((resolve) => setTimeout(resolve, 250));
            return `Překlad: ${text}`;
          },
          destroy() {},
        }),
      },
    });
  });
  await openFixtureChapter(page);
  await page.addStyleTag({ content: "#__vinext_dev_error_overlay_root { display: none !important; }" });
  await page.getByRole("button", { name: "Přeložit text z obrázku" }).click();
  await expect(page.getByRole("dialog", { name: "Překlad textu z mangy" })).toBeVisible();
  await expect(page.getByText("Nastavení překladu")).toBeVisible();
  await selectReaderRegion(page, { x: 0.2, y: 0.2 }, { x: 0.65, y: 0.5 }, "lasso");
  await expect(page.getByRole("dialog", { name: "Překlad textu z mangy" })).toBeVisible();

  const sourceText = page.getByPlaceholder("OCR text se objeví zde, případně ho napište ručně…");
  await sourceText.fill("Look behind you");
  const pageCounter = page.getByTestId("reader-page-counter").locator("strong");
  await expect(pageCounter).toHaveText("1 / 4");
  await sourceText.press("ArrowRight");
  await expect(pageCounter).toHaveText("1 / 4");
  await sourceText.press("Home");
  for (let index = 0; index < 4; index += 1) await sourceText.press("Shift+ArrowRight");
  await expect(page.getByRole("button", { name: "Přeložit označený nebo celý text" })).toHaveText("PŘELOŽIT OZNAČENOU ČÁST");
  await page.getByRole("button", { name: "Přeložit označený nebo celý text" }).click();
  await expect(page.getByLabel("Překlad", { exact: true })).toHaveValue("Překlad: Look");

  const lensPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "GOOGLE LENS · PROBLEMATICKÝ FONT ↗" }).click();
  const lensPopup = await lensPopupPromise;
  await expect(lensPopup.getByRole("heading", { name: "Výřez je připravený pro Google Lens" })).toBeVisible();
  await expect(lensPopup.getByAltText("Výřez manga bubliny pro Google Lens")).toBeVisible();
  await expect(lensPopup.getByRole("link", { name: "Otevřít web Google Lens ↗" })).toHaveAttribute("href", "https://lens.google.com/");
  await lensPopup.close();

  await sourceText.fill("stale");
  await page.getByRole("button", { name: "Přeložit označený nebo celý text" }).click();
  await page.getByTestId("pages-scroll").focus();
  await page.keyboard.press("ArrowRight");
  await expect(pageCounter).toHaveText("2 / 4");
  await page.waitForTimeout(350);
  await selectReaderRegion(page);
  await expect(page.getByText("Překlad: stale", { exact: true })).toHaveCount(0);
});

test("an existing lasso can be moved and resized before OCR is repeated", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer handles; touch uses the same pointer-event path.");
  await page.route("**/ocr/tesseract/worker.min.js", (route) => route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__mangaDisablePaddleOcr", { configurable: true, value: true });
  });
  await openFixtureChapter(page);
  await page.addStyleTag({ content: "#__vinext_dev_error_overlay_root { display: none !important; }" });
  await page.getByRole("button", { name: "Přeložit text z obrázku" }).click();
  await selectReaderRegion(page, { x: 0.18, y: 0.2 }, { x: 0.62, y: 0.48 }, "lasso");
  await expect(page.getByRole("dialog", { name: "Překlad textu z mangy" })).toBeVisible();
  await page.getByRole("button", { name: "UPRAVIT VÝBĚR" }).click();

  const editBox = page.locator(".reader-translation-edit-box");
  await expect(editBox).toBeVisible();
  const beforeMove = await editBox.boundingBox();
  await page.mouse.move(beforeMove!.x + beforeMove!.width / 2, beforeMove!.y + beforeMove!.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeMove!.x + beforeMove!.width / 2 + 28, beforeMove!.y + beforeMove!.height / 2 + 18);
  await page.mouse.up();
  const afterMove = await editBox.boundingBox();
  expect(afterMove!.x - beforeMove!.x).toBeGreaterThan(20);
  expect(afterMove!.y - beforeMove!.y).toBeGreaterThan(10);

  const southeastHandle = page.locator('[data-selection-handle="se"]');
  const handleBox = await southeastHandle.boundingBox();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 24, handleBox!.y + handleBox!.height / 2 + 20);
  await page.mouse.up();
  const afterResize = await editBox.boundingBox();
  expect(afterResize!.width - afterMove!.width).toBeGreaterThan(15);
  expect(afterResize!.height - afterMove!.height).toBeGreaterThan(12);
  await expect(page.getByRole("button", { name: "POTVRDIT A ZNOVU ROZPOZNAT" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editBox).toHaveCount(0);
});

test("automatic OCR uses PaddleOCR first and reports the active engine", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop OCR comparison control is covered once.");
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__mangaPaddleOcrFactory", {
      configurable: true,
      value: async () => ({
        predict: async (inputs: Blob[]) => inputs.map(() => ({
          items: [{ text: "PADDLE READS THIS", score: 0.97 }],
        })),
        dispose: async () => undefined,
      }),
    });
    Object.defineProperty(globalThis, "Translator", {
      configurable: true,
      value: {
        create: async () => ({ translate: async (text: string) => `Překlad: ${text}`, destroy() {} }),
      },
    });
  });

  await openFixtureChapter(page);
  await page.getByRole("button", { name: "Přeložit text z obrázku" }).click();
  await selectReaderRegion(page, { x: 0.18, y: 0.2 }, { x: 0.62, y: 0.48 }, "lasso");

  const dialog = page.getByRole("dialog", { name: "Překlad textu z mangy" });
  await expect(dialog.getByRole("textbox", { name: "Překlad" })).toHaveValue("Překlad: PADDLE READS THIS");
  await dialog.getByText("Upravit rozpoznání nebo přeložit jen slovo").click();
  await expect(dialog.getByLabel("OCR model")).toHaveValue("auto");
  await expect(dialog.getByText(/OCR: PaddleOCR PP-OCRv6/)).toBeVisible();
});

test("bundled OCR recognizes an outlined manga font without a runtime CDN", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The same OCR engine is used on mobile; keep the model smoke test singular.");
  test.setTimeout(90_000);
  const remoteOcrAssets: string[] = [];
  page.on("request", (request) => {
    if (/cdn\.jsdelivr\.net.*(?:tesseract|traineddata|wasm)/i.test(request.url())) remoteOcrAssets.push(request.url());
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__mangaDisablePaddleOcr", { configurable: true, value: true });
    Object.defineProperty(globalThis, "__translatorCreatedWithActivation", { configurable: true, value: [] });
    Object.defineProperty(globalThis, "Translator", {
      configurable: true,
      value: {
        create: () => {
          (globalThis as typeof globalThis & { __translatorCreatedWithActivation: boolean[] }).__translatorCreatedWithActivation.push(navigator.userActivation.isActive);
          return Promise.resolve({ translate: async (text: string) => `Překlad: ${text}`, destroy() {} });
        },
      },
    });
  });
  await page.route("**/reader-fixtures/missing.webp", async (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000" viewBox="0 0 600 1000">
      <defs><linearGradient id="night" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#555"/></linearGradient></defs>
      <rect width="600" height="1000" fill="url(#night)"/>
      <g transform="skewX(-6)" fill="#fff" stroke="#090909" stroke-width="5" paint-order="stroke" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="58" font-style="italic" letter-spacing="2">
        <text x="340" y="430">LOOK BEHIND</text>
        <text x="315" y="505">YOU!</text>
      </g>
    </svg>`,
  }));

  await openFixtureChapter(page);
  await page.getByRole("button", { name: "Přeložit text z obrázku" }).click();
  await selectReaderRegion(page, { x: 0.08, y: 0.25 }, { x: 0.92, y: 0.68 });
  await expect(page.getByPlaceholder("OCR text se objeví zde, případně ho napište ručně…")).toHaveValue(/^LOOK[\s\n]*BEHIND[\s\n]*YOU!?\s*$/i, { timeout: 60_000 });
  await expect(page.getByRole("textbox", { name: "Překlad", exact: true })).toHaveValue(/Překlad: LOOK\s+BEHIND\s+YOU!?/i, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "ROZPOZNAT VÝBĚR" })).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __translatorCreatedWithActivation: boolean[] }).__translatorCreatedWithActivation)).toContain(true);
  expect(remoteOcrAssets).toEqual([]);
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
  await page.route("**/ocr/tesseract/worker.min.js", (route) => route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__mangaDisablePaddleOcr", { configurable: true, value: true });
  });
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
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Přeložit text z obrázku" }).click();
  await expect(page.getByRole("dialog", { name: "Překlad textu z mangy" })).toBeVisible();
  await selectReaderRegion(page, { x: 0.12, y: 0.7 }, { x: 0.82, y: 0.94 });
  await expect(page.getByRole("dialog", { name: "Překlad textu z mangy" })).toBeVisible();
});
