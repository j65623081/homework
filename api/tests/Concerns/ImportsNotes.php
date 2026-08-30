<?php

namespace Tests\Concerns;

use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;

/**
 * Отправка запросов на импорт в обоих форматах тела.
 *
 * Тело собирается строкой, а не массивом: контракт описывает именно байты запроса,
 * и подмена их структурой Laravel спрятала бы, например, порядок ключей — а от него
 * зависит хеш запроса. По той же причине Content-Type задаётся явно: Symfony
 * по умолчанию подставляет application/x-www-form-urlencoded, и тест проверял бы
 * не тот путь.
 */
trait ImportsNotes
{
    /** Ключ по умолчанию: 8+ символов из разрешённого набора. */
    protected const KEY = 'batch-2026-08-30-001';

    /** Импорт форматом A — JSON в теле запроса. */
    protected function importJson(string $body, ?string $key = self::KEY): TestResponse
    {
        return $this->call(
            'POST',
            '/api/notes/import',
            [],
            [],
            [],
            $this->server('application/json', $key),
            $body
        );
    }

    /** Импорт форматом B — multipart/form-data с полем file. */
    protected function importFile(
        string $contents,
        ?string $key = self::KEY,
        string $name = 'notes.json',
        string $mime = 'application/json',
    ): TestResponse {
        $path = $this->temporaryUpload($contents);

        return $this->call(
            'POST',
            '/api/notes/import',
            [],
            [],
            ['file' => new UploadedFile($path, $name, $mime, null, true)],
            $this->server('multipart/form-data; boundary=----test', $key)
        );
    }

    /** Тело пачки из готовых элементов. */
    protected function batch(array $items): string
    {
        return json_encode(['notes' => $items], JSON_UNESCAPED_UNICODE);
    }

    /** @return array<string, string> */
    private function server(string $contentType, ?string $key): array
    {
        $server = ['CONTENT_TYPE' => $contentType];

        if ($key !== null) {
            $server['HTTP_IDEMPOTENCY_KEY'] = $key;
        }

        return $server;
    }

    /** Файл для загрузки кладётся рядом с временным хранилищем и уходит вместе с ним. */
    private function temporaryUpload(string $contents): string
    {
        $path = dirname($this->storagePath).DIRECTORY_SEPARATOR.'upload-'.bin2hex(random_bytes(4)).'.bin';

        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }

        file_put_contents($path, $contents);

        return $path;
    }
}
