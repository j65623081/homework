import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { SetupError } from './assert.mjs';

/**
 * Доступ к файлу-хранилищу, на который на время прогона указывает стенд.
 *
 * Железное правило проекта: рабочий api/storage/app/notes.json не читается
 * и не пишется никогда. Здесь оно держится тремя разными способами:
 *
 * 1. Запретный каталог — весь api/storage. Любой путь внутри него отвергается
 *    до первого обращения к диску (см. guard()).
 * 2. Путь берётся только из --storage. Умолчания «взять рабочий файл» нет
 *    вообще: без флага проверки состояний хранилища пропускаются.
 * 3. Перед прогоном стенд доказывает, что читает именно этот файл: в файл
 *    кладётся метка со случайным значением, и она должна вернуться из API.
 *    Стенд, поднятый без NOTES_STORAGE_PATH, эту проверку не проходит,
 *    и мутирующие проверки не запускаются.
 */
export class Storage {
    constructor({ notesPath, keysPath, repoRoot }) {
        this.notesPath = notesPath === null ? null : path.resolve(notesPath);
        this.keysPath = keysPath === null || keysPath === undefined ? null : path.resolve(keysPath);
        this.repoRoot = repoRoot;
        this.available = false;
        this.keysAvailable = false;
        this.unavailableReason = 'не задан --storage: подменять файл-хранилище нечем';
        this.keysUnavailableReason = 'реестр ключей не подменён (--keys)';
    }

    /** Отвергнуть любой путь внутри рабочего хранилища приложения. */
    guard() {
        const forbidden = path.resolve(this.repoRoot, 'api', 'storage');
        for (const candidate of [this.notesPath, this.keysPath]) {
            if (candidate === null) {
                continue;
            }
            if (isInside(forbidden, candidate)) {
                throw new SetupError(
                    `путь ${candidate} лежит внутри рабочего хранилища ${forbidden}. ` +
                        'Правилами проекта запрещено: возьмите путь во временном каталоге.'
                );
            }
        }
    }

    /**
     * Убедиться, что стенд действительно читает подменённый файл.
     * Возвращает true/false; причину недоступности кладёт в unavailableReason.
     */
    async verify(api) {
        if (this.notesPath === null) {
            return false;
        }
        this.guard();

        const marker = `метка-прогона-${crypto.randomUUID()}`;
        this.writeNotes([
            {
                id: crypto.randomUUID(),
                title: marker,
                body: '',
                tags: [],
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
            },
        ]);

        const res = await api.get(`/api/notes?q=${encodeURIComponent(marker)}`);
        const found = res.status === 200 && res.json?.meta?.total === 1 && res.json?.data?.[0]?.title === marker;

        if (!found) {
            this.available = false;
            this.unavailableReason =
                `стенд не читает ${this.notesPath} (метка не вернулась, ответ ${res.status}). ` +
                'Поднимите его с NOTES_STORAGE_PATH, указывающим на этот же файл.';
            return false;
        }

        this.available = true;
        this.unavailableReason = null;
        return true;
    }

    // --- notes.json ---

    writeRaw(contents) {
        this.assertUsable();
        fs.mkdirSync(path.dirname(this.notesPath), { recursive: true });
        fs.writeFileSync(this.notesPath, contents, 'utf8');
    }

    writeNotes(notes) {
        this.writeRaw(JSON.stringify(notes, null, 2));
    }

    remove() {
        this.assertUsable();
        if (fs.existsSync(this.notesPath)) {
            fs.rmSync(this.notesPath);
        }
    }

    exists() {
        this.assertUsable();
        return fs.existsSync(this.notesPath);
    }

    readRaw() {
        this.assertUsable();
        return fs.existsSync(this.notesPath) ? fs.readFileSync(this.notesPath, 'utf8') : null;
    }

    /** Число записей в подменённом хранилище; null, если файл нечитаем как список. */
    count() {
        const raw = this.readRaw();
        if (raw === null || raw.trim() === '') {
            return 0;
        }
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.length : null;
        } catch {
            return null;
        }
    }

    notes() {
        const raw = this.readRaw();
        if (raw === null || raw.trim() === '') {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }

    fingerprint() {
        const raw = this.readRaw();
        return raw === null ? '<файла нет>' : crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
    }

    // --- import_keys.json ---

    writeKeysRaw(contents) {
        this.assertKeysUsable();
        fs.mkdirSync(path.dirname(this.keysPath), { recursive: true });
        fs.writeFileSync(this.keysPath, contents, 'utf8');
    }

    removeKeys() {
        this.assertKeysUsable();
        if (fs.existsSync(this.keysPath)) {
            fs.rmSync(this.keysPath);
        }
    }

    readKeysRaw() {
        this.assertKeysUsable();
        return fs.existsSync(this.keysPath) ? fs.readFileSync(this.keysPath, 'utf8') : null;
    }

    keys() {
        const raw = this.readKeysRaw();
        if (raw === null || raw.trim() === '') {
            return {};
        }
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    keysFingerprint() {
        const raw = this.readKeysRaw();
        return raw === null ? '<файла нет>' : crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
    }

    assertUsable() {
        if (this.notesPath === null) {
            throw new SetupError('файл-хранилище не подменён: нужен --storage');
        }
        this.guard();
    }

    assertKeysUsable() {
        if (this.keysPath === null) {
            throw new SetupError('реестр ключей не подменён: нужен --keys');
        }
        this.guard();
    }
}

function isInside(parent, candidate) {
    const rel = path.relative(normalize(parent), normalize(candidate));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function normalize(p) {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
