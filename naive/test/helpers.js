import { createServer } from '../src/server.js';
import { NoteStore } from '../src/store.js';

/** Поднимает сервер на случайном порту и отдаёт клиент + функцию остановки. */
export async function startTestServer() {
  const store = new NoteStore();
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] = init.headers['Content-Type'] ?? 'application/json';
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, body: json, text };
  }

  return {
    base,
    store,
    request,
    get: (p) => request('GET', p),
    post: (p, b, h) => request('POST', p, b, h),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
