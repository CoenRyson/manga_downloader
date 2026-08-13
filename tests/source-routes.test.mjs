import assert from "node:assert/strict";
import test from "node:test";
import { GET as resolveNativeSource } from "../app/api/native-source/route.ts";
import { GET as proxyNativeImage } from "../app/api/native-source/image/route.ts";

const originalFetch = globalThis.fetch;

function searchHtml(title, slug) {
  return `<a href="https://www.mangaread.org/manga/${slug}/">${title}</a>`;
}

test("native resolver uses aliases and does not route Berserk prefixes to Read Berserk", { concurrency: false }, async () => {
  let readBerserkCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "readberserk.com") {
      readBerserkCalls += 1;
      return new Response("");
    }
    if (url.hostname === "www.mangaread.org" && url.pathname === "/") {
      const query = url.searchParams.get("s");
      if (query === "Berserk of Gluttony") return new Response(searchHtml("Berserk of Gluttony", "berserk-of-gluttony"));
      if (query === "Frieren at the Funeral") return new Response(searchHtml("Frieren at the Funeral", "frieren-at-the-funeral"));
      return new Response("");
    }
    if (url.pathname === "/manga/berserk-of-gluttony/") return new Response('<a href="https://www.mangaread.org/manga/berserk-of-gluttony/chapter-1/">1</a>');
    if (url.pathname === "/manga/frieren-at-the-funeral/") return new Response('<a href="https://www.mangaread.org/manga/frieren-at-the-funeral/chapter-1/">1</a>');
    return new Response("", { status: 404 });
  };
  try {
    const berserkResponse = await resolveNativeSource(new Request("http://local/api/native-source?title=Berserk%20of%20Gluttony"));
    const berserk = await berserkResponse.json();
    assert.equal(berserk.provider, "MangaRead");
    assert.equal(berserk.chapterCount, 1);
    assert.equal(readBerserkCalls, 0);

    const aliases = encodeURIComponent(JSON.stringify(["Frieren: Beyond Journey's End", "Frieren at the Funeral", "Sousou no Frieren"]));
    const frierenResponse = await resolveNativeSource(new Request(`http://local/api/native-source?title=Frieren%3A%20Beyond%20Journey%27s%20End&titles=${aliases}`));
    const frieren = await frierenResponse.json();
    assert.equal(frieren.provider, "MangaRead");
    assert.equal(frieren.matchedTitle, "Frieren at the Funeral");
    assert.equal(frieren.chapterCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native image proxy rejects HTML and accepts images", { concurrency: false }, async () => {
  try {
    globalThis.fetch = async () => new Response("<html>unsafe</html>", { headers: { "Content-Type": "text/html" } });
    const htmlResponse = await proxyNativeImage(new Request("http://local/api/native-source/image?url=https%3A%2F%2Fgoblinslayerfree.com%2Fcover.jpg"));
    assert.equal(htmlResponse.status, 502);

    globalThis.fetch = async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
    const imageResponse = await proxyNativeImage(new Request("http://local/api/native-source/image?url=https%3A%2F%2Fgoblinslayerfree.com%2Fcover.jpg"));
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
