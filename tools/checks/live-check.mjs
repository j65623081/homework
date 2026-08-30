#!/usr/bin/env node
/**
 * Живой прогон Notes API по критериям приёмки из SPEC.md.
 *
 * Node 22, ноль зависимостей: только встроенные модули и fetch.
 *
 *   node tools/checks/live-check.mjs --storage=C:/Temp/notes-check/notes.json
 *   node tools/checks/live-check.mjs http://localhost:8000 --only=import
 *   node tools/checks/live-check.mjs --list
 *
 * Стенд для полного прогона поднимается с подменённым файлом-хранилищем:
 *
 *   NOTES_STORAGE_PATH=C:/Temp/notes-check/notes.json php artisan serve --port=8000
 *
 * Рабочий api/storage/app/notes.json скрипт не открывает ни при каких условиях.
 * Без --storage мутирующие проверки не запускаются вовсе — они печатаются как SKIP.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SetupError } from './lib/assert.mjs';
import { createClient } from './lib/http.mjs';
import { Storage } from './lib/storage.mjs';
import { run } from './lib/runner.mjs';

import crud from './suites/crud.mjs';
import list from './suites/list.mjs';
import contract from './suites/contract.mjs';
import storageSuite from './suites/storage.mjs';
import importSuite from './suites/import.mjs';
import untrusted from './suites/untrusted.mjs';
import ui from './suites/ui.mjs';
import errors from './suites/errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Порядок важен: агрегирующие проверки формата ошибки идут последними. */
const SUITES = [crud, list, contract, storageSuite, importSuite, untrusted, ui, errors];

const DEFAULT_BASE = 'http://localhost:8000';

function parseArgs(argv) {
    const options = {
        base: DEFAULT_BASE,
        only: null,
        storage: null,
        keys: null,
        keepGoing: false,
        verbose: false,
        listOnly: false,
        timeout: 15000,
    };

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--keep-going') {
            options.keepGoing = true;
        } else if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--list') {
            options.listOnly = true;
        } else if (arg.startsWith('--only=')) {
            options.only = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
        } else if (arg.startsWith('--storage=')) {
            options.storage = arg.slice('--storage='.length);
        } else if (arg.startsWith('--keys=')) {
            options.keys = arg.slice('--keys='.length);
        } else if (arg.startsWith('--base=')) {
            options.base = arg.slice('--base='.length);
        } else if (arg.startsWith('--timeout=')) {
            options.timeout = Number(arg.slice('--timeout='.length));
        } else if (arg.startsWith('--')) {
            throw new SetupError(`неизвестный флаг ${arg}. Запустите с --help.`);
        } else {
            options.base = arg;
        }
    }

    if (options.storage !== null && options.keys === null) {
        options.keys = path.join(path.dirname(path.resolve(options.storage)), 'import_keys.json');
    }

    return options;
}

const HELP = `Живой прогон Notes API по критериям приёмки из SPEC.md.

Использование:
  node tools/checks/live-check.mjs [БАЗОВЫЙ_URL] [флаги]

Флаги:
  --base=URL        базовый URL стенда (по умолчанию ${DEFAULT_BASE})
  --storage=ПУТЬ    файл-хранилище, на который на время прогона указывает стенд
                    (тот же путь, что в NOTES_STORAGE_PATH). Без него мутирующие
                    проверки и проверки состояний хранилища пропускаются
  --keys=ПУТЬ       файл реестра ключей идемпотентности
                    (по умолчанию import_keys.json рядом с --storage)
  --only=СПИСОК     прогнать подмножество: группы или подстроки идентификаторов,
                    через запятую. Например --only=import или --only=storage,errors
  --keep-going      не останавливаться на первом расхождении
  --verbose         печатать проверку в четыре строки вместо одной
  --list            показать список проверок и выйти
  --timeout=МС      таймаут одного запроса, по умолчанию 15000
  -h, --help        эта справка

Группы: ${SUITES.map((s) => s.group).join(', ')}

Коды возврата: 0 — расхождений нет, 1 — есть расхождение, 2 — стенд или окружение
не готовы (стенд не поднят, подменённый файл-хранилище задан неверно).`;

function selectChecks(only) {
    const all = SUITES.flatMap((suite) => suite.checks.map((check) => ({ ...check, group: suite.group })));
    if (only === null) {
        return all;
    }
    return all.filter((check) => only.some((token) => check.group === token || check.id.includes(token)));
}

async function detectCapabilities(api, storage, out) {
    const capabilities = {
        storage: { available: false, reason: storage.unavailableReason },
        import: { available: false, reason: 'эндпоинт POST /api/notes/import не отвечает' },
        keys: { available: false, reason: 'реестр ключей идемпотентности недоступен для подмены' },
        ui: { available: false, reason: 'страница /ui/ не отдаётся' },
        browser: {
            available: false,
            reason: 'требуется исполнение JavaScript в браузере; скрипт живого прогона ' +
                'работает без зависимостей и браузер не поднимает — пункт закрывается прогоном в tools/e2e',
        },
    };

    // Стенд вообще отвечает?
    const ping = await api.get('/api/notes?limit=1').catch((error) => {
        throw new SetupError(`стенд на ${api.base} не отвечает: ${error.message}`);
    });
    out(`Стенд ${api.base}: GET /api/notes?limit=1 → ${ping.status}`);

    // Подменённое хранилище: стенд должен доказать, что читает именно наш файл.
    if (await storage.verify(api)) {
        capabilities.storage = { available: true, reason: null };
        out(`Хранилище подменено и проверено: ${storage.notesPath}`);
    } else {
        capabilities.storage = { available: false, reason: storage.unavailableReason };
        out(`Хранилище НЕ подменено: ${storage.unavailableReason}`);
    }

    // Эндпоинт импорта. Запрос заведомо отказной: ничего не записывает при любом исходе.
    const probe = await api.request('POST', '/api/notes/import', {
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
        body: 'проба',
    });
    if (probe.status === 404) {
        capabilities.import = {
            available: false,
            reason: `эндпоинта POST /api/notes/import ещё нет (проба вернула 404 ${probe.json?.error?.code ?? ''})`.trim(),
        };
        out(`Импорт: эндпоинта нет (проба → 404)`);
    } else {
        capabilities.import = { available: true, reason: null };
        out(`Импорт: эндпоинт отвечает (проба → ${probe.status})`);
    }

    // Реестр ключей: проверяем, что стенд пишет именно в подменённый файл.
    if (capabilities.storage.available && capabilities.import.available && storage.keysPath !== null) {
        try {
            storage.removeKeys();
            storage.writeNotes([]);
            const probeKey = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await api.postJson('/api/notes/import', { notes: [{ title: 'Проба реестра' }] }, { headers: { 'Idempotency-Key': probeKey } });
            const registered = Object.keys(storage.keys());
            if (registered.includes(probeKey)) {
                capabilities.keys = { available: true, reason: null };
                out(`Реестр ключей подменён и проверен: ${storage.keysPath}`);
            } else {
                capabilities.keys = {
                    available: false,
                    reason: `стенд не пишет реестр ключей в ${storage.keysPath}: путь к import_keys.json надо вынести в конфиг, как путь к notes.json`,
                };
                out(`Реестр ключей НЕ подменён: ${capabilities.keys.reason}`);
            }
        } catch (error) {
            capabilities.keys = { available: false, reason: `подмена реестра ключей не удалась: ${error.message}` };
        }
    } else if (!capabilities.import.available) {
        capabilities.keys = { available: false, reason: 'эндпоинта импорта ещё нет, реестр ключей проверять не на чем' };
    } else if (!capabilities.storage.available) {
        capabilities.keys = { available: false, reason: storage.unavailableReason };
    }

    // Веб-интерфейс.
    const uiProbe = await api.request('GET', '/ui/', { headers: { Accept: 'text/html' } });
    if (uiProbe.status === 200) {
        capabilities.ui = { available: true, reason: null };
        out(`Веб-интерфейс: /ui/ отдаётся (${uiProbe.status})`);
    } else {
        capabilities.ui = { available: false, reason: `страницы /ui/ ещё нет (проба вернула ${uiProbe.status})` };
        out(`Веб-интерфейс: страницы нет (проба → ${uiProbe.status})`);
    }

    return capabilities;
}

async function main() {
    const out = console.log;
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        out(HELP);
        return 0;
    }

    const checks = selectChecks(options.only);

    if (options.listOnly) {
        out(`Всего проверок: ${checks.length}`);
        for (const suite of SUITES) {
            const mine = checks.filter((c) => c.group === suite.group);
            if (mine.length === 0) {
                continue;
            }
            out(`\n${suite.group} — ${suite.title} (${mine.length})`);
            for (const check of mine) {
                out(`  ${check.id}`);
                out(`      что:   ${check.what}`);
                out(`      ждали: ${check.expect}`);
                if (check.interpretation) {
                    out(`      прочтение спеки: ${check.interpretation}`);
                }
            }
        }
        return 0;
    }

    if (checks.length === 0) {
        throw new SetupError(`под --only=${options.only.join(',')} не подошла ни одна проверка`);
    }

    const recorded = [];
    const api = createClient(options.base, { timeout: options.timeout, onResponse: (res) => recorded.push(res) });
    const storage = new Storage({ notesPath: options.storage, keysPath: options.keys, repoRoot: REPO_ROOT });
    storage.guard();

    out('Живой прогон Notes API по SPEC.md');
    out('='.repeat(100));
    const capabilities = await detectCapabilities(api, storage, out);
    out('='.repeat(100));
    out('');

    // Ответы пробы окружения в агрегированные проверки формата ошибки не берём.
    recorded.length = 0;

    const summary = await run(checks, { api, storage, capabilities, recorded }, {
        keepGoing: options.keepGoing,
        verbose: options.verbose,
        out,
    });

    out('');
    out('='.repeat(100));
    out(`Итого: проверок ${checks.length}, прогнано ${summary.ok + summary.fail}, сошлось ${summary.ok}, расхождений ${summary.fail}, не прогнано ${summary.skip}`);

    if (summary.skip > 0) {
        const byReason = new Map();
        for (const item of summary.skipped) {
            byReason.set(item.reason, (byReason.get(item.reason) ?? []).concat(item.id));
        }
        out('');
        out('Не прогнано:');
        for (const [reason, ids] of byReason) {
            out(`  ${ids.length} шт. — ${reason}`);
            out(`      ${ids.join(', ')}`);
        }
    }

    if (summary.fail > 0) {
        out('');
        out('Расхождения:');
        for (const failure of summary.failures) {
            out(`  ${failure.id}`);
            out(`      что:      ${failure.what}`);
            out(`      ждали:    ${failure.expect}`);
            out(`      получили: ${failure.got}`);
        }
        return 1;
    }

    return 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        if (error instanceof SetupError) {
            console.error(`\nОкружение не готово: ${error.message}`);
            process.exitCode = 2;
            return;
        }
        console.error(`\nСкрипт упал: ${error.stack ?? error.message}`);
        process.exitCode = 2;
    });
