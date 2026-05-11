// HedgingEngine — product pricing, MTM, settlement, and P&L for all hedge types
//
// Products per asset class:
//   FX:        forward, option
//   Commodity: future, option
//   IR:        swap, cap

import { GAME_CONFIG } from '../utils/constants.js';

class HedgingEngineController {

    // -----------------------------------------------------------------------
    // Product definitions — which products are available per asset class
    // -----------------------------------------------------------------------

    getProductsForAssetClass(assetClass) {
        switch (assetClass) {
            case 'fx':
                return [
                    { id: 'fx_forward', name: 'FX Forward', type: 'forward', hasUpfrontCost: false, hasBreakageCost: true },
                    { id: 'fx_option', name: 'FX Option', type: 'option', hasUpfrontCost: true, hasBreakageCost: false }
                ];
            case 'commodity':
                return [
                    { id: 'commodity_future', name: 'Future', type: 'future', hasUpfrontCost: false, hasBreakageCost: true },
                    { id: 'commodity_option', name: 'Option', type: 'option', hasUpfrontCost: true, hasBreakageCost: false }
                ];
            case 'ir':
                return [
                    { id: 'ir_swap', name: 'IR Swap', type: 'swap', hasUpfrontCost: false, hasBreakageCost: true },
                    { id: 'ir_cap', name: 'IR Cap', type: 'cap', hasUpfrontCost: true, hasBreakageCost: false }
                ];
            default:
                return [];
        }
    }

    // -----------------------------------------------------------------------
    // Pricing — calculate the contract rate / premium at trade inception
    // -----------------------------------------------------------------------

    /**
     * Price an FX forward using covered interest rate parity (simplified).
     * F = S × (1 + r_base × T) / (1 + r_quote × T)
     */
    priceFXForward(spot, rBase, rQuote, tenorQuarters) {
        const T = tenorQuarters * 0.25; // Convert quarters to years
        return spot * (1 + rBase * T) / (1 + rQuote * T);
    }

    /**
     * Price a commodity future using cost-of-carry.
     * F = S × (1 + r × T)
     */
    priceCommodityFuture(spot, riskFreeRate, tenorQuarters) {
        const T = tenorQuarters * 0.25;
        return spot * (1 + riskFreeRate * T);
    }

    /**
     * Price an FX or commodity option (simplified Black-Scholes proxy).
     * Returns the premium as a fraction of notional.
     * ATM options: ~2-5% of notional depending on vol and tenor.
     */
    priceOption(spot, vol, tenorQuarters, assetClass) {
        const T = tenorQuarters * 0.25;
        // Simplified: premium ≈ 0.4 × σ × √T × spot (ATM approximation)
        const baseVol = vol || this.getDefaultVol(assetClass);
        const premium = 0.4 * baseVol * Math.sqrt(T) * spot;
        return {
            premium,                    // Total premium per unit
            premiumPct: premium / spot,  // As fraction of spot
            strike: spot               // ATM strike
        };
    }

    /**
     * Price an IR swap — returns the fixed rate.
     * Simplified: fixed rate ≈ current floating + small term premium.
     */
    priceIRSwap(currentFloating, tenorQuarters) {
        // Term premium: ~5-15bps per year
        const T = tenorQuarters * 0.25;
        const termPremium = 0.001 * T;
        return currentFloating + termPremium;
    }

    /**
     * Price an IR cap — returns the premium.
     * Simplified: premium depends on how far cap strike is from current rate.
     */
    priceIRCap(currentRate, tenorQuarters) {
        const T = tenorQuarters * 0.25;
        // ATM cap: premium ≈ 1-3% of notional per year
        const annualPremium = 0.015;
        return {
            premium: annualPremium * T,  // As fraction of notional
            strike: currentRate          // ATM cap strike
        };
    }

    getDefaultVol(assetClass) {
        switch (assetClass) {
            case 'fx': return 0.10;
            case 'commodity': return 0.25;
            case 'ir': return 0.15;
            default: return 0.15;
        }
    }

    // -----------------------------------------------------------------------
    // Trade creation — build a hedge trade object
    // -----------------------------------------------------------------------

    /**
     * Create a hedge trade.
     * @param {Object} params
     * @param {Object} params.exposure - the exposure being hedged
     * @param {string} params.productId - e.g. 'fx_forward', 'fx_option'
     * @param {number} params.notional - hedge notional amount
     * @param {number} params.tenorQuarters - 1-8
     * @param {number} params.spotRate - current market rate
     * @param {number} params.rBase - base currency rate (for forwards)
     * @param {number} params.rQuote - quote currency rate (for forwards)
     * @param {number} params.currentQuarter - current total quarters played
     * @param {string} params.bankId - counterparty bank
     * @returns {Object} hedge trade object
     */
    createTrade(params) {
        const { exposure, productId, notional, tenorQuarters, spotRate, rBase, rQuote, currentQuarter, bankId } = params;

        const baseHedge = {
            id: `hedge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            productId,
            assetClass: exposure.type,
            underlying: exposure.underlying,
            // Hedge direction stored in PAIR-action terms (buy/sell the pair).
            // FX with home=base of pair (e.g. EUR base + EURUSD, unit=USD): hedge
            // direction is OPPOSITE to exposure unit-action (sell-USD exposure →
            // BUY EURUSD to lock in EUR). FX with home=quote of pair (e.g. USD base
            // + EURUSD, unit=EUR): hedge direction MATCHES (sell-EUR exposure →
            // SELL EURUSD). Commodities: same direction as exposure.
            direction: (() => {
                if (exposure.type !== 'fx') {
                    return exposure.direction === 'buy' ? 'buy' : 'sell';
                }
                const homeIsBase = typeof exposure.underlying === 'string'
                    && typeof exposure.unit === 'string'
                    && exposure.underlying.endsWith(exposure.unit);
                if (homeIsBase) {
                    return exposure.direction === 'buy' ? 'sell' : 'buy';
                }
                return exposure.direction === 'buy' ? 'buy' : 'sell';
            })(),
            notional,
            startQuarter: currentQuarter,
            maturityQuarter: currentQuarter + tenorQuarters,
            status: 'active',
            currentMtm: 0,
            marginPosted: 0,
            premiumPaid: 0,
            bankId: bankId || 'default'
        };

        switch (productId) {
            case 'fx_forward': {
                const fwdRate = this.priceFXForward(spotRate, rBase || 0.03, rQuote || 0.04, tenorQuarters);
                return { ...baseHedge, productType: 'forward', contractRate: fwdRate };
            }
            case 'fx_option': {
                const opt = this.priceOption(spotRate, null, tenorQuarters, 'fx');
                const premium = opt.premiumPct * notional;
                return { ...baseHedge, productType: 'option', contractRate: opt.strike, premiumPaid: premium, strike: opt.strike };
            }
            case 'commodity_future': {
                const futRate = this.priceCommodityFuture(spotRate, rBase || 0.04, tenorQuarters);
                return { ...baseHedge, productType: 'future', contractRate: futRate };
            }
            case 'commodity_option': {
                const opt = this.priceOption(spotRate, null, tenorQuarters, 'commodity');
                const premium = opt.premiumPct * notional;
                return { ...baseHedge, productType: 'option', contractRate: opt.strike, premiumPaid: premium, strike: opt.strike };
            }
            case 'ir_swap': {
                const fixedRate = this.priceIRSwap(spotRate, tenorQuarters);
                return { ...baseHedge, productType: 'swap', contractRate: fixedRate };
            }
            case 'ir_cap': {
                const cap = this.priceIRCap(spotRate, tenorQuarters);
                const premium = cap.premium * notional;
                return { ...baseHedge, productType: 'cap', contractRate: cap.strike, premiumPaid: premium, strike: cap.strike };
            }
            default:
                return { ...baseHedge, productType: 'forward', contractRate: spotRate };
        }
    }

    // -----------------------------------------------------------------------
    // MTM — mark-to-market valuation of active hedges
    // -----------------------------------------------------------------------

    /**
     * Calculate current MTM for a hedge.
     * @param {Object} hedge - hedge trade object
     * @param {number} currentRate - current market rate for the underlying
     * @param {number} quartersRemaining - quarters until maturity
     * @returns {number} MTM value (positive = in the money)
     */
    calculateMTM(hedge, currentRate, quartersRemaining) {
        if (hedge.status !== 'active') return 0;

        const sign = hedge.direction === 'buy' ? 1 : -1;

        switch (hedge.productType) {
            case 'forward':
            case 'future': {
                // MTM = (current forward - contract rate) × notional × direction
                // Simplified: use spot as proxy for forward at short tenors
                return sign * (currentRate - hedge.contractRate) * hedge.notional / currentRate;
            }
            case 'option': {
                // Intrinsic value + time value
                const intrinsic = hedge.direction === 'buy'
                    ? Math.max(0, hedge.strike - currentRate) * hedge.notional / currentRate
                    : Math.max(0, currentRate - hedge.strike) * hedge.notional / currentRate;
                // Time value decays toward zero
                const timeValue = hedge.premiumPaid * Math.max(0, quartersRemaining / (hedge.maturityQuarter - hedge.startQuarter));
                return intrinsic + timeValue - hedge.premiumPaid;
            }
            case 'swap': {
                // Swap MTM: (floating - fixed) × notional × remaining time
                const T = quartersRemaining * 0.25;
                return (currentRate - hedge.contractRate) * hedge.notional * T;
            }
            case 'cap': {
                // Cap value: intrinsic if rate exceeds strike
                const capPayoff = Math.max(0, currentRate - hedge.strike) * hedge.notional * 0.25;
                const timeValue = hedge.premiumPaid * Math.max(0, quartersRemaining / (hedge.maturityQuarter - hedge.startQuarter));
                return capPayoff + timeValue - hedge.premiumPaid;
            }
            default:
                return 0;
        }
    }

    // -----------------------------------------------------------------------
    // Settlement — calculate P&L when a hedge matures or is unwound
    // -----------------------------------------------------------------------

    /**
     * Settle a maturing hedge.
     * @param {Object} hedge
     * @param {number} settlementRate - market rate at maturity
     * @returns {{ pnl: number, cashFlow: number }}
     */
    settle(hedge, settlementRate) {
        const sign = hedge.direction === 'buy' ? 1 : -1;

        switch (hedge.productType) {
            case 'forward':
            case 'future': {
                // P&L = (settlement - contract) × notional × direction
                const pnl = sign * (settlementRate - hedge.contractRate) * hedge.notional / settlementRate;
                return { pnl, cashFlow: pnl };
            }
            case 'option': {
                // Option payoff at expiry
                let payoff;
                if (hedge.direction === 'buy') {
                    payoff = Math.max(0, hedge.strike - settlementRate) * hedge.notional / settlementRate;
                } else {
                    payoff = Math.max(0, settlementRate - hedge.strike) * hedge.notional / settlementRate;
                }
                const pnl = payoff - hedge.premiumPaid;
                return { pnl, cashFlow: payoff };
            }
            case 'swap': {
                // Quarterly settlement: (floating - fixed) × notional × 0.25
                const pnl = (settlementRate - hedge.contractRate) * hedge.notional * 0.25;
                return { pnl, cashFlow: pnl };
            }
            case 'cap': {
                // Cap payoff if rate exceeds strike
                const payoff = Math.max(0, settlementRate - hedge.strike) * hedge.notional * 0.25;
                const pnl = payoff - hedge.premiumPaid;
                return { pnl, cashFlow: payoff };
            }
            default:
                return { pnl: 0, cashFlow: 0 };
        }
    }

    // -----------------------------------------------------------------------
    // Unwind — early termination cost
    // -----------------------------------------------------------------------

    /**
     * Calculate the cost to unwind a hedge early.
     * Forwards/futures/swaps have breakage cost = current MTM.
     * Options have no breakage — they just expire worthless or are sold.
     * @param {Object} hedge
     * @param {number} currentRate
     * @param {number} quartersRemaining
     * @returns {{ cost: number, hasBreakage: boolean }}
     */
    unwindCost(hedge, currentRate, quartersRemaining) {
        const mtm = this.calculateMTM(hedge, currentRate, quartersRemaining);

        switch (hedge.productType) {
            case 'forward':
            case 'future':
            case 'swap':
                // Breakage cost = negative MTM (you pay to exit a losing position)
                return {
                    cost: mtm < 0 ? Math.abs(mtm) : 0,
                    proceeds: mtm > 0 ? mtm : 0,
                    hasBreakage: true
                };
            case 'option':
            case 'cap':
                // No breakage — can sell option for residual value
                return {
                    cost: 0,
                    proceeds: Math.max(0, mtm + hedge.premiumPaid) * 0.9, // 10% bid-offer loss
                    hasBreakage: false
                };
            default:
                return { cost: 0, proceeds: 0, hasBreakage: false };
        }
    }

    // -----------------------------------------------------------------------
    // Trading costs — for scoring the over-trading penalty
    // -----------------------------------------------------------------------

    /**
     * Calculate trading cost for a new trade.
     * @param {string} productType
     * @param {number} notional
     * @returns {number} cost
     */
    getTradingCost(productType, notional) {
        // Bid-offer cost as fraction of notional
        const bps = {
            'forward': 3,   // 3bps
            'future': 2,    // 2bps
            'option': 5,    // 5bps (wider for options)
            'swap': 4,      // 4bps
            'cap': 5        // 5bps
        };
        const costBps = bps[productType] || 3;
        return notional * costBps / 10000;
    }
}

// Singleton
export const hedgingEngine = new HedgingEngineController();
