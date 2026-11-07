// Pure exposure and hedge cash maths. Signs match GameLoop.calculateQuarterlyPnL.

const IR_QUARTER = 0.25;
const OPTION_PREMIUM_PCT = 0.015;

export function exposureCashImpact(exp, startRate, endRate, notional) {
    if (exp.type === 'ir') {
        // Floating-rate payer: rates are decimals (0.0347 = 3.47%), one quarter of interest.
        return -(endRate - startRate) * notional * IR_QUARTER;
    }
    const ratio = (endRate - startRate) / startRate;
    let impact = exp.direction === 'buy' ? -ratio * notional : ratio * notional;
    if (exp.type === 'fx'
        && typeof exp.underlying === 'string'
        && typeof exp.unit === 'string'
        && exp.underlying.endsWith(exp.unit)) {
        impact = -impact;
    }
    return impact;
}

export function hedgeCashImpact(exp, startRate, endRate, hedgedNotional, product) {
    const forward = -exposureCashImpact(exp, startRate, endRate, hedgedNotional);
    if (product === 'forward') return forward;
    if (product === 'option') return Math.max(0, forward);
    throw new Error(`Unknown hedge product: ${product}`);
}

export function optionPremium(hedgedNotional) {
    return OPTION_PREMIUM_PCT * hedgedNotional;
}
