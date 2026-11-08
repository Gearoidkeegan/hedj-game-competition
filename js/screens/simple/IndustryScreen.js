// IndustryScreen: pick the company for a Simple run. Seven cards; locked ones are greyed out with their unlock rule.
// Picking one waits for the market data (app.marketReady), starts the run and opens the quarter screen.

import { h } from '../../ui/dom.js';
import { exposureTitle, unlockRuleText } from '../../ui/labels.js';

// Starts a run once the market data has loaded (createRun throws without it). Shared with the title's crises.
export async function startRun(app, industryId, opts = {}) {
    await app.marketReady;
    return app.runController.start(industryId, opts);
}

export class IndustryScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.busy = false;
        this.cards = new Map();
        this.visit = 0;   // changes whenever the screen is rebuilt or left, so a late start can't navigate
    }

    render() {
        this.visit++;
        const industries = this.app.content?.industries || [];
        const unlocked = new Set(this.app.runController?.progress().unlocked || []);
        this.busy = false;
        this.cards = new Map();
        const list = h('div', { class: 'ind-list' }, industries.map(ind => this._card(ind, unlocked.has(`industry:${ind.id}`))));
        this.el = h('div', { class: 'screen active v3 industry-screen' },
            h('header', { class: 'v3-head' },
                h('button', { class: 'btn ind-back', type: 'button', text: 'BACK', 'aria-label': 'Back to title',
                    on: { click: () => this.app.showScreen('title') } }),
                h('h1', { text: 'Pick your company' })),
            h('div', { class: 'v3-body' },
                h('p', { class: 'v3-lede', text: 'You run treasury for eight quarters. Each company has its own risks.' }),
                list));
        return this.el;
    }

    mount() {}

    unmount() {
        this.visit++;
    }

    _card(ind, open) {
        const risks = (ind.exposures || []).map(e => exposureTitle(e)).join(', ');
        const nameEl = h('span', { class: 'ind-name', text: ind.name });
        const card = h('button', {
            class: `ind-card${open ? '' : ' is-locked'}`, type: 'button', 'data-industry': ind.id,
            disabled: !open, 'aria-disabled': open ? null : 'true',
            on: { click: () => this.pick(ind.id) }
        },
        nameEl,
        h('span', { class: 'ind-desc', text: ind.description || '' }),
        h('span', { class: 'ind-risks', text: `Risks: ${risks}` }),
        open ? null : h('span', { class: 'ind-lock', text: `Locked. ${unlockRuleText(`industry:${ind.id}`)}` }));
        this.cards.set(ind.id, { card, nameEl, name: ind.name, open });
        return card;
    }

    // Resolves once the run has started and the quarter screen is showing (or the start failed).
    async pick(industryId) {
        const entry = this.cards.get(industryId);
        if (this.busy || !entry?.open) return;
        this.busy = true;
        const visit = this.visit;
        for (const c of this.cards.values()) c.card.disabled = true;
        entry.nameEl.textContent = 'Opening the books…';
        try {
            await startRun(this.app, industryId);
        } catch (err) {
            console.error('IndustryScreen: could not start the run', err);
            this.app.showToast?.("Couldn't start the run. Check your connection and try again.", 'error');
            entry.nameEl.textContent = entry.name;
            for (const c of this.cards.values()) c.card.disabled = !c.open;
            this.busy = false;
            return;
        }
        if (visit === this.visit) this.app.showScreen('quarter');   // BACK during the start: stay where the player went
    }
}
