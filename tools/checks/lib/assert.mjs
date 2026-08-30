/**
 * Мини-набор утверждений для проверок живого прогона.
 *
 * Своя реализация, а не node:assert, по одной причине: каждой проверке нужно
 * напечатать строку «ждали X, получили Y». node:assert умеет только бросить
 * ошибку, а нам нужно вернуть человеческое описание факта даже при успехе.
 */

/** Расхождение с контрактом. Несёт с собой описание того, что получили на самом деле. */
export class CheckFailure extends Error {
    constructor(got) {
        super(got);
        this.name = 'CheckFailure';
        this.got = got;
    }
}

/** Ошибка окружения: стенд не поднят, подмена хранилища не работает и т. п. */
export class SetupError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SetupError';
    }
}

/** Если условие не выполнено — расхождение с описанием факта. */
export function expect(condition, got) {
    if (!condition) {
        throw new CheckFailure(got);
    }
}

/** Безусловное расхождение. */
export function fail(got) {
    throw new CheckFailure(got);
}

/** Короткое описание ответа сервиса для колонки «получили». */
export function describe(res) {
    const code = res.json?.error?.code;
    if (code) {
        const fields = res.json.error.fields ? Object.keys(res.json.error.fields) : null;
        return `${res.status} ${code}` + (fields ? ` fields=[${fields.join(',')}]` : ' без fields');
    }
    if (res.json === null && res.text.length > 0) {
        return `${res.status}, тело не JSON: ${short(res.text)}`;
    }
    return `${res.status} ${short(JSON.stringify(res.json))}`;
}

/** Обрезка длинных значений, чтобы строка отчёта осталась строкой. */
export function short(value, limit = 160) {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (s === undefined) {
        return 'undefined';
    }
    return s.length > limit ? `${s.slice(0, limit)}…(${s.length} симв.)` : s;
}

/** Глубокое сравнение без внешних зависимостей: сериализация с сортировкой ключей. */
export function canonical(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'undefined';
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function deepEqual(a, b) {
    return canonical(a) === canonical(b);
}
