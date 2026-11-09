// Human labels for the v3 Simple screens: unlock and badge ids, unlock rules, and plain-language exposure copy.
// Raw ids ('industry:pharma', 'gfc2008') and market codes ('EURUSD') are never shown to players.

import { UNLOCK_RULES } from '../engine/sim/progress.js';
import { CRISES } from '../engine/sim/crises.js';
import { CHAIRMAN_SPRITES } from './pixel/sprites.js';
import { formatCash } from '../utils/formatters.js';
import { bandText } from '../screens/simple/RunController.js';
import { coverPercent } from './RiskMeter.js';

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

// v3.1: the card's size line. FX and commodity: policyCover's value, "€750.0m this quarter". Floating debt: the
// caller passes the principal, "€10.00bn floating debt" (never the interest, which would reveal the rate level and so
// the era). Empty when there is no usable size.
export function exposureSizeText(e, value, currency) {
    if (!Number.isFinite(value)) return '';
    const money = formatCash(Math.abs(value), currency);
    return e?.type === 'ir' ? `${money} floating debt` : `${money} this quarter`;
}

// Why a dial is stuck at 0 before hedgeAccess. Empty for FX, which is always hedgeable.
export function lockedReason(e) {
    if (e.type === 'commodity') return "Your bank doesn't offer commodity hedging";
    if (e.type === 'ir') return "Your bank doesn't offer interest-rate hedging";
    return '';
}

// ── Cash clarity (v3.2) ───────────────────────────────────────────────────

// "+€3.0m", "-€3.0m", "+€0".
export function signedCash(v, currency) {
    const n = Number.isFinite(v) && v !== 0 ? v : 0;
    return `${n < 0 ? '' : '+'}${formatCash(n, currency)}`;
}

// A forecast range from forecastVariance (0.4 -> "±40%").
export function forecastRangeText(variance) {
    const v = Number.isFinite(variance) ? Math.max(0, variance) : 0;
    return `±${Math.round(v * 100)}%`;
}

const VOLUME_ON_FORECAST = 0.02;   // a smaller miss reads as "on forecast"
const OVER_HEDGE_EPS = 1e-9;       // float slack on h × forecast > realised

// The volume result on a result line: "Volume 9% under forecast", "Volume 9% over forecast", "Volume on forecast",
// with " (over-hedged)" when the hedge (ratio × forecast) was bigger than the volume that came in. Empty for floating
// debt (the principal is contractual) and for lines without volumes (summaries saved before A9).
export function volumeText(exposure, line) {
    if (!exposure || exposure.type === 'ir') return '';
    const forecast = Math.abs(line?.forecastNotional);
    const realised = Math.abs(line?.realisedNotional);
    if (!Number.isFinite(forecast) || !Number.isFinite(realised) || forecast === 0) return '';
    const miss = realised / forecast - 1;
    const text = Math.abs(miss) < VOLUME_ON_FORECAST
        ? 'Volume on forecast'
        : `Volume ${Math.round(Math.abs(miss) * 100)}% ${miss < 0 ? 'under' : 'over'} forecast`;
    const h = Number.isFinite(line.hedgeRatio) ? line.hedgeRatio : 0;
    const over = h * forecast > realised * (1 + OVER_HEDGE_EPS) + OVER_HEDGE_EPS;
    return over ? `${text} (over-hedged)` : text;
}

// The result screen's opening line: the board-policy status of the quarter, judged as the engine judged it.
// `mandate` is the quarter's band (run.mandate; on a no-policy quarter it may be the one just adopted, which this
// line never shows). Copes with summaries saved before v3.1 (no riskCover) and before A9 (inMandate only).
export function factsLine(summary, mandate) {
    const policy = summary?.policy
        ?? (summary?.inMandate === true ? 'in' : summary?.inMandate === false ? 'off' : 'none');
    if (policy === 'none' || !mandate) {
        return summary?.policyAdopted ? 'Policy adopted from next quarter' : 'No board policy yet';
    }
    const band = bandText(mandate);
    const cover = summary.riskCover;
    const known = typeof cover === 'number' && Number.isFinite(cover);
    if (policy === 'in') {
        if (cover === null) return 'In policy: nothing you can hedge yet';
        if (!known) return `In policy (board wants ${band})`;
        return `In policy: ${coverPercent(cover, mandate)}% of risk covered (board wants ${band})`;
    }
    if (summary.wrongFocus === true) return 'Off policy: big exposure under-hedged';
    if (!known) return `Off policy: board wants ${band}`;
    return `Off policy: ${coverPercent(cover, mandate)}% hedged, board wants ${band}`;
}

const BREAKDOWN_FIELDS = ['cashBefore', 'cashAfter', 'ocf', 'exposureTotal', 'hedgeTotal', 'addOnCost'];

// The money step formatCash shows at this size (0.01bn, 0.1m, 1k, 1).
const displayStep = abs => (abs >= 1e9 ? 1e7 : abs >= 1e6 ? 1e5 : abs >= 1e3 ? 1e3 : 1);

// The result screen's cash breakdown: Operations, Market (the move on the exposures), Hedges, Event and Add-ons,
// signed, then "Cash +€23.0m". Zero parts are dropped, except Operations. The parts are rounded to what formatCash
// shows (largest remainder), so the figures on screen add up to the total on screen. null for a summary saved
// before v3.2, which has no parts.
export function cashBreakdown(summary, currency) {
    if (!summary || BREAKDOWN_FIELDS.some(k => !Number.isFinite(summary[k]))) return null;
    const event = Number.isFinite(summary.eventCash) ? summary.eventCash : 0;
    const raw = [
        { key: 'ops', label: 'Operations', value: summary.ocf },
        { key: 'market', label: 'Market', value: summary.exposureTotal },
        { key: 'hedges', label: 'Hedges', value: summary.hedgeTotal },
        { key: 'event', label: 'Event', value: event },
        { key: 'addOns', label: 'Add-ons', value: -summary.addOnCost }
    ];
    const total = raw.reduce((s, p) => s + p.value, 0);
    const step = displayStep(Math.max(Math.abs(total), ...raw.map(p => Math.abs(p.value))));
    const units = raw.map(p => Math.floor(p.value / step));
    let need = Math.round(total / step) - units.reduce((s, u) => s + u, 0);
    const byRemainder = raw.map((p, i) => ({ i, rem: p.value / step - units[i] }))
        .filter(x => x.rem > 0)
        .sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (const { i } of byRemainder) {
        if (need <= 0) break;
        units[i] += 1;
        need -= 1;
    }
    const totalUnits = units.reduce((s, u) => s + u, 0);
    const parts = raw
        .map((p, i) => ({ key: p.key, label: p.label, value: units[i] * step }))
        .filter(p => p.key === 'ops' || p.value !== 0)
        .map(p => ({ ...p, text: `${p.label} ${signedCash(p.value, currency)}` }));
    const totalValue = totalUnits * step;
    return { parts, total: { value: totalValue, text: `Cash ${signedCash(totalValue, currency)}` } };
}
