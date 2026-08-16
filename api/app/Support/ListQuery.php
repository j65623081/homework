<?php

namespace App\Support;

use App\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * Разбор параметров списка: tag, q, limit, offset.
 *
 * Невалидное значение — это 422, а не тихий clamp: явная ошибка отлаживается,
 * молча поправленная — нет. Отсутствующий и пустой параметр равнозначны:
 * `?limit=` клиенты присылают, когда поле фильтра не заполнено.
 */
class ListQuery
{
    private const LIMIT_DEFAULT = 20;

    private const LIMIT_MIN = 1;

    private const LIMIT_MAX = 100;

    public function __construct(
        public readonly ?string $tag,
        public readonly ?string $q,
        public readonly int $limit,
        public readonly int $offset,
    ) {}

    public static function fromRequest(Request $request): self
    {
        $errors = [];

        $limit = self::integer(
            $request,
            'limit',
            self::LIMIT_DEFAULT,
            self::LIMIT_MIN,
            self::LIMIT_MAX,
            'Должно быть целым числом от '.self::LIMIT_MIN.' до '.self::LIMIT_MAX,
            $errors
        );

        $offset = self::integer(
            $request,
            'offset',
            0,
            0,
            PHP_INT_MAX,
            'Должно быть целым числом не меньше 0',
            $errors
        );

        if ($errors !== []) {
            throw ApiException::invalidQuery($errors);
        }

        $tag = $request->query('tag');
        $q = $request->query('q');

        return new self(
            is_string($tag) && trim($tag) !== '' ? mb_strtolower(trim($tag)) : null,
            is_string($q) && $q !== '' ? $q : null,
            $limit,
            $offset,
        );
    }

    /**
     * @param  array<string, array<string>>  $errors
     */
    private static function integer(
        Request $request,
        string $name,
        int $default,
        int $min,
        int $max,
        string $message,
        array &$errors,
    ): int {
        $raw = $request->query($name);

        if ($raw === null || $raw === '') {
            return $default;
        }

        if (! is_string($raw) || preg_match('/^-?\d+$/', $raw) !== 1) {
            $errors[$name][] = $message;

            return $default;
        }

        $value = (int) $raw;

        if ($value < $min || $value > $max) {
            $errors[$name][] = $message;

            return $default;
        }

        return $value;
    }
}
