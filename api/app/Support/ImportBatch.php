<?php

namespace App\Support;

use App\Exceptions\ApiException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;

/**
 * Разбор запроса на импорт: заголовки, потолки, тело пачки и её хеш.
 *
 * Порядок проверок здесь — часть контракта, а не деталь реализации:
 *
 * 1. `Content-Type` — от него зависит, где вообще лежит тело (415);
 * 2. `Idempotency-Key` — проверка заголовка, тело для неё не нужно (422);
 * 3. размер тела или файла (413) — «до разбора содержимого»;
 * 4. разбор JSON (400);
 * 5. форма верхнего уровня: только поле `notes`, и оно список;
 * 6. число заметок в пачке (413) — тоже до разбора самих заметок;
 * 7. пустая пачка (422).
 *
 * Сами заметки на этом этапе не разбираются: их брак даёт не отказ, а строки
 * в отчёте о частичном успехе.
 */
class ImportBatch
{
    /** Формат ключа идемпотентности: 8…128 символов [A-Za-z0-9_-]. */
    private const KEY_PATTERN = '/^[A-Za-z0-9_-]{8,128}$/D';

    private const MAX_NOTES = 200;

    private const MAX_BYTES = 2 * 1024 * 1024;

    /** Единственное поле верхнего уровня, описанное контрактом. */
    private const ALLOWED = ['notes'];

    /**
     * @param  array<int, mixed>  $items  элементы пачки как есть, без разбора
     */
    public function __construct(
        public readonly string $key,
        public readonly array $items,
        public readonly string $requestHash,
    ) {}

    public static function fromRequest(Request $request): self
    {
        $format = self::format($request);
        $key = self::key($request);
        $raw = self::rawBody($request, $format);

        $decoded = self::decode($raw);
        $items = self::items($decoded);

        return new self($key, $items, self::requestHash($raw));
    }

    /**
     * Допустимых форматов ровно два. Параметры вроде `; charset=utf-8` не важны,
     * важен сам тип.
     */
    private static function format(Request $request): string
    {
        $header = (string) $request->headers->get('Content-Type', '');
        $mime = strtolower(trim(explode(';', $header)[0]));

        return match ($mime) {
            'application/json' => 'json',
            'multipart/form-data' => 'multipart',
            default => throw ApiException::unsupportedMediaType(),
        };
    }

    private static function key(Request $request): string
    {
        $key = $request->headers->get('Idempotency-Key');

        if (! is_string($key) || preg_match(self::KEY_PATTERN, $key) !== 1) {
            throw ApiException::idempotencyKeyInvalid();
        }

        return $key;
    }

    /**
     * Тело пачки в виде строки — из тела запроса или из загруженного файла.
     * Имя файла, его MIME-тип и любые другие поля multipart игнорируются:
     * разбирается только содержимое.
     */
    private static function rawBody(Request $request, string $format): string
    {
        if ($format === 'json') {
            $raw = $request->getContent();

            if (strlen($raw) > self::MAX_BYTES) {
                throw ApiException::importTooLarge();
            }

            return $raw;
        }

        $file = $request->file('file');

        if (! $file instanceof UploadedFile) {
            throw ApiException::validationFailed([
                'file' => ['Поле обязательно и должно содержать один файл'],
            ]);
        }

        if (! $file->isValid()) {
            // Файл не долез целиком из-за ограничений загрузки — для клиента
            // это то же самое «прислано слишком много».
            if (in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                throw ApiException::importTooLarge();
            }

            throw ApiException::validationFailed([
                'file' => ['Файл не загрузился'],
            ]);
        }

        if ($file->getSize() > self::MAX_BYTES) {
            throw ApiException::importTooLarge();
        }

        $raw = @file_get_contents($file->getPathname());

        if ($raw === false) {
            throw ApiException::internalError();
        }

        if (strlen($raw) > self::MAX_BYTES) {
            throw ApiException::importTooLarge();
        }

        return $raw;
    }

    /**
     * @return array<string, mixed>
     */
    private static function decode(string $raw): array
    {
        // Пустое тело — это не сломанный JSON, а отсутствие полей: пусть его
        // поймает валидация и скажет, что не хватает notes.
        if (trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw ApiException::malformedJson();
        }

        // Ожидается объект. Список, строка или число телом пачки быть не могут.
        if (! is_array($decoded) || (array_is_list($decoded) && $decoded !== [])) {
            throw ApiException::malformedJson();
        }

        return $decoded;
    }

    /**
     * @param  array<string, mixed>  $decoded
     * @return array<int, mixed>
     */
    private static function items(array $decoded): array
    {
        $unknown = array_diff(array_keys($decoded), self::ALLOWED);

        if ($unknown !== []) {
            $fields = [];

            foreach ($unknown as $field) {
                $fields[(string) $field] = ['Поле не описано в контракте'];
            }

            throw ApiException::unknownFields($fields);
        }

        if (! array_key_exists('notes', $decoded)) {
            throw ApiException::validationFailed([
                'notes' => ['Поле обязательно для заполнения'],
            ]);
        }

        $items = $decoded['notes'];

        if (! is_array($items) || ! array_is_list($items)) {
            throw ApiException::validationFailed([
                'notes' => ['Должно быть списком заметок'],
            ]);
        }

        // Потолок числа заметок — до разбора самих заметок: стоимость обработки
        // запроса не должна зависеть от того, что клиент прислал внутри.
        if (count($items) > self::MAX_NOTES) {
            throw ApiException::importTooLarge();
        }

        // Импорт нуля заметок — почти наверняка ошибка на стороне клиента,
        // и тихий успех её спрячет.
        if ($items === []) {
            throw ApiException::validationFailed([
                'notes' => ['Пачка не может быть пустой'],
            ]);
        }

        return $items;
    }

    /**
     * SHA-256 от канонизированного содержимого пачки, а не от сырого тела:
     * те же данные с другим порядком ключей или другими отступами обязаны дать
     * тот же хеш, иначе повтор по таймауту получит ложный 409. По той же причине
     * для формата B хеш считается от содержимого файла, а не от границ multipart.
     */
    private static function requestHash(string $raw): string
    {
        // Разбор без ассоциативных массивов: иначе пустой объект и пустой список
        // становятся неразличимы и два разных тела дали бы один хеш.
        $value = json_decode($raw, false);

        $canonical = json_encode(self::ordered($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($canonical === false) {
            throw ApiException::internalError();
        }

        return hash('sha256', $canonical);
    }

    private static function ordered(mixed $value): mixed
    {
        if (is_object($value)) {
            $fields = get_object_vars($value);
            ksort($fields);

            return (object) array_map(self::ordered(...), $fields);
        }

        if (is_array($value)) {
            return array_map(self::ordered(...), $value);
        }

        return $value;
    }
}
