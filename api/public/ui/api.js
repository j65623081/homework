/*
 * Клиент Notes API. Контракт — SPEC.md, раздел «Контракт API».
 * Файл ничего не рисует: возвращает разобранные данные либо бросает ошибку
 * одного из двух типов — ApiError (сервер ответил) или NetworkError (не ответил).
 */
(function (global) {
  'use strict';

  // По file:// относительный /api указывал бы на корень диска, поэтому там
  // берём адрес локального стенда явно. Запрос всё равно может не пройти
  // (кросс-доменные заголовки в задаче не предусмотрены) — это ожидаемо,
  // страница в таком случае показывает баннер недоступности стенда.
  var BASE = global.location.protocol === 'file:'
    ? 'http://localhost:8000/api'
    : '/api';

  /** Сервер ответил, но код не 2xx. Держит разобранный error-объект контракта. */
  function ApiError(status, code, message, fields) {
    var err = new Error(message || 'Ошибка запроса');
    err.name = 'ApiError';
    err.status = status;
    err.code = code || 'unknown';
    err.fields = fields || null;
    err.isApiError = true;
    return err;
  }

  /** Ответа не было вовсе: стенд не поднят, обрыв сети, запрос отменён. */
  function NetworkError(cause) {
    var err = new Error('Не удалось связаться со стендом');
    err.name = 'NetworkError';
    err.isNetworkError = true;
    err.cause = cause;
    return err;
  }

  function buildUrl(path, params) {
    var url = BASE + path;
    var qs = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '') {
        return;
      }
      qs.append(key, String(value));
    });
    var tail = qs.toString();
    return tail ? url + '?' + tail : url;
  }

  async function readBody(response) {
    // 204 по контракту тела не имеет.
    if (response.status === 204) {
      return null;
    }
    var text = await response.text();
    if (text === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      return { __unparsed: text };
    }
  }

  function toApiError(response, payload) {
    var envelope = payload && payload.error;
    if (envelope && typeof envelope === 'object') {
      return ApiError(
        response.status,
        typeof envelope.code === 'string' ? envelope.code : 'unknown',
        typeof envelope.message === 'string' ? envelope.message : '',
        envelope.fields && typeof envelope.fields === 'object' ? envelope.fields : null
      );
    }
    // Ответ вне контракта: сервер отдал не наш формат ошибки.
    return ApiError(
      response.status,
      'unexpected_response',
      'Сервер ответил кодом ' + response.status + ' в формате, которого нет в контракте',
      null
    );
  }

  async function request(path, options) {
    var opts = options || {};
    var response;
    try {
      response = await fetch(buildUrl(path, opts.params), {
        method: opts.method || 'GET',
        headers: opts.headers || undefined,
        body: opts.body !== undefined ? opts.body : undefined,
      });
    } catch (e) {
      throw NetworkError(e);
    }

    var payload = await readBody(response);
    if (!response.ok) {
      throw toApiError(response, payload);
    }
    return payload;
  }

  var api = {
    baseUrl: BASE,

    /** GET /api/notes — список с фильтром и постраничностью. */
    listNotes: function (filters) {
      var f = filters || {};
      return request('/notes', {
        params: { tag: f.tag, q: f.q, limit: f.limit, offset: f.offset },
      });
    },

    /** POST /api/notes — создание одной заметки. */
    createNote: function (note) {
      return request('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(note),
      });
    },

    /** DELETE /api/notes/{id} — удаление. 204 без тела. */
    deleteNote: function (id) {
      return request('/notes/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    /**
     * POST /api/notes/import, формат A: JSON в теле.
     * Текст уходит ровно таким, как его ввёл человек: если он не разбирается
     * как JSON, ответить об этом должен сервер кодом malformed_json,
     * а не клиент своей проверкой.
     */
    importJsonText: function (rawText, idempotencyKey) {
      return request('/notes/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: rawText,
      });
    },

    /**
     * POST /api/notes/import, формат B: multipart/form-data, поле file.
     * Content-Type не выставляем руками — иначе потеряется boundary,
     * который дописывает браузер.
     */
    importFile: function (file, idempotencyKey) {
      var form = new FormData();
      form.append('file', file);
      return request('/notes/import', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Idempotency-Key': idempotencyKey },
        body: form,
      });
    },
  };

  global.NotesApi = api;
})(window);
