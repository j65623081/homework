<?php

namespace Tests;

use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Базовый класс для тестов API.
 *
 * Две задачи, обе — требования AGENTS.md:
 * 1. Каждый тест работает со своим файлом-хранилищем во временном каталоге.
 * 2. Рабочий storage/app/notes.json не читается и не пишется — это проверяется
 *    сравнением контрольной суммы до и после каждого теста.
 *
 * С появлением импорта файлов-хранилищ стало два: тот же механизм заведён
 * и для реестра ключей import_keys.json.
 */
abstract class ApiTestCase extends TestCase
{
    /** Временное хранилище этого теста. */
    protected string $storagePath;

    /** Временный реестр ключей идемпотентности этого теста. */
    protected string $keysPath;

    /** Рабочее хранилище приложения — к нему тесты не прикасаются. */
    private string $realStoragePath;

    private ?string $realStorageHashBefore;

    /** Рабочий реестр ключей — к нему тесты тоже не прикасаются. */
    private string $realKeysPath;

    private ?string $realKeysHashBefore;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storagePath = sys_get_temp_dir()
            .DIRECTORY_SEPARATOR.'notes-api-tests'
            .DIRECTORY_SEPARATOR.Str::uuid()->toString()
            .DIRECTORY_SEPARATOR.'notes.json';

        $this->keysPath = dirname($this->storagePath).DIRECTORY_SEPARATOR.'import_keys.json';

        config([
            'notes.path' => $this->storagePath,
            'notes.keys_path' => $this->keysPath,
        ]);

        $this->realStoragePath = storage_path('app'.DIRECTORY_SEPARATOR.'notes.json');
        $this->realStorageHashBefore = $this->hashOf($this->realStoragePath);

        $this->realKeysPath = storage_path('app'.DIRECTORY_SEPARATOR.'import_keys.json');
        $this->realKeysHashBefore = $this->hashOf($this->realKeysPath);
    }

    protected function tearDown(): void
    {
        $this->assertSame(
            $this->realStorageHashBefore,
            $this->hashOf($this->realStoragePath),
            'Тест изменил рабочий storage/app/notes.json — это запрещено правилами проекта'
        );

        $this->assertSame(
            $this->realKeysHashBefore,
            $this->hashOf($this->realKeysPath),
            'Тест изменил рабочий storage/app/import_keys.json — это запрещено правилами проекта'
        );

        // Каталог теста убирается целиком: кроме двух файлов-хранилищ в нём могут
        // лежать файлы, подготовленные для загрузки через multipart.
        $directory = dirname($this->storagePath);

        if (is_dir($directory)) {
            foreach ((array) glob($directory.DIRECTORY_SEPARATOR.'*') as $file) {
                if (is_file($file)) {
                    unlink($file);
                }
            }
            rmdir($directory);
        }

        parent::tearDown();
    }

    private function hashOf(string $path): ?string
    {
        return is_file($path) ? md5_file($path) : null;
    }

    /** Положить во временное хранилище произвольное содержимое, в том числе испорченное. */
    protected function writeStorage(string $contents): void
    {
        $dir = dirname($this->storagePath);
        if (! is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        file_put_contents($this->storagePath, $contents);
    }

    /** Положить во временное хранилище готовый список заметок. */
    protected function seedStorage(array $notes): void
    {
        $this->writeStorage(json_encode($notes, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    }

    /** Сырое содержимое временного хранилища или null, если файла нет. */
    protected function rawStorage(): ?string
    {
        return is_file($this->storagePath) ? file_get_contents($this->storagePath) : null;
    }

    /** Число записей во временном хранилище. */
    protected function storedCount(): int
    {
        $raw = $this->rawStorage();

        return $raw === null ? 0 : count(json_decode($raw, true) ?: []);
    }

    /** Положить во временный реестр ключей произвольное содержимое. */
    protected function writeKeys(string $contents): void
    {
        $dir = dirname($this->keysPath);
        if (! is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        file_put_contents($this->keysPath, $contents);
    }

    /** Сырое содержимое временного реестра ключей или null, если файла нет. */
    protected function rawKeys(): ?string
    {
        return is_file($this->keysPath) ? file_get_contents($this->keysPath) : null;
    }

    /** Разобранный реестр ключей; пустой массив, если файла нет. */
    protected function keys(): array
    {
        $raw = $this->rawKeys();

        return $raw === null ? [] : (json_decode($raw, true) ?: []);
    }

    /** Заготовка заметки для прямой записи в хранилище, минуя API. */
    protected function note(array $overrides = []): array
    {
        return array_merge([
            'id' => (string) Str::uuid(),
            'title' => 'Заметка',
            'body' => '',
            'tags' => [],
            'created_at' => '2026-08-16T10:00:00Z',
            'updated_at' => '2026-08-16T10:00:00Z',
        ], $overrides);
    }

    /** Создать заметку через API и вернуть её тело. */
    protected function createNote(array $payload): array
    {
        $response = $this->postJson('/api/notes', $payload);
        $response->assertStatus(201);

        return $response->json('data');
    }

    protected function assertErrorShape(TestResponse $response, string $code): void
    {
        $response->assertJsonStructure(['error' => ['code', 'message']]);
        $response->assertJsonPath('error.code', $code);
    }
}
