<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiException;
use App\Support\ListQuery;
use App\Support\NotePayload;
use App\Support\NoteStorage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;

class NoteController extends Controller
{
    public function __construct(private readonly NoteStorage $storage) {}

    /** GET /api/notes */
    public function index(Request $request): JsonResponse
    {
        $query = ListQuery::fromRequest($request);

        $notes = $this->sorted($this->filtered($this->storage->all(), $query));

        $total = count($notes);
        $page = array_slice($notes, $query->offset, $query->limit);

        return $this->json([
            'data' => array_map($this->present(...), $page),
            'meta' => [
                'total' => $total,
                'limit' => $query->limit,
                'offset' => $query->offset,
            ],
        ]);
    }

    /** POST /api/notes */
    public function store(Request $request): JsonResponse
    {
        $payload = NotePayload::fromRequest($request);

        $notes = $this->storage->all();

        $now = $this->now();
        $note = [
            'id' => (string) Str::uuid(),
            'title' => $payload['title'],
            'body' => $payload['body'],
            'tags' => $payload['tags'],
            'created_at' => $now,
            'updated_at' => $now,
        ];

        $notes[] = $note;
        $this->storage->save($notes);

        return $this->json(['data' => $this->present($note)], 201)
            ->header('Location', '/api/notes/'.$note['id']);
    }

    /** GET /api/notes/{id} */
    public function show(string $id): JsonResponse
    {
        $notes = $this->storage->all();
        $index = $this->indexOf($notes, $id);

        if ($index === null) {
            throw ApiException::notFound();
        }

        return $this->json(['data' => $this->present($notes[$index])]);
    }

    /** PUT /api/notes/{id} */
    public function update(Request $request, string $id): JsonResponse
    {
        $payload = NotePayload::fromRequest($request);

        $notes = $this->storage->all();
        $index = $this->indexOf($notes, $id);

        // Upsert не выполняется: создание идёт только через POST.
        if ($index === null) {
            throw ApiException::notFound();
        }

        $note = $notes[$index];

        // Идемпотентность: если нормализованное тело совпало с текущим состоянием,
        // файл не перезаписывается и updated_at не сдвигается — второй ответ
        // на тот же запрос побайтово равен первому.
        $unchanged = ($note['title'] ?? null) === $payload['title']
            && ($note['body'] ?? '') === $payload['body']
            && array_values($note['tags'] ?? []) === $payload['tags'];

        if (! $unchanged) {
            $note['title'] = $payload['title'];
            $note['body'] = $payload['body'];
            $note['tags'] = $payload['tags'];
            $note['updated_at'] = $this->now();

            $notes[$index] = $note;
            $this->storage->save($notes);
        }

        return $this->json(['data' => $this->present($note)]);
    }

    /** DELETE /api/notes/{id} */
    public function destroy(string $id): Response
    {
        $notes = $this->storage->all();
        $index = $this->indexOf($notes, $id);

        if ($index === null) {
            throw ApiException::notFound();
        }

        array_splice($notes, $index, 1);
        $this->storage->save($notes);

        return response()->noContent();
    }

    /**
     * @param  array<int, array<string, mixed>>  $notes
     * @return array<int, array<string, mixed>>
     */
    private function filtered(array $notes, ListQuery $query): array
    {
        if ($query->tag !== null) {
            $notes = array_filter(
                $notes,
                fn (array $note) => in_array($query->tag, $note['tags'] ?? [], true)
            );
        }

        if ($query->q !== null) {
            $notes = array_filter(
                $notes,
                fn (array $note) => mb_stripos((string) ($note['title'] ?? ''), $query->q) !== false
                    || mb_stripos((string) ($note['body'] ?? ''), $query->q) !== false
            );
        }

        return array_values($notes);
    }

    /**
     * Порядок фиксирован спецификацией: created_at по убыванию, при равенстве —
     * id по возрастанию. Вторичный ключ нужен, чтобы порядок не зависел от
     * реализации сортировки и тесты не «моргали».
     *
     * @param  array<int, array<string, mixed>>  $notes
     * @return array<int, array<string, mixed>>
     */
    private function sorted(array $notes): array
    {
        usort($notes, fn (array $a, array $b) => [$b['created_at'] ?? '', $a['id'] ?? '']
            <=> [$a['created_at'] ?? '', $b['id'] ?? '']);

        return $notes;
    }

    /**
     * @param  array<int, array<string, mixed>>  $notes
     */
    private function indexOf(array $notes, string $id): ?int
    {
        foreach ($notes as $index => $note) {
            if (($note['id'] ?? null) === $id) {
                return $index;
            }
        }

        return null;
    }

    /**
     * Порядок и состав полей в ответе фиксированы контрактом и не зависят
     * от того, что лежит в файле.
     *
     * @param  array<string, mixed>  $note
     * @return array<string, mixed>
     */
    private function present(array $note): array
    {
        return [
            'id' => $note['id'] ?? null,
            'title' => $note['title'] ?? '',
            'body' => $note['body'] ?? '',
            'tags' => array_values($note['tags'] ?? []),
            'created_at' => $note['created_at'] ?? null,
            'updated_at' => $note['updated_at'] ?? null,
        ];
    }

    private function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z');
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function json(array $payload, int $status = 200): JsonResponse
    {
        return response()
            ->json($payload, $status, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            ->header('Content-Type', 'application/json; charset=utf-8');
    }
}
