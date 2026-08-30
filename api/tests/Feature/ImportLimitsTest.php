<?php

namespace Tests\Feature;

use Tests\ApiTestCase;
use Tests\Concerns\ImportsNotes;

/**
 * Импорт — отказы уровня всей пачки и потолки.
 * Сценарии 17, 18, 19 и критерии приёмки «Импорт — отказы».
 */
class ImportLimitsTest extends ApiTestCase
{
    use ImportsNotes;

    public function test_запрос_без_ключа_идемпотентности_даёт_422(): void
    {
        $response = $this->importJson($this->batch([['title' => 'Первая']]), null);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'idempotency_key_invalid');

        $this->assertNull($this->rawStorage(), 'Хранилище не должно измениться');
    }

    public function test_ключ_короче_восьми_символов_даёт_422(): void
    {
        $response = $this->importJson($this->batch([['title' => 'Первая']]), 'short-1');

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'idempotency_key_invalid');
    }

    public function test_ключ_с_недопустимыми_символами_даёт_422(): void
    {
        $response = $this->importJson($this->batch([['title' => 'Первая']]), 'ключ-с-кириллицей');

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'idempotency_key_invalid');
    }

    public function test_ключ_длиннее_128_символов_даёт_422(): void
    {
        $response = $this->importJson($this->batch([['title' => 'Первая']]), str_repeat('a', 129));

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'idempotency_key_invalid');
    }

    public function test_ошибка_ключа_не_содержит_поля_fields(): void
    {
        $response = $this->importJson($this->batch([['title' => 'Первая']]), null);

        $response->assertStatus(422);
        $this->assertArrayNotHasKey(
            'fields',
            $response->json('error'),
            'Ошибка относится к заголовку, а не к полю тела'
        );
    }

    public function test_чужой_content_type_даёт_415(): void
    {
        $response = $this->call(
            'POST',
            '/api/notes/import',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'text/plain', 'HTTP_IDEMPOTENCY_KEY' => self::KEY],
            $this->batch([['title' => 'Первая']])
        );

        $response->assertStatus(415);
        $this->assertErrorShape($response, 'unsupported_media_type');
    }

    public function test_пачка_из_201_заметки_даёт_413(): void
    {
        $items = array_fill(0, 201, ['title' => 'Заметка']);

        $response = $this->importJson($this->batch($items));

        $response->assertStatus(413);
        $this->assertErrorShape($response, 'import_too_large');

        $this->assertNull($this->rawStorage());
    }

    public function test_потолок_пачки_срабатывает_до_разбора_содержимого(): void
    {
        // 201 элемент, и все до одного невалидны: контракт обещает 413, а не отчёт
        // о частичном успехе — потолок проверяется раньше содержимого.
        $items = array_fill(0, 201, ['titel' => 'Опечатка']);

        $this->importJson($this->batch($items))
            ->assertStatus(413)
            ->assertJsonPath('error.code', 'import_too_large');
    }

    public function test_ровно_200_заметок_импортируются(): void
    {
        $items = array_fill(0, 200, ['title' => 'Заметка']);

        $this->importJson($this->batch($items))
            ->assertStatus(200)
            ->assertJsonPath('imported', 200);
    }

    public function test_тело_больше_двух_мегабайт_даёт_413(): void
    {
        $body = '{"notes":[{"title":"Большая","body":"'.str_repeat('a', 2 * 1024 * 1024).'"}]}';

        $this->assertGreaterThan(2 * 1024 * 1024, strlen($body));

        $response = $this->importJson($body);

        $response->assertStatus(413);
        $this->assertErrorShape($response, 'import_too_large');
    }

    public function test_файл_больше_двух_мегабайт_даёт_413(): void
    {
        $contents = '{"notes":[{"title":"Большая","body":"'.str_repeat('a', 2 * 1024 * 1024).'"}]}';

        $response = $this->importFile($contents);

        $response->assertStatus(413);
        $this->assertErrorShape($response, 'import_too_large');
    }

    public function test_пустая_пачка_даёт_422_validation_failed(): void
    {
        $response = $this->importJson('{"notes":[]}');

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
    }

    public function test_файл_не_разбирающийся_как_json_даёт_400(): void
    {
        $response = $this->importFile('это вообще не json');

        $response->assertStatus(400);
        $this->assertErrorShape($response, 'malformed_json');
    }

    public function test_битый_json_в_теле_даёт_400(): void
    {
        $response = $this->importJson('{"notes":[{"title":"Первая"}');

        $response->assertStatus(400);
        $this->assertErrorShape($response, 'malformed_json');
    }

    public function test_multipart_без_поля_file_даёт_422(): void
    {
        $response = $this->call(
            'POST',
            '/api/notes/import',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'multipart/form-data; boundary=----test', 'HTTP_IDEMPOTENCY_KEY' => self::KEY]
        );

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
    }

    public function test_неизвестное_поле_верхнего_уровня_отклоняет_пачку(): void
    {
        $response = $this->importJson('{"nots":[{"title":"Первая"}]}');

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'unknown_fields');
        $this->assertArrayHasKey('nots', $response->json('error.fields'));
    }

    public function test_ни_один_отказ_не_создал_записи_в_реестре_ключей(): void
    {
        $valid = $this->batch([['title' => 'Первая']]);

        $this->importJson($valid, null)->assertStatus(422);
        $this->importJson($valid, 'short-1')->assertStatus(422);
        $this->importJson($this->batch(array_fill(0, 201, ['title' => 'Заметка'])))->assertStatus(413);
        $this->importJson('{"notes":[]}')->assertStatus(422);
        $this->importJson('{"notes":[')->assertStatus(400);

        $this->assertNull($this->rawKeys(), 'Реестр не должен появляться от неудавшихся запросов');
    }

    public function test_импорт_на_испорченное_хранилище_даёт_500_storage_corrupted(): void
    {
        $this->writeStorage('[{"id":"1"} мусор');

        $response = $this->importJson($this->batch([['title' => 'Первая']]));

        $response->assertStatus(500);
        $this->assertErrorShape($response, 'storage_corrupted');
    }

    public function test_испорченное_хранилище_не_перезаписывается_импортом(): void
    {
        $corrupted = '[{"id":"1"} мусор';
        $this->writeStorage($corrupted);

        $this->importJson($this->batch([['title' => 'Первая']]))->assertStatus(500);

        $this->assertSame($corrupted, $this->rawStorage());
        $this->assertNull($this->rawKeys(), 'Ключ не фиксируется, если заметки не записаны');
    }

    public function test_ошибки_импорта_не_содержат_трассировок_путей_и_имён_классов(): void
    {
        $responses = [
            $this->importJson($this->batch([['title' => 'Первая']]), null),
            $this->importJson('не json'),
            $this->importJson($this->batch(array_fill(0, 201, ['title' => 'Заметка']))),
        ];

        foreach ($responses as $response) {
            $body = $response->getContent();

            $this->assertStringNotContainsString('Exception', $body);
            $this->assertStringNotContainsString('App\\', $body);
            $this->assertStringNotContainsString('vendor', $body);
            $this->assertStringNotContainsString('#0 ', $body);
            $this->assertStringNotContainsString(base_path(), $body);
        }
    }
}
