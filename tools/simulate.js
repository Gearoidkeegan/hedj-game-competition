// Balance simulator for the Simple sim engine (Tasks A7, A9).
//
//   node tools/simulate.js [--n 1000] [--seed 1]
//
// Plays n seeded runs per strategy, cycling through all 7 industries, and prints a table per strategy,
// a per-board-type table, the balance criteria (with their relative margins) and the gameOverTitles spread.
// Deterministic: the same --n and --seed give the same table.
//
// Strategies (A9). Hedge ratios apply to every active exposure; the engine clamps them to what is allowed
// (0 on IR/commodity before hedgeAccess, 0.5 before facilities):
//   unhedged  0 everywhere; buys nothing; never proposes a policy
//   flat50    0.5 everywhere; buys one forecasting module in Q1; never proposes a policy
//   policy    on a no-policy board, proposes 50-75 in Q1. Buys facilities when the band's min exceeds the
//             cap, then hedgeAccess (when the industry has IR/commodity and the band hedges at all), then one
//             forecasting module, one per quarter in that order. Dials the 0.25 step nearest the band
//             midpoint (ties go down), within the cap
//   full      buys facilities in Q1, hedgeAccess in Q2 when relevant; 100% everywhere
//   random    one random dial value per quarter, applied to every exposure; buys nothing; never proposes
// `severe` is the share of runs fired at once by a severe losing breach (R35); it is part of `fired`.
// Event choices: a seeded random pick among the event's choices (its own RNG stream per run), so
// both choices of every card get played.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marketEngine } from '../js/engine/MarketEngine.js';
import { SeededRandom } from '../js/utils/random.js';
import { createRun, simulateQuarter, isRunOver } from '../js/engine/sim/SimEngine.js';
import { canBuyPowerUp, hedgeCap, POWER_UP_IDS } from '../js/engine/sim/powerUps.js';
import { finalScore } from '../js/engine/sim/score.js';
import { loadMarketData, loadIndustries } from '../tests/helpers/loadData.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIAL = [0, 0.25, 0.5, 0.75, 1];
export const STRATEGIES = ['unhedged', 'flat50', 'policy', 'full', 'random'];
export const BOARD_TYPES = ['band', 'noHedge', 'none'];
const PROPOSAL = { min: 0.5, max: 0.75 };

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

// Nearest dial step; a tie goes to the lower step.
const snap = h => DIAL.reduce((best, d) => (Math.abs(d - h) < Math.abs(best - h) ? d : best), DIAL[0]);
const hasIrOrCommodity = run => run.exposures.some(e => e.type === 'ir' || e.type === 'commodity');
const owns = (run, id) => run.powerUps.owned.includes(id);
const canBuy = (run, id) => canBuyPowerUp(run, id, POWER_UP_IDS);

// This quarter's decisions for a strategy: { h, buyPowerUp, proposePolicy }.
function plan(strategy, run, rng) {
    switch (strategy) {
        case 'unhedged': return { h: 0, buyPowerUp: null, proposePolicy: null };
        case 'flat50': {
            const buyPowerUp = run.quarter === 0 && canBuy(run, 'forecasting') ? 'forecasting' : null;
            return { h: 0.5, buyPowerUp, proposePolicy: null };
        }
        case 'policy': {
            const proposePolicy = run.mandate === null ? PROPOSAL : null;
            const band = run.mandate ?? PROPOSAL;
            const wants = [];
            if (band.min > hedgeCap(run) && !owns(run, 'facilities')) wants.push('facilities');
            if (band.max > 0 && hasIrOrCommodity(run) && !owns(run, 'hedgeAccess')) wants.push('hedgeAccess');
            if (!owns(run, 'forecasting')) wants.push('forecasting');
            const buyPowerUp = wants.find(id => canBuy(run, id)) ?? null;
            const cap = buyPowerUp === 'facilities' ? 1 : hedgeCap(run);
            return { h: Math.min(snap((band.min + band.max) / 2), cap), buyPowerUp, proposePolicy };
        }
        case 'full': {
            let buyPowerUp = null;
            if (!owns(run, 'facilities')) buyPowerUp = canBuy(run, 'facilities') ? 'facilities' : null;
            else if (hasIrOrCommodity(run) && !owns(run, 'hedgeAccess')) buyPowerUp = canBuy(run, 'hedgeAccess') ? 'hedgeAccess' : null;
            return { h: 1, buyPowerUp, proposePolicy: null };
        }
        case 'random': return { h: rng.pick(DIAL), buyPowerUp: null, proposePolicy: null };
        default: throw new Error(`Unknown strategy: ${strategy}`);
    }
}

// One full run; returns its status, board, quarters played, final score and firing detail.
export function playRun(strategy, industry, seed) {
    const { market, content, titles } = loadWorld();
    let run = createRun({ industry, seed, startedAt: 0, market });
    const board = run.boardType;
    // Strategy and event picks use their own stream so they never disturb the engine's.
    const rng = new SeededRandom((seed ^ 0x5bd1e995) >>> 0);
    while (!isRunOver(run)) {
        const { h, buyPowerUp, proposePolicy } = plan(strategy, run, rng);
        const hedges = Object.fromEntries(run.exposures.map(e => [e.id, h]));
        let eventChoice = null;
        if (run.pendingEvent) {
            const event = content.events.find(e => e.id === run.pendingEvent);
            eventChoice = rng.pick(event.choices).id;
        }
        ({ run } = simulateQuarter(run, { hedges, buyPowerUp, eventChoice, proposePolicy }, market, content));
    }
    const { total, title } = finalScore(
        { history: run.history, status: run.status, startingCash: run.startingCash, boardMood: run.boardMood },
        titles
    );
    const last = run.history[run.history.length - 1];
    return {
        status: run.status,
        board,
        quarters: run.quarter,
        score: total,
        title,
        // Fired at once by a severe losing breach (R35): the severe check comes before the mood rule.
        severeFired: run.status === 'fired' && last.severe,
        // R40 check: a firing should follow an off-policy losing quarter, or the no-policy board.
        offPolicyLoss: run.history.some(s => s.breach === 'loss'),
        noPolicy: run.history.some(s => s.policy === 'none')
    };
}

function emptyBoardStats() {
    return { n: 0, fired: 0, bankrupt: 0, scores: [] };
}

// n runs of one strategy; run i plays industry i mod 7 with seed seedBase + i.
export function runStrategy(strategyName, n, seedBase = 1) {
    const { industries } = loadWorld();
    const scores = [];
    const titles = [];
    const byBoard = Object.fromEntries(BOARD_TYPES.map(b => [b, emptyBoardStats()]));
    let bankrupt = 0;
    let fired = 0;
    let firedExplained = 0;
    let severeFired = 0;
    let quarters = 0;
    let maxQuarters = 0;
    for (let i = 0; i < n; i++) {
        const r = playRun(strategyName, industries[i % industries.length], (seedBase + i) >>> 0);
        scores.push(r.score);
        titles.push(r.title);
        const b = byBoard[r.board];
        b.n++;
        b.scores.push(r.score);
        if (r.status === 'bankrupt') { bankrupt++; b.bankrupt++; }
        if (r.status === 'fired') {
            fired++;
            b.fired++;
            if (r.offPolicyLoss || r.noPolicy) firedExplained++;
        }
        if (r.severeFired) severeFired++;
        quarters += r.quarters;
        maxQuarters = Math.max(maxQuarters, r.quarters);
    }
    return {
        scores, titles, byBoard, fired, firedExplained,
        bankruptRate: bankrupt / n, firedRate: fired / n, severeFiredRate: severeFired / n,
        meanQuarters: quarters / n, maxQuarters
    };
}

export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

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

const boardFired = (r, b) => r.byBoard[b].fired / r.byBoard[b].n;
// Band boards pooled: fired / runs over the three bands.
const bandFired = r => boardFired(r, 'band');

// Relative margins: how far inside its threshold a value sits (negative = failing).
const above = (x, lo) => (x - lo) / Math.abs(lo || 1);
const below = (x, hi) => (hi - x) / Math.abs(hi || 1);

// The balance criteria, shared by balance.test.js and this report (A9; R34 luck bounds; R37 bankruptcy floor).
// Each: { name, pass, value, margin } where margin is relative (0.1 = 10% inside the threshold).
export function criteria(res) {
    const P = res.policy;
    const medPolicy = quantile(P.scores, 0.5);
    const maxQ = Math.max(...STRATEGIES.map(s => res[s].maxQuarters));
    const fired = STRATEGIES.reduce((a, s) => a + res[s].fired, 0);
    const explained = STRATEGIES.reduce((a, s) => a + res[s].firedExplained, 0);
    const explainedShare = fired ? explained / fired : 1;
    const full = shareAbove(res.full.scores, medPolicy);
    const random = shareAbove(res.random.scores, medPolicy);
    const noneP = mean(P.byBoard.none.scores);
    const noneF = mean(res.flat50.byBoard.none.scores);
    const noneU = mean(res.unhedged.byBoard.none.scores);
    const uNoneFired = boardFired(res.unhedged, 'none');
    const uBandHalf = 0.5 * bandFired(res.unhedged);
    const c = (name, pass, value, margin) => ({ name, pass, value, margin });
    return [
        c('mean(policy) > mean(unhedged)', mean(P.scores) > mean(res.unhedged.scores),
            `${mean(P.scores).toFixed(0)} vs ${mean(res.unhedged.scores).toFixed(0)}`, above(mean(P.scores), mean(res.unhedged.scores))),
        c('mean(policy) > mean(flat50)', mean(P.scores) > mean(res.flat50.scores),
            `${mean(P.scores).toFixed(0)} vs ${mean(res.flat50.scores).toFixed(0)}`, above(mean(P.scores), mean(res.flat50.scores))),
        c('share(full > median(policy)) in [0.08, 0.30]', full >= 0.08 && full <= 0.30, full.toFixed(3),
            Math.min(above(full, 0.08), below(full, 0.30))),
        c('share(random > median(policy)) >= 0.02', random >= 0.02, random.toFixed(3), above(random, 0.02)),
        c('bankruptRate(unhedged) in [0.015, 0.30]', res.unhedged.bankruptRate >= 0.015 && res.unhedged.bankruptRate <= 0.30,
            res.unhedged.bankruptRate.toFixed(3), Math.min(above(res.unhedged.bankruptRate, 0.015), below(res.unhedged.bankruptRate, 0.30))),
        c('bankruptRate(policy) < 0.05', P.bankruptRate < 0.05, P.bankruptRate.toFixed(3), below(P.bankruptRate, 0.05)),
        // In-policy play keeps you employed (A7, re-added in A9 fix round 1).
        c('firedRate(policy) < 0.05', P.firedRate < 0.05, P.firedRate.toFixed(3), below(P.firedRate, 0.05)),
        c('firedRate(unhedged) <= 0.50', res.unhedged.firedRate <= 0.50, res.unhedged.firedRate.toFixed(3),
            below(res.unhedged.firedRate, 0.50)),
        c('firedRate(unhedged | noHedge board) <= 0.15', boardFired(res.unhedged, 'noHedge') <= 0.15,
            boardFired(res.unhedged, 'noHedge').toFixed(3), below(boardFired(res.unhedged, 'noHedge'), 0.15)),
        c('fired runs with an off-policy loss or the no-policy board >= 0.7', explainedShare >= 0.7,
            `${explainedShare.toFixed(3)} (${explained}/${fired})`, above(explainedShare, 0.7)),
        c('none board: mean(policy) > mean(flat50)', noneP > noneF, `${noneP.toFixed(0)} vs ${noneF.toFixed(0)}`, above(noneP, noneF)),
        c('flat50 firedRate: none board > band boards', boardFired(res.flat50, 'none') > bandFired(res.flat50),
            `${boardFired(res.flat50, 'none').toFixed(3)} vs ${bandFired(res.flat50).toFixed(3)}`,
            above(boardFired(res.flat50, 'none'), bandFired(res.flat50))),
        // R49: the no-policy board pressures a player who never proposes a policy.
        c('none board: firedRate(unhedged) >= 0.5 x its band-board firedRate', uNoneFired >= uBandHalf,
            `${uNoneFired.toFixed(3)} vs ${uBandHalf.toFixed(3)}`, above(uNoneFired, uBandHalf)),
        c('none board: mean(unhedged) < mean(policy)', noneU < noneP, `${noneU.toFixed(0)} vs ${noneP.toFixed(0)}`, below(noneU, noneP)),
        c('max quarters === 8', maxQ === 8, String(maxQ), maxQ === 8 ? Infinity : -1)
    ];
}

function pad(v, w) {
    return String(v).padStart(w);
}

export function formatTable(res) {
    const head = ['strategy', 'mean', 'p10', 'p25', 'median', 'p75', 'p90', 'max', 'bankrupt', 'fired', 'severe', 'meanQ'];
    const widths = [9, 6, 6, 6, 6, 6, 6, 6, 8, 6, 6, 5];
    const lines = [head.map((h, i) => pad(h, widths[i])).join(' ')];
    for (const s of STRATEGIES) {
        const r = res[s];
        const row = [s, mean(r.scores).toFixed(0), ...[0.1, 0.25, 0.5, 0.75, 0.9].map(q => quantile(r.scores, q).toFixed(0)),
            Math.max(...r.scores), r.bankruptRate.toFixed(3), r.firedRate.toFixed(3), r.severeFiredRate.toFixed(3), r.meanQuarters.toFixed(2)];
        lines.push(row.map((v, i) => pad(v, widths[i])).join(' '));
    }
    return lines.join('\n');
}

// Fired rate, bankrupt rate and mean score per strategy and starting board type.
export function formatBoards(res) {
    const lines = [['strategy', ...BOARD_TYPES.flatMap(b => [`${b}:n`, 'fired', 'bust', 'mean'])].map((h, i) => pad(h, i ? 9 : 9)).join(' ')];
    for (const s of STRATEGIES) {
        const cells = BOARD_TYPES.flatMap(b => {
            const x = res[s].byBoard[b];
            return [x.n, (x.fired / x.n).toFixed(3), (x.bankrupt / x.n).toFixed(3), mean(x.scores).toFixed(0)];
        });
        lines.push([s, ...cells].map(v => pad(v, 9)).join(' '));
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
    console.log('\nBy starting board type');
    console.log(formatBoards(res));
    console.log('\nCriteria (margin: relative distance inside the threshold; THIN under 10%)');
    for (const c of criteria(res)) {
        const m = Number.isFinite(c.margin) ? `${(c.margin * 100).toFixed(0)}%` : '-';
        console.log(`  ${c.pass ? 'PASS' : 'FAIL'}${c.pass && c.margin < 0.1 ? ' THIN' : ''}  ${c.name}  (${c.value}; margin ${m})`);
    }
    console.log('\nTitle bands (share of runs)');
    console.log(formatTitles(res));
}
