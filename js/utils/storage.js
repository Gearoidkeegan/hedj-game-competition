import { emptyProgress, mergeProgress, parseSave } from '../engine/sim/progress.js';

// localStorage persistence for game saves, leaderboard, competition registration, and pending scores

const SAVE_KEY = 'hedj_game_save';
const LEADERBOARD_KEY = 'hedj_game_leaderboard';
const GUIDE_SEEN_KEY = 'hedj_has_seen_guide';
const REGISTRATION_KEY = 'hedj_comp_registration';
const PENDING_SCORE_KEY = 'hedj_comp_pending_score';
const MAX_LEADERBOARD_ENTRIES = 20;

export function hasSeenGuide() {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1';
}

export function markGuideSeen() {
    try {
        localStorage.setItem(GUIDE_SEEN_KEY, '1');
    } catch (e) {
        console.warn('Failed to mark guide seen:', e);
    }
}

export function saveGame(gameState) {
    try {
        const serialized = JSON.stringify(gameState);
        localStorage.setItem(SAVE_KEY, serialized);
        return true;
    } catch (e) {
        console.warn('Failed to save game:', e);
        return false;
    }
}

export function loadGame() {
    try {
        const serialized = localStorage.getItem(SAVE_KEY);
        if (!serialized) return null;
        return JSON.parse(serialized);
    } catch (e) {
        console.warn('Failed to load game:', e);
        return null;
    }
}

export function clearSave() {
    localStorage.removeItem(SAVE_KEY);
}

export function hasSavedGame() {
    return localStorage.getItem(SAVE_KEY) !== null;
}

export function getLeaderboard() {
    try {
        const data = localStorage.getItem(LEADERBOARD_KEY);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

export function addLeaderboardEntry(entry) {
    // entry: { playerName, industry, score, grade, quartersPlayed, seed, date }
    const board = getLeaderboard();
    board.push({
        ...entry,
        date: entry.date || new Date().toISOString()
    });
    board.sort((a, b) => b.score - a.score);
    const trimmed = board.slice(0, MAX_LEADERBOARD_ENTRIES);
    try {
        localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('Failed to save leaderboard:', e);
    }
    return trimmed;
}

export function clearLeaderboard() {
    localStorage.removeItem(LEADERBOARD_KEY);
}

export function exportLeaderboardCSV() {
    const board = getLeaderboard();
    if (board.length === 0) return null;

    const headers = ['Rank', 'Name', 'Company', 'Email', 'Industry', 'Score', 'Grade', 'Quarters', 'Seed', 'Date'];
    const rows = board.map((e, i) => [
        i + 1,
        csvEscape(e.playerName || ''),
        csvEscape(e.companyName || ''),
        csvEscape(e.contactEmail || ''),
        csvEscape(e.industry || ''),
        e.score || 0,
        e.grade || '',
        e.quartersPlayed || '',
        e.seed || '',
        e.date || ''
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
}

function csvEscape(val) {
    if (typeof val !== 'string') return val;
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
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

// ─── Pending Score Queue ──────────────────────────────────────────────────

export function savePendingScore(payload) {
    try {
        localStorage.setItem(PENDING_SCORE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Failed to save pending score:', e);
    }
}

export function getPendingScore() {
    try {
        const data = localStorage.getItem(PENDING_SCORE_KEY);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
}

export function clearPendingScore() {
    localStorage.removeItem(PENDING_SCORE_KEY);
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
