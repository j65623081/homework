import { SetupError } from './assert.mjs';

/**
 * HTTP-клиент поверх встроенного fetch. Ни одной зависимости.
 *
 * Тело с кириллицей передаётся как строка и кодируется в UTF-8 самим fetch —
 * той проблемы, что была у `curl.exe -d` на Windows, здесь нет. Чтобы это было
 * не предположением, а фактом, среди проверок есть отдельная: заметка с кириллицей
 * и эмодзи создаётся и читается обратно дословно.
 */
export function createClient(baseUrl, { timeout = 10000, onResponse = () => {} } = {}) {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    async function request(method, path, options = {}) {
        const { headers = {}, body = undefined } = options;
        const url = `${base}${path}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        let res;
        try {
            res = await fetch(url, { method, headers, body, redirect: 'manual', signal: controller.signal });
        } catch (error) {
            throw new SetupError(`запрос ${method} ${path} не выполнен: ${error.message}`);
        } finally {
            clearTimeout(timer);
        }

        const text = await res.text();
        let json = null;
        try {
            json = text.length > 0 ? JSON.parse(text) : null;
        } catch {
            json = null;
        }

        const result = {
            method,
            path,
            status: res.status,
            headers: Object.fromEntries(res.headers.entries()),
            text,
            json,
        };
        onResponse(result);

        return result;
    }

    const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

    return {
        base,
        request,
        get: (path, options = {}) => request('GET', path, { headers: { Accept: 'application/json', ...options.headers }, ...options }),
        del: (path, options = {}) => request('DELETE', path, { headers: { Accept: 'application/json', ...options.headers }, ...options }),
        postJson: (path, payload, options = {}) =>
            request('POST', path, {
                headers: { ...jsonHeaders, ...options.headers },
                body: typeof payload === 'string' ? payload : JSON.stringify(payload),
            }),
        putJson: (path, payload, options = {}) =>
            request('PUT', path, {
                headers: { ...jsonHeaders, ...options.headers },
                body: typeof payload === 'string' ? payload : JSON.stringify(payload),
            }),
    };
}

/**
 * Сборка тела multipart/form-data вручную.
 *
 * FormData из Node подошёл бы, но он не даёт положить произвольное имя файла
 * с инъекцией внутри и произвольный MIME-тип так же явно, а по SPEC.md именно
 * это и нужно проверять: метаданные файла не влияют ни на что.
 */
export function multipart(parts, boundary = `----notes-check-${Math.random().toString(36).slice(2)}`) {
    const chunks = [];
    for (const part of parts) {
        let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
        if (part.filename !== undefined) {
            header += `; filename="${part.filename}"`;
        }
        header += '\r\n';
        if (part.contentType) {
            header += `Content-Type: ${part.contentType}\r\n`;
        }
        header += '\r\n';
        chunks.push(Buffer.from(header, 'utf8'));
        chunks.push(Buffer.from(part.value, 'utf8'));
        chunks.push(Buffer.from('\r\n', 'utf8'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

    return {
        body: Buffer.concat(chunks),
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    };
}
