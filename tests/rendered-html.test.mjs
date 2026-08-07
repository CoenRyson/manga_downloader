import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the manga reader home", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Manga Reader/);
  assert.match(html, /MANGA READER/);
  assert.match(html, /NAJDI\. OTEVŘI\. ČTI\./);
  assert.match(html, /Název mangy česky/);
  assert.match(html, /Knihovna/);
  assert.match(html, /Stažené/);
  assert.match(html, /Nastavení/);
  assert.doesNotMatch(html, /Your site is taking shape|SkeletonPreview|codex-preview/);
});

test("keeps the starter preview removed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(page, /MANGA READER/);
  assert.match(page, /readableChapterCount/);
  assert.match(page, /Hlavní navigace/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /lang: "cs"|lang="cs"/);
  assert.match(packageJson, /"test": "vinext build && node --test/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});
