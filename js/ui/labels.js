// Human labels for the v3 Simple screens: unlock and badge ids, unlock rules, and plain-language exposure copy.
// Raw ids ('industry:pharma', 'gfc2008') and market codes ('EURUSD') are never shown to players.

import { UNLOCK_RULES } from '../engine/sim/progress.js';
import { CRISES } from '../engine/sim/crises.js';
import { CHAIRMAN_SPRITES } from './pixel/sprites.js';
import { formatCash } from '../utils/formatters.js';

// What each unlock takes. tests/ui/labels.test.js checks these against UNLOCK_RULES, so they can't drift.
export const UNLOCK_HINTS = Object.freeze({
    'mode:pro': { kind: 'complete' },
    'industry:construction': { kind: 'best', n: 1500 },
    'industry:pharma': { kind: 'runs', n: 3 },
    'industry:tech': { kind: 'best', n: 2250 },
    'industry:energy': { kind: 'runs', n: 6 },
    'powerup:visibility': { kind: 'runs', n: 2 },
    'crisis:*': { kind: 'runs', n: 4 }
});

const hintFor = id => UNLOCK_HINTS[id] || UNLOCK_HINTS[`${String(id).split(':')[0]}:*`] || null;
const num = n => n.toLocaleString('en-GB');
const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1);

// 'industry:pharma' -> 'MedGlobal Labs', 'powerup:visibility' -> 'Cash Visibility', 'mode:pro' -> 'Pro mode'.
export function unlockLabel(id, content = {}) {
    const [kind, rest = ''] = String(id).split(':');
    if (kind === 'mode') return rest === 'pro' ? 'Pro mode' : `${titleCase(rest)} mode`;
    if (kind === 'industry') return (content.industries || []).find(i => i.id === rest)?.name || titleCase(rest);
    if (kind === 'powerup') return content.powerups?.[rest]?.name || titleCase(rest);
    if (kind === 'crisis') return CRISES.find(c => c.id === rest)?.label || 'Crisis scenario';
    return titleCase(String(id).replace(/[:_-]+/g, ' '));
}

// A progress badge: a crisis id ('gfc2008'), a chairman id ('dimon') or an unlock id.
export function badgeLabel(id, content = {}) {
    const crisis = CRISES.find(c => c.id === id);
    if (crisis) return crisis.label;
    if (Object.hasOwn(CHAIRMAN_SPRITES, id)) return CHAIRMAN_SPRITES[id].label;
    return unlockLabel(id, content);
}

export function unlockRuleText(id) {
    const hint = hintFor(id);
    if (!hint) return '';
    if (hint.kind === 'complete') return 'Finish all 8 quarters of a run';
    if (hint.kind === 'best') return `Score ${num(hint.n)} in a run`;
    return `Play ${hint.n} runs`;
}

// "Next unlock: MedGlobal Labs. Play 3 runs (2 to go)", or null when everything is unlocked.
export function nextUnlockHint(progress, content = {}) {
    const unlocked = new Set(progress?.unlocked || []);
    const rule = UNLOCK_RULES.find(r => !unlocked.has(r.id));
    if (!rule) return null;
    const hint = hintFor(rule.id);
    let progressText = '';
    if (hint?.kind === 'runs') progressText = ` (${Math.max(0, hint.n - (progress.runs || 0))} to go)`;
    if (hint?.kind === 'best' && progress?.best?.simple > 0) progressText = ` (best so far ${num(progress.best.simple)})`;
    return `Next unlock: ${unlockLabel(rule.id, content)}. ${unlockRuleText(rule.id)}${progressText}`;
}

// ── Exposure copy ─────────────────────────────────────────────────────────

const COMMODITIES = {
    JETNWE: 'jet fuel', BRENT: 'crude oil', NATGAS: 'natural gas', COFFEE: 'coffee beans', DAIRY: 'dairy',
    COPPER: 'copper', STEEL: 'steel'
};
// [plural, singular noun as used in "the dollar weakens"]
const CURRENCIES = {
    USD: ['dollars', 'dollar'], EUR: ['euros', 'euro'], GBP: ['pounds', 'pound'], JPY: ['yen', 'yen'],
    CHF: ['Swiss francs', 'Swiss franc'], BRL: ['Brazilian reais', 'real']
};
const plural = ccy => CURRENCIES[ccy]?.[0] || ccy;
const single = ccy => CURRENCIES[ccy]?.[1] || ccy;
const commodity = e => COMMODITIES[e.underlying] || 'raw materials';

export function exposureTitle(e) {
    if (e.type === 'commodity') return titleCase(commodity(e)) + (e.direction === 'sell' ? ' sales' : '');
    if (e.type === 'ir') return 'Floating-rate debt';
    return `${titleCase(single(e.unit))} ${e.direction === 'sell' ? 'revenue' : 'costs'}`;
}

// "You buy jet fuel in dollars", "You earn dollars and convert them to euros".
export function exposureCopy(e, baseCurrency) {
    if (e.type === 'commodity') {
        return `You ${e.direction === 'sell' ? 'sell' : 'buy'} ${commodity(e)} in ${plural(e.unit)}`;
    }
    if (e.type === 'ir') return 'You pay a floating interest rate on your debt';
    return e.direction === 'sell'
        ? `You earn ${plural(e.unit)} and convert them to ${plural(baseCurrency)}`
        : `You pay suppliers in ${plural(e.unit)}`;
}

export function exposureRisk(e) {
    if (e.type === 'commodity') return `Hurts you if the price ${e.direction === 'sell' ? 'falls' : 'rises'}`;
    if (e.type === 'ir') return 'Hurts you if interest rates rise';
    return `Hurts you if the ${single(e.unit)} ${e.direction === 'sell' ? 'weakens' : 'strengthens'}`;
}

// What moved, for the result screen: "Dollar", "Jet fuel", "Interest rates".
export function moveLabel(e) {
    if (e?.type === 'commodity') return titleCase(commodity(e));
    if (e?.type === 'ir') return 'Interest rates';
    return titleCase(single(e?.unit || ''));
}

// v3.1: the card's size line, from policyCover's values: "€750.0m this quarter"; floating debt's size is the
// quarter's interest, "€17.5m of interest this quarter". Empty when there is no usable size.
export function exposureSizeText(e, value, currency) {
    if (!Number.isFinite(value)) return '';
    const money = formatCash(Math.abs(value), currency);
    return e?.type === 'ir' ? `${money} of interest this quarter` : `${money} this quarter`;
}

// Why a dial is stuck at 0 before hedgeAccess. Empty for FX, which is always hedgeable.
export function lockedReason(e) {
    if (e.type === 'commodity') return "Your bank doesn't offer commodity hedging";
    if (e.type === 'ir') return "Your bank doesn't offer interest-rate hedging";
    return '';
}
