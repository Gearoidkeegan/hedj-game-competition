const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function dublinDate(ms) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(ms));
}

export function validCompany(s) {
    return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 60 && !/[<>]/.test(s);
}

// DynamoDB ttl (epoch seconds): event end + 90 days, or now + 90 days when no event end is set. Never undefined.
export function ttlSeconds(env, nowMs) {
    const endMs = Date.parse(env.EVENT_END_ISO || '');
    return Math.floor(((Number.isFinite(endMs) ? endMs : nowMs) + RETENTION_MS) / 1000);
}
