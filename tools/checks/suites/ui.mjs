import { expect, short } from '../lib/assert.mjs';

/**
 * Блок критериев «Веб-интерфейс».
 *
 * Часть проверяется обычным HTTP-запросом: страница отдаётся, внешних ресурсов
 * не тянет, форма импорта на месте. Часть требует исполнения JavaScript в
 * настоящем браузере — фильтр, поиск, отчёт об импорте, экранирование в DOM.
 * Скрипт без зависимостей браузера не поднимает, поэтому такие пункты честно
 * помечены needs: ['browser'] и печатаются как SKIP с причиной.
 * Закрывать их — задача Playwright-прогона в tools/e2e.
 */

/** Ссылки на чужие хосты: http(s):// и protocol-relative //cdn… */
const EXTERNAL = /(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["']|url\(\s*["']?(?:https?:)?\/\/[^)]+\)|@import\s+["']?(?:https?:)?\/\//gi;

/**
 * Страница + всё, что она подключает через <script src="…"> — локальные пути
 * только, никакие внешние.
 *
 * Нужно потому, что фронтендер разнёс логику по файлам (api.js, dom.js, app.js)
 * вместо инлайн-скриптов в index.html — верно с точки зрения структуры кода,
 * но проверки ui/talks-to-api и ui/import-form-present сначала искали строку
 * "/api/notes" в сырой разметке index.html и ничего не находили: путь к API
 * лежит в api.js, а не в html. Найдено 2026-08-30 на живом прогоне слитого main.
 */
async function pageWithScripts(api) {
    const page = await api.request('GET', '/ui/', { headers: { Accept: 'text/html' } });
    const srcs = [...page.text.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)]
        .map((m) => m[1])
        .filter((src) => !/^https?:\/\//i.test(src) && !src.startsWith('//'));
    const scripts = await Promise.all(
        srcs.map(async (src) => {
            const url = src.startsWith('/') ? src : `/ui/${src}`;
            const res = await api.request('GET', url);
            return res.text ?? '';
        }),
    );
    return { page, combined: page.text + '\n' + scripts.join('\n') };
}

export default {
    group: 'ui',
    title: 'Веб-интерфейс',
    checks: [
        {
            id: 'ui/page-opens',
            what: 'GET /ui/ при поднятом стенде',
            expect: '200 и HTML-страница',
            needs: ['ui'],
            run: async ({ api }) => {
                const res = await api.request('GET', '/ui/', { headers: { Accept: 'text/html' } });
                expect(res.status === 200, `${res.status}, тело ${short(res.text)}`);
                expect(/text\/html/i.test(res.headers['content-type'] ?? ''), `Content-Type: ${short(res.headers['content-type'])}`);
                expect(/<html/i.test(res.text), `тело не похоже на HTML: ${short(res.text)}`);
                return `200, Content-Type: ${res.headers['content-type']}, длина ${res.text.length} байт`;
            },
        },
        {
            id: 'ui/no-external-resources',
            what: 'Разметка /ui/ — ссылки на внешние хосты',
            expect: 'ни одного внешнего ресурса: ни CDN, ни шрифтов, ни картинок',
            needs: ['ui'],
            run: async ({ api }) => {
                const res = await api.request('GET', '/ui/', { headers: { Accept: 'text/html' } });
                expect(res.status === 200, `${res.status}`);
                const found = res.text.match(EXTERNAL) ?? [];
                expect(found.length === 0, `найдено внешних ссылок: ${found.length} — ${short(found.join(' | '))}`);
                return 'внешних ссылок в разметке нет';
            },
        },
        {
            id: 'ui/talks-to-api',
            what: 'Разметка /ui/ — обращения к API',
            expect: 'страница ходит в /api/notes',
            needs: ['ui'],
            run: async ({ api }) => {
                const { combined } = await pageWithScripts(api);
                expect(/\/api\/notes/.test(combined), 'ни в разметке, ни в подключённых скриптах нет упоминания /api/notes');
                return 'обращение к /api/notes есть в подключённых скриптах';
            },
        },
        {
            id: 'ui/import-form-present',
            what: 'Разметка /ui/ — форма импорта',
            expect: 'есть поле для файла или для JSON-пачки и упоминание /api/notes/import',
            needs: ['ui'],
            run: async ({ api }) => {
                const { page, combined } = await pageWithScripts(api);
                const hasField = /type\s*=\s*["']file["']/i.test(page.text) || /<textarea/i.test(page.text);
                expect(hasField, 'ни input[type=file], ни textarea в разметке нет');
                expect(/\/api\/notes\/import/.test(combined), 'ни в разметке, ни в подключённых скриптах нет обращения к /api/notes/import');
                return 'поле для пачки в разметке, обращение к /api/notes/import в подключённых скриптах';
            },
        },
        {
            id: 'ui/no-build-step',
            what: 'Разметка /ui/ — признаки шага сборки',
            expect: 'ни import из node_modules, ни ссылок на бандлер',
            needs: ['ui'],
            run: async ({ api }) => {
                const res = await api.request('GET', '/ui/', { headers: { Accept: 'text/html' } });
                expect(!/node_modules|\/dist\/|webpack|vite\/client/i.test(res.text), 'в разметке есть следы шага сборки');
                return 'следов шага сборки в разметке нет';
            },
        },
        {
            id: 'ui/list-filter-and-search',
            what: 'Список заметок, фильтр по тегу и поиск по подстроке в интерфейсе',
            expect: 'список отображается, фильтр и поиск меняют выдачу',
            needs: ['browser'],
            run: async () => 'не должно сюда дойти',
        },
        {
            id: 'ui/import-report',
            what: 'Форма импорта показывает отчёт: сколько записано, сколько отклонено и по каким индексам',
            expect: 'после отправки пачки на странице виден отчёт',
            needs: ['browser'],
            run: async () => 'не должно сюда дойти',
        },
        {
            id: 'ui/xss-rendered-as-text',
            what: '<script>alert(1)</script> в title заметки на странице',
            expect: 'виден как строка и не выполняется',
            needs: ['browser'],
            run: async () => 'не должно сюда дойти',
        },
        {
            id: 'ui/stand-down-message',
            what: 'Страница при остановленном стенде',
            expect: 'понятная ошибка, а не пустой экран',
            needs: ['browser'],
            run: async () => 'не должно сюда дойти',
        },
    ],
};
