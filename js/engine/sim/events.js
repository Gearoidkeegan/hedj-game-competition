// Simple-mode event cards. Pure: operates on a RunState and returns a new one.

// Picks a not-yet-seen event, weighted by `weight`. Returns its id, or null when none are left.
// The chance of an event happening at all is rolled by SimEngine, not here.
export function rollEvent(run, events, rng) {
    const seen = new Set([
        ...run.history.map(s => s.event && s.event.id).filter(Boolean),
        ...(run.pendingEvent ? [run.pendingEvent] : [])
    ]);
    const pool = events.filter(e => !seen.has(e.id));
    if (pool.length === 0) return null;
    const total = pool.reduce((sum, e) => sum + (e.weight > 0 ? e.weight : 0), 0);
    if (total <= 0) return rng.pick(pool).id;
    let roll = rng.next() * total;
    for (const e of pool) {
        roll -= e.weight > 0 ? e.weight : 0;
        if (roll < 0) return e.id;
    }
    return pool[pool.length - 1].id;
}

// Applies the chosen effects. cashPct hits both sides, mood the player only. notionalMult (keyed by
// exposure id; unknown ids are ignored) and varianceMult last only for this quarter, so they are
// returned rather than stored on the run.
export function applyEventChoice(run, event, choiceId) {
    if (!event) throw new Error(`Event ${run.pendingEvent} not found in content`);
    const choice = (event.choices || []).find(c => c.id === choiceId);
    if (!choice) throw new Error(`Unknown choice "${choiceId}" for event ${event.id}`);
    const fx = choice.effects || {};

    const next = structuredClone(run);
    if (fx.cashPct) {
        const delta = fx.cashPct * run.startingCash;
        next.cash += delta;
        next.benchmarkCash += delta;
    }
    if (fx.mood) next.boardMood = Math.min(100, Math.max(0, next.boardMood + fx.mood));

    const quarterNotionalMult = {};
    for (const [id, m] of Object.entries(fx.notionalMult || {})) {
        if (run.exposures.some(e => e.id === id)) quarterNotionalMult[id] = m;
    }
    return { run: next, quarterNotionalMult, quarterVarianceMult: fx.varianceMult ?? 1 };
}
