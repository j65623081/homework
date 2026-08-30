<?php

namespace App\Providers;

use App\Support\ImportKeyRegistry;
use App\Support\NoteStorage;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Путь берётся из конфига лениво, при первом обращении: так тест успевает
        // подменить его на временный файл до того, как хранилище будет создано.
        $this->app->singleton(
            NoteStorage::class,
            fn ($app) => new NoteStorage((string) $app['config']->get('notes.path'))
        );

        $this->app->singleton(
            ImportKeyRegistry::class,
            fn ($app) => new ImportKeyRegistry((string) $app['config']->get('notes.keys_path'))
        );
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
