import { ApiError, validationFailed, badRequest } from './errors.js';

export const LIMITS = {
  TITLE_MAX: 200,
  CONTENT_MAX: 10000,
  TAG_MAX: 32,
  TAGS_MAX: 20,
  PAGE_LIMIT_MAX: 100,
  PAGE_LIMIT_DEFAULT: 20,
};

// Тег после нормализации: буквы (в т.ч. не-латиница), цифры, дефис, подчёркивание, точка.
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

/**
 * Нормализация одного тега:
 *  - обрезаем пробелы по краям;
 *  - схлопываем внутренние пробелы и заменяем их на дефис ("todo  list" -> "todo-list");
 *  - приводим к нижнему регистру, чтобы "Work" и "work" были одним тегом;
 *  - NFC-нормализация Unicode, чтобы "ё" в двух разных кодировках не давало два тега.
 * Возвращает '' для пустых/пробельных значений — вызывающий код их отбрасывает.
 */
export function normalizeTag(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/**
 * Нормализация списка тегов: чистка, отбрасывание пустых, дедупликация
 * с сохранением порядка первого появления.
 */
export function normalizeTags(rawTags, errors, field = 'tags') {
  if (!Array.isArray(rawTags)) {
    errors.push({ field, message: 'must be an array of strings' });
    return [];
  }
  if (rawTags.length > LIMITS.TAGS_MAX) {
    errors.push({ field, message: `must contain at most ${LIMITS.TAGS_MAX} tags` });
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const [i, raw] of rawTags.entries()) {
    if (typeof raw !== 'string') {
      errors.push({ field: `${field}[${i}]`, message: 'must be a string' });
      continue;
    }
    const tag = normalizeTag(raw);
    if (tag === '') continue; // пустые и пробельные теги просто выбрасываем, это не ошибка
    if (tag.length > LIMITS.TAG_MAX) {
      errors.push({ field: `${field}[${i}]`, message: `must be at most ${LIMITS.TAG_MAX} characters` });
      continue;
    }
    if (!TAG_RE.test(tag)) {
      errors.push({
        field: `${field}[${i}]`,
        message: 'must start with a letter or digit and contain only letters, digits, ".", "_", "-"',
      });
      continue;
    }
    if (seen.has(tag)) continue; // дубликаты тихо схлопываем
    seen.add(tag);
    result.push(tag);
  }

  return result;
}

function validateTitle(value, errors, required) {
  if (value === undefined) {
    if (required) errors.push({ field: 'title', message: 'is required' });
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ field: 'title', message: 'must be a string' });
    return undefined;
  }
  const title = value.trim();
  if (title === '') {
    errors.push({ field: 'title', message: 'must not be empty' });
    return undefined;
  }
  if (title.length > LIMITS.TITLE_MAX) {
    errors.push({ field: 'title', message: `must be at most ${LIMITS.TITLE_MAX} characters` });
    return undefined;
  }
  return title;
}

function validateContent(value, errors) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    errors.push({ field: 'content', message: 'must be a string' });
    return undefined;
  }
  if (value.length > LIMITS.CONTENT_MAX) {
    errors.push({ field: 'content', message: `must be at most ${LIMITS.CONTENT_MAX} characters` });
    return undefined;
  }
  return value;
}

function assertObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object');
  }
}

const KNOWN_FIELDS = new Set(['title', 'content', 'tags']);

function rejectUnknown(body, errors) {
  for (const key of Object.keys(body)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push({ field: key, message: 'is not a recognised field' });
    }
  }
}

/** Полезная нагрузка для POST /notes и PUT /notes/:id (полная замена). */
export function parseFullNote(body) {
  assertObject(body);
  const errors = [];
  rejectUnknown(body, errors);

  const title = validateTitle(body.title, errors, true);
  const content = validateContent(body.content, errors);
  const tags = body.tags === undefined ? [] : normalizeTags(body.tags, errors);

  if (errors.length > 0) throw validationFailed(errors);
  return { title, content, tags };
}

/** Полезная нагрузка для PATCH /notes/:id (частичное обновление). */
export function parsePartialNote(body) {
  assertObject(body);
  const errors = [];
  rejectUnknown(body, errors);

  const patch = {};
  if (body.title !== undefined) patch.title = validateTitle(body.title, errors, false);
  if (body.content !== undefined) patch.content = validateContent(body.content, errors);
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags, errors);

  if (errors.length > 0) throw validationFailed(errors);
  if (Object.keys(patch).length === 0) {
    throw validationFailed([{ field: 'body', message: 'must contain at least one of: title, content, tags' }]);
  }
  return patch;
}

/** Разбор query-параметров списка заметок. */
export function parseListQuery(searchParams) {
  const errors = [];

  const limit = parseIntParam(searchParams.get('limit'), LIMITS.PAGE_LIMIT_DEFAULT, 1, LIMITS.PAGE_LIMIT_MAX, 'limit', errors);
  const offset = parseIntParam(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER, 'offset', errors);

  // tag можно указывать несколько раз: ?tag=work&tag=urgent
  const tags = [];
  for (const raw of searchParams.getAll('tag')) {
    const tag = normalizeTag(raw);
    if (tag !== '') tags.push(tag);
  }

  const matchRaw = (searchParams.get('match') || 'all').toLowerCase();
  if (!['all', 'any'].includes(matchRaw)) {
    errors.push({ field: 'match', message: 'must be "all" or "any"' });
  }

  const q = (searchParams.get('q') || '').trim();

  const sortRaw = (searchParams.get('sort') || '-createdAt');
  const allowedSorts = ['createdAt', '-createdAt', 'updatedAt', '-updatedAt', 'title', '-title'];
  if (!allowedSorts.includes(sortRaw)) {
    errors.push({ field: 'sort', message: `must be one of: ${allowedSorts.join(', ')}` });
  }

  if (errors.length > 0) throw new ApiError(400, 'invalid_query', 'Invalid query parameters', errors);

  return { limit, offset, tags: [...new Set(tags)], match: matchRaw, q, sort: sortRaw };
}

function parseIntParam(raw, fallback, min, max, field, errors) {
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    errors.push({ field, message: 'must be a non-negative integer' });
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    errors.push({ field, message: `must be between ${min} and ${max}` });
    return fallback;
  }
  return value;
}
