// Simple-mode power-ups. Pure: operates on a RunState and returns a new one.

export const POWER_UPS = {
    forecasting: { id: 'forecasting', costPct: 0.01, singleUse: false },
    visibility: { id: 'visibility', costPct: 0.005, singleUse: true, cashPct: 0.03 },
    options: { id: 'options', costPct: 0.005, singleUse: false }
};

export function powerUpCost(run, id) {
    return POWER_UPS[id].costPct * run.startingCash;
}

function alreadyHeld(run, id) {
    return run.powerUps.owned.includes(id) || run.powerUps.used.includes(id);
}

export function canBuyPowerUp(run, id, unlockedIds) {
    if (!Object.hasOwn(POWER_UPS, id)) return false;
    if (!unlockedIds.includes(id)) return false;
    if (alreadyHeld(run, id)) return false;
    return run.cash >= powerUpCost(run, id);
}

export function applyPowerUp(run, id) {
    if (!Object.hasOwn(POWER_UPS, id)) throw new Error(`Unknown power-up: ${id}`);
    if (alreadyHeld(run, id)) throw new Error(`Power-up already bought: ${id}`);
    const cost = powerUpCost(run, id);
    if (run.cash < cost) throw new Error(`Cannot afford power-up ${id}`);

    const next = structuredClone(run);
    next.cash -= cost; // the benchmark never buys power-ups
    if (id === 'forecasting') {
        next.varianceMultiplier = 0.5;
        next.powerUps.owned.push(id);
    } else if (id === 'visibility') {
        next.cash += POWER_UPS.visibility.cashPct * run.startingCash;
        next.powerUps.used.push(id);
    } else {
        next.powerUps.owned.push(id);
    }
    return next;
}
