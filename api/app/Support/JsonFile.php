<?php

namespace App\Support;

use App\Exceptions\ApiException;

/**
 * Атомарная запись JSON на диск: сначала временный файл рядом, затем переименование.
 *
 * Вынесено отдельно, потому что файлов-хранилищ стало два — notes.json и
 * import_keys.json, — и правило атомарности у них одно. Прерывание процесса
 * посреди записи иначе оставило бы наполовину записанный JSON, то есть сервис
 * своими руками перевёл бы себя в состояние «хранилище испорчено».
 */
class JsonFile
{
    public static function writeAtomically(string $path, string $contents): void
    {
        $directory = dirname($path);

        if (! is_dir($directory) && ! @mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw ApiException::internalError();
        }

        $temporary = $path.'.'.bin2hex(random_bytes(6)).'.tmp';

        if (@file_put_contents($temporary, $contents) === false) {
            throw ApiException::internalError();
        }

        if (! @rename($temporary, $path)) {
            @unlink($temporary);

            throw ApiException::internalError();
        }
    }
}
