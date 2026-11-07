import { CONFIG } from '../config.js';
import { getRegistration, getQueuedScores, removeQueuedScore } from './storage.js';

const TIMEOUT_MS = 10000;

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${CONFIG.apiBase}${path}`, {
            ...options,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        clearTimeout(timer);
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const d = await res.json(); msg = d.error || msg; } catch {}
            throw new ApiError(msg, res.status);
        }
        if (res.status === 204) return null;
        return res.json();
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw new ApiError('Request timed out', 0);
        throw err;
    }
}

export async function register(playerName, email, company, marketingConsent = false) {
    const data = await apiFetch('/register', {
        method: 'POST',
        body: JSON.stringify({ playerName, email, company, consentGiven: true, marketingConsent })
    });
    return data; // { gameToken, expiresAt }
}

// Registration with a token that has not expired, or null.
function validRegistration() {
    const reg = getRegistration();
    if (!reg?.gameToken || !reg.email) return null;
    if (reg.gameTokenExpiry && reg.gameTokenExpiry <= Date.now()) return null;
    return reg;
}

function authHeaders(reg) {
    return { 'x-player-email': reg.email, 'x-game-token': reg.gameToken };
}

// Returns { rank, best, isBest }, or { duplicate: true } when the gameId was already submitted.
export async function submitScore(payload) {
    const reg = validRegistration();
    if (!reg) throw new ApiError('Not registered', 401);
    return apiFetch('/score', {
        method: 'POST',
        body: JSON.stringify({
            ...payload,
            playerName: payload.playerName || reg.playerName,
            email: payload.email || reg.email,
            gameToken: reg.gameToken
        })
    });
}

export async function fetchLeaderboard({ mode = 'simple', period = 'event', limit = 20 } = {}) {
    const data = await apiFetch(`/leaderboard?mode=${encodeURIComponent(mode)}&period=${encodeURIComponent(period)}&limit=${limit}`);
    return data?.entries || [];
}

export async function getRemoteProgress() {
    const reg = validRegistration();
    if (!reg) return null;
    const data = await apiFetch('/progress', { headers: authHeaders(reg) });
    return data?.progress || null;
}

export async function putRemoteProgress(progress) {
    const reg = validRegistration();
    if (!reg) throw new ApiError('Not registered', 401);
    const data = await apiFetch('/progress', {
        method: 'PUT',
        headers: authHeaders(reg),
        body: JSON.stringify({ progress })
    });
    return data?.progress || null;
}

let flushing = null;

// Sends queued scores. Keeps an item on a network failure or 401 (and stops, to retry later), drops it on any other 4xx.
// Returns how many were sent. Only sends a player's scores while that same player is registered on this device.
export function flushScoreQueue() {
    if (!flushing) {
        flushing = doFlush().finally(() => { flushing = null; });
    }
    return flushing;
}

async function doFlush() {
    let sent = 0;
    for (const item of getQueuedScores()) {
        const reg = validRegistration();
        if (!reg) break;
        if (item.email && String(item.email).toLowerCase() !== reg.email.toLowerCase()) continue;
        try {
            await submitScore(item);
            removeQueuedScore(item.gameId);
            sent++;
        } catch (err) {
            if (err.status >= 400 && err.status < 500 && err.status !== 401) {
                removeQueuedScore(item.gameId);
                continue;
            }
            break;
        }
    }
    return sent;
}

export async function fetchPlayCount() {
    const data = await apiFetch('/analytics');
    return data?.play || 0;
}

export function trackEvent(eventName) {
    // Fire-and-forget — errors are swallowed intentionally
    apiFetch('/analytics', {
        method: 'POST',
        body: JSON.stringify({ event: eventName })
    }).catch(() => {});
}
