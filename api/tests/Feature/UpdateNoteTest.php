<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/** PUT /api/notes/{id} — сценарии 4, 5 и критерии приёмки 8, 9 из SPEC.md. */
class UpdateNoteTest extends ApiTestCase
{
    public function test_обновление_меняет_поля_и_сдвигает_updated_at(): void
    {
        $this->seedStorage([$this->note([
            'id' => '11111111-1111-4111-8111-111111111111',
            'title' => 'Старый заголовок',
            'updated_at' => '2026-08-16T10:00:00Z',
        ])]);

        $response = $this->putJson('/api/notes/11111111-1111-4111-8111-111111111111', [
            'title' => 'Новый заголовок',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.title', 'Новый заголовок');
        $this->assertNotSame('2026-08-16T10:00:00Z', $response->json('data.updated_at'));
    }

    public function test_created_at_и_id_не_меняются_при_обновлении(): void
    {
        $this->seedStorage([$this->note([
            'id' => '11111111-1111-4111-8111-111111111111',
            'created_at' => '2026-08-16T10:00:00Z',
        ])]);

        $response = $this->putJson('/api/notes/11111111-1111-4111-8111-111111111111', [
            'title' => 'Новый заголовок',
        ]);

        $response->assertJsonPath('data.id', '11111111-1111-4111-8111-111111111111');
        $response->assertJsonPath('data.created_at', '2026-08-16T10:00:00Z');
    }

    public function test_повторный_put_с_тем_же_телом_идемпотентен(): void
    {
        $created = $this->createNote(['title' => 'Заголовок', 'tags' => ['работа']]);

        $first = $this->putJson('/api/notes/'.$created['id'], [
            'title' => 'Изменённый',
            'tags' => ['Работа'],
        ]);
        $first->assertStatus(200);

        $second = $this->putJson('/api/notes/'.$created['id'], [
            'title' => 'Изменённый',
            'tags' => ['Работа'],
        ]);
        $second->assertStatus(200);

        $this->assertSame(
            $first->getContent(),
            $second->getContent(),
            'Повтор PUT должен дать побайтово тот же ответ'
        );
        $this->assertSame($first->json('data.updated_at'), $second->json('data.updated_at'));
    }

    public function test_обновление_полностью_заменяет_изменяемые_поля(): void
    {
        $this->seedStorage([$this->note([
            'id' => '11111111-1111-4111-8111-111111111111',
            'title' => 'Заголовок',
            'body' => 'старое тело',
            'tags' => ['работа'],
        ])]);

        $response = $this->putJson('/api/notes/11111111-1111-4111-8111-111111111111', [
            'title' => 'Только заголовок',
        ]);

        $response->assertJsonPath('data.body', '');
        $response->assertJsonPath('data.tags', []);
    }

    public function test_put_по_несуществующему_id_даёт_404_и_ничего_не_создаёт(): void
    {
        $this->seedStorage([$this->note()]);

        $response = $this->putJson('/api/notes/00000000-0000-4000-8000-000000000000', [
            'title' => 'Новая заметка',
        ]);

        $response->assertStatus(404);
        $this->assertErrorShape($response, 'not_found');
        $this->assertSame(1, $this->storedCount(), 'Upsert выполняться не должен');
    }

    public function test_валидация_при_обновлении_такая_же_как_при_создании(): void
    {
        $this->seedStorage([$this->note(['id' => '11111111-1111-4111-8111-111111111111'])]);

        $response = $this->putJson('/api/notes/11111111-1111-4111-8111-111111111111', [
            'body' => 'без заголовка',
        ]);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'validation_failed');
        $response->assertJsonStructure(['error' => ['fields' => ['title']]]);
    }

    public function test_неизвестное_поле_при_обновлении_422_unknown_fields(): void
    {
        $this->seedStorage([$this->note(['id' => '11111111-1111-4111-8111-111111111111'])]);

        $response = $this->putJson('/api/notes/11111111-1111-4111-8111-111111111111', [
            'title' => 'ok',
            'created_at' => '2020-01-01T00:00:00Z',
        ]);

        $response->assertStatus(422);
        $this->assertErrorShape($response, 'unknown_fields');
        $response->assertJsonStructure(['error' => ['fields' => ['created_at']]]);
    }

    public function test_битый_json_при_обновлении_даёт_400(): void
    {
        $this->seedStorage([$this->note(['id' => '11111111-1111-4111-8111-111111111111'])]);

        $response = $this->call(
            'PUT',
            '/api/notes/11111111-1111-4111-8111-111111111111',
            [], [], [],
            ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'],
            '{"title":'
        );

        $response->assertStatus(400);
        $this->assertErrorShape($response, 'malformed_json');
    }
}
