import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { NoteStore } from './store.js';

export function createServer(store = new NoteStore()) {
  return http.createServer(createApp(store));
}

// Запуск только при прямом вызове `node src/server.js`; при импорте из тестов — нет.
const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();

  server.listen(port, host, () => {
    console.log(`notes-api listening on http://${host}:${port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\n${signal} received, shutting down`);
      server.close(() => process.exit(0));
    });
  }
}
