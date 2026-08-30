<?php

namespace Tests\Feature;

use Tests\ApiTestCase;
use Tests\Concerns\ImportsNotes;

/**
 * Идемпотентность импорта и реестр ключей.
 * Сценарии 12, 13 и критерии приёмки «повтор», «отказы», «состояние хранилища».
 */
class ImportIdempotencyTest extends ApiTestCase
{
    use ImportsNotes;

    public function test_повтор_с_тем_же_ключом_и_телом_возвращает_то_же_тело(): void
    {
        $body = $this->batch([['title' => 'Первая'], ['title' => 'Вторая'], ['title' => 'Третья']]);

        $first = $this->importJson($body);
        $second = $this->importJson($body);

        $first->assertStatus(200);
        $second->assertStatus(200);

        $this->assertSame(
            array_merge($first->json(), ['idempotent_replay' => true]),
            $second->json(),
            'Повтор обязан отличаться от первого ответа только флагом'
        );
    }

    public function test_после_повтора_число_записей_в_хранилище_не_изменилось(): void
    {
        $body = $this->batch([['title' => 'Первая'], ['title' => 'Вторая'], ['title' => 'Третья']]);

        $this->importJson($body)->assertStatus(200);
        $this->assertSame(3, $this->storedCount());

        $before = $this->rawStorage();

        $this->importJson($body)->assertStatus(200);

        $this->assertSame(3, $this->storedCount());
        $this->assertSame($before, $this->rawStorage(), 'Повтор не должен трогать хранилище');
    }

    public function test_повтор_возвращает_отчёт_даже_на_испорченном_хранилище(): void
    {
        // Реестр читается раньше хранилища именно затем, чтобы повтор не зависел
        // от состояния notes.json: сохранённый отчёт уже есть.
        $body = $this->batch([['title' => 'Первая']]);

        $this->importJson($body)->assertStatus(200);

        $corrupted = '[{"id":"1"} мусор';
        $this->writeStorage($corrupted);

        $this->importJson($body)
            ->assertStatus(200)
            ->assertJsonPath('idempotent_replay', true);

        $this->assertSame($corrupted, $this->rawStorage());
    }

    public function test_тот_же_ключ_с_другим_телом_даёт_409(): void
    {
        $this->importJson($this->batch([['title' => 'Первая']]))->assertStatus(200);

        $response = $this->importJson($this->batch([['title' => 'Первая'], ['title' => 'Вторая']]));

        $response->assertStatus(409);
        $this->assertErrorShape($response, 'idempotency_key_conflict');
    }

    public function test_конфликт_ключа_ничего_не_записывает(): void
    {
        $this->importJson($this->batch([['title' => 'Первая']]))->assertStatus(200);

        $storageBefore = $this->rawStorage();
        $keysBefore = $this->rawKeys();

        $this->importJson($this->batch([['title' => 'Другая']]))->assertStatus(409);

        $this->assertSame($storageBefore, $this->rawStorage());
        $this->assertSame($keysBefore, $this->rawKeys());
    }

    public function test_другой_ключ_с_тем_же_содержимым_импортирует_повторно(): void
    {
        $body = $this->batch([['title' => 'Первая']]);

        $this->importJson($body, 'batch-first-key-01')->assertStatus(200);
        $second = $this->importJson($body, 'batch-second-key-1');

        $second->assertStatus(200);
        $second->assertJsonPath('idempotent_replay', false);
        $second->assertJsonPath('imported', 1);

        // Идемпотентность здесь про доставку, а не про дедупликацию:
        // это две заметки, а не одна.
        $this->assertSame(2, $this->storedCount());
    }

    public function test_порядок_ключей_в_json_не_создаёт_ложного_конфликта(): void
    {
        $first = $this->importJson('{"notes":[{"title":"Первая","body":"Текст"}]}');
        $second = $this->importJson('{"notes":[{"body":"Текст","title":"Первая"}]}');

        $first->assertStatus(200);
        $second->assertStatus(200);
        $second->assertJsonPath('idempotent_replay', true);
    }

    public function test_ключ_сохраняется_в_отдельном_файле_реестра(): void
    {
        $this->importJson($this->batch([['title' => 'Первая']]))->assertStatus(200);

        $keys = $this->keys();

        $this->assertArrayHasKey(self::KEY, $keys);
        $this->assertIsString($keys[self::KEY]['request_hash']);
        $this->assertSame(64, strlen($keys[self::KEY]['request_hash']), 'SHA-256 в шестнадцатеричном виде');
        $this->assertSame(1, $keys[self::KEY]['response']['imported']);
        $this->assertArrayHasKey('created_at', $keys[self::KEY]);

        // notes.json остаётся массивом заметок — реестр в него не подмешивается.
        $this->assertTrue(array_is_list(json_decode($this->rawStorage(), true)));
    }

    public function test_ключ_записывается_и_когда_ничего_не_импортировалось(): void
    {
        $this->importJson($this->batch([['body' => 'Без заголовка']]))->assertStatus(200);

        $this->assertArrayHasKey(self::KEY, $this->keys());
    }

    public function test_при_переполнении_реестра_вытесняется_самая_старая_запись(): void
    {
        $entries = [];

        for ($i = 0; $i < 500; $i++) {
            $entries['seeded-key-'.str_pad((string) $i, 4, '0', STR_PAD_LEFT)] = [
                'request_hash' => str_repeat('0', 64),
                'response' => ['imported' => 0, 'rejected' => 0, 'idempotent_replay' => false, 'notes' => [], 'errors' => []],
                'created_at' => sprintf('2026-01-%02dT%02d:00:00Z', intdiv($i, 24) + 1, $i % 24),
            ];
        }

        $this->writeKeys(json_encode($entries, JSON_UNESCAPED_UNICODE));

        $this->importJson($this->batch([['title' => 'Первая']]))->assertStatus(200);

        $keys = $this->keys();

        $this->assertCount(500, $keys);
        $this->assertArrayNotHasKey('seeded-key-0000', $keys, 'Вытесняется самая старая запись');
        $this->assertArrayHasKey('seeded-key-0499', $keys, 'Самая новая остаётся');
        $this->assertArrayHasKey(self::KEY, $keys);
    }

    public function test_испорченный_реестр_даёт_500_internal_error(): void
    {
        $this->writeKeys('{"batch-001": мусор');

        $response = $this->importJson($this->batch([['title' => 'Первая']]));

        $response->assertStatus(500);
        $this->assertErrorShape($response, 'internal_error');
    }

    public function test_испорченный_реестр_не_перезаписывается(): void
    {
        $corrupted = '{"batch-001": мусор';
        $this->writeKeys($corrupted);

        $this->importJson($this->batch([['title' => 'Первая']]))->assertStatus(500);

        $this->assertSame($corrupted, $this->rawKeys());
        $this->assertNull($this->rawStorage(), 'Заметки не должны записываться при нечитаемом реестре');
    }

    public function test_отсутствующий_реестр_трактуется_как_пустой(): void
    {
        $this->assertNull($this->rawKeys());

        $this->importJson($this->batch([['title' => 'Первая']]))
            ->assertStatus(200)
            ->assertJsonPath('idempotent_replay', false);
    }
}
