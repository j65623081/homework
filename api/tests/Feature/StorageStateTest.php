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

    /**
     * Находки сессии 3. Список разбирался как JSON и проходил проверку контейнера,
     * а что лежит внутри — не смотрел никто.
     */
    public function test_элемент_списка_не_объект_считается_порчей(): void
    {
        $this->writeStorage('[1,2,3]');

        $response = $this->getJson('/api/notes');

        $response->assertStatus(500);
        $this->assertErrorShape($response, 'storage_corrupted');
    }

    public function test_элемент_списка_без_id_считается_порчей(): void
    {
        $this->writeStorage('[{}]');

        $response = $this->getJson('/api/notes');

        $response->assertStatus(500);
        $this->assertErrorShape($response, 'storage_corrupted');
    }

    public function test_запись_с_пустым_или_нестроковым_id_считается_порчей(): void
    {
        foreach (['[{"id":""}]', '[{"id":null}]', '[{"id":42}]', '[{"id":["x"]}]'] as $contents) {
            $this->writeStorage($contents);

            $response = $this->getJson('/api/notes');

            $response->assertStatus(500, "Хранилище {$contents} должно считаться испорченным");
            $this->assertErrorShape($response, 'storage_corrupted');
        }
    }

    public function test_вложенный_список_вместо_записи_считается_порчей(): void
    {
        $this->writeStorage('[["id","x"]]');

        $this->assertErrorShape($this->getJson('/api/notes'), 'storage_corrupted');
    }

    public function test_запись_без_остальных_полей_порчей_не_считается(): void
    {
        // Граница проведена по id: у него нет разумного значения по умолчанию,
        // это адрес записи. Остальные поля present() дополняет пустыми значениями,
        // и это не выдумывание данных, а отражение пустоты.
        $this->writeStorage('[{"id":"11111111-1111-4111-8111-111111111111"}]');

        $response = $this->getJson('/api/notes');

        $response->assertStatus(200);
        $response->assertJsonPath('data.0.id', '11111111-1111-4111-8111-111111111111');
        $response->assertJsonPath('data.0.title', '');
        $response->assertJsonPath('data.0.tags', []);
    }

    public function test_испорченная_запись_не_перезаписывается(): void
    {
        $corrupted = '[{}]';
        $this->writeStorage($corrupted);

        $this->postJson('/api/notes', ['title' => 'Новая'])->assertStatus(500);

        $this->assertSame($corrupted, $this->rawStorage(), 'Файл должен остаться нетронутым');
    }
}
