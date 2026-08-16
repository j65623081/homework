<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\ApiTestCase;

/** Единый формат ошибки — критерий приёмки 14 из SPEC.md. */
class ErrorFormatTest extends ApiTestCase
{
    public function test_чтение_несуществующей_заметки_даёт_404_not_found(): void
    {
        $this->seedStorage([$this->note()]);

        $response = $this->getJson('/api/notes/00000000-0000-4000-8000-000000000000');

        $response->assertStatus(404);
        $this->assertErrorShape($response, 'not_found');
    }

    public function test_идентификатор_не_в_формате_uuid_даёт_404(): void
    {
        $response = $this->getJson('/api/notes/не-идентификатор');

        $response->assertStatus(404);
        $this->assertErrorShape($response, 'not_found');
    }

    public function test_несуществующий_маршрут_под_api_даёт_единый_формат_ошибки(): void
    {
        $response = $this->getJson('/api/чего-то-нет');

        $response->assertStatus(404);
        $this->assertErrorShape($response, 'not_found');
    }

    /**
     * @dataProvider ошибочныеЗапросы
     */
    public function test_ответ_об_ошибке_не_содержит_внутренностей(string $method, string $uri, array $payload): void
    {
        $this->writeStorage('[{"id":"1"} мусор');

        $response = $this->json($method, $uri, $payload);
        $body = $response->getContent();

        foreach ([
            'Exception',      // имена классов исключений
            'Illuminate\\',   // пространства имён фреймворка
            'App\\',          // пространства имён приложения
            'vendor',         // путь внутрь зависимостей
            '.php',           // путь к файлу на диске
            '#0 ',            // строка трассировки стека
            sys_get_temp_dir(),
            base_path(),
        ] as $утечка) {
            $this->assertStringNotContainsString(
                $утечка,
                $body,
                "Ответ об ошибке содержит «{$утечка}»: ".$body
            );
        }
    }

    public static function ошибочныеЗапросы(): array
    {
        return [
            'испорченное хранилище' => ['GET', '/api/notes', []],
            'нет маршрута' => ['GET', '/api/нет-такого', []],
            'невалидный limit' => ['GET', '/api/notes?limit=-1', []],
        ];
    }

    public function test_непредвиденное_исключение_не_раскрывает_трассировку(): void
    {
        Route::get('/api/тест-падения', function () {
            throw new RuntimeException('внутренняя деталь с путём '.base_path());
        });

        $response = $this->getJson('/api/тест-падения');

        $response->assertStatus(500);
        $response->assertJsonStructure(['error' => ['code', 'message']]);
        $this->assertStringNotContainsString(base_path(), $response->getContent());
        $this->assertStringNotContainsString('внутренняя деталь', $response->getContent());
    }

    public function test_ошибка_валидации_перечисляет_все_проблемные_поля(): void
    {
        $response = $this->getJson('/api/notes?limit=-1&offset=-1');

        $response->assertStatus(422);
        $response->assertJsonStructure(['error' => ['code', 'message', 'fields' => ['limit', 'offset']]]);
    }
}
