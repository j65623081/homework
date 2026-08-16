<?php

namespace App\Support;

use App\Exceptions\ApiException;

/**
 * Хранилище заметок в одном JSON-файле.
 *
 * Два правила из SPEC.md, которые здесь важнее всего:
 * 1. Отсутствующий и пустой файл — это пустой список, а не ошибка.
 * 2. Испорченный файл — это 500, и файл при этом не перезаписывается и не удаляется.
 *    Сервис никогда не затирает данные, которые не смог прочитать.
 */
class NoteStorage
{
    public function __construct(private readonly string $path) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function all(): array
    {
        if (! is_file($this->path)) {
            return [];
        }

        $raw = @file_get_contents($this->path);

        if ($raw === false) {
            throw ApiException::storageCorrupted();
        }

        if (trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw ApiException::storageCorrupted();
        }

        // Ожидается массив заметок. Объект верхнего уровня — тоже порча.
        if (! is_array($decoded) || ! array_is_list($decoded)) {
            throw ApiException::storageCorrupted();
        }

        return $decoded;
    }

    /**
     * Атомарная запись: сначала временный файл рядом, затем переименование.
     * Прерывание процесса посреди записи иначе оставило бы наполовину записанный
     * JSON — то есть сервис своими руками перевёл бы себя в storage_corrupted.
     *
     * @param  array<int, array<string, mixed>>  $notes
     */
    public function save(array $notes): void
    {
        $directory = dirname($this->path);

        if (! is_dir($directory) && ! @mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw ApiException::internalError();
        }

        $json = json_encode(
            array_values($notes),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
        );

        if ($json === false) {
            throw ApiException::internalError();
        }

        $temporary = $this->path.'.'.bin2hex(random_bytes(6)).'.tmp';

        if (@file_put_contents($temporary, $json.PHP_EOL) === false) {
            throw ApiException::internalError();
        }

        if (! @rename($temporary, $this->path)) {
            @unlink($temporary);

            throw ApiException::internalError();
        }
    }
}
