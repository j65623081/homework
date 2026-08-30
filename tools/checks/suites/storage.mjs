import { expect, describe, short, canonical } from '../lib/assert.mjs';
import { note, MISSING_ID } from '../lib/fixtures.mjs';

/**
 * Раздел «Состояния» и «Что именно считается испорченным хранилищем».
 *
 * Все проверки работают с подменённым файлом: рабочий api/storage/app/notes.json
 * скрипт не открывает никогда (см. lib/storage.mjs).
 */
export default {
    group: 'storage',
    title: 'Состояния файла-хранилища',
    checks: [
        {
            id: 'storage/missing-file',
            what: 'GET /api/notes при отсутствующем файле-хранилище',
            expect: '200, data=[] — отсутствие файла это пустой список, а не ошибка',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.remove();
                const res = await api.get('/api/notes');
                expect(res.status === 200, describe(res));
                expect(canonical(res.json?.data) === '[]', `data=${short(res.json?.data)}`);
                return `200, data=[], meta.total=${res.json?.meta?.total}`;
            },
        },
        {
            id: 'storage/missing-file-post-creates',
            what: 'POST /api/notes при отсутствующем файле-хранилище',
            expect: '201 и файл создан',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.remove();
                const res = await api.postJson('/api/notes', { title: 'Первая заметка' });
                expect(res.status === 201, describe(res));
                expect(storage.exists(), '201, но файл так и не создан');
                expect(storage.count() === 1, `файл создан, но записей ${storage.count()}`);
                return `201, файл создан, записей: ${storage.count()}`;
            },
        },
        {
            id: 'storage/empty-file',
            what: 'GET /api/notes при файле нулевой длины',
            expect: '200, data=[]',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('');
                const res = await api.get('/api/notes');
                expect(res.status === 200, describe(res));
                expect(canonical(res.json?.data) === '[]', `data=${short(res.json?.data)}`);
                return '200, data=[]';
            },
        },
        {
            id: 'storage/empty-array',
            what: 'GET /api/notes при файле с содержимым []',
            expect: '200, data=[], meta.total=0',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[]');
                const res = await api.get('/api/notes');
                expect(res.status === 200 && res.json?.meta?.total === 0, describe(res));
                return '200, data=[], meta.total=0';
            },
        },
        {
            id: 'storage/corrupted-garbage',
            what: 'GET /api/notes при дописанном в файл мусоре (сценарий 10)',
            expect: '500 storage_corrupted, содержимое файла после запроса совпадает с тем, что было до',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[{"id":"11111111-1111-4111-8111-111111111111"}] мусор');
                const before = storage.fingerprint();
                const res = await api.get('/api/notes');
                expect(res.status === 500, describe(res));
                expect(res.json?.error?.code === 'storage_corrupted', describe(res));
                const after = storage.fingerprint();
                expect(before === after, `${describe(res)}, но файл изменился: ${before} → ${after}`);
                return `${describe(res)}, файл не изменился (sha256 ${after})`;
            },
        },
        {
            id: 'storage/corrupted-top-level-object',
            what: 'GET /api/notes при хранилище вида {"notes":[]} — на верхнем уровне не список',
            expect: '500 storage_corrupted',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('{"notes":[]}');
                const res = await api.get('/api/notes');
                expect(res.status === 500 && res.json?.error?.code === 'storage_corrupted', describe(res));
                return describe(res);
            },
        },
        {
            id: 'storage/corrupted-scalars',
            what: 'GET /api/notes при хранилище вида [1,2,3]',
            expect: '500 storage_corrupted, а не internal_error',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[1,2,3]');
                const res = await api.get('/api/notes');
                expect(res.status === 500, describe(res));
                expect(res.json?.error?.code === 'storage_corrupted', describe(res));
                return describe(res);
            },
        },
        {
            id: 'storage/corrupted-empty-object',
            what: 'GET /api/notes при хранилище вида [{}]',
            expect: '500 storage_corrupted, а не 200 с заметкой id: null',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[{}]');
                const res = await api.get('/api/notes');
                expect(res.status === 500, describe(res));
                expect(res.json?.error?.code === 'storage_corrupted', describe(res));
                return describe(res);
            },
        },
        {
            id: 'storage/corrupted-post-does-not-append',
            what: 'POST /api/notes с корректным телом на хранилище [{}]',
            expect: '500 storage_corrupted и заметка в файл не дописана',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[{}]');
                const before = storage.fingerprint();
                const res = await api.postJson('/api/notes', { title: 'Заметка на битое хранилище' });
                expect(res.status === 500, describe(res));
                expect(res.json?.error?.code === 'storage_corrupted', describe(res));
                const after = storage.fingerprint();
                expect(before === after, `${describe(res)}, но файл изменился: ${storage.readRaw()}`);
                return `${describe(res)}, файл не изменился: ${storage.readRaw()}`;
            },
        },
        {
            id: 'storage/id-only-record-is-valid',
            what: 'GET /api/notes при хранилище вида [{"id":"..."}] без остальных полей',
            expect: '200, title и body — пустые строки, tags — пустой список',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[{"id":"11111111-1111-4111-8111-111111111111"}]');
                const res = await api.get('/api/notes');
                expect(res.status === 200, describe(res));
                const item = res.json?.data?.[0] ?? {};
                expect(item.title === '' && item.body === '' && canonical(item.tags) === '[]', `data[0]=${short(item)}`);
                return `200, data[0]={title:"", body:"", tags:[]}, created_at=${short(item.created_at, 30)}`;
            },
        },
        {
            id: 'storage/corrupted-invalid-post-is-422',
            what: 'POST /api/notes без title на испорченное хранилище',
            expect: '422, а не 500: тело валидируется до чтения хранилища',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[{"id":1}] и мусор');
                const res = await api.postJson('/api/notes', { body: 'без заголовка' });
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'validation_failed', describe(res));
                return describe(res);
            },
        },
        {
            id: 'storage/corrupted-invalid-query-is-422',
            what: 'GET /api/notes?limit=-1 на испорченное хранилище',
            expect: '422, а не 500: параметры валидируются до чтения хранилища',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('не json вовсе');
                const res = await api.get('/api/notes?limit=-1');
                expect(res.status === 422, describe(res));
                expect(res.json?.error?.code === 'validation_failed', describe(res));
                return describe(res);
            },
        },
        {
            id: 'storage/corrupted-show-is-500',
            what: 'GET /api/notes/{id} на испорченное хранилище',
            expect: '500 storage_corrupted, а не 404',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('[[]]');
                const res = await api.get(`/api/notes/${MISSING_ID}`);
                expect(res.status === 500 && res.json?.error?.code === 'storage_corrupted', describe(res));
                return describe(res);
            },
        },
        {
            id: 'storage/corrupted-delete-does-not-truncate',
            what: 'DELETE /api/notes/{id} на испорченное хранилище',
            expect: '500 storage_corrupted и файл не перезаписан',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeRaw('["строка вместо объекта"]');
                const before = storage.readRaw();
                const res = await api.del(`/api/notes/${MISSING_ID}`);
                expect(res.status === 500 && res.json?.error?.code === 'storage_corrupted', describe(res));
                expect(storage.readRaw() === before, `файл изменился: ${short(storage.readRaw())}`);
                return `${describe(res)}, файл не изменился`;
            },
        },
        {
            id: 'storage/format-stays-array',
            what: 'Формат файла после POST',
            expect: 'на верхнем уровне массив заметок с полями id, title, body, tags, created_at, updated_at',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([note()]);
                const res = await api.postJson('/api/notes', { title: 'Ещё одна', tags: ['дом'] });
                expect(res.status === 201, describe(res));
                const notes = storage.notes();
                expect(Array.isArray(notes) && notes.length === 2, `в файле ${short(storage.readRaw())}`);
                const stored = notes.find((n) => n.id === res.json.data.id);
                expect(stored !== undefined, `созданной заметки нет в файле: ${short(storage.readRaw())}`);
                const keys = Object.keys(stored).sort().join(',');
                expect(keys === 'body,created_at,id,tags,title,updated_at', `набор полей: ${keys}`);
                return `201, в файле массив из 2 записей, поля: ${keys}`;
            },
        },
    ],
};
