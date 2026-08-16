<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/** DELETE /api/notes/{id} — сценарий 9 и критерий приёмки 10 из SPEC.md. */
class DeleteNoteTest extends ApiTestCase
{
    public function test_удаление_даёт_204_без_тела(): void
    {
        $this->seedStorage([$this->note(['id' => '11111111-1111-4111-8111-111111111111'])]);

        $response = $this->deleteJson('/api/notes/11111111-1111-4111-8111-111111111111');

        $response->assertStatus(204);
        $this->assertSame('', $response->getContent());
        $this->assertSame(0, $this->storedCount());
    }

    public function test_повторное_удаление_даёт_404_а_не_204(): void
    {
        $this->seedStorage([$this->note(['id' => '11111111-1111-4111-8111-111111111111'])]);

        $this->deleteJson('/api/notes/11111111-1111-4111-8111-111111111111')->assertStatus(204);

        $second = $this->deleteJson('/api/notes/11111111-1111-4111-8111-111111111111');

        $second->assertStatus(404);
        $this->assertErrorShape($second, 'not_found');
    }

    public function test_удаление_не_трогает_соседние_записи(): void
    {
        $this->seedStorage([
            $this->note(['id' => '11111111-1111-4111-8111-111111111111']),
            $this->note(['id' => '22222222-2222-4222-8222-222222222222']),
        ]);

        $this->deleteJson('/api/notes/11111111-1111-4111-8111-111111111111')->assertStatus(204);

        $this->getJson('/api/notes/22222222-2222-4222-8222-222222222222')->assertStatus(200);
    }
}
