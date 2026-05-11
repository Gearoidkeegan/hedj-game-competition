// HedgeLadder — multi-quarter hedge tenor grid UI
// Each quarter row has its own inline slider for quick % adjustment

export class HedgeLadder {
    /**
     * @param {HTMLElement} container - DOM element to render into
     * @param {Object} options
     * @param {Object} options.exposure - the exposure being hedged
     * @param {number} options.maxTenor - max forward quarters (default 8)
     * @param {Function} options.onChange - callback({ tenor, pct }) when user adjusts a bucket
     */
    constructor(container, options = {}) {
        this.container = container;
        this.exposure = options.exposure || null;
        this.maxTenor = options.maxTenor || 8;
        this.onChange = options.onChange || null;
        this.completedQuarters = options.completedQuarters || 0;

        // Coverage per tenor bucket: { 1: 0.5, 2: 0.3, ... } = 50% Q+1, 30% Q+2 etc.
        this.buckets = {};
        // Existing coverage from already-booked hedges (read-only baseline)
        this.existingBuckets = {};
        for (let i = 1; i <= this.maxTenor; i++) {
            this.buckets[i] = 0;
            this.existingBuckets[i] = 0;
        }

        this.selectedTenor = 1;
    }

    /**
     * Set existing hedge coverage per tenor (from active hedges).
     * @param {Object} existing - { tenor: ratio } e.g. { 1: 0.5, 2: 0.25 }
     */
    setExistingCoverage(existing) {
        for (let i = 1; i <= this.maxTenor; i++) {
            this.existingBuckets[i] = existing[i] || 0;
            this.buckets[i] = existing[i] || 0;
        }
        this.render();
    }

    /**
     * Get the currently selected tenor and percentage (for trade preview).
     */
    getSelection() {
        return {
            tenor: this.selectedTenor,
            pct: this.buckets[this.selectedTenor] || 0
        };
    }

    /**
     * Get all changed buckets — tenors where the slider differs from existing coverage.
     * Returns array of { tenor, pct, deltaPct } for each tenor that has new hedging to book.
     */
    getChangedBuckets() {
        const changes = [];
        for (let t = 1; t <= this.maxTenor; t++) {
            if (t <= this.completedQuarters) continue;
            const current = this.buckets[t] || 0;
            const existing = this.existingBuckets[t] || 0;
            const delta = current - existing;
            if (Math.abs(delta) > 0.001) {
                changes.push({ tenor: t, pct: current, deltaPct: delta });
            }
        }
        return changes;
    }

    /**
     * Get all bucket values.
     */
    getAllBuckets() {
        return { ...this.buckets };
    }

    render() {
        if (!this.container) return;

        const quarterlyNotional = this.exposure?.quarterlyNotional || 0;

        let html = `
            <div class="hedge-ladder">
                <div class="hedge-ladder-header" style="display:grid;grid-template-columns:36px 1fr 38px 38px 48px;gap:4px;align-items:center;padding:2px 4px;">
                    <span class="pixel-text" style="font-size:7px;color:var(--text-secondary)">TENOR</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-secondary)">COVERAGE</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-secondary);text-align:right" title="Existing coverage from booked hedges">EXIST</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--gold);text-align:right" title="Total coverage including current proposed trade">TOTAL</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-secondary);text-align:right">NOTIONAL</span>
                </div>
        `;

        for (let t = 1; t <= this.maxTenor; t++) {
            const pct = this.buckets[t] || 0;
            const existingPct = this.existingBuckets[t] || 0;
            const pctDisplay = Math.round(pct * 100);
            const notional = quarterlyNotional * pct;
            const isPast = t <= this.completedQuarters;
            const isSelected = t === this.selectedTenor;
            const barWidth = Math.min(100, pct * 100 / 2); // scale bar to 200% max
            const hasChange = Math.abs(pct - existingPct) > 0.001;

            const barColor = isPast ? 'var(--text-muted)'
                : pct >= 0.5 ? 'var(--pnl-positive)'
                : pct > 0 ? 'var(--gold)'
                : 'var(--border-inner)';

            const existingDisplay = Math.round(existingPct * 100);

            if (isPast) {
                html += `
                    <div class="hedge-ladder-row past" style="display:grid;grid-template-columns:36px 1fr 38px 38px 48px;gap:4px;align-items:center;padding:3px 4px;opacity:0.35;text-decoration:line-through;">
                        <span class="hedge-ladder-tenor pixel-text" style="font-size:8px;">Q+${t}</span>
                        <div class="hedge-ladder-bar-container" style="position:relative;height:14px;background:var(--panel-bg);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${barWidth}%;background:${barColor};border-radius:2px;"></div>
                        </div>
                        <span class="pixel-text" style="font-size:8px;text-align:right;color:var(--text-muted);">—</span>
                        <span class="pixel-text" style="font-size:8px;text-align:right;color:var(--text-muted);">${pctDisplay}%</span>
                        <span class="pixel-text" style="font-size:7px;text-align:right;color:var(--text-muted);">—</span>
                    </div>
                `;
            } else {
                html += `
                    <div class="hedge-ladder-row ${isSelected ? 'selected' : ''}" data-tenor="${t}"
                         style="display:grid;grid-template-columns:36px 1fr 38px 38px 48px;gap:4px;align-items:center;padding:3px 4px;cursor:pointer;${hasChange ? 'background:rgba(255,204,0,0.08);' : ''}">
                        <span class="hedge-ladder-tenor pixel-text" style="font-size:8px;">Q+${t}</span>
                        <div style="position:relative;">
                            <input type="range" class="ladder-row-slider" data-tenor="${t}"
                                min="0" max="200" step="10" value="${pctDisplay}"
                                style="width:100%;height:18px;cursor:pointer;">
                        </div>
                        <span class="hedge-ladder-existing pixel-text" data-tenor-existing="${t}" style="font-size:8px;text-align:right;color:var(--text-muted);">${existingDisplay}%</span>
                        <span class="hedge-ladder-pct pixel-text" data-tenor-pct="${t}" style="font-size:9px;text-align:right;color:${hasChange ? 'var(--gold)' : 'var(--text-primary)'};font-weight:bold;">${pctDisplay}%</span>
                        <span class="hedge-ladder-notional pixel-text" data-tenor-notional="${t}" style="font-size:7px;text-align:right;color:var(--text-secondary);">${this.formatCompact(notional)}</span>
                    </div>
                `;
            }
        }

        html += `</div>`;

        this.container.innerHTML = html;
        this.bindEvents();
    }

    bindEvents() {
        // Row click to select tenor (for trade preview)
        this.container.querySelectorAll('.hedge-ladder-row:not(.past)').forEach(row => {
            row.addEventListener('click', (e) => {
                // Don't select if clicking the slider itself
                if (e.target.classList.contains('ladder-row-slider')) return;
                const tenor = parseInt(row.dataset.tenor);
                if (!tenor || tenor <= this.completedQuarters) return;
                this.selectedTenor = tenor;
                // Update selected highlight
                this.container.querySelectorAll('.hedge-ladder-row').forEach(r => r.classList.remove('selected'));
                row.classList.add('selected');
                if (this.onChange) {
                    this.onChange({ tenor, pct: this.buckets[tenor] || 0 });
                }
            });
        });

        // Per-row sliders
        this.container.querySelectorAll('.ladder-row-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const tenor = parseInt(slider.dataset.tenor);
                const pct = parseInt(e.target.value) / 100;
                this.buckets[tenor] = pct;
                this.selectedTenor = tenor;

                const existingPct = this.existingBuckets[tenor] || 0;
                const hasChange = Math.abs(pct - existingPct) > 0.001;

                // Update the TOTAL % label (slider value = total coverage incl. trade)
                const pctLabel = this.container.querySelector(`[data-tenor-pct="${tenor}"]`);
                if (pctLabel) {
                    pctLabel.textContent = `${e.target.value}%`;
                    pctLabel.style.color = hasChange ? 'var(--gold)' : 'var(--text-primary)';
                }
                // Existing label stays at the baseline; ensure it's still visible
                const existLabel = this.container.querySelector(`[data-tenor-existing="${tenor}"]`);
                if (existLabel) {
                    existLabel.textContent = `${Math.round(existingPct * 100)}%`;
                }

                // Update notional label
                const notLabel = this.container.querySelector(`[data-tenor-notional="${tenor}"]`);
                if (notLabel) {
                    notLabel.textContent = this.formatCompact((this.exposure?.quarterlyNotional || 0) * pct);
                }

                // Highlight row if changed
                const row = slider.closest('.hedge-ladder-row');
                if (row) {
                    row.style.background = hasChange ? 'rgba(255,204,0,0.08)' : '';
                }

                // Update selected highlight
                this.container.querySelectorAll('.hedge-ladder-row').forEach(r => r.classList.remove('selected'));
                if (row) row.classList.add('selected');

                if (this.onChange) {
                    this.onChange({ tenor, pct });
                }
            });
        });
    }

    formatCompact(amount) {
        const abs = Math.abs(amount);
        if (abs >= 1e9) return `${(abs / 1e9).toFixed(1)}B`;
        if (abs >= 1e6) return `${(abs / 1e6).toFixed(1)}M`;
        if (abs >= 1e3) return `${(abs / 1e3).toFixed(0)}K`;
        if (abs === 0) return '—';
        return abs.toFixed(0);
    }
}
