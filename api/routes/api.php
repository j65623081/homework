<?php

use App\Http\Controllers\NoteController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Маршруты API
|--------------------------------------------------------------------------
|
| Шесть эндпоинтов из SPEC.md, ни одним больше. Файл подключается вручную
| в bootstrap/app.php: штатный `php artisan install:api` тянет Sanctum,
| а добавлять зависимости в этом проекте запрещено.
|
*/

Route::get('/notes', [NoteController::class, 'index']);
Route::post('/notes', [NoteController::class, 'store']);
// Импорт объявлен до /notes/{id}: пересечения с ним нет, но порядок делает
// намерение очевидным при чтении файла.
Route::post('/notes/import', [NoteController::class, 'import']);
Route::get('/notes/{id}', [NoteController::class, 'show']);
Route::put('/notes/{id}', [NoteController::class, 'update']);
Route::delete('/notes/{id}', [NoteController::class, 'destroy']);
