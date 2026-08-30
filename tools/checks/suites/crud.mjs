import { expect, describe, short, canonical } from '../lib/assert.mjs';
import { UUID_V4, ISO_UTC, MISSING_ID, note, uuid } from '../lib/fixtures.mjs';

/**
 * Создание, чтение, обновление и удаление — эндпоинты 1–5 из «Контракт API»
 * и сценарии 1, 4, 5, 6, 7, 9 из «Сценарии».
 */
export default {
    group: 'crud',
    title: 'Создание, чтение, обновление, удаление',
    checks: [
        {
            id: 'crud/tags-normalized',
            what: 'POST /api/notes {"title":"Купить хлеб","tags":["Работа"," работа ","дом"]}',
            expect: '201, tags = ["работа","дом"]',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'Купить хлеб', tags: ['Работа', ' работа ', 'дом'] });
                expect(res.status === 201, describe(res));
                expect(canonical(res.json?.data?.tags) === canonical(['работа', 'дом']), `${res.status}, tags=${short(res.json?.data?.tags)}`);
                return `201, tags=${JSON.stringify(res.json.data.tags)}`;
            },
        },
        {
            id: 'crud/created-shape',
            what: 'POST /api/notes — форма созданной заметки',
            expect: 'id — UUID v4, created_at и updated_at — ISO 8601 UTC, body по умолчанию "", tags по умолчанию []',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'Только заголовок' });
                expect(res.status === 201, describe(res));
                const d = res.json?.data ?? {};
                expect(UUID_V4.test(d.id ?? ''), `id=${short(d.id)}`);
                expect(ISO_UTC.test(d.created_at ?? ''), `created_at=${short(d.created_at)}`);
                expect(ISO_UTC.test(d.updated_at ?? ''), `updated_at=${short(d.updated_at)}`);
                expect(d.body === '', `body=${short(d.body)}`);
                expect(canonical(d.tags) === '[]', `tags=${short(d.tags)}`);
                return `201, id=${d.id}, created_at=${d.created_at}, body="", tags=[]`;
            },
        },
        {
            id: 'crud/location-header',
            what: 'POST /api/notes — заголовок Location',
            expect: 'Location: /api/notes/{id} созданной заметки',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'С заголовком Location' });
                expect(res.status === 201, describe(res));
                const expected = `/api/notes/${res.json?.data?.id}`;
                expect(res.headers.location === expected, `Location=${short(res.headers.location ?? '<нет заголовка>')}`);
                return `201, Location=${res.headers.location}`;
            },
        },
        {
            id: 'crud/read-back',
            what: 'GET /api/notes/{id} сразу после создания (сценарий 1)',
            expect: '200 и те же данные, что вернул POST',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const created = await api.postJson('/api/notes', { title: 'Купить хлеб', body: 'молоко', tags: ['Работа', ' работа '] });
                expect(created.status === 201, describe(created));
                const res = await api.get(`/api/notes/${created.json.data.id}`);
                expect(res.status === 200, describe(res));
                expect(canonical(res.json?.data) === canonical(created.json.data), `200, но данные разошлись: ${short(res.json?.data)}`);
                return `200, тело совпало с ответом POST (tags=${JSON.stringify(res.json.data.tags)})`;
            },
        },
        {
            id: 'crud/cyrillic-verbatim',
            what: 'POST + GET с кириллицей и эмодзи в title и body',
            expect: '201/200, текст возвращается дословно (UTF-8 не портится)',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const title = 'Ёлка, «кавычки» и эмодзи 🌲';
                const body = 'Строка с переносом\nи табом\tвнутри — всё как есть';
                const created = await api.postJson('/api/notes', { title, body });
                expect(created.status === 201, describe(created));
                const res = await api.get(`/api/notes/${created.json.data.id}`);
                expect(res.status === 200, describe(res));
                expect(res.json?.data?.title === title, `title=${short(res.json?.data?.title)}`);
                expect(res.json?.data?.body === body, `body=${short(res.json?.data?.body)}`);
                return `200, title и body вернулись дословно: ${short(res.json.data.title, 40)}`;
            },
        },
        {
            id: 'crud/post-no-title',
            what: 'POST /api/notes без title',
            expect: '422, code=validation_failed, в fields есть title',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { body: 'без заголовка' });
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'validation_failed', describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('title'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/post-unknown-field',
            what: 'POST /api/notes с полем titel (сценарий 6)',
            expect: '422, code=unknown_fields, в fields есть titel',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { titel: 'опечатка' });
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'unknown_fields', describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('titel'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/post-empty-tag',
            what: 'POST /api/notes с tags ["ok","  "] (сценарий 7)',
            expect: '422 с указанием tags.1',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', { title: 'Заметка', tags: ['ok', '  '] });
                expect(res.status === 422, describe(res));
                expect(Object.keys(res.json?.error?.fields ?? {}).includes('tags.1'), describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/post-malformed-json',
            what: 'POST /api/notes с телом, которое не разбирается как JSON',
            expect: '400, code=malformed_json',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const res = await api.postJson('/api/notes', '{"title": "не закрыт"');
                expect(res.status === 400, describe(res));
                expect(res.json?.error?.code === 'malformed_json', describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/get-missing',
            what: 'GET /api/notes/{несуществующий id}',
            expect: '404, code=not_found',
            run: async ({ api }) => {
                const res = await api.get(`/api/notes/${MISSING_ID}`);
                expect(res.status === 404, describe(res));
                expect(res.json?.error?.code === 'not_found', describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/put-idempotent',
            what: 'PUT дважды подряд с тем же телом (сценарий 4)',
            expect: 'оба ответа 200 и побайтово равны, updated_at не сдвинулся',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const created = await api.postJson('/api/notes', { title: 'Исходный', tags: ['дом'] });
                expect(created.status === 201, describe(created));
                const id = created.json.data.id;
                const payload = { title: 'Новый заголовок', body: 'тело', tags: ['Работа'] };

                const first = await api.putJson(`/api/notes/${id}`, payload);
                expect(first.status === 200, describe(first));
                await new Promise((resolve) => setTimeout(resolve, 1100)); // чтобы сдвиг updated_at был заметен
                const second = await api.putJson(`/api/notes/${id}`, payload);
                expect(second.status === 200, describe(second));
                expect(first.text === second.text, `второй ответ отличается: ${short(second.text)}`);
                return `200 и 200, тела совпали побайтово, updated_at=${first.json.data.updated_at}`;
            },
        },
        {
            id: 'crud/put-missing-no-upsert',
            what: 'PUT /api/notes/{несуществующий id} (сценарий 5)',
            expect: '404, число записей в файле не изменилось',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([note(), note()]);
                const before = storage.count();
                const res = await api.putJson(`/api/notes/${MISSING_ID}`, { title: 'Создастся ли' });
                expect(res.status === 404, describe(res));
                expect(res.json?.error?.code === 'not_found', describe(res));
                const after = storage.count();
                expect(after === before, `404, но записей стало ${after} вместо ${before}`);
                return `${describe(res)}, записей было ${before}, стало ${after}`;
            },
        },
        {
            id: 'crud/put-malformed-json',
            what: 'PUT /api/notes/{id} с телом, которое не разбирается как JSON',
            expect: '400, code=malformed_json',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const existing = note();
                storage.writeNotes([existing]);
                const res = await api.putJson(`/api/notes/${existing.id}`, '{"title":');
                expect(res.status === 400, describe(res));
                expect(res.json?.error?.code === 'malformed_json', describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/put-immutable-fields',
            what: 'PUT /api/notes/{id} с полем id в теле',
            expect: '422 unknown_fields: id и created_at неизменяемы и в контракте тела PUT их нет',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const existing = note();
                storage.writeNotes([existing]);
                const res = await api.putJson(`/api/notes/${existing.id}`, { title: 'Подмена', id: uuid() });
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'unknown_fields', describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/delete-then-404',
            what: 'DELETE, затем повторный DELETE того же id (сценарий 9)',
            expect: '204 с пустым телом, затем 404 not_found',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const existing = note();
                storage.writeNotes([existing]);
                const first = await api.del(`/api/notes/${existing.id}`);
                expect(first.status === 204, describe(first));
                expect(first.text === '', `204, но тело не пустое: ${short(first.text)}`);
                const second = await api.del(`/api/notes/${existing.id}`);
                expect(second.status === 404, describe(second));
                expect(second.json?.error?.code === 'not_found', describe(second));
                return `204 (тело пустое), затем ${describe(second)}`;
            },
        },
        {
            id: 'crud/unsupported-method',
            what: 'PATCH /api/notes/{id} — метода в контракте нет',
            expect: '404 not_found (отдельный код для 405 сознательно не вводится)',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                const existing = note();
                storage.writeNotes([existing]);
                const res = await api.request('PATCH', `/api/notes/${existing.id}`, {
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ title: 'Через PATCH' }),
                });
                expect(res.status === 404, describe(res));
                expect(res.json?.error?.code === 'not_found', describe(res));
                return describe(res);
            },
        },
        {
            id: 'crud/unknown-route',
            what: 'GET /api/notes/{id}/history — маршрута в контракте нет',
            expect: '404 not_found в едином формате ошибки',
            run: async ({ api }) => {
                const res = await api.get(`/api/notes/${MISSING_ID}/history`);
                expect(res.status === 404, describe(res));
                expect(res.json?.error?.code === 'not_found', describe(res));
                return describe(res);
            },
        },
    ],
};
