import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import { GET as goblinSlayer } from "../app/api/goblin-slayer/route";
import { GET as goblinSlayerChapter } from "../app/api/goblin-slayer/chapter/route";
import { GET as mangaDexChapter } from "../app/api/mangadex-chapter/route";
import { GET as mangaDexFeed } from "../app/api/mangadex-feed/route";
import { GET as mangaDexImage } from "../app/api/mangadex-image/route";
import { GET as mangaDexSearch } from "../app/api/mangadex-search/route";
import { GET as mangaDexStatistics } from "../app/api/mangadex-search/statistics/route";
import { GET as nativeSource } from "../app/api/native-source/route";
import { GET as nativeSourceChapter } from "../app/api/native-source/chapter/route";
import { GET as nativeSourceImage } from "../app/api/native-source/image/route";
import { GET as ocrModel } from "../app/api/ocr-model/route";
import { GET as webSource } from "../app/api/web-source/route";

type RouteHandler = (request: Request) => Response | Promise<Response>;

const routes = new Map<string, RouteHandler>([
  ["/api/goblin-slayer", goblinSlayer],
  ["/api/goblin-slayer/chapter", goblinSlayerChapter],
  ["/api/mangadex-chapter", mangaDexChapter],
  ["/api/mangadex-feed", mangaDexFeed],
  ["/api/mangadex-image", mangaDexImage],
  ["/api/mangadex-search", mangaDexSearch],
  ["/api/mangadex-search/statistics", mangaDexStatistics],
  ["/api/native-source", nativeSource],
  ["/api/native-source/chapter", nativeSourceChapter],
  ["/api/native-source/image", nativeSourceImage],
  ["/api/ocr-model", ocrModel],
  ["/api/web-source", webSource],
]);

const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
const publicPrefix = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`;
const host = process.env.HOST?.trim() || "0.0.0.0";
const parsedPort = Number(process.env.PORT || 3000);
const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65_536 ? parsedPort : 3000;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

async function sendWebResponse(response: Response, outgoing: ServerResponse, headOnly: boolean) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  setSecurityHeaders(outgoing);

  if (headOnly || !response.body) {
    outgoing.end();
    return;
  }

  Readable.fromWeb(response.body as never).on("error", () => outgoing.destroy()).pipe(outgoing);
}

async function serveApi(request: IncomingMessage, response: ServerResponse, url: URL, handler: RouteHandler) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }

  const webRequest = new Request(url, { method: "GET", headers: request.headers as HeadersInit });
  const webResponse = await handler(webRequest);
  await sendWebResponse(webResponse, response, request.method === "HEAD");
}

async function fileExists(path: string) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let filePath = resolve(publicRoot, `.${requestedPath}`);
  if (filePath !== publicRoot && !filePath.startsWith(publicPrefix)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  let fileInfo = await fileExists(filePath);
  if (!fileInfo && !extname(requestedPath)) {
    filePath = resolve(publicRoot, "index.html");
    fileInfo = await fileExists(filePath);
  }
  if (!fileInfo) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  const accepted = request.headers["accept-encoding"] || "";
  let servedPath = filePath;
  let encoding: "br" | "gzip" | undefined;
  if (accepted.includes("br") && (await fileExists(`${filePath}.br`))) {
    servedPath = `${filePath}.br`;
    encoding = "br";
  } else if (accepted.includes("gzip") && (await fileExists(`${filePath}.gz`))) {
    servedPath = `${filePath}.gz`;
    encoding = "gzip";
  }

  const immutable = requestedPath.startsWith("/assets/") || requestedPath.startsWith("/ocr/");
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream");
  response.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  response.setHeader("Vary", "Accept-Encoding");
  if (encoding) response.setHeader("Content-Encoding", encoding);
  setSecurityHeaders(response);

  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(servedPath).on("error", () => response.destroy()).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const authority = request.headers.host || `127.0.0.1:${port}`;
    const url = new URL(request.url || "/", `http://${authority}`);
    const handler = routes.get(url.pathname);
    if (handler) {
      await serveApi(request, response, url, handler);
    } else {
      await serveStatic(request, response, url);
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    if (!response.writableEnded) response.end(JSON.stringify({ error: "Interní chyba serveru." }));
  }
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.listen(port, host, () => console.log(`Manga Reader běží na http://${host}:${port}`));
