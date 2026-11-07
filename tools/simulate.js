// Balance simulator for the Simple sim engine (Task A7).
//
//   node tools/simulate.js [--n 1000] [--seed 1]
//
// Plays n seeded runs per strategy, cycling through all 7 industries, and prints a table per strategy,
// the balance criteria and the gameOverTitles spread. Deterministic: the same --n and --seed give the
// same table.
//
// Strategies (hedge ratio for every active exposure, every quarter):
//   unhedged  all 0
//   flat50    all 0.5
//   mandate   the midpoint of the board's band, snapped to the dial (0, 0.25, 0.5, 0.75, 1)
//   full      all 1
//   random    one random dial value per quarter, applied to every exposure
// flat50, mandate and full buy the forecasting power-up in Q1; unhedged and random buy nothing.
// Event choices: a seeded random pick among the event's choices (its own RNG stream per run), so
// both choices of every card get played.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marketEngine } from '../js/engine/MarketEngine.js';
import { SeededRandom } from '../js/utils/random.js';
import { createRun, simulateQuarter, isRunOver } from '../js/engine/sim/SimEngine.js';
import { finalScore } from '../js/engine/sim/score.js';
import { loadMarketData, loadIndustries } from '../tests/helpers/loadData.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIAL = [0, 0.25, 0.5, 0.75, 1];
export const STRATEGIES = ['unhedged', 'flat50', 'mandate', 'full', 'random'];
const BUYS_FORECASTING = new Set(['flat50', 'mandate', 'full']);

function readJson(relPath) {
    return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

// Real event cards once they exist (ruling R3), otherwise the A4 fixture. Shape: { events: [...] }.
function loadContent() {
    const real = 'data/simple-events.json';
    return readJson(existsSync(join(ROOT, real)) ? real : 'tests/fixtures/simple-events.json');
}

let world = null;
function loadWorld() {
    if (!world) {
        marketEngine.loadFromObjects(loadMarketData());
        world = {
            market: marketEngine,
            industries: loadIndustries(),
            content: loadContent(),
            titles: readJson('data/quips.json').gameOverTitles
        };
    }
    return world;
}

const snap = h => DIAL.reduce((best, d) => (Math.abs(d - h) < Math.abs(best - h) ? d : best), DIAL[0]);

function hedgeRatio(strategy, run, rng) {
    switch (strategy) {
        case 'unhedged': return 0;
        case 'flat50': return 0.5;
        case 'mandate': return snap((run.mandate.min + run.mandate.max) / 2);
        case 'full': return 1;
        case 'random': return rng.pick(DIAL);
        default: throw new Error(`Unknown strategy: ${strategy}`);
    }
}

// One full run; returns its status, quarters played and final score.
export function playRun(strategy, industry, seed) {
    const { market, content, titles } = loadWorld();
    let run = createRun({ industry, seed, startedAt: 0, market });
    // Strategy and event picks use their own stream so they never disturb the engine's.
    const rng = new SeededRandom((seed ^ 0x5bd1e995) >>> 0);
    while (!isRunOver(run)) {
        const h = hedgeRatio(strategy, run, rng);
        const hedges = Object.fromEntries(run.exposures.map(e => [e.id, h]));
        const buyPowerUp = run.quarter === 0 && BUYS_FORECASTING.has(strategy) ? 'forecasting' : null;
        let eventChoice = null;
        if (run.pendingEvent) {
            const event = content.events.find(e => e.id === run.pendingEvent);
            eventChoice = rng.pick(event.choices).id;
        }
        ({ run } = simulateQuarter(run, { hedges, useOptions: false, buyPowerUp, eventChoice }, market, content));
    }
    const { total, title } = finalScore(
        { history: run.history, status: run.status, startingCash: run.startingCash, boardMood: run.boardMood },
        titles
    );
    return { status: run.status, quarters: run.quarter, score: total, title };
}

// n runs of one strategy; run i plays industry i mod 7 with seed seedBase + i.
export function runStrategy(strategyName, n, seedBase = 1) {
    const { industries } = loadWorld();
    const scores = [];
    const titles = [];
    let bankrupt = 0;
    let fired = 0;
    let quarters = 0;
    let maxQuarters = 0;
    for (let i = 0; i < n; i++) {
        const r = playRun(strategyName, industries[i % industries.length], (seedBase + i) >>> 0);
        scores.push(r.score);
        titles.push(r.title);
        if (r.status === 'bankrupt') bankrupt++;
        if (r.status === 'fired') fired++;
        quarters += r.quarters;
        maxQuarters = Math.max(maxQuarters, r.quarters);
    }
    return { scores, bankruptRate: bankrupt / n, firedRate: fired / n, meanQuarters: quarters / n, maxQuarters, titles };
}

export const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// Linear-interpolated quantile, q in [0, 1].
export function quantile(xs, q) {
    const s = [...xs].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const shareAbove = (xs, v) => xs.filter(x => x > v).length / xs.length;

export function runAll(n, seedBase = 1) {
    return Object.fromEntries(STRATEGIES.map(s => [s, runStrategy(s, n, seedBase)]));
}

// The A7 balance criteria as restated by ruling R34, evaluated on runAll() output.
export function criteria(res) {
    const medMandate = quantile(res.mandate.scores, 0.5);
    const maxQ = Math.max(...STRATEGIES.map(s => res[s].maxQuarters));
    return [
        ['mean(mandate) > 1.3 x mean(unhedged)', mean(res.mandate.scores) > 1.3 * mean(res.unhedged.scores),
            `${mean(res.mandate.scores).toFixed(0)} vs ${(1.3 * mean(res.unhedged.scores)).toFixed(0)}`],
        ['share(full > median(mandate)) in [0.08, 0.30]',
            between(shareAbove(res.full.scores, medMandate), 0.08, 0.30), shareAbove(res.full.scores, medMandate).toFixed(3)],
        ['share(random > median(mandate)) >= 0.02',
            shareAbove(res.random.scores, medMandate) >= 0.02, shareAbove(res.random.scores, medMandate).toFixed(3)],
        ['p25(mandate) > median(unhedged)', quantile(res.mandate.scores, 0.25) > quantile(res.unhedged.scores, 0.5),
            `${quantile(res.mandate.scores, 0.25).toFixed(0)} vs ${quantile(res.unhedged.scores, 0.5).toFixed(0)}`],
        ['bankruptRate(unhedged) in [0.03, 0.30]', between(res.unhedged.bankruptRate, 0.03, 0.30), res.unhedged.bankruptRate.toFixed(3)],
        ['bankruptRate(mandate) < 0.05', res.mandate.bankruptRate < 0.05, res.mandate.bankruptRate.toFixed(3)],
        ['firedRate(mandate) < 0.05', res.mandate.firedRate < 0.05, res.mandate.firedRate.toFixed(3)],
        ['firedRate(unhedged) >= 0.15', res.unhedged.firedRate >= 0.15, res.unhedged.firedRate.toFixed(3)],
        ['max quarters === 8', maxQ === 8, String(maxQ)]
    ].map(([name, pass, value]) => ({ name, pass, value }));
}

function between(x, lo, hi) {
    return x >= lo && x <= hi;
}

function pad(v, w) {
    return String(v).padStart(w);
}

export function formatTable(res) {
    const head = ['strategy', 'mean', 'p10', 'p25', 'median', 'p75', 'p90', 'max', 'bankrupt', 'fired', 'meanQ'];
    const widths = [9, 6, 6, 6, 6, 6, 6, 6, 8, 6, 5];
    const lines = [head.map((h, i) => pad(h, widths[i])).join(' ')];
    for (const s of STRATEGIES) {
        const r = res[s];
        const row = [s, mean(r.scores).toFixed(0), ...[0.1, 0.25, 0.5, 0.75, 0.9].map(q => quantile(r.scores, q).toFixed(0)),
            Math.max(...r.scores), r.bankruptRate.toFixed(3), r.firedRate.toFixed(3), r.meanQuarters.toFixed(2)];
        lines.push(row.map((v, i) => pad(v, widths[i])).join(' '));
    }
    return lines.join('\n');
}

// Share of runs per gameOverTitles band, per strategy and pooled.
export function formatTitles(res) {
    const { titles } = loadWorld();
    const names = titles.map(t => t.title);
    const lines = [['min', 'title', ...STRATEGIES, 'all'].map((h, i) => (i < 2 ? h.padEnd(i ? 24 : 5) : pad(h, 8))).join(' ')];
    const all = STRATEGIES.flatMap(s => res[s].titles);
    titles.forEach((t, k) => {
        const share = list => (list.filter(x => x === names[k]).length / list.length * 100).toFixed(1) + '%';
        lines.push([String(t.min).padEnd(5), t.title.padEnd(24), ...STRATEGIES.map(s => pad(share(res[s].titles), 8)), pad(share(all), 8)].join(' '));
    });
    return lines.join('\n');
}

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const n = arg('n', 1000);
    const seed = arg('seed', 1);
    const t0 = performance.now();
    const res = runAll(n, seed);
    console.log(`${n} runs per strategy, seeds ${seed}..${seed + n - 1}, ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
    console.log(formatTable(res));
    console.log('\nCriteria');
    for (const c of criteria(res)) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.value})`);
    console.log('\nTitle bands (share of runs)');
    console.log(formatTitles(res));
}
