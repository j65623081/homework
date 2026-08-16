import { NoteStore } from './store.js';
import {
  ApiError,
  badRequest,
  notFound,
  methodNotAllowed,
  unsupportedMediaType,
  payloadTooLarge,
  validationFailed,
} from './errors.js';
import {
  parseFullNote,
  parsePartialNote,
  parseListQuery,
  normalizeTag,
  normalizeTags,
  LIMITS,
} from './validation.js';

const MAX_BODY_BYTES = 256 * 1024; // 256 KB — заметка это текст, больше не нужно

function sendJson(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, { 'Content-Length': 0 });
  res.end();
}

/**
 * Явная обёртка ответа с нестандартным кодом. Нужна, чтобы не гадать
 * по форме объекта: заметка с полем status и «ответ» больше не путаются.
 */
class Response {
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}

const respond = (status, body) => new Response(status, body);

async function readJsonBody(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== '' && type !== 'application/json') throw unsupportedMediaType();

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw payloadTooLarge(MAX_BODY_BYTES);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') throw badRequest('Request body must not be empty');

  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Request body is not valid JSON');
  }
}

/**
 * Создаёт обработчик запросов. Хранилище передаётся снаружи,
 * чтобы тесты могли поднять чистый экземпляр на каждый файл тестов.
 */
export function createApp(store = new NoteStore()) {
  const routes = [
    { method: 'GET', pattern: /^\/health$/, handler: health },
    { method: 'GET', pattern: /^\/notes$/, handler: listNotes },
    { method: 'POST', pattern: /^\/notes$/, handler: createNote },
    { method: 'GET', pattern: /^\/notes\/([^/]+)$/, handler: getNote },
    { method: 'PUT', pattern: /^\/notes\/([^/]+)$/, handler: replaceNote },
    { method: 'PATCH', pattern: /^\/notes\/([^/]+)$/, handler: patchNote },
    { method: 'DELETE', pattern: /^\/notes\/([^/]+)$/, handler: deleteNote },
    { method: 'POST', pattern: /^\/notes\/([^/]+)\/tags$/, handler: addTags },
    { method: 'DELETE', pattern: /^\/notes\/([^/]+)\/tags\/([^/]+)$/, handler: removeTag },
    { method: 'GET', pattern: /^\/tags$/, handler: listTags },
  ];

  function health() {
    return { status: 'ok', notes: store.size, uptime: Math.round(process.uptime()) };
  }

  function listNotes(_req, _res, _params, url) {
    const query = parseListQuery(url.searchParams);
    const { total, items } = store.list(query);
    return {
      items,
      pagination: { total, limit: query.limit, offset: query.offset, count: items.length },
    };
  }

  async function createNote(req, res) {
    const payload = parseFullNote(await readJsonBody(req));
    const note = store.create(payload);
    res.setHeader('Location', `/notes/${note.id}`);
    return respond(201, note);
  }

  function getNote(_req, _res, [id]) {
    const note = store.get(id);
    if (!note) throw notFound(`Note ${id} not found`);
    return note;
  }

  async function replaceNote(req, _res, [id]) {
    const payload = parseFullNote(await readJsonBody(req));
    // PUT — полная замена: content и tags сбрасываются, если их не прислали
    const updated = store.update(id, { title: payload.title, content: payload.content, tags: payload.tags });
    if (!updated) throw notFound(`Note ${id} not found`);
    return updated;
  }

  async function patchNote(req, _res, [id]) {
    const patch = parsePartialNote(await readJsonBody(req));
    const updated = store.update(id, patch);
    if (!updated) throw notFound(`Note ${id} not found`);
    return updated;
  }

  function deleteNote(_req, _res, [id]) {
    if (!store.delete(id)) throw notFound(`Note ${id} not found`);
    return respond(204, undefined);
  }

  async function addTags(req, _res, [id]) {
    const note = store.get(id);
    if (!note) throw notFound(`Note ${id} not found`);

    const body = await readJsonBody(req);
    const raw = Array.isArray(body) ? body : body?.tags;
    const errors = [];
    const incoming = normalizeTags(raw, errors);
    if (errors.length > 0) throw validationFailed(errors);

    // объединение с уже имеющимися, дубликаты схлопываются
    const merged = [...new Set([...note.tags, ...incoming])];
    if (merged.length > LIMITS.TAGS_MAX) {
      throw validationFailed([
        { field: 'tags', message: `note would exceed the limit of ${LIMITS.TAGS_MAX} tags` },
      ]);
    }
    return store.update(id, { tags: merged });
  }

  function removeTag(_req, _res, [id, rawTag]) {
    const note = store.get(id);
    if (!note) throw notFound(`Note ${id} not found`);

    const tag = normalizeTag(decodeURIComponent(rawTag));
    if (!note.tags.includes(tag)) throw notFound(`Note ${id} has no tag "${tag}"`);
    return store.update(id, { tags: note.tags.filter((t) => t !== tag) });
  }

  function listTags() {
    const items = store.tags();
    return { items, total: items.length };
  }

  return async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendJson(res, 400, badRequest('Malformed request URL').toJSON());
    }

    // нормализуем путь: убираем хвостовой слэш, кроме корня
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    try {
      const matched = routes.filter((r) => r.pattern.test(path));
      if (matched.length === 0) {
        throw notFound(`No route for ${req.method} ${path}`);
      }

      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const route = matched.find((r) => r.method === method);
      if (!route) {
        const allowed = [...new Set(matched.map((r) => r.method))];
        res.setHeader('Allow', allowed.join(', '));
        throw methodNotAllowed(allowed);
      }

      const params = (path.match(route.pattern) ?? []).slice(1);
      const result = await route.handler(req, res, params, url);

      if (result instanceof Response) {
        if (result.body === undefined) return sendEmpty(res, result.status);
        return sendJson(res, result.status, result.body);
      }
      return sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof ApiError) {
        return sendJson(res, err.status, err.toJSON());
      }
      console.error('[notes-api] unhandled error:', err);
      return sendJson(res, 500, {
        error: { code: 'internal_error', message: 'Internal server error' },
      });
    }
  };
}
