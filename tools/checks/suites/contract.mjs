import { expect, describe, short } from '../lib/assert.mjs';
import { note } from '../lib/fixtures.mjs';

/**
 * Правила из раздела «Модель данных» и «Нормализация тегов».
 *
 * В списке критериев приёмки их нет поимённо, но это часть контракта, и живой
 * прогон — единственное место, где они проверяются на настоящем стенде.
 */
export default {
    group: 'contract',
    title: 'Модель данных и нормализация тегов',
    checks: [
        {
            id: 'contract/title-blank',
            what: 'POST /api/notes с title из одних пробелов',
            expect: '422: после trim длина должна быть от 1 до 200',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: '   ' });
                expect(res.status === 422, describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('title'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'contract/title-201-chars',
            what: 'POST /api/notes с title длиной 201 символ',
            expect: '422 с указанием title',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'я'.repeat(201) });
                expect(res.status === 422, describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('title'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'contract/title-200-chars-ok',
            what: 'POST /api/notes с title длиной ровно 200 символов',
            expect: '201: 200 — допустимая граница',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'я'.repeat(200) });
                expect(res.status === 201, describe(res));
                return `201, title длиной ${res.json.data.title.length}`;
            },
        },
        {
            id: 'contract/body-too-long',
            what: 'POST /api/notes с body длиной 10 001 символ',
            expect: '422 с указанием body (потолок — 10 000)',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'Заметка', body: 'a'.repeat(10001) });
                expect(res.status === 422, describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('body'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'contract/tags-limit-before-dedup',
            what: 'POST /api/notes с 11 одинаковыми тегами',
            expect: '422: потолок в 10 тегов считается до дедупликации',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'Заметка', tags: Array(11).fill('работа') });
                expect(res.status === 422, describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).some((f) => f.startsWith('tags')), describe(res));
                return describe(res);
            },
        },
        {
            id: 'contract/tags-ten-ok',
            what: 'POST /api/notes с 10 разными тегами',
            expect: '201: десять — допустимая граница',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const tags = Array.from({ length: 10 }, (_, i) => `тег${i}`);
                const res = await api.postJson('/api/notes', { title: 'Заметка', tags });
                expect(res.status === 201, describe(res));
                expect(res.json?.data?.tags?.length === 10, `tags.length=${res.json?.data?.tags?.length}`);
                return `201, tags.length=10`;
            },
        },
        {
            id: 'contract/tag-too-long',
            what: 'POST /api/notes с тегом длиной 31 символ',
            expect: '422: длина тега после нормализации — от 1 до 30',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'Заметка', tags: ['т'.repeat(31)] });
                expect(res.status === 422, describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('tags.0'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'contract/put-normalizes-tags',
            what: 'PUT /api/notes/{id} с тегами ["Дом"," дом ","Работа"]',
            expect: '200 и tags = ["дом","работа"] — нормализация та же, что при POST',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const existing = note();
                storage.writeNotes([existing]);
                const res = await api.putJson(`/api/notes/${existing.id}`, { title: 'Заметка', tags: ['Дом', ' дом ', 'Работа'] });
                expect(res.status === 200, describe(res));
                expect(JSON.stringify(res.json?.data?.tags) === JSON.stringify(['дом', 'работа']), `tags=${short(res.json?.data?.tags)}`);
                return `200, tags=${JSON.stringify(res.json.data.tags)}`;
            },
        },
        {
            id: 'contract/created-at-immutable',
            what: 'PUT /api/notes/{id} — что стало с created_at',
            expect: '200 и created_at тот же, что был до обновления',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const existing = note({ created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z' });
                storage.writeNotes([existing]);
                const res = await api.putJson(`/api/notes/${existing.id}`, { title: 'Изменённый' });
                expect(res.status === 200, describe(res));
                expect(res.json?.data?.created_at === existing.created_at, `created_at=${short(res.json?.data?.created_at)}`);
                expect(res.json?.data?.updated_at !== existing.updated_at, `updated_at не изменился: ${short(res.json?.data?.updated_at)}`);
                return `200, created_at=${res.json.data.created_at} (не изменился), updated_at=${res.json.data.updated_at}`;
            },
        },
        {
            id: 'contract/response-content-type',
            what: 'Заголовок Content-Type ответа GET /api/notes',
            expect: 'application/json с указанием charset=utf-8 («Контракт API»)',
            needs: ['storage'],
            interpretation: 'спека говорит «Тело запроса и ответа — application/json; charset=utf-8»; ' +
                'считается ли charset обязательным в заголовке, прямо не сказано',
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.get('/api/notes');
                expect(res.status === 200, describe(res));
                const ct = res.headers['content-type'] ?? '<нет заголовка>';
                expect(/application\/json/i.test(ct) && /charset=utf-8/i.test(ct), `Content-Type: ${ct}`);
                return `200, Content-Type: ${ct}`;
            },
        },
    ],
};
