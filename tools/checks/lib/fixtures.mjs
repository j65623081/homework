import crypto from 'node:crypto';

/** UUID v4 — формат `id` из SPEC.md, «Модель данных». */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO 8601, UTC, с `Z` на конце. Дробные доли секунды спекой не запрещены. */
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** UUID, которого заведомо нет в хранилище. */
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

export function uuid() {
    return crypto.randomUUID();
}

/** Готовая запись для прямой укладки в файл-хранилище, минуя API. */
export function note(overrides = {}) {
    return {
        id: uuid(),
        title: 'Заметка',
        body: '',
        tags: [],
        created_at: '2026-08-16T10:00:00Z',
        updated_at: '2026-08-16T10:00:00Z',
        ...overrides,
    };
}

/** Пачка из n заметок с убывающими метками времени: первая — самая свежая. */
export function series(n, overrides = () => ({})) {
    return Array.from({ length: n }, (_, i) => {
        const minute = String(59 - i).padStart(2, '0');
        return note({ title: `Заметка ${i + 1}`, created_at: `2026-08-16T10:${minute}:00Z`, updated_at: `2026-08-16T10:${minute}:00Z`, ...overrides(i) });
    });
}
