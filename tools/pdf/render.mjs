// Рендерит tools/pdf/report.html в REPORT.pdf через Playwright из tools/e2e.
//
// REPORT.pdf уже лежит в репозитории готовым — этот скрипт нужен только чтобы
// пересобрать его после правки report.html, не для проверки сдачи.
//
// Предварительно (один раз, не сделано автоматически и не закоммичено —
// node_modules/ в tools/e2e/ исключён из git через .gitignore):
//   cd tools/e2e && npm install --save-dev @playwright/test && npx playwright install chromium
//
// Запуск: node tools/pdf/render.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const playwrightEntry = join(here, '..', 'e2e', 'node_modules', '@playwright', 'test', 'index.mjs');

if (!existsSync(playwrightEntry)) {
  console.error(
    'Playwright не установлен в tools/e2e — этот скрипт его переиспользует, а не ставит сам.\n' +
    'Сначала: cd tools/e2e && npm install --save-dev @playwright/test && npx playwright install chromium\n' +
    '(REPORT.pdf уже собран и лежит в корне репозитория — пересборка нужна только после правки report.html.)'
  );
  process.exit(1);
}

const { chromium } = await import('../e2e/node_modules/@playwright/test/index.mjs');

const htmlPath = join(here, 'report.html');
const outPath = join(here, '..', '..', 'REPORT.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.pdf({
  path: outPath,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%; font-family: 'Segoe UI', Arial, sans-serif; font-size:9px; color:#888; padding: 0 20mm; display:flex; justify-content:space-between;">
      <span>Notes API — отчёт по ДЗ №2</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
  margin: { top: '10mm', bottom: '14mm', left: '0mm', right: '0mm' },
});
await browser.close();
console.log('Готово:', outPath);
