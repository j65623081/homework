import { CheckFailure, SetupError } from './assert.mjs';

const STATUS_LABEL = {
    ok: 'OK  ',
    fail: 'FAIL',
    skip: 'SKIP',
};

/**
 * Прогон проверок с остановкой на первом расхождении.
 *
 * Остановка на первом — требование задачи: скрипт должен годиться для CI,
 * где важен факт «сломалось», а не полный список. Флаг --keep-going снимает
 * остановку, когда скрипт запускают руками и нужен весь срез сразу;
 * код возврата при этом всё равно ненулевой.
 */
export async function run(checks, ctx, { keepGoing = false, verbose = false, out = console.log } = {}) {
    const total = checks.length;
    const summary = { ok: 0, fail: 0, skip: 0, firstFailure: null, failures: [], skipped: [] };
    let index = 0;

    for (const check of checks) {
        index += 1;
        const prefix = `[${String(index).padStart(2, '0')}/${total}]`;

        const missing = (check.needs ?? []).find((need) => !ctx.capabilities[need].available);
        if (missing) {
            summary.skip += 1;
            summary.skipped.push({ id: check.id, reason: ctx.capabilities[missing].reason });
            out(line('skip', prefix, check, `не прогнано — ${ctx.capabilities[missing].reason}`, verbose));
            continue;
        }

        try {
            const got = await check.run(ctx);
            summary.ok += 1;
            out(line('ok', prefix, check, got, verbose));
        } catch (error) {
            if (error instanceof SetupError) {
                throw error;
            }
            summary.fail += 1;
            const got = error instanceof CheckFailure ? error.got : `исключение: ${error.message}`;
            summary.failures.push({ id: check.id, what: check.what, expect: check.expect, got });
            out(line('fail', prefix, check, got, verbose));
            if (summary.firstFailure === null) {
                summary.firstFailure = { id: check.id, got };
            }
            if (!keepGoing) {
                out('');
                out(`Остановлено на первом расхождении: ${check.id}. Добавьте --keep-going, чтобы увидеть остальные.`);
                break;
            }
        }
    }

    return summary;
}

/** По строке на проверку: что проверяли, чего ждали, что получили. */
function line(status, prefix, check, got, verbose) {
    if (verbose) {
        return (
            `${STATUS_LABEL[status]} ${prefix} ${check.id}\n` +
            `           что:      ${check.what}\n` +
            `           ждали:    ${check.expect}\n` +
            `           получили: ${got}`
        );
    }

    return `${STATUS_LABEL[status]} ${prefix} ${check.id} | ${check.what} | ждали: ${check.expect} | получили: ${got}`;
}
