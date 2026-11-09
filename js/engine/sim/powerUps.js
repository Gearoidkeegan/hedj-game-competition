// Simple-mode power-ups (A9, ruling R44). Pure: operates on a RunState and returns a new one.
// Costs are fractions of starting cash in BALANCE.powerUpCosts.

import { BALANCE } from './balance.js';

const FORECAST_MAX_LEVEL = 3;

export const POWER_UPS = {
    // Tiered: up to 3 modules, each +20% forecast accuracy (run.forecastLevel 0..3).
    forecasting: { id: 'forecasting', singleUse: false, maxLevel: FORECAST_MAX_LEVEL },
    visibility: { id: 'visibility', singleUse: true, cashPct: 0.03 },
    // Bigger bank facilities: hedge cap 50% -> 100% and a borrowing buffer below zero cash.
    facilities: { id: 'facilities', singleUse: false },
    // Interest-rate and commodity hedging (many banks don't offer it). Only for industries with those exposures.
    hedgeAccess: { id: 'hedgeAccess', singleUse: false }
};

export const POWER_UP_IDS = Object.keys(POWER_UPS);

const owns = (run, id) => run.powerUps.owned.includes(id);
const forecastLevel = run => (Number.isInteger(run.forecastLevel) ? run.forecastLevel : 0);

// 0.4, 0.6, 0.8 or 1. Computed as (2 + level) / 5 so level 3 is exactly 1.
export function forecastAccuracy(run) {
    return (2 + Math.min(forecastLevel(run), FORECAST_MAX_LEVEL)) / 5;
}

// Forecast surprise variance for volume (fx, commodity) exposures: 0.40, 0.267, 0.133 or 0.
export function forecastVariance(run) {
    return BALANCE.forecast.baseVariance * Math.max(0, 1 - forecastAccuracy(run)) / 0.6;
}

// Largest hedge ratio allowed on any hedgeable exposure.
export function hedgeCap(run) {
    return owns(run, 'facilities') ? 1 : BALANCE.facilities.baseHedgeCap;
}

// How far below zero cash may fall before the run is bankrupt.
export function borrowingBuffer(run) {
    return owns(run, 'facilities') ? BALANCE.facilities.borrowPct * run.startingCash : 0;
}

// FX is always hedgeable; interest-rate and commodity exposures need hedgeAccess.
export function isHedgeable(run, exposure) {
    return exposure.type === 'fx' || owns(run, 'hedgeAccess');
}

// The ratio SimEngine clamps a requested hedge to: 0 if not hedgeable, otherwise the cap.
export function maxHedgeRatio(run, exposure) {
    return isHedgeable(run, exposure) ? hedgeCap(run) : 0;
}

const hasIrOrCommodity = run => run.exposures.some(e => e.type === 'ir' || e.type === 'commodity');

// Cost of the next purchase of `id` (for forecasting, the next module). Infinity when it can't be bought again.
export function powerUpCost(run, id) {
    if (id === 'forecasting') {
        const level = forecastLevel(run);
        return level < FORECAST_MAX_LEVEL ? BALANCE.powerUpCosts.forecasting[level] * run.startingCash : Infinity;
    }
    return BALANCE.powerUpCosts[id] * run.startingCash;
}

function availabilityError(run, id) {
    if (!Object.hasOwn(POWER_UPS, id)) return `Unknown power-up: ${id}`;
    if (id === 'forecasting') {
        if (forecastLevel(run) >= FORECAST_MAX_LEVEL) return 'Forecasting is already at its top level';
    } else if (owns(run, id) || run.powerUps.used.includes(id)) {
        return `Power-up already bought: ${id}`;
    }
    if (id === 'hedgeAccess' && !hasIrOrCommodity(run)) return 'hedgeAccess needs an interest-rate or commodity exposure';
    if (run.cash < powerUpCost(run, id)) return `Cannot afford power-up ${id}`;
    return null;
}

export function canBuyPowerUp(run, id, unlockedIds) {
    if (!Object.hasOwn(POWER_UPS, id)) return false;
    if (!unlockedIds.includes(id)) return false;
    return availabilityError(run, id) === null;
}

export function applyPowerUp(run, id) {
    const error = availabilityError(run, id);
    if (error) throw new Error(error);
    const cost = powerUpCost(run, id);

    const next = structuredClone(run);
    next.cash -= cost; // the benchmark never buys power-ups
    if (id === 'forecasting') {
        next.forecastLevel = forecastLevel(run) + 1;
        if (!owns(next, id)) next.powerUps.owned.push(id);
    } else if (id === 'visibility') {
        next.cash += POWER_UPS.visibility.cashPct * run.startingCash;
        next.powerUps.used.push(id);
    } else {
        next.powerUps.owned.push(id);
    }
    return next;
}
