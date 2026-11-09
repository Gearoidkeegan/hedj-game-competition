import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndustries, loadJson } from '../helpers/loadData.js';
import { UNLOCK_RULES, emptyProgress } from '../../js/engine/sim/progress.js';
import { CRISES } from '../../js/engine/sim/crises.js';
import { CHAIRMAN_SPRITES } from '../../js/ui/pixel/sprites.js';
import {
    UNLOCK_HINTS, unlockLabel, unlockRuleText, nextUnlockHint, badgeLabel,
    exposureTitle, exposureCopy, exposureRisk, lockedReason, exposureSizeText
} from '../../js/ui/labels.js';

const content = { industries: loadIndustries(), powerups: loadJson('data/powerups.json') };

test('every unlock id has a human label, never the raw id', () => {
    for (const { id } of UNLOCK_RULES) {
        const label = unlockLabel(id, content);
        assert.ok(label && label !== id && !label.includes(':'), `${id} -> ${label}`);
    }
    for (const id of emptyProgress().unlocked) assert.ok(!unlockLabel(id, content).includes(':'), id);
    assert.equal(unlockLabel('industry:pharma', content), 'MedGlobal Labs');
    assert.equal(unlockLabel('powerup:visibility', content), 'Cash Visibility');
    assert.equal(unlockLabel('crisis:gfc2008', content), 'Global Financial Crisis (2008)');
    assert.equal(unlockLabel('mode:pro', content), 'Pro mode');
});

test('badges (crisis ids, chairmen) map to labels', () => {
    for (const c of CRISES) assert.equal(badgeLabel(c.id, content), c.label);
    for (const [id, s] of Object.entries(CHAIRMAN_SPRITES)) assert.equal(badgeLabel(id, content), s.label);
    assert.equal(badgeLabel('mode:pro', content), 'Pro mode');
});

// The hint thresholds are copy, but they must agree with the engine's rules: the rule passes at the threshold
// and fails one below it.
test('unlock hints agree with UNLOCK_RULES', () => {
    for (const rule of UNLOCK_RULES) {
        const hint = UNLOCK_HINTS[rule.id] || UNLOCK_HINTS[rule.id.replace(/:.*/, ':*')];
        assert.ok(hint, `no hint for ${rule.id}`);
        const p = (runs, best) => ({ ...emptyProgress(), runs, best: { simple: best, pro: 0 } });
        if (hint.kind === 'runs') {
            assert.equal(rule.test(p(hint.n, 0), { status: 'fired' }), true, rule.id);
            assert.equal(rule.test(p(hint.n - 1, 0), { status: 'fired' }), false, rule.id);
        } else if (hint.kind === 'best') {
            assert.equal(rule.test(p(1, hint.n), { status: 'fired' }), true, rule.id);
            assert.equal(rule.test(p(1, hint.n - 1), { status: 'fired' }), false, rule.id);
        } else {
            assert.equal(hint.kind, 'complete');
            assert.equal(rule.test(p(1, 0), { status: 'complete' }), true);
            assert.equal(rule.test(p(1, 0), { status: 'bankrupt' }), false);
        }
        assert.ok(unlockRuleText(rule.id).length > 0);
    }
    assert.equal(unlockRuleText('industry:construction'), 'Score 1,500 in a run');
    assert.equal(unlockRuleText('industry:pharma'), 'Play 3 runs');
    assert.equal(unlockRuleText('mode:pro'), 'Finish all 8 quarters of a run');
});

test('nextUnlockHint names the first locked item and how far off it is', () => {
    const fresh = emptyProgress();
    assert.equal(nextUnlockHint(fresh, content), 'Next unlock: Pro mode. Finish all 8 quarters of a run');
    const later = { ...fresh, runs: 1, best: { simple: 900, pro: 0 }, unlocked: [...fresh.unlocked, 'mode:pro'] };
    assert.equal(nextUnlockHint(later, content), 'Next unlock: Momentum Construction. Score 1,500 in a run (best so far 900)');
    const runsOnly = { ...later, best: { simple: 3000, pro: 0 },
        unlocked: [...later.unlocked, 'industry:construction', 'industry:tech'] };
    assert.equal(nextUnlockHint(runsOnly, content), 'Next unlock: MedGlobal Labs. Play 3 runs (2 to go)');
    const all = { ...fresh, unlocked: UNLOCK_RULES.map(r => r.id) };
    assert.equal(nextUnlockHint(all, content), null);
});

test('every exposure has plain-language copy with no market codes', () => {
    const codes = /\b(EURUSD|EURGBP|GBPUSD|USDJPY|EURCHF|EURBRL|JETNWE|NATGAS|BRENT)\b/;
    for (const ind of content.industries) {
        for (const e of ind.exposures) {
            for (const text of [exposureTitle(e), exposureCopy(e, ind.baseCurrency), exposureRisk(e)]) {
                assert.ok(text && !codes.test(text) && !text.includes('undefined'), `${ind.id}/${e.id}: ${text}`);
            }
        }
    }
    const airline = content.industries.find(i => i.id === 'airline');
    const fuel = airline.exposures.find(e => e.id === 'fuel');
    const usd = airline.exposures.find(e => e.id === 'usd-revenue');
    const debt = airline.exposures.find(e => e.id === 'floating-debt');
    assert.equal(exposureTitle(fuel), 'Jet fuel');
    assert.equal(exposureCopy(fuel, 'EUR'), 'You buy jet fuel in dollars');
    assert.equal(exposureRisk(fuel), 'Hurts you if the price rises');
    assert.equal(exposureTitle(usd), 'Dollar revenue');
    assert.equal(exposureCopy(usd, 'EUR'), 'You earn dollars and convert them to euros');
    assert.equal(exposureRisk(usd), 'Hurts you if the dollar weakens');
    assert.equal(exposureCopy(debt, 'EUR'), 'You pay a floating interest rate on your debt');
    assert.equal(exposureRisk(debt), 'Hurts you if interest rates rise');
    const tech = content.industries.find(i => i.id === 'tech');
    assert.equal(exposureCopy(tech.exposures.find(e => e.id === 'jpy-costs'), 'USD'), 'You pay suppliers in yen');
});

test('locked exposures explain themselves in one short line', () => {
    assert.equal(lockedReason({ type: 'commodity' }), "Your bank doesn't offer commodity hedging");
    assert.equal(lockedReason({ type: 'ir' }), "Your bank doesn't offer interest-rate hedging");
    assert.equal(lockedReason({ type: 'fx' }), '');
});

test('v3.1 size line: the size this quarter in the company currency; the principal for floating debt', () => {
    assert.equal(exposureSizeText({ type: 'fx' }, 750e6, 'EUR'), '€750.0m this quarter');
    assert.equal(exposureSizeText({ type: 'commodity' }, 120e6, 'USD'), '$120.0m this quarter');
    assert.equal(exposureSizeText({ type: 'fx' }, 1.5e9, 'GBP'), '£1.50bn this quarter');
    assert.equal(exposureSizeText({ type: 'ir' }, 2e9, 'EUR'), '€2.00bn floating debt', 'the principal, never interest');
    assert.equal(exposureSizeText({ type: 'fx' }, 0, 'EUR'), '€0 this quarter');
    for (const bad of [null, undefined, NaN, Infinity]) assert.equal(exposureSizeText({ type: 'fx' }, bad, 'EUR'), '', String(bad));
    for (const ind of content.industries) {
        for (const e of ind.exposures) {
            const t = exposureSizeText(e, e.quarterlyNotional * 5, ind.baseCurrency);
            assert.ok(t.length <= 90 && !/\b(19|20)\d\d\b/.test(t), t);
        }
    }
});
