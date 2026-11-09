// Free play (R66): whether the competition is live, from the deploy settings alone.
// Live when EVENT_ID is set, EVENT_START_ISO is unset or now >= start, and EVENT_END_ISO is unset or now < end.
// An unparseable date counts as unset (the deploy workflow only passes strict ISO-8601 UTC).
import { HttpError } from './http.mjs';

// A score from a run started before the end is accepted this long after it (a run queued on conference wifi).
export const SCORE_GRACE_MS = 2 * 60 * 60 * 1000;

const isoMs = iso => {
    const ms = Date.parse(iso || '');
    return Number.isFinite(ms) ? ms : null;
};

export function isLive(env, nowMs) {
    if (!env.EVENT_ID) return false;
    const start = isoMs(env.EVENT_START_ISO);
    const end = isoMs(env.EVENT_END_ISO);
    return (start === null || nowMs >= start) && (end === null || nowMs < end);
}

// The public GET /event body. Never the event id.
export function eventStatus(env, nowMs) {
    return {
        live: isLive(env, nowMs),
        startIso: isoMs(env.EVENT_START_ISO) === null ? null : env.EVENT_START_ISO,
        endIso: isoMs(env.EVENT_END_ISO) === null ? null : env.EVENT_END_ISO
    };
}

export function inScoreGrace(env, nowMs, startedAt) {
    const end = isoMs(env.EVENT_END_ISO);
    return !!env.EVENT_ID && end !== null && Number.isFinite(startedAt)
        && startedAt < end && nowMs >= end && nowMs < end + SCORE_GRACE_MS;
}

export function requireLive(env, nowMs) {
    if (!isLive(env, nowMs)) throw new HttpError(403, 'competition_closed');
}
