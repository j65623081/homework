<?php

use App\Support\ApiErrorResponse;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Всё под /api отвечает единым форматом ошибки из SPEC.md.
        // Трассировки стека наружу не выходят никогда, в том числе при APP_DEBUG=true.
        $exceptions->render(function (Throwable $e, Request $request) {
            return $request->is('api/*') ? ApiErrorResponse::from($e) : null;
        });
    })->create();
