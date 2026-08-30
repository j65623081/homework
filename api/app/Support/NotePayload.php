<?php

namespace App\Support;

use App\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * Разбор и проверка тела запроса для POST и PUT.
 *
 * Тело разбирается вручную, а не через штатную валидацию Laravel, по двум причинам:
 * контракт требует своего формата ошибки и своего разделения 400 / 422, и он требует
 * отклонять неизвестные поля, а не игнорировать их.
 */
class NotePayload
{
    /** Поля, которые клиент вправе прислать. Всё остальное — unknown_fields. */
    private const ALLOWED = ['title', 'body', 'tags'];

    private const TITLE_MAX = 200;

    private const BODY_MAX = 10000;

    private const TAGS_MAX = 10;

    private const TAG_MAX = 30;

    /**
     * @return array{title: string, body: string, tags: array<int, string>}
     */
    public static function fromRequest(Request $request): array
    {
        return self::fromArray(self::decode($request->getContent()));
    }

    /**
     * Тот же разбор, но для уже разобранного объекта. Нужен импорту: элемент пачки
     * подчиняется тем же правилам, что тело POST /api/notes, и повторять их
     * во втором месте нельзя — разъедутся.
     *
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string, tags: array<int, string>}
     */
    public static function fromArray(array $data): array
    {
        self::rejectUnknownFields($data);

        return self::validate($data);
    }

    /**
     * @return array<string, mixed>
     */
    private static function decode(string $raw): array
    {
        // Пустое тело — это не сломанный JSON, а отсутствие полей: пусть его
        // поймает валидация и скажет, что не хватает title.
        if (trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw ApiException::malformedJson();
        }

        // Ожидается объект. Список, строка или число телом заметки быть не могут.
        if (! is_array($decoded) || (array_is_list($decoded) && $decoded !== [])) {
            throw ApiException::malformedJson();
        }

        return $decoded;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function rejectUnknownFields(array $data): void
    {
        $unknown = array_diff(array_keys($data), self::ALLOWED);

        if ($unknown === []) {
            return;
        }

        $fields = [];

        foreach ($unknown as $key) {
            $fields[(string) $key] = ['Поле не описано в контракте'];
        }

        throw ApiException::unknownFields($fields);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string, tags: array<int, string>}
     */
    private static function validate(array $data): array
    {
        $errors = [];

        $title = self::validateTitle($data, $errors);
        $body = self::validateBody($data, $errors);
        $tags = self::validateTags($data, $errors);

        if ($errors !== []) {
            throw ApiException::validationFailed($errors);
        }

        return ['title' => $title, 'body' => $body, 'tags' => $tags];
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, array<string>>  $errors
     */
    private static function validateTitle(array $data, array &$errors): string
    {
        if (! array_key_exists('title', $data)) {
            $errors['title'][] = 'Поле обязательно для заполнения';

            return '';
        }

        if (! is_string($data['title'])) {
            $errors['title'][] = 'Должно быть строкой';

            return '';
        }

        $title = trim($data['title']);
        $length = mb_strlen($title);

        if ($length < 1) {
            $errors['title'][] = 'Не может быть пустым';
        } elseif ($length > self::TITLE_MAX) {
            $errors['title'][] = 'Не длиннее '.self::TITLE_MAX.' символов';
        }

        return $title;
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, array<string>>  $errors
     */
    private static function validateBody(array $data, array &$errors): string
    {
        if (! array_key_exists('body', $data) || $data['body'] === null) {
            return '';
        }

        if (! is_string($data['body'])) {
            $errors['body'][] = 'Должно быть строкой';

            return '';
        }

        if (mb_strlen($data['body']) > self::BODY_MAX) {
            $errors['body'][] = 'Не длиннее '.self::BODY_MAX.' символов';
        }

        return $data['body'];
    }

    /**
     * Нормализация: trim, нижний регистр, дедупликация с сохранением порядка.
     * Индексы в ошибках — из присланного массива, до дедупликации, чтобы клиент
     * мог найти проблемный тег у себя.
     *
     * @param  array<string, mixed>  $data
     * @param  array<string, array<string>>  $errors
     * @return array<int, string>
     */
    private static function validateTags(array $data, array &$errors): array
    {
        if (! array_key_exists('tags', $data) || $data['tags'] === null) {
            return [];
        }

        $tags = $data['tags'];

        if (! is_array($tags) || ! array_is_list($tags)) {
            $errors['tags'][] = 'Должно быть списком строк';

            return [];
        }

        if (count($tags) > self::TAGS_MAX) {
            $errors['tags'][] = 'Не больше '.self::TAGS_MAX.' тегов';

            return [];
        }

        $normalized = [];

        foreach ($tags as $index => $tag) {
            $key = 'tags.'.$index;

            if (! is_string($tag)) {
                $errors[$key][] = 'Тег должен быть строкой';

                continue;
            }

            $value = mb_strtolower(trim($tag));

            if ($value === '') {
                $errors[$key][] = 'Тег не может быть пустым';

                continue;
            }

            if (mb_strlen($value) > self::TAG_MAX) {
                $errors[$key][] = 'Тег не длиннее '.self::TAG_MAX.' символов';

                continue;
            }

            if (! in_array($value, $normalized, true)) {
                $normalized[] = $value;
            }
        }

        return $normalized;
    }
}
