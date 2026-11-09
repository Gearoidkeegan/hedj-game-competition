// The player character's face from the run state (v3.1). Pure and DOM-free.
//
//   avatarMood({ cash, redLine, startingCash, boardMood, status }) -> 'happy' | 'worried' | 'angry'
//
//   angry:   bankrupt or fired, cash below the red line, or board mood 25 or lower;
//   worried: board mood below 50, or cash below the red line plus 15% of starting cash;
//   happy:   otherwise.
// A field that is missing or not a finite number is left out of the rules it feeds (an old save never throws).

export const ANGRY_MOOD = 25;
export const WORRIED_MOOD = 50;
export const WORRIED_CASH_PCT = 0.15;

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function avatarMood({ cash, redLine, startingCash, boardMood, status } = {}) {
    if (status === 'bankrupt' || status === 'fired') return 'angry';
    const c = num(cash);
    const red = num(redLine);
    const start = num(startingCash);
    const mood = num(boardMood);
    if (c !== null && red !== null && c < red) return 'angry';
    if (mood !== null && mood <= ANGRY_MOOD) return 'angry';
    if (mood !== null && mood < WORRIED_MOOD) return 'worried';
    if (c !== null && red !== null && start !== null && c < red + WORRIED_CASH_PCT * start) return 'worried';
    return 'happy';
}
