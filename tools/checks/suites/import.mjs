import { expect, describe, short, canonical, deepEqual } from '../lib/assert.mjs';
import { multipart } from '../lib/http.mjs';
import { UUID_V4, note, uuid } from '../lib/fixtures.mjs';

/**
 * `POST /api/notes/import` — раздел 6 «Контракт API» и блок «Критерии приёмки
 * импорта и веб-интерфейса».
 *
 * На момент написания эндпоинта в этой ветке нет: его пишет бекендер в своей.
 * Проверки написаны по контракту и помечены needs: ['import'] — если стенд
 * отвечает на импорт 404, они честно печатаются как SKIP, а не как OK.
 */

const IMPORT = '/api/notes/import';

/** Ключ идемпотентности допустимого формата: 8…128 символов [A-Za-z0-9_-]. */
function key(prefix = 'batch') {
    return `${prefix}-${uuid().replace(/-/g, '')}`.slice(0, 64);
}

function batch(n, make = (i) => ({ title: `Заметка ${i + 1}` })) {
    return { notes: Array.from({ length: n }, (_, i) => make(i)) };
}

/** Тело ответа импорта без выданных id и меток времени — для сравнения двух путей. */
function shapeWithoutIds(body) {
    return {
        imported: body?.imported,
        rejected: body?.rejected,
        errors: body?.errors,
        notes: (body?.notes ?? []).map((n) => ({ title: n.title, body: n.body, tags: n.tags })),
    };
}

export default {
    group: 'import',
    title: 'Импорт пачкой',
    checks: [
        {
            id: 'import/happy-path',
            what: 'POST /api/notes/import с Idempotency-Key и тремя валидными заметками',
            expect: '200, imported=3, rejected=0, idempotent_replay=false, в notes три заметки с непустыми id',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, batch(3), { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                expect(res.json?.imported === 3 && res.json?.rejected === 0, short(res.json));
                expect(res.json?.idempotent_replay === false, `idempotent_replay=${short(res.json?.idempotent_replay)}`);
                expect(res.json?.notes?.length === 3, `notes.length=${res.json?.notes?.length}`);
                expect(res.json.notes.every((n) => UUID_V4.test(n.id ?? '')), `id=${short(res.json.notes.map((n) => n.id))}`);
                return `200, imported=3, rejected=0, idempotent_replay=false, три id формата UUID v4`;
            },
        },
        {
            id: 'import/replay-same-key-same-body',
            what: 'Повтор того же запроса с тем же ключом и тем же телом (сценарий 12)',
            expect: '200 и то же тело, отличающееся только idempotent_replay: true',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const k = key();
                const payload = batch(3);
                const first = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': k } });
                expect(first.status === 200, describe(first));
                const second = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': k } });
                expect(second.status === 200, describe(second));
                expect(second.json?.idempotent_replay === true, `idempotent_replay=${short(second.json?.idempotent_replay)}`);
                const a = { ...first.json, idempotent_replay: null };
                const b = { ...second.json, idempotent_replay: null };
                expect(deepEqual(a, b), `тела разошлись: было ${short(a)}, стало ${short(b)}`);
                return '200, тело то же, idempotent_replay=true';
            },
        },
        {
            id: 'import/replay-does-not-duplicate',
            what: 'Число записей в хранилище после повтора',
            expect: 'три заметки, а не шесть',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const k = key();
                const payload = batch(3);
                await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': k } });
                const afterFirst = storage.count();
                await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': k } });
                const afterSecond = storage.count();
                expect(afterFirst === 3, `после первого импорта записей ${afterFirst}`);
                expect(afterSecond === 3, `после повтора записей ${afterSecond}`);
                return `после первого импорта 3, после повтора 3`;
            },
        },
        {
            id: 'import/multipart-equals-json',
            what: 'Импорт файлом (multipart/form-data, поле file) против того же JSON в теле',
            expect: 'результаты неотличимы, кроме выданных id и меток времени',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                const payload = batch(3, (i) => ({ title: `Заметка ${i + 1}`, tags: ['Работа'] }));
                storage.writeNotes([]);
                const viaJson = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': key('json') } });
                expect(viaJson.status === 200, `JSON: ${describe(viaJson)}`);

                storage.writeNotes([]);
                const part = multipart([{ name: 'file', filename: 'batch.json', contentType: 'application/json', value: JSON.stringify(payload) }]);
                const viaFile = await api.request('POST', IMPORT, {
                    headers: { ...part.headers, 'Idempotency-Key': key('file'), Accept: 'application/json' },
                    body: part.body,
                });
                expect(viaFile.status === 200, `multipart: ${describe(viaFile)}`);
                expect(deepEqual(shapeWithoutIds(viaJson.json), shapeWithoutIds(viaFile.json)),
                    `JSON: ${short(shapeWithoutIds(viaJson.json))} против файла: ${short(shapeWithoutIds(viaFile.json))}`);
                return '200 и 200, отчёты совпали с точностью до id и меток времени';
            },
        },
        {
            id: 'import/filename-and-mime-ignored',
            what: 'Импорт файлом с именем «../../evil.exe» и MIME-типом application/x-msdownload',
            expect: '200 и тот же результат: метаданные файла не влияют ни на что',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const payload = batch(2);
                const part = multipart([
                    { name: 'file', filename: '../../evil.exe', contentType: 'application/x-msdownload', value: JSON.stringify(payload) },
                    { name: 'notes', value: '{"notes":[{"title":"поле-обманка"}]}' },
                ]);
                const res = await api.request('POST', IMPORT, {
                    headers: { ...part.headers, 'Idempotency-Key': key(), Accept: 'application/json' },
                    body: part.body,
                });
                expect(res.status === 200, describe(res));
                expect(res.json?.imported === 2, `imported=${short(res.json?.imported)}`);
                const titles = storage.notes().map((n) => n.title);
                expect(!titles.includes('поле-обманка'), `в хранилище попало лишнее поле multipart: ${short(titles)}`);
                return `200, imported=2, лишнее поле multipart проигнорировано`;
            },
        },
        {
            id: 'import/tags-normalized',
            what: 'Импорт заметки с тегами ["Работа"," работа ","дом"]',
            expect: '200 и tags = ["работа","дом"] — нормализация та же, что при POST',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, { notes: [{ title: 'С тегами', tags: ['Работа', ' работа ', 'дом'] }] },
                    { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                expect(canonical(res.json?.notes?.[0]?.tags) === canonical(['работа', 'дом']), `tags=${short(res.json?.notes?.[0]?.tags)}`);
                return `200, tags=${JSON.stringify(res.json.notes[0].tags)}`;
            },
        },
        {
            id: 'import/partial-success',
            what: 'Пачка из пяти заметок: у второй пустой title, у четвёртой поле titel (сценарий 14)',
            expect: '200, imported=3, rejected=2, в errors две записи',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const payload = {
                    notes: [
                        { title: 'Первая' },
                        { title: '' },
                        { title: 'Третья' },
                        { titel: 'опечатка' },
                        { title: 'Пятая' },
                    ],
                };
                const res = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                expect(res.json?.imported === 3 && res.json?.rejected === 2, short(res.json));
                expect(res.json?.errors?.length === 2, `errors=${short(res.json?.errors)}`);
                return `200, imported=3, rejected=2, errors.length=2`;
            },
        },
        {
            id: 'import/error-index-points-to-input',
            what: 'errors[].index в той же пачке',
            expect: 'index 1 с кодом validation_failed и index 3 с кодом unknown_fields — позиции во входной пачке',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const payload = {
                    notes: [{ title: 'Первая' }, { title: '' }, { title: 'Третья' }, { titel: 'опечатка' }, { title: 'Пятая' }],
                };
                const res = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                const errors = res.json?.errors ?? [];
                const byIndex = Object.fromEntries(errors.map((e) => [e.index, e.code]));
                expect(byIndex[1] === 'validation_failed', `errors=${short(errors)}`);
                expect(byIndex[3] === 'unknown_fields', `errors=${short(errors)}`);
                return `200, errors: index 1 → validation_failed, index 3 → unknown_fields`;
            },
        },
        {
            id: 'import/valid-items-are-stored',
            what: 'Что реально лежит в хранилище после пачки с браком',
            expect: 'три валидные заметки записаны, невалидных нет',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const payload = {
                    notes: [{ title: 'Первая' }, { title: '' }, { title: 'Третья' }, { titel: 'опечатка' }, { title: 'Пятая' }],
                };
                const res = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                const titles = storage.notes().map((n) => n.title).sort();
                expect(canonical(titles) === canonical(['Первая', 'Пятая', 'Третья']), `в хранилище: ${short(titles)}`);
                return `200, в хранилище ровно три валидные заметки: ${JSON.stringify(titles)}`;
            },
        },
        {
            id: 'import/all-rejected-is-200',
            what: 'Пачка из двух заметок, обе без title (сценарий 15)',
            expect: '200 с imported=0 и rejected=2, а не 422',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, { notes: [{ body: 'a' }, { body: 'b' }] }, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                expect(res.json?.imported === 0 && res.json?.rejected === 2, short(res.json));
                return `200, imported=0, rejected=2`;
            },
        },
        {
            id: 'import/no-key',
            what: 'Импорт без заголовка Idempotency-Key (сценарий 17)',
            expect: '422 idempotency_key_invalid, хранилище не изменилось',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([note()]);
                const before = storage.fingerprint();
                const res = await api.postJson(IMPORT, batch(2));
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'idempotency_key_invalid', describe(res));
                expect(storage.fingerprint() === before, `${describe(res)}, но хранилище изменилось`);
                return `${describe(res)}, хранилище не изменилось`;
            },
        },
        {
            id: 'import/short-key',
            what: 'Импорт с ключом «abc» (короче 8 символов)',
            expect: '422 idempotency_key_invalid',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, batch(1), { headers: { 'Idempotency-Key': 'abc' } });
                expect(res.status === 422 && res.json?.error?.code === 'idempotency_key_invalid', describe(res));
                return describe(res);
            },
        },
        {
            id: 'import/key-bad-charset',
            what: 'Импорт с ключом «ключ пачки №1» — символы вне [A-Za-z0-9_-]',
            expect: '422 idempotency_key_invalid',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, batch(1), { headers: { 'Idempotency-Key': 'kluch pachki #1' } });
                expect(res.status === 422 && res.json?.error?.code === 'idempotency_key_invalid', describe(res));
                return describe(res);
            },
        },
        {
            id: 'import/key-conflict',
            what: 'Тот же ключ с другим телом (сценарий 13)',
            expect: '409 idempotency_key_conflict, хранилище не изменилось',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const k = key();
                const first = await api.postJson(IMPORT, batch(3), { headers: { 'Idempotency-Key': k } });
                expect(first.status === 200, describe(first));
                const before = storage.fingerprint();
                const res = await api.postJson(IMPORT, batch(4), { headers: { 'Idempotency-Key': k } });
                expect(res.status === 409, describe(res));
                expect(res.json?.error?.code === 'idempotency_key_conflict', describe(res));
                expect(storage.fingerprint() === before, `${describe(res)}, но хранилище изменилось`);
                return `${describe(res)}, хранилище не изменилось`;
            },
        },
        {
            id: 'import/too-many-notes',
            what: 'Пачка из 201 заметки (сценарий 18)',
            expect: '413 import_too_large, проверка срабатывает до разбора содержимого',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const payload = batch(201, (i) => (i === 200 ? { titel: 'мусор' } : { title: `Заметка ${i}` }));
                const res = await api.postJson(IMPORT, payload, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 413, describe(res));
                expect(res.json?.error?.code === 'import_too_large', describe(res));
                expect(storage.count() === 0, `413, но в хранилище ${storage.count()} записей`);
                return `${describe(res)}, ничего не записано`;
            },
        },
        {
            id: 'import/two-hundred-ok',
            what: 'Пачка ровно из 200 заметок',
            expect: '200: 200 — допустимая граница, 201-я лишняя',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, batch(200), { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                expect(res.json?.imported === 200, `imported=${short(res.json?.imported)}`);
                return `200, imported=200`;
            },
        },
        {
            id: 'import/body-too-large',
            what: 'Тело импорта размером больше 2 МБ',
            expect: '413 import_too_large',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const filler = 'я'.repeat(9000);
                const payload = { notes: Array.from({ length: 150 }, (_, i) => ({ title: `Заметка ${i}`, body: filler })) };
                const raw = JSON.stringify(payload);
                expect(Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024, `тело получилось ${Buffer.byteLength(raw, 'utf8')} байт — меньше 2 МБ, проверка бессмысленна`);
                const res = await api.postJson(IMPORT, raw, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 413, describe(res));
                expect(res.json?.error?.code === 'import_too_large', describe(res));
                return `${describe(res)} на теле ${Buffer.byteLength(raw, 'utf8')} байт`;
            },
        },
        {
            id: 'import/unsupported-media-type',
            what: 'Импорт с Content-Type: text/plain (сценарий 19)',
            expect: '415 unsupported_media_type',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.request('POST', IMPORT, {
                    headers: { 'Content-Type': 'text/plain', Accept: 'application/json', 'Idempotency-Key': key() },
                    body: JSON.stringify(batch(1)),
                });
                expect(res.status === 415, describe(res));
                expect(res.json?.error?.code === 'unsupported_media_type', describe(res));
                return describe(res);
            },
        },
        {
            id: 'import/empty-batch',
            what: 'Импорт тела {"notes": []}',
            expect: '422 validation_failed: импорт нуля заметок — почти наверняка ошибка клиента',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, { notes: [] }, { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'validation_failed', describe(res));
                return describe(res);
            },
        },
        {
            id: 'import/malformed-file',
            what: 'Импорт файлом, содержимое которого не разбирается как JSON',
            expect: '400 malformed_json',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const part = multipart([{ name: 'file', filename: 'batch.json', contentType: 'application/json', value: '{"notes": [' }]);
                const res = await api.request('POST', IMPORT, {
                    headers: { ...part.headers, 'Idempotency-Key': key(), Accept: 'application/json' },
                    body: part.body,
                });
                expect(res.status === 400, describe(res));
                expect(res.json?.error?.code === 'malformed_json', describe(res));
                return describe(res);
            },
        },
        {
            id: 'import/rejections-leave-no-keys',
            what: 'Реестр ключей после серии отказов (нет ключа, короткий ключ, text/plain, пустая пачка, битый JSON)',
            expect: 'ни один отказ не создал записи в import_keys.json',
            needs: ['storage', 'import', 'keys'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                storage.writeKeysRaw('{}');
                await api.postJson(IMPORT, batch(1));
                await api.postJson(IMPORT, batch(1), { headers: { 'Idempotency-Key': 'abc' } });
                await api.request('POST', IMPORT, {
                    headers: { 'Content-Type': 'text/plain', 'Idempotency-Key': key(), Accept: 'application/json' },
                    body: '{}',
                });
                await api.postJson(IMPORT, { notes: [] }, { headers: { 'Idempotency-Key': key() } });
                await api.postJson(IMPORT, '{"notes":[', { headers: { 'Idempotency-Key': key() } });
                const registered = Object.keys(storage.keys());
                expect(registered.length === 0, `в реестре появились ключи: ${short(registered)}`);
                return 'реестр остался пустым после пяти отказов';
            },
        },
        {
            id: 'import/missing-storage-creates-file',
            what: 'Импорт при отсутствующем notes.json',
            expect: '200, файл создан, заметки записаны',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.remove();
                const res = await api.postJson(IMPORT, batch(2), { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                expect(storage.exists() && storage.count() === 2, `файл: ${short(storage.readRaw())}`);
                return `200, файл создан, записей: ${storage.count()}`;
            },
        },
        {
            id: 'import/corrupted-storage',
            what: 'Импорт при испорченном notes.json',
            expect: '500 storage_corrupted, содержимое файла после запроса совпадает с тем, что было до',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[{}] и мусор');
                const before = storage.readRaw();
                const res = await api.postJson(IMPORT, batch(2), { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 500, describe(res));
                expect(res.json?.error?.code === 'storage_corrupted', describe(res));
                expect(storage.readRaw() === before, `файл изменился: ${short(storage.readRaw())}`);
                return `${describe(res)}, файл не изменился`;
            },
        },
        {
            id: 'import/corrupted-keys-registry',
            what: 'Импорт при испорченном import_keys.json',
            expect: '500 internal_error (а не storage_corrupted), файл реестра не перезаписан',
            needs: ['storage', 'import', 'keys'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                storage.writeKeysRaw('{ это не json');
                const before = storage.readKeysRaw();
                try {
                    const res = await api.postJson(IMPORT, batch(1), { headers: { 'Idempotency-Key': key() } });
                    expect(res.status === 500, describe(res));
                    expect(res.json?.error?.code === 'internal_error', describe(res));
                    expect(storage.readKeysRaw() === before, `реестр перезаписан: ${short(storage.readKeysRaw())}`);
                    return `${describe(res)}, реестр не перезаписан`;
                } finally {
                    // Порча реестра — общее состояние на диске, а не приватное состояние
                    // этой проверки. Не восстановить его здесь значит подставить
                    // следующую по порядку проверку: найдено 2026-08-30 на живом
                    // прогоне слитого main — notes-format-unchanged падала по чужой
                    // вине, унаследовав битый реестр.
                    storage.removeKeys();
                }
            },
        },
        {
            id: 'import/notes-format-unchanged',
            what: 'Формат notes.json после импорта',
            expect: 'по-прежнему массив заметок с тем же набором полей, что до ДЗ №2',
            needs: ['storage', 'import'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson(IMPORT, batch(2), { headers: { 'Idempotency-Key': key() } });
                expect(res.status === 200, describe(res));
                const notes = storage.notes();
                expect(Array.isArray(notes) && notes.length === 2, `в файле: ${short(storage.readRaw())}`);
                const keys = Object.keys(notes[0]).sort().join(',');
                expect(keys === 'body,created_at,id,tags,title,updated_at', `набор полей: ${keys}`);
                return `200, массив из 2 записей, поля: ${keys}`;
            },
        },
        {
            id: 'import/registry-evicts-oldest',
            what: 'Импорт при 500 записях в реестре ключей',
            expect: 'вытеснена самая старая по created_at, самая новая на месте',
            needs: ['storage', 'import', 'keys'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const registry = {};
                for (let i = 0; i < 500; i += 1) {
                    const minute = String(i).padStart(4, '0');
                    registry[`seeded-key-${minute}`] = {
                        request_hash: `hash-${minute}`,
                        response: { imported: 0, rejected: 0, idempotent_replay: false, notes: [], errors: [] },
                        created_at: `2026-01-01T00:00:00Z`.replace('00:00:00', `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`),
                    };
                }
                storage.writeKeysRaw(JSON.stringify(registry, null, 2));
                const res = await api.postJson(IMPORT, batch(1), { headers: { 'Idempotency-Key': key('fresh') } });
                expect(res.status === 200, describe(res));
                const after = storage.keys();
                expect(after['seeded-key-0000'] === undefined, 'самая старая запись реестра осталась на месте');
                expect(after['seeded-key-0499'] !== undefined, 'вытеснена самая новая запись, а не самая старая');
                expect(Object.keys(after).length <= 500, `в реестре ${Object.keys(after).length} записей — потолок 500 не удержан`);
                return `200, самая старая запись вытеснена, в реестре ${Object.keys(after).length} записей`;
            },
        },
    ],
};
