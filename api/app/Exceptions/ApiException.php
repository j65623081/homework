<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Ошибка, которую можно показать клиенту.
 *
 * Коды — из закрытого перечня SPEC.md. Сообщение всегда наше и всегда безопасное:
 * ни путей на диске, ни имён классов, ни трассировок наружу не уходит.
 */
class ApiException extends RuntimeException
{
    /**
     * @param  array<string, array<string>>|null  $fields
     */
    public function __construct(
        public readonly string $errorCode,
        public readonly int $status,
        string $message,
        public readonly ?array $fields = null,
    ) {
        parent::__construct($message);
    }

    public static function malformedJson(): self
    {
        return new self('malformed_json', 400, 'Тело запроса не является корректным JSON');
    }

    /**
     * @param  array<string, array<string>>  $fields
     */
    public static function validationFailed(array $fields): self
    {
        return new self('validation_failed', 422, 'Тело запроса не прошло валидацию', $fields);
    }

    /**
     * @param  array<string, array<string>>  $fields
     */
    public static function unknownFields(array $fields): self
    {
        return new self('unknown_fields', 422, 'В теле запроса есть поля, которых нет в контракте', $fields);
    }

    /**
     * То же самое, но для строки запроса: сообщение про «тело» здесь было бы враньём.
     *
     * @param  array<string, array<string>>  $fields
     */
    public static function invalidQuery(array $fields): self
    {
        return new self('validation_failed', 422, 'Параметры запроса не прошли валидацию', $fields);
    }

    public static function notFound(): self
    {
        return new self('not_found', 404, 'Запрошенный ресурс не найден');
    }

    /**
     * Content-Type, которого нет среди двух допустимых форматов тела импорта.
     * Поля fields здесь нет: ошибка относится к заголовку, а не к телу.
     */
    public static function unsupportedMediaType(): self
    {
        return new self('unsupported_media_type', 415, 'Content-Type не поддерживается этим эндпоинтом');
    }

    /** Пачка больше 200 заметок либо тело больше 2 МБ. Проверяется до разбора содержимого. */
    public static function importTooLarge(): self
    {
        return new self('import_too_large', 413, 'Пачка превышает допустимый размер');
    }

    public static function idempotencyKeyInvalid(): self
    {
        return new self(
            'idempotency_key_invalid',
            422,
            'Заголовок Idempotency-Key отсутствует или не подходит под формат'
        );
    }

    public static function idempotencyKeyConflict(): self
    {
        return new self(
            'idempotency_key_conflict',
            409,
            'Этот ключ идемпотентности уже использован с другим содержимым запроса'
        );
    }

    public static function storageCorrupted(): self
    {
        return new self('storage_corrupted', 500, 'Файл-хранилище не удалось прочитать');
    }

    public static function internalError(): self
    {
        return new self('internal_error', 500, 'Внутренняя ошибка сервера');
    }
}
