// Formatting utilities for currency, percentages, and dates

export function formatCurrency(amount, currency = 'USD', compact = false) {
    if (compact) {
        const abs = Math.abs(amount);
        const sign = amount < 0 ? '-' : '';
        if (abs >= 1e9) return `${sign}${currency} ${(abs / 1e9).toFixed(1)}B`;
        if (abs >= 1e6) return `${sign}${currency} ${(abs / 1e6).toFixed(1)}M`;
        if (abs >= 1e3) return `${sign}${currency} ${(abs / 1e3).toFixed(0)}K`;
        return `${sign}${currency} ${abs.toFixed(0)}`;
    }
    return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatRate(rate, decimals = 4, assetType = null) {
    if (assetType === 'ir') {
        // Interest rates: display as percentage (e.g. 0.035 → 3.50%)
        return `${(rate * 100).toFixed(2)}%`;
    }
    return rate.toFixed(decimals);
}

export function formatPercent(value, decimals = 1) {
    return `${(value * 100).toFixed(decimals)}%`;
}

export function formatPnL(amount, currency = 'USD') {
    const sign = amount >= 0 ? '+' : '';
    return `${sign}${formatCurrency(amount, currency, true)}`;
}

export function formatQuarter(yearOffset, quarter) {
    return `Year ${yearOffset + 1} Q${quarter}`;
}

export function formatChange(current, previous) {
    if (previous === 0) return '—';
    const change = (current - previous) / previous;
    const sign = change >= 0 ? '+' : '';
    return `${sign}${(change * 100).toFixed(2)}%`;
}

export function pnlClass(amount) {
    if (amount > 0) return 'pnl-positive';
    if (amount < 0) return 'pnl-negative';
    return 'pnl-neutral';
}
