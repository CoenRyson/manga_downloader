import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createBrotliCompress, constants } from "node:zlib";

const root = fileURLToPath(new URL("../dist/nas/public/", import.meta.url));
const compressible = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".wasm"]);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collect(path) : [path];
    }),
  );
  return nested.flat();
}

let count = 0;
for (const file of await collect(root)) {
  if (!compressible.has(extname(file).toLowerCase()) || (await stat(file)).size < 1_024) continue;
  await pipeline(
    createReadStream(file),
    createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    createWriteStream(`${file}.br`),
  );
  count += 1;
}

console.log(`Předkomprimováno ${count} statických souborů.`);
