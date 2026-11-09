import { emptyProgress, mergeProgress, parseSave } from '../engine/sim/progress.js';

// localStorage persistence: the guide flag, competition registration, and (v3) per-player runs, progress, the
// character (v3.1) and the offline score queue.

const GUIDE_SEEN_KEY = 'hedj_has_seen_guide';
const REGISTRATION_KEY = 'hedj_comp_registration';

// ─── Free play (R66) ──────────────────────────────────────────────────────
// Outside a live event the game runs as a local guest. The guest's run, progress and guide flag use the per-player
// keys below under GUEST_PLAYER, which can never be an email (every registered email contains '@'), so they stay
// apart from any registered player's on the same device. The app sets the mode (main.js, from GET /api/event) only
// where no run is under way: the title, and the start of a run.

export const GUEST_PLAYER = 'guest';
let freePlay = false;

export function setFreePlay(on) {
    freePlay = !!on;
}

export function isFreePlay() {
    return freePlay;
}

export function hasSeenGuide() {
    if (freePlay) {
        try { return store().getItem(playerKey(GUEST_PLAYER, 'guide')) === '1'; } catch { return false; }
    }
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1';
}

export function markGuideSeen() {
    try {
        if (freePlay) store().setItem(playerKey(GUEST_PLAYER, 'guide'), '1');
        else localStorage.setItem(GUIDE_SEEN_KEY, '1');
    } catch (e) {
        console.warn('Failed to mark guide seen:', e);
    }
}

// ─── Competition Registration ─────────────────────────────────────────────

export function getRegistration() {
    try {
        const data = localStorage.getItem(REGISTRATION_KEY);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
}

export function saveRegistration(reg) {
    // reg: { playerName, email, company, gameToken, gameTokenExpiry }
    try {
        localStorage.setItem(REGISTRATION_KEY, JSON.stringify(reg));
    } catch (e) {
        console.warn('Failed to save registration:', e);
    }
}

export function clearRegistration() {
    localStorage.removeItem(REGISTRATION_KEY);
}

// ─── v3: per-player storage and offline score queue ───────────────────────
// Keys are namespaced per player (email lowercased) so a shared device never leaks one player's data to the next.

const V3_PREFIX = 'hedj_v3:';
const QUEUE_KEY = `${V3_PREFIX}_queue`;
const MAX_QUEUED_SCORES = 20;

let backend = null;

// Tests only: inject a localStorage-shaped object. Pass null to go back to the real localStorage.
export function setStorageBackend(store) {
    backend = store;
}

function store() {
    return backend || localStorage;
}

function playerKey(email, suffix) {
    return `${V3_PREFIX}${String(email || '').trim().toLowerCase()}:${suffix}`;
}

function readJson(key) {
    try {
        const raw = store().getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key, value) {
    try {
        store().setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.warn('Failed to write storage:', e);
        return false;
    }
}

export function saveRun(email, runJson) {
    try {
        store().setItem(playerKey(email, 'run'), typeof runJson === 'string' ? runJson : JSON.stringify(runJson));
        return true;
    } catch (e) {
        console.warn('Failed to save run:', e);
        return false;
    }
}

// Returns the RunState, or null when there is no save or it is not a valid version 3 save (the bad save is cleared).
export function loadRun(email) {
    let raw = null;
    try { raw = store().getItem(playerKey(email, 'run')); } catch { return null; }
    if (raw === null || raw === undefined) return null;
    const run = parseSave(raw);
    if (!run) clearRun(email);
    return run;
}

export function clearRun(email) {
    try { store().removeItem(playerKey(email, 'run')); } catch { /* storage unavailable */ }
}

export function getProgress(email) {
    const saved = readJson(playerKey(email, 'progress'));
    return saved ? mergeProgress(emptyProgress(), saved) : emptyProgress();
}

export function saveProgress(email, progress) {
    return writeJson(playerKey(email, 'progress'), progress);
}

// v3.1: the player character, per player (the guest in free play). Device-local only: it is not part of the
// progress and is never sent to /progress (Ruling V1). The caller checks the id is a known avatar.
// A pick that couldn't be written (storage full or blocked) is remembered for this page load, so the picker
// doesn't come back straight away.
const avatarFallback = new Map();

export function getAvatar(email) {
    const key = playerKey(email, 'avatar');
    // A pick that failed to save is newer than anything still in the store.
    if (avatarFallback.has(key)) return avatarFallback.get(key);
    try {
        const v = store().getItem(key);
        if (typeof v === 'string' && v) return v;
    } catch { /* storage unavailable */ }
    return null;
}

export function saveAvatar(email, avatarId) {
    const key = playerKey(email, 'avatar');
    try {
        store().setItem(key, String(avatarId));
        avatarFallback.delete(key);
        return true;
    } catch (e) {
        console.warn('Failed to save the character:', e);
        avatarFallback.set(key, String(avatarId));
        return false;
    }
}

export function getQueuedScores() {
    const list = readJson(QUEUE_KEY);
    return Array.isArray(list) ? list.filter(p => p && typeof p === 'object') : [];
}

// Keeps the newest 20. A payload with a gameId already queued is not added twice.
export function queueScore(payload) {
    const list = getQueuedScores().filter(p => !payload.gameId || p.gameId !== payload.gameId);
    list.push(payload);
    return writeJson(QUEUE_KEY, list.slice(-MAX_QUEUED_SCORES));
}

export function removeQueuedScore(gameId) {
    writeJson(QUEUE_KEY, getQueuedScores().filter(p => p.gameId !== gameId));
}

// The last GET /api/event answer, for when the next check fails (R66). Device-wide, not per player.
const EVENT_CACHE_KEY = `${V3_PREFIX}_event`;

export function getCachedEvent() {
    const e = readJson(EVENT_CACHE_KEY);
    return e && typeof e === 'object' && typeof e.live === 'boolean' ? e : null;
}

export function saveCachedEvent(event) {
    return writeJson(EVENT_CACHE_KEY, event);
}
