// R63: which score-submission failures are final, and the line the game-over screen shows for them.
// A 4xx is final (the server will refuse the same payload again), except:
//   401: the token expired or was replaced; the score stays queued and is sent after the player re-registers
//        (Review Focus 3);
//   408 and 429: a timeout or a throttle, so a later retry can succeed.
// Network errors, timeouts (status 0) and 5xx are not final either: the score stays queued.

const RETRYABLE_4XX = [401, 408, 429];
const PREFIX = 'Score not accepted: ';
const FALLBACK_REASON = 'the server refused it';
export const REJECTION_TEXT_MAX = 90;

export function isFinalRejection(err) {
    const status = err?.status;
    return Number.isInteger(status) && status >= 400 && status < 500 && !RETRYABLE_4XX.includes(status);
}

// "Score not accepted: <reason>", from the server's error message, in 90 characters or fewer.
export function rejectionText(message) {
    let reason = typeof message === 'string' ? message.trim() : '';
    if (!reason || /^HTTP \d+$/.test(reason)) reason = FALLBACK_REASON;
    reason = reason.charAt(0).toLowerCase() + reason.slice(1);
    const room = REJECTION_TEXT_MAX - PREFIX.length;
    if (reason.length > room) reason = `${reason.slice(0, room - 1).trimEnd()}…`;
    return PREFIX + reason;
}
