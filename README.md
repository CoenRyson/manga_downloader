# Shiori — lokální manga čtečka

Jednoduchý full‑stack starter projekt (lokální manga reader) založený na vinextu s volitelnou podporou Cloudflare D1 a Drizzle ORM.

## Popis

Tento repozitář obsahuje základní šablonu aplikace pro prohlížení lokálních mang/komiksů. Projekt je postavený v TypeScriptu a využívá ekosystém (vinext, Vite, Next kompatibilní prostředí). Můžeš ho použít jako výchozí bod pro vlastní čtečku, přidat D1 databázi přes Cloudflare nebo generovat migrace pomocí Drizzle.

## Požadavky

- Node.js >= 22.13.0
- Doporučené: npm nebo jiný správce balíčků (pnpm/yarn lze použít s odpovídající konfigurací)

## Rychlý start

```bash
npm install
npm run dev    # spuštění v režimu vývoje
npm run build  # sestavení aplikace
npm start      # spuštění produkčního buildu
```

## Docker na NASu

Kontejner používá statickou SPA a minimální Node proxy. Neobsahuje `node_modules`, React server ani serverové renderování. Ve výchozím stavu běží na portu `3000` s limitem 0,75 CPU a 256 MB RAM:

```bash
docker compose up -d --build
```

Limity a vnější port lze změnit bez úpravy souboru:

```bash
MANGA_READER_PORT=3000 MANGA_READER_CPU_LIMIT=1.0 MANGA_READER_MEMORY_LIMIT=384m docker compose up -d --build
```

OCR, překlad, exporty, historie i celé uživatelské rozhraní běží v prohlížeči uživatele. Velké OCR knihovny se načtou až při použití překladu. NAS pouze doručí předkomprimované statické soubory a přeposílá zdroje, které prohlížeč nemůže načíst přímo kvůli CORS; neměnné soubory se ukládají do cache prohlížeče.

## Skripty (z package.json)

- `dev` — spustí vinext v dev režimu
- `build` — sestaví aplikaci (`vinext build`)
- `build:nas` — vytvoří statickou NAS aplikaci a minimální proxy v `dist/nas`
- `start` — spustí produkční build (`vinext start`)
- `test` — sestaví projekt a spustí testy
- `test:nas` — sestaví a otestuje přesně tu variantu, která běží v Dockeru
- `lint` — spustí ESLint
- `db:generate` — vygeneruje Drizzle migrace (pokud používáš Drizzle)

## Struktura projektu (rychlý přehled)

- `app/` — hlavní kód webové aplikace (UI, routy)
- `db/schema.ts` — místo pro definici Drizzle schématu (momentálně může být prázdné)
- `drizzle.config.ts` — konfigurace Drizzle (používaná pro generování migrací)
- `examples/d1/` — ukázková integrace s D1 (volitelné)
- `vite.config.ts` — lokální nastavení vývoje
- `.openai/hosting.json` — volitelné deklarace vazeb (Sites D1, R2) používané pro lokální simulaci

> Poznámka: konkrétní soubory a adresáře se mohou lišit podle větve nebo místních úprav. Pokud něco chybí, zkontroluj aktuální obsah repozitáře.

## Autentizační hlavičky a přihlášení

Projekt může přijímat hlavičky identity (pokud ho hostuje prostředí, které identity injektuje). To usnadňuje implementaci uživatelských účtů a ochranu stránek. Pokud používáš připravené helpery pro přihlášení (např. `app/chatgpt-auth.ts`), najdeš v nich funkce pro kontrolu a vynucení přihlášení.

## Užitečné odkazy

- vinext: https://github.com/cloudflare/vinext
- Drizzle D1 guide: https://orm.drizzle.team/docs/get-started/d1-new


---

Pokud chceš, mohu README ještě upravit konkrétně podle tvého projektu (přidat návod, jak nahrávat manga soubory, ukázky konfigurace D1/R2 nebo screenshoty). Napiš, co bys chtěl doplnit.
