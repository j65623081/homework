<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/** Состояния хранилища — сценарий 10 и критерии приёмки 11–13 из SPEC.md. */
class StorageStateTest extends ApiTestCase
{
    public function test_отсутствующий_файл_трактуется_как_пустой_список(): void
    {
        $this->assertNull($this->rawStorage());

        $response = $this->getJson('/api/notes');

        $response->assertStatus(200);
        $response->assertJsonPath('data', []);
        $response->assertJsonPath('meta.total', 0);
    }

    public function test_чтение_не_создаёт_файл_хранилища(): void
    {
        $this->getJson('/api/notes')->assertStatus(200);

        $this->assertNull($this->rawStorage(), 'GET не должен создавать файл');
    }

    public function test_пустой_файл_нулевой_длины_трактуется_как_пустой_список(): void
    {
        $this->writeStorage('');

        $response = $this->getJson('/api/notes');

        $response->assertStatus(200);
        $response->assertJsonPath('data', []);
    }

    public function test_файл_с_пустым_массивом_трактуется_как_пустой_список(): void
    {
        $this->writeStorage('[]');

        $this->getJson('/api/notes')->assertStatus(200)->assertJsonPath('data', []);
    }

    public function test_испорченный_файл_даёт_500_storage_corrupted(): void
    {
        $this->writeStorage('[{"id":"1"} мусор');

        $response = $this->getJson('/api/notes');

        $response->assertStatus(500);
        $this->assertErrorShape($response, 'storage_corrupted');
    }

    public function test_испорченный_файл_не_перезаписывается(): void
    {
        $corrupted = '[{"id":"1"} мусор';
        $this->writeStorage($corrupted);

        $this->getJson('/api/notes')->assertStatus(500);
        $this->postJson('/api/notes', ['title' => 'Новая'])->assertStatus(500);
        $this->deleteJson('/api/notes/11111111-1111-4111-8111-111111111111')->assertStatus(500);

        $this->assertSame($corrupted, $this->rawStorage(), 'Файл-хранилище должен остаться нетронутым');
    }

    public function test_любой_эндпоинт_на_испорченном_хранилище_даёт_storage_corrupted(): void
    {
        $this->writeStorage('{не json');

        $this->assertErrorShape($this->getJson('/api/notes'), 'storage_corrupted');
        $this->assertErrorShape($this->getJson('/api/notes/11111111-1111-4111-8111-111111111111'), 'storage_corrupted');
        $this->assertErrorShape($this->postJson('/api/notes', ['title' => 'ok']), 'storage_corrupted');
        $this->assertErrorShape($this->putJson('/api/notes/11111111-1111-4111-8111-111111111111', ['title' => 'ok']), 'storage_corrupted');
        $this->assertErrorShape($this->deleteJson('/api/notes/11111111-1111-4111-8111-111111111111'), 'storage_corrupted');
    }

    public function test_json_верхнего_уровня_не_массив_считается_порчей(): void
    {
        $this->writeStorage('{"notes": []}');

        $this->getJson('/api/notes')->assertStatus(500);
    }
}
