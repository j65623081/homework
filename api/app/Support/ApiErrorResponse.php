<?php

namespace App\Support;

use App\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

/**
 * Единственное место, где исключение превращается в ответ клиенту.
 *
 * Наружу уходит только то, что мы написали сами: код из закрытого перечня SPEC.md,
 * фраза на русском и, для 422, перечень полей. Ни сообщений фреймворка,
 * ни имён классов, ни путей на диске, ни трассировки — независимо от APP_DEBUG.
 */
class ApiErrorResponse
{
    public static function from(Throwable $e): JsonResponse
    {
        $error = self::describe($e);

        $payload = ['error' => array_filter([
            'code' => $error->errorCode,
            'message' => $error->getMessage(),
            'fields' => $error->fields,
        ], fn ($value) => $value !== null)];

        return response()
            ->json($payload, $error->status, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            ->header('Content-Type', 'application/json; charset=utf-8');
    }

    private static function describe(Throwable $e): ApiException
    {
        if ($e instanceof ApiException) {
            return $e;
        }

        // Нет такого маршрута или метод не поддерживается: для клиента это
        // одинаково «такого эндпоинта нет». Отдельного кода для 405 в контракте нет.
        if ($e instanceof NotFoundHttpException || $e instanceof MethodNotAllowedHttpException) {
            return ApiException::notFound();
        }

        // Всё остальное, включая ошибки самого фреймворка, — непредвиденная
        // ошибка сервера. Подробности остаются в логе, клиент их не видит.
        if ($e instanceof HttpExceptionInterface && $e->getStatusCode() === 404) {
            return ApiException::notFound();
        }

        return ApiException::internalError();
    }
}
