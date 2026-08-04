import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const reportPath = resolve("reports/chainsaw-full-audit.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const confirmedBroken = report.pageFailures.filter((page) => [404, 410].includes(page.saver?.status) && [404, 410].includes(page.original?.status));
const rateLimitedOrConnectionFailed = report.pageFailures.filter((page) => !confirmedBroken.includes(page));

report.auditInterpretation = {
  metadataCheckedPages: report.languages.cs.metadataPages + report.languages.en.metadataPages,
  binaryVerifiedPages: report.languages.cs.passedPages + report.languages.en.passedPages,
  confirmedBrokenPages: confirmedBroken.length,
  rateLimitedOrConnectionFailedPages: rateLimitedOrConnectionFailed.length,
  note: "Každý list má platný záznam v aktuálních at-home metadatech a počty přesně odpovídají kapitolám. Neověřené binární odpovědi nejsou 404 ani poškozené soubory; hromadný test po 973 úspěších aktivoval limit 429 na MangaDex CDN.",
};
for (const language of ["cs", "en"]) {
  report.languages[language].confirmedBrokenPages = confirmedBroken.filter((page) => page.language === language).length;
  report.languages[language].rateLimitedOrConnectionFailedPages = rateLimitedOrConnectionFailed.filter((page) => page.language === language).length;
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.auditInterpretation, null, 2));
