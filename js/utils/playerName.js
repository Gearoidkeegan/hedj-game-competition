// The leaderboard-name and company rules, mirrored from the server so the registration form can say what is
// wrong before the round trip (R64). The server stays the authority. The browser can't import
// backend/lib/http.mjs (it pulls in node:crypto), so tests/client/playerName.test.js pins these regexes to the
// server's source text and checks both sides agree on a corpus of names.

export const NAME_MAX = 20;      // code points, after NFC (server: backend/lib/http.mjs validName)
export const COMPANY_MAX = 60;   // characters, trimmed (server: backend/lib/util.mjs validCompany)

// Letters, digits, space, . ' _ - # * and emoji (variation selector, ZWJ, skin tones, flags, keycaps, tag sequences); 1-20 code points
// after NFC normalisation. Must contain at least one letter, digit or emoji so joiners/punctuation alone are rejected.
const NAME_RE = /^[\p{L}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3\u{E0020}-\u{E007F} .'_#*-]{1,20}$/u;
const NAME_CONTENT_RE = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]|[#*]️?⃣/u;

export function validPlayerName(s) {
    if (typeof s !== 'string') return false;
    const n = s.trim().normalize('NFC');
    return NAME_RE.test(n) && NAME_CONTENT_RE.test(n);
}

export function validCompanyName(s) {
    return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= COMPANY_MAX && !/[<>]/.test(s);
}
