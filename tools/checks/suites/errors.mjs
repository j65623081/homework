import { expect, describe, short } from '../lib/assert.mjs';

/** Закрытый перечень кодов из раздела «Формат ошибки». */
export const ALLOWED_CODES = new Set([
    'malformed_json',
    'validation_failed',
    'unknown_fields',
    'not_found',
    'storage_corrupted',
    'internal_error',
    'unsupported_media_type',
    'import_too_large',
    'idempotency_key_invalid',
    'idempotency_key_conflict',
]);

/**
 * Признаки утечки внутренностей наружу.
 *
 * Критерий приёмки: «Ни один ответ об ошибке не содержит трассировки стека,
 * пути к файлу на диске или имени класса». Проверяется не отдельным запросом,
 * а по всем ответам 4xx/5xx, собранным за прогон, — иначе легко проверить
 * один эндпоинт и пропустить остальные.
 */
const LEAKS = [
    { name: 'трассировка стека', re: /"trace"|#\d+\s+\/|#\d+\s+[A-Za-z]:\\/ },
    { name: 'путь к файлу на диске', re: /[A-Za-z]:\\\\?[\w.\\-]+|\/(?:var|home|usr)\/[\w./-]+|\bvendor[\\/]|\bapp[\\/]Http[\\/]/ },
    { name: 'имя PHP-файла', re: /\w+\.php\b/ },
    { name: 'имя класса или пространства имён', re: /\b(?:App|Illuminate|Symfony)\\{1,2}\w+|Exception\b|::class/ },
];

export default {
    group: 'errors',
    title: 'Единый формат ошибки',
    checks: [
        {
            id: 'errors/shape',
            what: 'Форма тела ошибки на 400, 404 и 422',
            expect: 'ровно {"error":{"code","message"[,"fields"]}}, code из закрытого перечня',
            needs: ['storage'],
            run: async ({ api, storage }) => {
                storage.writeNotes([]);
                const samples = [
                    await api.postJson('/api/notes', '{"title"'),
                    await api.get('/api/notes/00000000-0000-4000-8000-000000000000'),
                    await api.postJson('/api/notes', { body: 'без title' }),
                ];
                const seen = [];
                for (const res of samples) {
                    const err = res.json?.error;
                    expect(err !== undefined && err !== null, `${res.status}: тело ${short(res.text)}`);
                    expect(typeof err.code === 'string' && typeof err.message === 'string', `${res.status}: error=${short(err)}`);
                    expect(ALLOWED_CODES.has(err.code), `${res.status}: код ${err.code} вне закрытого перечня`);
                    const extra = Object.keys(res.json).filter((k) => k !== 'error');
                    expect(extra.length === 0, `${res.status}: рядом с error лишние ключи ${extra.join(',')}`);
                    const inner = Object.keys(err).filter((k) => !['code', 'message', 'fields'].includes(k));
                    expect(inner.length === 0, `${res.status}: в error лишние ключи ${inner.join(',')}`);
                    seen.push(`${res.status} ${err.code}`);
                }
                return seen.join('; ');
            },
        },
        {
            id: 'errors/no-fields-on-header-errors',
            what: 'Ответ 404 not_found — есть ли в нём fields',
            expect: 'fields отсутствует: ошибка не привязана к полю тела',
            run: async ({ api }) => {
                const res = await api.get('/api/notes/00000000-0000-4000-8000-000000000000');
                expect(res.status === 404, describe(res));
                expect(res.json?.error?.fields === undefined, `fields=${short(res.json?.error?.fields)}`);
                return '404 not_found, fields отсутствует';
            },
        },
        {
            id: 'errors/no-internals-leaked',
            what: 'Все ответы 4xx/5xx, собранные за этот прогон',
            expect: 'ни трассировки стека, ни пути на диске, ни имени класса',
            run: async ({ recorded }) => {
                const errors = recorded.filter((r) => r.status >= 400);
                expect(errors.length > 0, 'за прогон не было ни одного ответа 4xx/5xx — проверять нечего');
                for (const res of errors) {
                    for (const leak of LEAKS) {
                        if (leak.re.test(res.text)) {
                            expect(false, `${res.method} ${res.path} → ${res.status}: ${leak.name} в теле: ${short(res.text)}`);
                        }
                    }
                }
                return `проверено ответов: ${errors.length}, утечек не найдено`;
            },
        },
        {
            id: 'errors/codes-are-closed-set',
            what: 'Коды всех ошибок, собранных за этот прогон',
            expect: 'каждый код — из закрытого перечня SPEC.md',
            run: async ({ recorded }) => {
                const codes = new Set();
                for (const res of recorded.filter((r) => r.status >= 400)) {
                    const code = res.json?.error?.code;
                    if (typeof code === 'string') {
                        codes.add(code);
                    }
                }
                const unknown = [...codes].filter((c) => !ALLOWED_CODES.has(c));
                expect(unknown.length === 0, `коды вне перечня: ${unknown.join(', ')}`);
                return `встретились коды: ${[...codes].sort().join(', ') || '<нет>'}`;
            },
        },
    ],
};
