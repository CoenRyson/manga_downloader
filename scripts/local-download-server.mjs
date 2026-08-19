import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const appPort = Number.parseInt(process.argv[2] ?? "", 10);
const serverPort = Number.parseInt(process.argv[3] ?? "", 10);
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".cbz", ".epub", ".pdf"]);
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

if (!Number.isInteger(appPort) || !Number.isInteger(serverPort) || serverPort < 1024 || serverPort > 65535) {
  throw new Error("Local download server received invalid ports.");
}

const allowedOrigins = new Set([`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`]);
const userProfile = process.env.USERPROFILE?.trim() || homedir();
const downloadsDirectory = join(userProfile, "Downloads");

function sanitizeName(value, fallback) {
  const cleaned = String(value ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
  if (!cleaned) return fallback;
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

function sendJson(response, status, body, origin = "") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${serverPort}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, appPort });
    return;
  }

  if (request.method === "OPTIONS" && url.pathname === "/download" && allowedOrigins.has(origin)) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
    response.end();
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/download" || !allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: "Nepovolený požadavek." }, origin);
    return;
  }

  const mangaTitle = sanitizeName(url.searchParams.get("title"), "Manga");
  const fileName = sanitizeName(url.searchParams.get("file"), "export.cbz");
  if (!ALLOWED_EXTENSIONS.has(extname(fileName).toLowerCase())) {
    sendJson(response, 400, { error: "Nepovolený typ souboru." }, origin);
    return;
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_DOWNLOAD_BYTES) {
    sendJson(response, 413, { error: "Soubor je příliš velký." }, origin);
    return;
  }

  const mangaDirectory = join(downloadsDirectory, mangaTitle);
  const destination = join(mangaDirectory, fileName);
  try {
    await mkdir(mangaDirectory, { recursive: true });
    let received = 0;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) request.destroy(new Error("Download is too large"));
    });
    const output = createWriteStream(destination, { flags: "w" });
    await new Promise((resolve, reject) => {
      request.pipe(output);
      request.on("error", reject);
      output.on("error", reject);
      output.on("finish", resolve);
    });
    sendJson(response, 200, { folder: mangaTitle, fileName }, origin);
  } catch {
    await rm(destination, { force: true }).catch(() => undefined);
    if (!response.headersSent) sendJson(response, 500, { error: "Soubor nelze uložit do složky Stažené soubory." }, origin);
  }
});

server.listen(serverPort, "127.0.0.1");
