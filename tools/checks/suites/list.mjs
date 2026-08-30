import { expect, describe, short, canonical } from '../lib/assert.mjs';
import { note, series } from '../lib/fixtures.mjs';

/**
 * `GET /api/notes` — фильтры, границы, сортировка и meta.
 * Эндпоинт 1 из «Контракт API», сценарии 2, 3, 8.
 */
export default {
    group: 'list',
    title: 'Список с фильтром',
    checks: [
        {
            id: 'list/defaults',
            what: 'GET /api/notes без параметров',
            expect: '200, meta.limit=20, meta.offset=0, meta.total — число всех записей',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes(series(3));
                const res = await api.get('/api/notes');
                expect(res.status === 200, describe(res));
                expect(res.json?.meta?.limit === 20, `meta=${short(res.json?.meta)}`);
                expect(res.json?.meta?.offset === 0, `meta=${short(res.json?.meta)}`);
                expect(res.json?.meta?.total === 3, `meta=${short(res.json?.meta)}`);
                return `200, meta=${JSON.stringify(res.json.meta)}`;
            },
        },
        {
            id: 'list/tag-filter',
            what: 'GET /api/notes?tag=работа&limit=5 при семи заметках с этим тегом (сценарий 2)',
            expect: '200, data — 5 заметок, meta.total = 7 (total считается до limit/offset)',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([...series(7, () => ({ tags: ['работа'] })), note({ tags: ['дом'], created_at: '2026-08-15T10:00:00Z' })]);
                const res = await api.get('/api/notes?tag=' + encodeURIComponent('работа') + '&limit=5');
                expect(res.status === 200, describe(res));
                expect(res.json?.data?.length === 5, `data.length=${res.json?.data?.length}`);
                expect(res.json?.meta?.total === 7, `meta=${short(res.json?.meta)}`);
                return `200, data.length=5, meta=${JSON.stringify(res.json.meta)}`;
            },
        },
        {
            id: 'list/tag-normalized-compare',
            what: 'GET /api/notes?tag=%20Работа%20 — сравнение по нормализованному значению',
            expect: '200 и заметка с тегом "работа" находится',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([note({ tags: ['работа'] })]);
                const res = await api.get('/api/notes?tag=' + encodeURIComponent(' Работа '));
                expect(res.status === 200, describe(res));
                expect(res.json?.meta?.total === 1, `${res.status}, meta=${short(res.json?.meta)}`);
                return `200, meta.total=${res.json.meta.total}`;
            },
        },
        {
            id: 'list/tag-no-match',
            what: 'GET /api/notes?tag=отпуск при отсутствии таких заметок (сценарий 3)',
            expect: '200, data=[], meta.total=0',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes(series(3, () => ({ tags: ['работа'] })));
                const res = await api.get('/api/notes?tag=' + encodeURIComponent('отпуск'));
                expect(res.status === 200, describe(res));
                expect(canonical(res.json?.data) === '[]', `data=${short(res.json?.data)}`);
                expect(res.json?.meta?.total === 0, `meta=${short(res.json?.meta)}`);
                return `200, data=[], meta.total=0`;
            },
        },
        {
            id: 'list/q-substring',
            what: 'GET /api/notes?q=ХЛЕБ и ?q=МОЛОКО — подстрока в title и в body, регистронезависимо',
            expect: 'оба запроса дают 200 и находят заметку',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([note({ title: 'Купить хлеб', body: 'и молоко' }), note({ title: 'Совещание', body: 'в четверг' })]);
                const byTitle = await api.get('/api/notes?q=' + encodeURIComponent('ХЛЕБ'));
                expect(byTitle.status === 200 && byTitle.json?.meta?.total === 1, `по title: ${describe(byTitle)}`);
                const byBody = await api.get('/api/notes?q=' + encodeURIComponent('МОЛОКО'));
                expect(byBody.status === 200 && byBody.json?.meta?.total === 1, `по body: ${describe(byBody)}`);
                return `200 и 200, total=1 в обоих случаях`;
            },
        },
        {
            id: 'list/sort-order',
            what: 'GET /api/notes — порядок при одинаковом created_at',
            expect: 'created_at по убыванию, при равенстве — id по возрастанию',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const same = '2026-08-16T10:00:00Z';
                const older = '2026-08-15T10:00:00Z';
                const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
                storage.writeNotes([
                    note({ id: ids[2], created_at: same, updated_at: same }),
                    note({ id: ids[0], created_at: same, updated_at: same }),
                    note({ id: ids[1], created_at: older, updated_at: older }),
                ]);
                const res = await api.get('/api/notes');
                expect(res.status === 200, describe(res));
                const got = res.json.data.map((n) => n.id);
                const want = [ids[0], ids[2], ids[1]];
                expect(canonical(got) === canonical(want), `порядок ${short(got)}`);
                return `200, порядок: свежие раньше, при равном created_at id по возрастанию`;
            },
        },
        {
            id: 'list/offset-beyond',
            what: 'GET /api/notes?offset=9999 при непустом хранилище',
            expect: '200, data=[], meta.total — реальное число записей',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes(series(3));
                const res = await api.get('/api/notes?offset=9999');
                expect(res.status === 200, describe(res));
                expect(canonical(res.json?.data) === '[]', `data=${short(res.json?.data)}`);
                expect(res.json?.meta?.total === 3, `meta=${short(res.json?.meta)}`);
                return `200, data=[], meta.total=3`;
            },
        },
        {
            id: 'list/offset-huge',
            what: 'GET /api/notes?offset=999999999999999999999',
            expect: '200, а не 422 — верхней границы у offset сознательно нет',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes(series(2));
                const res = await api.get('/api/notes?offset=999999999999999999999');
                expect(res.status === 200, describe(res));
                return `200, data.length=${res.json?.data?.length}, meta.total=${res.json?.meta?.total}`;
            },
        },
        ...['-1', '0', '101', 'abc'].map((value) => ({
            id: `list/limit-${value}`,
            what: `GET /api/notes?limit=${value}`,
            expect: '422, code=validation_failed, в fields есть limit',
            run: async ({ api }) => {
                const res = await api.get(`/api/notes?limit=${encodeURIComponent(value)}`);
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'validation_failed', describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('limit'), describe(res));
                return describe(res);
            },
        })),
        ...['-1', 'abc'].map((value) => ({
            id: `list/offset-${value}`,
            what: `GET /api/notes?offset=${value}`,
            expect: '422, code=validation_failed, в fields есть offset',
            run: async ({ api }) => {
                const res = await api.get(`/api/notes?offset=${encodeURIComponent(value)}`);
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'validation_failed', describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('offset'), describe(res));
                return describe(res);
            },
        })),
        {
            id: 'list/limit-boundaries-ok',
            what: 'GET /api/notes?limit=1 и ?limit=100 — границы допустимого',
            expect: 'оба 200',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes(series(3));
                const low = await api.get('/api/notes?limit=1');
                expect(low.status === 200 && low.json?.data?.length === 1, `limit=1: ${describe(low)}`);
                const high = await api.get('/api/notes?limit=100');
                expect(high.status === 200, `limit=100: ${describe(high)}`);
                return `200 (data.length=1) и 200 (data.length=${high.json.data.length})`;
            },
        },
        {
            // Решение человека, шаг 5 ДЗ №2 (2026-08-30): правило "неизвестные поля
            // отклоняются" относится к телу запроса, не к query-строке. SPEC.md уточнён
            // явно. До правки тест ожидал 422 unknown_fields и был снят с прогона по FAIL —
            // расхождение оказалось не дефектом сервиса, а недосказанностью спеки.
            id: 'list/unknown-query-param',
            what: 'GET /api/notes?sort=title — параметра в контракте нет',
            expect: '200: query-параметры вне контракта игнорируются, а не отклоняются',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes(series(2));
                const res = await api.get('/api/notes?sort=title');
                expect(res.status === 200, describe(res));
                expect(Array.isArray(res.json?.data) && res.json.data.length === 2, describe(res));
                return describe(res);
            },
        },
    ],
};
