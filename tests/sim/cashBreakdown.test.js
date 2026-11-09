// v3.2 cash clarity: the summary carries the parts of the cash change, and they add up exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { canBuyPowerUp, powerUpCost, POWER_UP_IDS, POWER_UPS } from '../../js/engine/sim/powerUps.js';
import { createRun, simulateQuarter, isRunOver } from '../../js/engine/sim/SimEngine.js';
import { SeededRandom } from '../../js/utils/random.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const content = { events: loadJson('data/simple-events.json').events };
const RATIOS = [0, 0.25, 0.5, 0.75, 1];

// The identity the result screen relies on.
function assertAddsUp(s, msg) {
    for (const k of ['cashBefore', 'ocf', 'exposureTotal', 'hedgeTotal', 'addOnCost', 'eventCash']) {
        assert.ok(Number.isFinite(s[k]), `${msg}: ${k} = ${s[k]}`);
    }
    const sum = s.cashBefore + s.ocf + s.exposureTotal + s.hedgeTotal + s.eventCash - s.addOnCost;
    assert.ok(Math.abs(sum - s.cashAfter) < 1e-6, `${msg}: ${sum} !== ${s.cashAfter}`);
}

test('summary parts: cashBefore + ocf + exposureTotal + hedgeTotal + eventCash − addOnCost = cashAfter, every quarter', () => {
    let quarters = 0;
    let withAddOn = 0;
    let withVisibility = 0;
    let withEventCash = 0;
    let bankrupt = 0;
    for (const industry of industries) {
        for (let seed = 1; seed <= 40; seed++) {
            const pick = new SeededRandom(seed * 7919);
            let run = createRun({ industry, seed, startedAt: 1_700_000_000_000, market: marketEngine });
            // Some runs start poor so bankruptcy shows up too.
            if (seed % 10 === 0) run = { ...run, cash: run.startingCash * 0.05 };
            while (!isRunOver(run)) {
                const hedges = Object.fromEntries(run.exposures.map(e => [e.id, pick.pick(RATIOS)]));
                const buyable = POWER_UP_IDS.filter(id => canBuyPowerUp(run, id, POWER_UP_IDS));
                const buyPowerUp = buyable.length && pick.next() < 0.6 ? pick.pick(buyable) : null;
                let eventChoice = null;
                if (run.pendingEvent) eventChoice = pick.pick(content.events.find(e => e.id === run.pendingEvent).choices).id;
                const before = run.cash;
                const { run: next, summary } = simulateQuarter(run, { hedges, buyPowerUp, eventChoice }, marketEngine, content);
                const msg = `${industry.id} seed ${seed} q${summary.q}`;
                assert.equal(summary.cashBefore, before, msg);
                assert.equal(summary.ocf, BALANCE.baseOcfPct * run.startingCash, msg);
                assert.ok(Math.abs(summary.exposureTotal - summary.lines.reduce((s, l) => s + l.exposureImpact, 0)) < 1e-6, msg);
                assert.ok(Math.abs(summary.hedgeTotal - summary.lines.reduce((s, l) => s + l.hedgeImpact, 0)) < 1e-6, msg);
                assertAddsUp(summary, msg);
                quarters++;
                if (summary.addOnCost !== 0) withAddOn++;
                if (buyPowerUp === 'visibility') {
                    withVisibility++;
                    const net = powerUpCost(run, 'visibility') - POWER_UPS.visibility.cashPct * run.startingCash;
                    assert.ok(Math.abs(summary.addOnCost - net) < 1e-6, `${msg}: visibility is net of its cash`);
                }
                if (summary.eventCash !== 0) withEventCash++;
                if (next.status === 'bankrupt') bankrupt++;
                run = next;
            }
        }
    }
    assert.ok(quarters > 1000, `played ${quarters}`);
    assert.ok(withAddOn > 50 && withVisibility > 0 && withEventCash > 10 && bankrupt > 0,
        `coverage: addOn ${withAddOn}, visibility ${withVisibility}, eventCash ${withEventCash}, bankrupt ${bankrupt}`);
});

test('summary parts: no add-on or event means addOnCost and eventCash are exactly 0', () => {
    const industry = industries.find(i => i.id === 'airline');
    const run = createRun({ industry, seed: 3, startedAt: 1_700_000_000_000, market: marketEngine });
    const { summary } = simulateQuarter({ ...run, pendingEvent: null }, { hedges: {} }, marketEngine, content);
    assert.equal(summary.addOnCost, 0);
    assert.equal(summary.eventCash, 0);
    assert.equal(summary.cashBefore, run.startingCash);
    assertAddsUp(summary, 'plain quarter');
});
