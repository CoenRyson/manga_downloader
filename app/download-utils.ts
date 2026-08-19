const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizeDownloadName(value: string, fallback = "Manga") {
  const cleaned = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  if (!cleaned) return fallback;
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function readableExportLabel(label: string) {
  const volume = /^volume-(\d+)$/i.exec(label);
  if (volume) return `Sešit ${volume[1]}`;
  const chapter = /^chapter-(.+)$/i.exec(label);
  if (chapter) return `Kapitola ${chapter[1]}`;
  if (label === "complete") return "Komplet";
  return sanitizeDownloadName(label, "Export");
}

export function makeExportFileName(title: string, label: string, extension: "cbz" | "epub" | "pdf", kindle = false) {
  const base = sanitizeDownloadName(title);
  const part = readableExportLabel(label);
  const kindleSuffix = kindle ? " - Kindle" : "";
  return sanitizeDownloadName(`${base} - ${part}${kindleSuffix}`) + `.${extension}`;
}

export async function saveDownloadBlob(blob: Blob, fileName: string, mangaTitle: string) {
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
    const appPort = Number.parseInt(window.location.port, 10);
    if (!Number.isInteger(appPort)) throw new Error("Neplatný port lokální aplikace.");
    const params = new URLSearchParams({ title: sanitizeDownloadName(mangaTitle), file: fileName });
    const response = await fetch(`http://127.0.0.1:${appPort + 10000}/download?${params}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (response.ok) return "local" as const;
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "Soubor nelze uložit do Stažených souborů.");
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "browser" as const;
}
