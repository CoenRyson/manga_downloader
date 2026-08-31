import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(projectRoot, "dist/nas");
const expectedParent = resolve(projectRoot, "dist");

if (dirname(target) !== expectedParent || !target.endsWith(`${process.platform === "win32" ? "\\" : "/"}nas`)) {
  throw new Error(`Odmítám odstranit neočekávanou cestu: ${target}`);
}

await rm(target, { recursive: true, force: true });
