<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/** GET /api/notes — сценарии 2, 3, 8 и критерии приёмки 5–7 из SPEC.md. */
class ListNotesTest extends ApiTestCase
{
    public function test_список_отдаёт_data_и_meta(): void
    {
        $this->seedStorage([
            $this->note(['title' => 'Первая', 'created_at' => '2026-08-16T10:00:00Z']),
            $this->note(['title' => 'Вторая', 'created_at' => '2026-08-16T11:00:00Z']),
        ]);

        $response = $this->getJson('/api/notes');

        $response->assertStatus(200);
        $response->assertJsonPath('meta.total', 2);
        $response->assertJsonPath('meta.limit', 20);
        $response->assertJsonPath('meta.offset', 0);
        $response->assertJsonCount(2, 'data');
    }

    public function test_сортировка_по_created_at_по_убыванию(): void
    {
        $this->seedStorage([
            $this->note(['title' => 'Старая', 'created_at' => '2026-08-16T10:00:00Z']),
            $this->note(['title' => 'Новая', 'created_at' => '2026-08-16T12:00:00Z']),
            $this->note(['title' => 'Средняя', 'created_at' => '2026-08-16T11:00:00Z']),
        ]);

        $titles = $this->getJson('/api/notes')->json('data.*.title');

        $this->assertSame(['Новая', 'Средняя', 'Старая'], $titles);
    }

    public function test_при_равном_created_at_порядок_по_id_по_возрастанию(): void
    {
        $this->seedStorage([
            $this->note(['id' => 'ccccccc0-0000-4000-8000-000000000000', 'created_at' => '2026-08-16T10:00:00Z']),
            $this->note(['id' => 'aaaaaaa0-0000-4000-8000-000000000000', 'created_at' => '2026-08-16T10:00:00Z']),
            $this->note(['id' => 'bbbbbbb0-0000-4000-8000-000000000000', 'created_at' => '2026-08-16T10:00:00Z']),
        ]);

        $ids = $this->getJson('/api/notes')->json('data.*.id');

        $this->assertSame([
            'aaaaaaa0-0000-4000-8000-000000000000',
            'bbbbbbb0-0000-4000-8000-000000000000',
            'ccccccc0-0000-4000-8000-000000000000',
        ], $ids);
    }

    public function test_фильтр_по_тегу(): void
    {
        $this->seedStorage([
            $this->note(['title' => 'С тегом', 'tags' => ['работа']]),
            $this->note(['title' => 'Без тега', 'tags' => ['дом']]),
        ]);

        $response = $this->getJson('/api/notes?tag=работа');

        $response->assertStatus(200);
        $response->assertJsonPath('meta.total', 1);
        $response->assertJsonPath('data.0.title', 'С тегом');
    }

    public function test_фильтр_по_тегу_сравнивает_нормализованное_значение(): void
    {
        $this->seedStorage([$this->note(['tags' => ['работа']])]);

        // Пробелы и регистр — как их прислал бы настоящий клиент, в кодированном виде.
        $this->getJson('/api/notes?tag='.rawurlencode('  РАБОТА  '))
            ->assertJsonPath('meta.total', 1);
    }

    public function test_фильтр_без_совпадений_даёт_200_и_пустой_список(): void
    {
        $this->seedStorage([$this->note(['tags' => ['работа']])]);

        $response = $this->getJson('/api/notes?tag=отпуск');

        $response->assertStatus(200);
        $response->assertJsonPath('data', []);
        $response->assertJsonPath('meta.total', 0);
    }

    public function test_поиск_по_подстроке_регистронезависим_и_смотрит_в_title_и_body(): void
    {
        $this->seedStorage([
            $this->note(['title' => 'Купить ХЛЕБ', 'body' => '']),
            $this->note(['title' => 'Другое', 'body' => 'не забыть хлеб']),
            $this->note(['title' => 'Третье', 'body' => 'молоко']),
        ]);

        $response = $this->getJson('/api/notes?q=хлеб');

        $response->assertJsonPath('meta.total', 2);
    }

    public function test_meta_total_считается_до_применения_limit(): void
    {
        $this->seedStorage(array_map(
            fn ($i) => $this->note(['title' => 'Заметка '.$i, 'created_at' => sprintf('2026-08-16T10:%02d:00Z', $i)]),
            range(1, 7)
        ));

        $response = $this->getJson('/api/notes?limit=3');

        $response->assertJsonPath('meta.total', 7);
        $response->assertJsonPath('meta.limit', 3);
        $response->assertJsonCount(3, 'data');
    }

    public function test_offset_за_пределами_даёт_пустой_список_при_непустом_total(): void
    {
        $this->seedStorage([$this->note(), $this->note()]);

        $response = $this->getJson('/api/notes?offset=9999');

        $response->assertStatus(200);
        $response->assertJsonPath('data', []);
        $response->assertJsonPath('meta.total', 2);
        $response->assertJsonPath('meta.offset', 9999);
    }

    /**
     * @dataProvider невалидныеLimit
     */
    public function test_невалидный_limit_даёт_422_с_указанием_поля(string $value): void
    {
        $response = $this->getJson('/api/notes?limit='.$value);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
        $response->assertJsonStructure(['error' => ['fields' => ['limit']]]);
        // Ошибка про строку запроса не должна называть себя ошибкой тела запроса.
        $response->assertJsonPath('error.message', 'Параметры запроса не прошли валидацию');
    }

    public static function невалидныеLimit(): array
    {
        return [['0'], ['-1'], ['101'], ['abc'], ['1.5']];
    }

    /**
     * @dataProvider невалидныеOffset
     */
    public function test_невалидный_offset_даёт_422_с_указанием_поля(string $value): void
    {
        $response = $this->getJson('/api/notes?offset='.$value);

        $response->assertStatus(422);
        $response->assertJsonStructure(['error' => ['fields' => ['offset']]]);
    }

    public static function невалидныеOffset(): array
    {
        return [['-1'], ['abc']];
    }

    public function test_пустой_limit_считается_отсутствующим(): void
    {
        $response = $this->getJson('/api/notes?limit=');

        $response->assertStatus(200);
        $response->assertJsonPath('meta.limit', 20);
    }

    public function test_граничные_значения_limit_принимаются(): void
    {
        $this->getJson('/api/notes?limit=1')->assertStatus(200)->assertJsonPath('meta.limit', 1);
        $this->getJson('/api/notes?limit=100')->assertStatus(200)->assertJsonPath('meta.limit', 100);
        $this->getJson('/api/notes?offset=0')->assertStatus(200)->assertJsonPath('meta.offset', 0);
    }
}
