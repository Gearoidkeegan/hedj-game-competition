// HTML-escapes a player-supplied string for safe interpolation into innerHTML (text and quoted attributes).
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ENTITIES[ch]);
}
