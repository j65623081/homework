<?php

namespace App\Support;

use App\Exceptions\ApiException;

/**
 * Реестр отработанных ключей идемпотентности — отдельный файл import_keys.json.
 *
 * Три правила из SPEC.md, которые здесь важнее всего:
 *
 * 1. Формат notes.json не меняется. Реестр живёт в своём файле, и всё, что
 *    написано про хранилище заметок в ДЗ №1, остаётся в силе без правок.
 * 2. Нечитаемый реестр — это internal_error, а не storage_corrupted: потеряна
 *    защита от повторов, а не данные. Файл при этом не перезаписывается —
 *    молча начать реестр заново значит тихо отключить идемпотентность ровно
 *    тогда, когда клиент на неё рассчитывает.
 * 3. TTL нет, рост ограничен потолком в 500 записей с вытеснением самых старых.
 */
class ImportKeyRegistry
{
    private const MAX_ENTRIES = 500;

    public function __construct(private readonly string $path) {}

    /**
     * @return array<string, array<string, mixed>>
     */
    public function all(): array
    {
        if (! is_file($this->path)) {
            return [];
        }

        $raw = @file_get_contents($this->path);

        if ($raw === false) {
            throw ApiException::internalError();
        }

        if (trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw ApiException::internalError();
        }

        // Ожидается объект «ключ → запись». Пустой массив от пустого объекта
        // после разбора неотличим, и оба означают пустой реестр.
        if (! is_array($decoded) || (array_is_list($decoded) && $decoded !== [])) {
            throw ApiException::internalError();
        }

        foreach ($decoded as $entry) {
            if (! self::isEntry($entry)) {
                throw ApiException::internalError();
            }
        }

        return $decoded;
    }

    private static function isEntry(mixed $entry): bool
    {
        if (! is_array($entry)) {
            return false;
        }

        $hash = $entry['request_hash'] ?? null;

        return is_string($hash) && $hash !== '' && is_array($entry['response'] ?? null);
    }

    /**
     * @param  array<string, array<string, mixed>>  $entries
     */
    public function save(array $entries): void
    {
        $entries = self::evictOldest($entries);

        // Пустой массив в PHP кодируется как [], а реестр — объект. На практике
        // сюда не приходит пустой набор, но формат файла не должен зависеть
        // от удачи.
        $json = $entries === []
            ? '{}'
            : json_encode($entries, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

        if ($json === false) {
            throw ApiException::internalError();
        }

        JsonFile::writeAtomically($this->path, $json.PHP_EOL);
    }

    /**
     * Вытесняется самая старая запись по created_at, а не самая новая: свежие
     * ключи — те, по которым ещё может прийти повтор.
     *
     * @param  array<string, array<string, mixed>>  $entries
     * @return array<string, array<string, mixed>>
     */
    private static function evictOldest(array $entries): array
    {
        if (count($entries) <= self::MAX_ENTRIES) {
            return $entries;
        }

        uasort(
            $entries,
            fn (array $a, array $b) => (string) ($a['created_at'] ?? '') <=> (string) ($b['created_at'] ?? '')
        );

        return array_slice($entries, count($entries) - self::MAX_ENTRIES, null, true);
    }
}
