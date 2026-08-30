// Рендерит tools/pdf/report.html в REPORT.pdf через Playwright (уже установлен в tools/e2e).
// Запуск: node tools/pdf/render.mjs
import { chromium } from '../e2e/node_modules/@playwright/test/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
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
