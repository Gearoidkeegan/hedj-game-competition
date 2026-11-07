import { timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

export function json(status, body, extraHeaders = {}) {
    return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: body === null || body === undefined ? '' : JSON.stringify(body)
    };
}

export function parseBody(event, maxBytes = 4096) {
    const raw = event?.body || '{}';
    const text = event?.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new HttpError(413, 'Request body too large');
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new HttpError(400, 'Invalid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new HttpError(400, 'Invalid JSON');
    }
    return parsed;
}

function headerValue(event, name) {
    const headers = event?.headers || {};
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name) return headers[key];
    }
    return undefined;
}

// Constant-time comparison; hashing-free, length mismatch short-circuits (length is not secret).
export function isAdmin(event, env) {
    const expected = env?.ADMIN_KEY;
    const given = headerValue(event, 'x-admin-key');
    if (!expected || typeof given !== 'string') return false;
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAdmin(event, env) {
    if (!isAdmin(event, env)) throw new HttpError(401, 'Unauthorized');
}

// Brief regex /^[\p{L}\p{N} .'_-]{1,20}$/u cannot match the required emoji example, so \p{Extended_Pictographic} is added.
const NAME_RE = /^[\p{L}\p{N}\p{Extended_Pictographic} .'_-]{1,20}$/u;
export function validName(s) {
    return typeof s === 'string' && NAME_RE.test(s);
}

// Turns thrown HttpErrors into JSON responses; rethrows anything else.
export function errorResponse(err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    throw err;
}
