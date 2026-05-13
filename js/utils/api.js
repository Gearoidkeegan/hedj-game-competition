import { CONFIG } from '../config.js';
import { getRegistration } from './storage.js';

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

export async function submitScore(payload) {
    const reg = getRegistration();
    if (!reg?.gameToken) throw new ApiError('Not registered', 401);
    const data = await apiFetch('/score', {
        method: 'POST',
        body: JSON.stringify({ ...payload, gameToken: reg.gameToken, email: reg.email })
    });
    return data; // { rank }
}

export async function fetchLeaderboard(limit = 20) {
    return apiFetch(`/leaderboard?limit=${limit}`);
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
