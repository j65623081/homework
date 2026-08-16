import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let api;

before(async () => {
  api = await startTestServer();
});

after(async () => {
  await api.stop();
});

describe('health', () => {
  test('GET /health отвечает ok', async () => {
    const res = await api.get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });
});

describe('CRUD заметок', () => {
  test('POST /notes создаёт заметку и отдаёт 201 + Location', async () => {
    const res = await api.post('/notes', { title: 'Первая', content: 'текст', tags: ['Work'] });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('location'), `/notes/${res.body.id}`);
    assert.equal(res.body.title, 'Первая');
    assert.deepEqual(res.body.tags, ['work']);
    assert.ok(res.body.createdAt && res.body.updatedAt);
  });

  test('GET /notes/:id возвращает созданную заметку', async () => {
    const created = (await api.post('/notes', { title: 'Читаем' })).body;
    const res = await api.get(`/notes/${created.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, created);
  });

  test('GET /notes/:id для несуществующего id — 404', async () => {
    const res = await api.get('/notes/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });

  test('PATCH обновляет только переданные поля и двигает updatedAt', async () => {
    const created = (await api.post('/notes', { title: 'Старый', content: 'c', tags: ['a'] })).body;
    await new Promise((r) => setTimeout(r, 5));
    const res = await api.patch(`/notes/${created.id}`, { title: 'Новый' });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'Новый');
    assert.equal(res.body.content, 'c');
    assert.deepEqual(res.body.tags, ['a']);
    assert.equal(res.body.createdAt, created.createdAt);
    assert.notEqual(res.body.updatedAt, created.updatedAt);
  });

  test('PUT заменяет заметку целиком: непереданные поля сбрасываются', async () => {
    const created = (await api.post('/notes', { title: 'T', content: 'c', tags: ['a', 'b'] })).body;
    const res = await api.put(`/notes/${created.id}`, { title: 'Только заголовок' });
    assert.equal(res.status, 200);
    assert.equal(res.body.content, '');
    assert.deepEqual(res.body.tags, []);
  });

  test('DELETE удаляет и второй раз даёт 404', async () => {
    const created = (await api.post('/notes', { title: 'Удалить' })).body;
    const first = await api.del(`/notes/${created.id}`);
    assert.equal(first.status, 204);
    assert.equal(first.text, '');
    const second = await api.del(`/notes/${created.id}`);
    assert.equal(second.status, 404);
  });
});

describe('валидация', () => {
  test('без title — 422 с деталями', async () => {
    const res = await api.post('/notes', { content: 'нет заголовка' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'validation_failed');
    assert.ok(res.body.error.details.some((d) => d.field === 'title'));
  });

  test('пустой/пробельный title — 422', async () => {
    const res = await api.post('/notes', { title: '   ' });
    assert.equal(res.status, 422);
  });

  test('title обрезается по краям', async () => {
    const res = await api.post('/notes', { title: '  с пробелами  ' });
    assert.equal(res.body.title, 'с пробелами');
  });

  test('слишком длинный title — 422', async () => {
    const res = await api.post('/notes', { title: 'x'.repeat(201) });
    assert.equal(res.status, 422);
  });

  test('tags не массив — 422', async () => {
    const res = await api.post('/notes', { title: 'T', tags: 'work' });
    assert.equal(res.status, 422);
  });

  test('неизвестное поле — 422', async () => {
    const res = await api.post('/notes', { title: 'T', color: 'red' });
    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.some((d) => d.field === 'color'));
  });

  test('битый JSON — 400', async () => {
    const res = await api.post('/notes', '{ not json');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
  });

  test('пустое тело — 400', async () => {
    const res = await api.post('/notes', '');
    assert.equal(res.status, 400);
  });

  test('неверный Content-Type — 415', async () => {
    const res = await api.post('/notes', 'title=T', { 'Content-Type': 'text/plain' });
    assert.equal(res.status, 415);
  });

  test('PATCH с пустым объектом — 422', async () => {
    const created = (await api.post('/notes', { title: 'T' })).body;
    const res = await api.patch(`/notes/${created.id}`, {});
    assert.equal(res.status, 422);
  });

  test('неизвестный маршрут — 404, неверный метод — 405 с Allow', async () => {
    assert.equal((await api.get('/nope')).status, 404);
    const res = await api.request('PUT', '/notes', { title: 'T' });
    assert.equal(res.status, 405);
    assert.ok(res.headers.get('allow').includes('POST'));
  });
});

describe('нормализация тегов', () => {
  test('регистр, пробелы, дубли и пустые значения', async () => {
    const res = await api.post('/notes', {
      title: 'Теги',
      tags: ['  Work ', 'work', 'WORK', '', '   ', 'to  do', 'Дом'],
    });
    assert.equal(res.status, 201);
    // 'Work'/'work'/'WORK' -> один тег; пустые выброшены; пробелы внутри -> дефис
    assert.deepEqual(res.body.tags, ['work', 'to-do', 'дом']);
  });

  test('порядок первого появления сохраняется', async () => {
    const res = await api.post('/notes', { title: 'T', tags: ['b', 'a', 'B', 'c'] });
    assert.deepEqual(res.body.tags, ['b', 'a', 'c']);
  });

  test('тег из недопустимых символов — 422', async () => {
    const res = await api.post('/notes', { title: 'T', tags: ['#hash'] });
    assert.equal(res.status, 422);
  });

  test('слишком длинный тег — 422', async () => {
    const res = await api.post('/notes', { title: 'T', tags: ['x'.repeat(33)] });
    assert.equal(res.status, 422);
  });

  test('больше 20 тегов — 422', async () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    const res = await api.post('/notes', { title: 'T', tags });
    assert.equal(res.status, 422);
  });
});

describe('операции с тегами заметки', () => {
  test('POST /notes/:id/tags добавляет и схлопывает дубли', async () => {
    const created = (await api.post('/notes', { title: 'T', tags: ['a'] })).body;
    const res = await api.post(`/notes/${created.id}/tags`, { tags: ['B', 'a', ' c '] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.tags, ['a', 'b', 'c']);
  });

  test('DELETE /notes/:id/tags/:tag убирает тег (регистр не важен)', async () => {
    const created = (await api.post('/notes', { title: 'T', tags: ['keep', 'drop'] })).body;
    const res = await api.del(`/notes/${created.id}/tags/DROP`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.tags, ['keep']);
  });

  test('удаление тега, которого нет — 404', async () => {
    const created = (await api.post('/notes', { title: 'T', tags: ['keep'] })).body;
    assert.equal((await api.del(`/notes/${created.id}/tags/missing`)).status, 404);
  });
});
