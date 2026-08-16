import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let api;

before(async () => {
  api = await startTestServer();
  // фикстуры создаются последовательно, чтобы createdAt шли по возрастанию
  for (const note of [
    { title: 'Купить молоко', content: 'в магазине', tags: ['shopping', 'home'] },
    { title: 'Отчёт за квартал', content: 'таблица и выводы', tags: ['work', 'urgent'] },
    { title: 'Позвонить в банк', content: 'уточнить лимит', tags: ['work', 'home'] },
    { title: 'Без тегов', content: 'просто заметка', tags: [] },
  ]) {
    const res = await api.post('/notes', note);
    assert.equal(res.status, 201);
    await new Promise((r) => setTimeout(r, 2));
  }
});

after(async () => {
  await api.stop();
});

describe('GET /notes', () => {
  test('по умолчанию отдаёт все заметки, новые сверху', async () => {
    const res = await api.get('/notes');
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.total, 4);
    assert.equal(res.body.items.length, 4);
    assert.equal(res.body.items[0].title, 'Без тегов');
  });

  test('фильтр по одному тегу', async () => {
    const res = await api.get('/notes?tag=work');
    assert.equal(res.body.pagination.total, 2);
    assert.ok(res.body.items.every((n) => n.tags.includes('work')));
  });

  test('тег в фильтре нормализуется так же, как при записи', async () => {
    const res = await api.get('/notes?tag=%20WORK%20');
    assert.equal(res.body.pagination.total, 2);
  });

  test('несколько тегов: по умолчанию AND', async () => {
    const res = await api.get('/notes?tag=work&tag=home');
    assert.equal(res.body.pagination.total, 1);
    assert.equal(res.body.items[0].title, 'Позвонить в банк');
  });

  test('match=any даёт объединение', async () => {
    const res = await api.get('/notes?tag=work&tag=shopping&match=any');
    assert.equal(res.body.pagination.total, 3);
  });

  test('несуществующий тег — пустой список, а не 404', async () => {
    const res = await api.get('/notes?tag=nope');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.pagination.total, 0);
  });

  test('поиск q по заголовку и тексту, регистр не важен', async () => {
    assert.equal((await api.get('/notes?q=МОЛОКО')).body.pagination.total, 1);
    assert.equal((await api.get('/notes?q=лимит')).body.pagination.total, 1);
  });

  test('поиск и тег комбинируются', async () => {
    const res = await api.get('/notes?tag=work&q=банк');
    assert.equal(res.body.pagination.total, 1);
  });

  test('пагинация: limit/offset и корректный total', async () => {
    const page1 = await api.get('/notes?limit=2&offset=0&sort=createdAt');
    const page2 = await api.get('/notes?limit=2&offset=2&sort=createdAt');
    assert.equal(page1.body.pagination.total, 4);
    assert.equal(page1.body.items.length, 2);
    assert.equal(page2.body.items.length, 2);
    const ids = new Set([...page1.body.items, ...page2.body.items].map((n) => n.id));
    assert.equal(ids.size, 4);
  });

  test('sort=title сортирует по алфавиту', async () => {
    const res = await api.get('/notes?sort=title');
    const titles = res.body.items.map((n) => n.title);
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
  });

  test('некорректные query-параметры — 400', async () => {
    assert.equal((await api.get('/notes?limit=abc')).status, 400);
    assert.equal((await api.get('/notes?limit=1000')).status, 400);
    assert.equal((await api.get('/notes?sort=random')).status, 400);
    assert.equal((await api.get('/notes?match=maybe')).status, 400);
  });
});

describe('GET /tags', () => {
  test('отдаёт теги со счётчиками, по убыванию', async () => {
    const res = await api.get('/tags');
    assert.equal(res.status, 200);
    const map = Object.fromEntries(res.body.items.map((t) => [t.tag, t.count]));
    assert.equal(map.work, 2);
    assert.equal(map.home, 2);
    assert.equal(map.shopping, 1);
    assert.equal(map.urgent, 1);
    const counts = res.body.items.map((t) => t.count);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  });

  test('тег исчезает из списка, когда исчез у всех заметок', async () => {
    const created = (await api.post('/notes', { title: 'Временная', tags: ['ephemeral'] })).body;
    assert.ok((await api.get('/tags')).body.items.some((t) => t.tag === 'ephemeral'));
    await api.del(`/notes/${created.id}`);
    assert.ok(!(await api.get('/tags')).body.items.some((t) => t.tag === 'ephemeral'));
  });
});
