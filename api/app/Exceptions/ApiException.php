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

    public static function storageCorrupted(): self
    {
        return new self('storage_corrupted', 500, 'Файл-хранилище не удалось прочитать');
    }

    public static function internalError(): self
    {
        return new self('internal_error', 500, 'Внутренняя ошибка сервера');
    }
}
