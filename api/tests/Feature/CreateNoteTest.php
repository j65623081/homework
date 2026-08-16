<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/** POST /api/notes — сценарии 1, 6, 7 и критерии приёмки 1–4 из SPEC.md. */
class CreateNoteTest extends ApiTestCase
{
    public function test_создание_возвращает_201_и_нормализованные_теги(): void
    {
        $response = $this->postJson('/api/notes', [
            'title' => 'Купить хлеб',
            'tags' => ['Работа', ' работа ', 'дом'],
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.tags', ['работа', 'дом']);
        $response->assertJsonPath('data.title', 'Купить хлеб');
        $response->assertJsonPath('data.body', '');
    }

    public function test_создание_отдаёт_заголовок_location_с_идентификатором(): void
    {
        $response = $this->postJson('/api/notes', ['title' => 'Купить хлеб']);

        $id = $response->json('data.id');
        $response->assertHeader('Location', '/api/notes/'.$id);
    }

    public function test_идентификатор_выдаёт_сервер_в_формате_uuid_v4(): void
    {
        $response = $this->postJson('/api/notes', ['title' => 'Купить хлеб']);

        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $response->json('data.id')
        );
    }

    public function test_метки_времени_в_utc_по_iso_8601(): void
    {
        $response = $this->postJson('/api/notes', ['title' => 'Купить хлеб']);

        $this->assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/',
            $response->json('data.created_at')
        );
        $this->assertSame($response->json('data.created_at'), $response->json('data.updated_at'));
    }

    public function test_созданную_заметку_можно_прочитать_по_идентификатору(): void
    {
        $created = $this->createNote(['title' => 'Купить хлеб', 'tags' => ['Работа']]);

        $response = $this->getJson('/api/notes/'.$created['id']);

        $response->assertStatus(200);
        $response->assertJsonPath('data', $created);
    }

    public function test_заголовок_сохраняется_обрезанным(): void
    {
        $response = $this->postJson('/api/notes', ['title' => '  Купить хлеб  ']);

        $response->assertJsonPath('data.title', 'Купить хлеб');
    }

    public function test_без_заголовка_422_validation_failed(): void
    {
        $response = $this->postJson('/api/notes', ['body' => 'без заголовка']);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
        $response->assertJsonStructure(['error' => ['fields' => ['title']]]);
    }

    public function test_заголовок_из_одних_пробелов_422(): void
    {
        $response = $this->postJson('/api/notes', ['title' => '   ']);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
        $response->assertJsonStructure(['error' => ['fields' => ['title']]]);
    }

    public function test_заголовок_длиннее_200_символов_422(): void
    {
        $response = $this->postJson('/api/notes', ['title' => str_repeat('я', 201)]);

        $response->assertStatus(422);
        $response->assertJsonStructure(['error' => ['fields' => ['title']]]);
    }

    public function test_неизвестное_поле_422_unknown_fields(): void
    {
        $response = $this->postJson('/api/notes', ['titel' => 'Купить хлеб']);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'unknown_fields');
        $response->assertJsonStructure(['error' => ['fields' => ['titel']]]);
    }

    public function test_пустой_тег_422_с_указанием_индекса(): void
    {
        $response = $this->postJson('/api/notes', ['title' => 'ok', 'tags' => ['ok', '  ']]);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
        $response->assertJsonStructure(['error' => ['fields' => ['tags.1']]]);
    }

    public function test_больше_десяти_тегов_422(): void
    {
        $tags = array_map(fn ($i) => 'тег'.$i, range(1, 11));

        $response = $this->postJson('/api/notes', ['title' => 'ok', 'tags' => $tags]);

        $response->assertStatus(422);
        $response->assertJsonStructure(['error' => ['fields' => ['tags']]]);
    }

    public function test_тело_не_являющееся_json_даёт_400_malformed_json(): void
    {
        $response = $this->call(
            'POST',
            '/api/notes',
            [], [], [],
            ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'],
            '{"title": "сломано"'
        );

        $response->assertStatus(400);
        $this->assertErrorShape($response, 'malformed_json');
    }

    public function test_ответ_отдаётся_как_json_в_utf_8(): void
    {
        $response = $this->postJson('/api/notes', ['title' => 'Купить хлеб']);

        $this->assertSame(
            'application/json; charset=utf-8',
            strtolower($response->headers->get('Content-Type'))
        );
    }

    public function test_первый_post_создаёт_файл_хранилища(): void
    {
        $this->assertNull($this->rawStorage());

        $this->postJson('/api/notes', ['title' => 'Купить хлеб'])->assertStatus(201);

        $this->assertSame(1, $this->storedCount());
    }
}
