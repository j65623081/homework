<?php

use App\Http\Controllers\NoteController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Маршруты API
|--------------------------------------------------------------------------
|
| Пять эндпоинтов из SPEC.md, ни одним больше. Файл подключается вручную
| в bootstrap/app.php: штатный `php artisan install:api` тянет Sanctum,
| а добавлять зависимости в этом проекте запрещено.
|
*/

Route::get('/notes', [NoteController::class, 'index']);
Route::post('/notes', [NoteController::class, 'store']);
Route::get('/notes/{id}', [NoteController::class, 'show']);
Route::put('/notes/{id}', [NoteController::class, 'update']);
Route::delete('/notes/{id}', [NoteController::class, 'destroy']);
