"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Manga = {
  id: string;
  title: string;
  kana: string;
  creator: string;
  chapters: number;
  genre: string;
  license: string;
  accent: string;
  accent2: string;
  description: string;
  year: string;
  source?: string;
};

type QueueItem = {
  manga: Manga;
  progress: number;
  status: "preparing" | "ready" | "packing" | "saved";
};

const seedManga: Manga[] = [
  {
    id: "nocturne-01",
    title: "Nocturne 01",
    kana: "夜行線",
    creator: "KomiDrop Studio",
    chapters: 8,
    genre: "Sci-fi",
    license: "CC BY 4.0",
    accent: "#ff5b45",
    accent2: "#ffb347",
    description: "Poslední noční vlak převáží sny mezi městy, která už neexistují.",
    year: "2026",
  },
  {
    id: "moss-signal",
    title: "Moss Signal",
    kana: "苔信号",
    creator: "Ami Kuro",
    chapters: 12,
    genre: "Mystery",
    license: "CC BY-NC 4.0",
    accent: "#b8ef67",
    accent2: "#407b4e",
    description: "V zarostlém rádiu se každý čtvrtek ozve hlas zítřejšího dne.",
    year: "2025",
  },
  {
    id: "paper-sun",
    title: "Paper Sun",
    kana: "紙の太陽",
    creator: "Rin & Teo",
    chapters: 5,
    genre: "Slice of life",
    license: "CC0",
    accent: "#f5d34d",
    accent2: "#f1799d",
    description: "Malé papírnictví, jedno horké léto a dopisy bez adresáta.",
    year: "2024",
  },
  {
    id: "salt-temple",
    title: "Salt Temple",
    kana: "塩の寺",
    creator: "Open Panel Club",
    chapters: 16,
    genre: "Fantasy",
    license: "CC BY-SA 4.0",
    accent: "#70c8ff",
    accent2: "#5d51c7",
    description: "Chrám na dně vyschlého moře se probouzí jen při bouři.",
    year: "2026",
  },
  {
    id: "tiny-orbit",
    title: "Tiny Orbit",
    kana: "小軌道",
    creator: "Mika Vale",
    chapters: 7,
    genre: "Romance",
    license: "CC BY 4.0",
    accent: "#f49ac2",
    accent2: "#7158e2",
    description: "Dva opraváři satelitů sdílejí jednu oběžnou dráhu a příliš málo času.",
    year: "2025",
  },
  {
    id: "street-kappa",
    title: "Street Kappa",
    kana: "河童通り",
    creator: "Nami Public Lab",
    chapters: 10,
    genre: "Comedy",
    license: "CC0",
    accent: "#5ee0b4",
    accent2: "#f2f47a",
    description: "Vodní démon otevírá večerku a zjišťuje, že lidé jsou mnohem podivnější.",
    year: "2023",
  },
];

const genres = ["Vše", "Sci-fi", "Mystery", "Slice of life", "Fantasy", "Romance", "Comedy"];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  const set16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const set32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const localView = new DataView(local.buffer);
    set32(localView, 0, 0x04034b50);
    set16(localView, 4, 20);
    set16(localView, 6, 0);
    set16(localView, 8, 0);
    set16(localView, 10, dosTime);
    set16(localView, 12, dosDate);
    set32(localView, 14, checksum);
    set32(localView, 18, file.data.length);
    set32(localView, 22, file.data.length);
    set16(localView, 26, name.length);
    set16(localView, 28, 0);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    set32(centralView, 0, 0x02014b50);
    set16(centralView, 4, 20);
    set16(centralView, 6, 20);
    set16(centralView, 8, 0);
    set16(centralView, 10, 0);
    set16(centralView, 12, dosTime);
    set16(centralView, 14, dosDate);
    set32(centralView, 16, checksum);
    set32(centralView, 20, file.data.length);
    set32(centralView, 24, file.data.length);
    set16(centralView, 28, name.length);
    set16(centralView, 30, 0);
    set16(centralView, 32, 0);
    set16(centralView, 34, 0);
    set16(centralView, 36, 0);
    set32(centralView, 38, 0);
    set32(centralView, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  set32(endView, 0, 0x06054b50);
  set16(endView, 4, 0);
  set16(endView, 6, 0);
  set16(endView, 8, files.length);
  set16(endView, 10, files.length);
  set32(endView, 12, centralSize);
  set32(endView, 16, offset);
  set16(endView, 20, 0);

  const total = offset + centralSize + end.length;
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const test = `${line}${word} `;
    if (context.measureText(test).width > width && line) {
      context.fillText(line.trim(), x, currentY);
      line = `${word} `;
      currentY += lineHeight;
    } else line = test;
  }
  context.fillText(line.trim(), x, currentY);
}

function createPage(manga: Manga, page: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1280;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("Canvas není dostupný."));

    context.fillStyle = "#f5f0e7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#101010";
    context.lineWidth = 12;
    context.strokeRect(22, 22, 856, 1236);
    context.fillStyle = "#101010";
    context.font = "900 42px Arial";
    context.fillText(manga.title.toUpperCase(), 55, 80);
    context.font = "700 20px Arial";
    context.fillText(`ORIGINAL DEMO • PAGE ${page}/4`, 55, 115);

    const panel = (x: number, y: number, width: number, height: number, fill = "#fff") => {
      context.fillStyle = fill;
      context.fillRect(x, y, width, height);
      context.strokeStyle = "#101010";
      context.lineWidth = 8;
      context.strokeRect(x, y, width, height);
    };

    if (page === 1) {
      panel(55, 150, 790, 560, manga.accent);
      context.fillStyle = "#101010";
      context.beginPath();
      context.arc(450, 430, 155, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = manga.accent2;
      context.beginPath();
      context.arc(485, 395, 118, 0, Math.PI * 2);
      context.fill();
      context.font = "900 122px Arial";
      context.fillStyle = "#f5f0e7";
      context.fillText("01", 365, 465);
      panel(55, 735, 380, 465);
      panel(465, 735, 380, 465, "#101010");
      context.fillStyle = "#101010";
      context.font = "800 31px Arial";
      wrapText(context, "Město spí. Signál ale právě dorazil.", 82, 805, 320, 43);
      context.fillStyle = manga.accent;
      context.font = "900 86px Arial";
      context.fillText("…", 590, 920);
    } else if (page === 2) {
      panel(55, 150, 500, 450, "#101010");
      panel(585, 150, 260, 450, manga.accent2);
      panel(55, 630, 790, 570, "#ffffff");
      context.fillStyle = manga.accent;
      for (let i = 0; i < 7; i += 1) context.fillRect(95 + i * 105, 690 + (i % 2) * 55, 55, 360);
      context.fillStyle = "#f5f0e7";
      context.font = "900 34px Arial";
      wrapText(context, "NEOTÁČEJ SE.", 95, 235, 390, 48);
      context.fillStyle = "#101010";
      context.font = "900 28px Arial";
      wrapText(context, "Tohle nebylo v jízdním řádu.", 610, 230, 200, 38);
    } else if (page === 3) {
      panel(55, 150, 790, 305, manga.accent2);
      panel(55, 485, 250, 715, "#101010");
      panel(335, 485, 510, 330, "#ffffff");
      panel(335, 845, 510, 355, manga.accent);
      context.strokeStyle = "#101010";
      context.lineWidth = 18;
      for (let i = 0; i < 9; i += 1) {
        context.beginPath();
        context.moveTo(75 + i * 95, 430);
        context.lineTo(180 + i * 95, 180);
        context.stroke();
      }
      context.fillStyle = "#f5f0e7";
      context.font = "900 70px Arial";
      context.fillText("GO", 118, 850);
      context.fillStyle = "#101010";
      context.font = "800 30px Arial";
      wrapText(context, "Možná každá cesta začíná špatným směrem.", 375, 550, 420, 43);
    } else {
      panel(55, 150, 790, 1050, "#101010");
      context.fillStyle = manga.accent;
      context.beginPath();
      context.arc(450, 555, 265, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = manga.accent2;
      context.beginPath();
      context.arc(450, 555, 165, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#f5f0e7";
      context.textAlign = "center";
      context.font = "900 64px Arial";
      context.fillText("POKRAČOVÁNÍ", 450, 970);
      context.font = "700 28px Arial";
      context.fillText("komidrop / original demo", 450, 1020);
      context.textAlign = "start";
    }

    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("Stránku se nepodařilo vytvořit."));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function safeFileName(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("Vše");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [imported, setImported] = useState<Manga[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [paperMode, setPaperMode] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("komidrop-theme");
    setPaperMode(saved === "paper");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = paperMode ? "paper" : "ink";
    window.localStorage.setItem("komidrop-theme", paperMode ? "paper" : "ink");
  }, [paperMode]);

  const manga = useMemo(() => [...imported, ...seedManga], [imported]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return manga.filter((item) => {
      const matchesGenre = genre === "Vše" || item.genre === genre;
      const matchesQuery = !needle || `${item.title} ${item.creator} ${item.kana}`.toLowerCase().includes(needle);
      return matchesGenre && matchesQuery;
    });
  }, [manga, query, genre]);

  const addToQueue = (item: Manga) => {
    if (queue.some((entry) => entry.manga.id === item.id)) {
      setNotice("Tenhle titul už ve frontě je.");
      return;
    }
    setQueue((current) => [...current, { manga: item, progress: 6, status: "preparing" }]);
    setNotice(`${item.title} přidáno do fronty.`);
    const timer = window.setInterval(() => {
      setQueue((current) => current.map((entry) => {
        if (entry.manga.id !== item.id || entry.status !== "preparing") return entry;
        const progress = Math.min(100, entry.progress + 7 + Math.round(Math.random() * 13));
        if (progress === 100) window.clearInterval(timer);
        return { ...entry, progress, status: progress === 100 ? "ready" : "preparing" };
      }));
    }, 260);
  };

  const saveCbz = async (item: Manga) => {
    setQueue((current) => current.map((entry) => entry.manga.id === item.id ? { ...entry, status: "packing" } : entry));
    try {
      const pages = await Promise.all([1, 2, 3, 4].map((page) => createPage(item, page)));
      const encoder = new TextEncoder();
      const comicInfo = `<?xml version="1.0" encoding="utf-8"?><ComicInfo><Title>${escapeXml(item.title)}</Title><Writer>${escapeXml(item.creator)}</Writer><Genre>${escapeXml(item.genre)}</Genre><Year>${item.year}</Year><PageCount>4</PageCount><Notes>Original KomiDrop demo. License: ${escapeXml(item.license)}</Notes></ComicInfo>`;
      const readme = `KOMIDROP ORIGINAL DEMO\n\n${item.title}\n${item.description}\n\nLicence: ${item.license}\nZdroj: ${item.source ?? "KomiDrop Studio demo catalogue"}\n\nObsah je originální ukázka vytvořená v prohlížeči. Neobsahuje materiál třetích stran.`;
      const archive = zipStore([
        ...pages.map((data, index) => ({ name: `page-${String(index + 1).padStart(2, "0")}.png`, data })),
        { name: "ComicInfo.xml", data: encoder.encode(comicInfo) },
        { name: "README.txt", data: encoder.encode(readme) },
      ]);
      const blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/vnd.comicbook+zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(item.title)}-demo.cbz`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setQueue((current) => current.map((entry) => entry.manga.id === item.id ? { ...entry, status: "saved" } : entry));
      setNotice("CBZ je připravené ve vašem stahování.");
    } catch {
      setQueue((current) => current.map((entry) => entry.manga.id === item.id ? { ...entry, status: "ready" } : entry));
      setNotice("Export se nepovedl. Zkuste to ještě jednou.");
    }
  };

  const handleImport = (event: FormEvent) => {
    event.preventDefault();
    setImportError("");
    if (!rightsConfirmed) {
      setImportError("Nejdřív potvrďte, že máte právo obsah stáhnout.");
      return;
    }
    try {
      const url = new URL(importUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error("protocol");
      const slug = url.pathname.split("/").filter(Boolean).pop() ?? "vlastni-titul";
      const title = slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
      const newItem: Manga = {
        id: `import-${Date.now()}`,
        title: title || "Vlastní titul",
        kana: "URL IMPORT",
        creator: url.hostname.replace(/^www\./, ""),
        chapters: 1,
        genre: "Vlastní",
        license: "Ručně ověřeno",
        accent: "#ff5b45",
        accent2: "#7c6cff",
        description: "Soukromý záznam zdroje. KomiDrop ho uloží jen na tomto zařízení.",
        year: String(new Date().getFullYear()),
        source: url.toString(),
      };
      setImported((current) => [newItem, ...current]);
      setImportOpen(false);
      setImportUrl("");
      setRightsConfirmed(false);
      setNotice("Zdroj přidán do lokální knihovny.");
    } catch {
      setImportError("Vložte platnou adresu začínající http:// nebo https://.");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="KomiDrop domů">
          <span className="brand-mark">K</span>
          <span>KOMI<span>/</span>DROP</span>
        </a>
        <nav className="nav-links" aria-label="Hlavní navigace">
          <a href="#library">Knihovna</a>
          <a href="#how">Jak to funguje</a>
        </nav>
        <div className="top-actions">
          <button className="theme-button" onClick={() => setPaperMode((value) => !value)} aria-label="Přepnout barevný režim">
            {paperMode ? "INK" : "PAPER"}
          </button>
          <button className="import-button" onClick={() => setImportOpen(true)}>+ Přidat zdroj</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> LEGAL MODE / OFFLINE READY</div>
          <h1>MANGA<br />BEZ <em>ŠEDÉ</em><br />ZÓNY.</h1>
          <p className="hero-text">Stahuj originální, otevřenou nebo vlastní mangu do CBZ. Čistá knihovna. Jasná licence. Nula pochybných scraperů.</p>
          <div className="hero-actions">
            <a className="primary-cta" href="#library">Prozkoumat knihovnu <span>↘</span></a>
            <button className="text-cta" onClick={() => setImportOpen(true)}>Mám vlastní URL →</button>
          </div>
          <div className="mini-stats" aria-label="Statistiky knihovny">
            <div><strong>06</strong><span>originálních sérií</span></div>
            <div><strong>58</strong><span>kapitol k exportu</span></div>
            <div><strong>0</strong><span>trackerů a reklam</span></div>
          </div>
        </div>

        <div className="hero-art" aria-label="Doporučená manga Nocturne 01">
          <div className="poster-shadow" />
          <div className="poster">
            <div className="poster-grid" />
            <span className="poster-code">KD—001 / 2026</span>
            <span className="poster-kana">夜<br />行<br />線</span>
            <div className="poster-orbit orbit-one" />
            <div className="poster-orbit orbit-two" />
            <div className="poster-title">NOCTURNE<br /><i>01</i></div>
            <div className="poster-footer"><span>SCI—FI</span><span>CC BY 4.0</span></div>
          </div>
          <button className="floating-download" onClick={() => addToQueue(seedManga[0])} aria-label="Přidat Nocturne 01 do fronty">
            <span>↓</span> CBZ
          </button>
          <div className="feature-note">VÝBĚR TÝDNE <span>4.9 / 5</span></div>
        </div>
      </section>

      <div className="ticker" aria-hidden="true">
        <div>OPEN CULTURE <span>✦</span> READ OFFLINE <span>✦</span> KEEP ARTISTS CREDITED <span>✦</span> OWN YOUR LIBRARY <span>✦</span> OPEN CULTURE <span>✦</span></div>
      </div>

      <section className="library" id="library">
        <div className="section-heading">
          <div>
            <span className="section-index">01 / DISCOVER</span>
            <h2>OTEVŘENÁ<br />KNIHOVNA</h2>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat titul nebo autora…" aria-label="Hledat titul nebo autora" />
          </label>
        </div>

        <div className="genre-row" aria-label="Filtrovat podle žánru">
          {genres.map((item) => <button key={item} className={genre === item ? "active" : ""} onClick={() => setGenre(item)}>{item}</button>)}
        </div>

        <div className="manga-grid">
          {filtered.map((item, index) => {
            const queued = queue.find((entry) => entry.manga.id === item.id);
            return (
              <article className="manga-card" key={item.id} style={{ "--accent": item.accent, "--accent-two": item.accent2 } as React.CSSProperties}>
                <div className={`cover cover-${index % 4}`}>
                  <span className="cover-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="cover-kana">{item.kana}</span>
                  <div className="cover-shape shape-a" />
                  <div className="cover-shape shape-b" />
                  <strong>{item.title}</strong>
                  <small>{item.year} / {item.genre}</small>
                </div>
                <div className="card-meta">
                  <div className="license-line"><span>{item.license}</span><span>{item.chapters} kapitol</span></div>
                  <h3>{item.title}</h3>
                  <p className="creator">{item.creator}</p>
                  <p className="description">{item.description}</p>
                  <button className="card-download" onClick={() => addToQueue(item)} disabled={Boolean(queued)}>
                    {queued ? (queued.status === "ready" || queued.status === "saved" ? "Připraveno ✓" : `Připravuji ${queued.progress}%`) : "Přidat do fronty"}
                    <span>{queued ? "•" : "↓"}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {filtered.length === 0 && <div className="empty-state"><strong>NIC TU NENÍ.</strong><span>Zkuste jiný výraz nebo žánr.</span></div>}
      </section>

      <section className="how" id="how">
        <div className="how-intro">
          <span className="section-index">02 / HOW IT WORKS</span>
          <h2>TŘI KROKY.<br /><i>ŽÁDNÝ HÁČEK.</i></h2>
          <p>KomiDrop je lokální-first nástroj. Vaše URL, historie ani knihovna neopustí zařízení.</p>
        </div>
        <div className="steps">
          <article><span>01</span><h3>Vyber zdroj</h3><p>Otevřený katalog nebo vlastní URL, ke které máš práva.</p></article>
          <article><span>02</span><h3>Zkontroluj licenci</h3><p>Licence je vidět dřív, než cokoliv přidáš do fronty.</p></article>
          <article><span>03</span><h3>Ulož CBZ</h3><p>Standardní formát pro oblíbené offline čtečky komiksů.</p></article>
        </div>
      </section>

      <footer>
        <a className="brand footer-brand" href="#top"><span className="brand-mark">K</span><span>KOMI<span>/</span>DROP</span></a>
        <p>Vytvořeno pro čtenáře, kteří chtějí mít jasno.</p>
        <div><span>LOCAL FIRST</span><span>NO TRACKING</span><span>2026</span></div>
      </footer>

      {queue.length > 0 && (
        <aside className="queue-panel" aria-label="Fronta exportu">
          <div className="queue-head">
            <div><span className="queue-pulse" /><strong>EXPORT QUEUE</strong> <small>{queue.length}</small></div>
            <button onClick={() => setQueue([])} aria-label="Vyčistit frontu">Vyčistit</button>
          </div>
          <div className="queue-list">
            {queue.map((entry) => (
              <div className="queue-item" key={entry.manga.id}>
                <div className="queue-thumb" style={{ background: `linear-gradient(145deg, ${entry.manga.accent}, ${entry.manga.accent2})` }}>{entry.manga.kana.slice(0, 1)}</div>
                <div className="queue-info">
                  <strong>{entry.manga.title}</strong>
                  <span>{entry.status === "preparing" ? `Příprava stránek / ${entry.progress}%` : entry.status === "packing" ? "Balím CBZ…" : entry.status === "saved" ? "Uloženo do zařízení" : "Připraveno k uložení"}</span>
                  <div className="progress"><i style={{ width: `${entry.progress}%` }} /></div>
                </div>
                {(entry.status === "ready" || entry.status === "saved") && <button className="save-button" onClick={() => saveCbz(entry.manga)}>{entry.status === "saved" ? "Uložit znovu" : "Uložit CBZ"}</button>}
              </div>
            ))}
          </div>
        </aside>
      )}

      {importOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setImportOpen(false)}>
          <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <button className="modal-close" onClick={() => setImportOpen(false)} aria-label="Zavřít">×</button>
            <span className="section-index">MANUAL SOURCE / LOCAL ONLY</span>
            <h2 id="import-title">PŘIDEJ<br /><i>VLASTNÍ ZDROJ.</i></h2>
            <p>Vlož přímou URL k obsahu, který je tvůj, je ve veřejné doméně nebo k němu máš svolení autora.</p>
            <form onSubmit={handleImport}>
              <label>URL zdroje<input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://example.org/moje-manga" autoFocus required /></label>
              <label className="rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>Potvrzuji, že mám právo tento obsah stáhnout a uložit.</span></label>
              {importError && <div className="form-error" role="alert">{importError}</div>}
              <button type="submit" className="primary-cta modal-submit">Přidat do knihovny <span>↘</span></button>
            </form>
            <small>KomiDrop neobchází paywally, DRM ani omezení přístupu.</small>
          </section>
        </div>
      )}

      {notice && <button className="toast" onClick={() => setNotice("")} aria-label="Zavřít oznámení">{notice}<span>×</span></button>}
    </main>
  );
}
