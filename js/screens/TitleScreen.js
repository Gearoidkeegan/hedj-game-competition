// Title screen (v3): PLAY, RESUME for the registered player's own saved run, their stats, a leaderboard teaser,
// PRO and CRISES entries, and "Not you?" for a shared device.
// Per player (R39): everything personal comes from app.runController, which only ever reads the registered
// player's namespaced save and progress. Player strings are set with textContent (R7); no innerHTML.

import * as apiModule from '../utils/api.js';
import { getRegistration, clearRegistration, hasSeenGuide } from '../utils/storage.js';
import { CRISES } from '../engine/sim/crises.js';
import { CHAIRMAN_SPRITES } from '../ui/pixel/sprites.js';
import { soundFX } from '../ui/SoundFX.js';
import { h } from '../ui/dom.js';
import { badgeLabel, nextUnlockHint, unlockRuleText } from '../ui/labels.js';
import { startRun } from './simple/IndustryScreen.js';

const TEASER_SIZE = 3;
const TODAY_LIMIT = 50;   // the backend's maximum
const CHAIRMEN_TOTAL = Object.keys(CHAIRMAN_SPRITES).length;
const num = n => Math.round(n).toLocaleString('en-GB');

function validRegistration() {
    const reg = getRegistration();
    return reg?.email && reg.gameTokenExpiry > Date.now() ? reg : null;
}

export class TitleScreen {
    // deps.api lets tests inject a fake (fetchLeaderboard).
    constructor(app, { api = apiModule } = {}) {
        this.app = app;
        this.api = api;
        this.el = null;
        this.mountId = 0;
        this.starting = false;
    }

    render() {
        const rc = this.app.runController;
        this.reg = validRegistration();
        this.progress = rc ? rc.progress() : null;
        // resume() only ever returns the registered player's run, and resets the controller otherwise.
        this.resumeRun = this.reg && rc ? rc.resume() : null;
        this.crisisOpen = false;
        this.statsEl = null;

        this.el = h('div', { class: 'screen active v3 title-v3' },
            h('div', { class: 'v3-body t-body' },
                h('div', { class: 't-logo' },
                    h('img', { src: 'assets/images/hedj-logo.png', alt: 'Hedj', width: '72', height: '72' }),
                    h('h1', { text: 'Treasury Manager' }),
                    h('p', { class: 't-tag', text: 'Eight quarters. One board. Can you keep your job?' })),
                this._playerLine(),
                this._menu(),
                this.reg ? this._stats() : null,
                this._teaser(),
                this._more()),
            h('footer', { class: 't-footer' },
                h('button', { class: 'btn t-sound', type: 'button', 'aria-label': 'Sound on', text: 'SOUND ON',
                    on: { click: e => this._toggleSound(e.currentTarget) } }),
                h('a', { href: 'https://www.hedj.eu', target: '_blank', rel: 'noopener', text: 'Powered by Hedj' })));
        return this.el;
    }

    mount() {
        const id = ++this.mountId;
        const live = () => id === this.mountId;
        if (this.reg && this.app.runController) {
            this.app.runController.syncProgress()
                .then(p => { if (live() && p) this._paintStats(p); })
                .catch(() => {});
        }
        Promise.resolve()
            .then(() => this.api.fetchLeaderboard({ mode: 'simple', period: 'today', limit: TODAY_LIMIT }))
            .then(entries => { if (live()) this._paintBoard(Array.isArray(entries) ? entries : [], false); })
            .catch(() => { if (live()) this._paintBoard([], true); });
    }

    unmount() {
        this.mountId++;
    }

    // ── Sections ──────────────────────────────────────────────────────────

    _playerLine() {
        if (!this.reg) return null;
        return h('p', { class: 't-player' },
            'Playing as ',
            h('span', { class: 't-player-name', text: this.reg.playerName || this.reg.email }),
            ' ',
            h('button', { class: 'btn-link t-notyou', type: 'button', text: 'Not you?', on: { click: () => this._notYou() } }));
    }

    _menu() {
        const run = this.resumeRun;
        const industry = run && (this.app.content?.industries || []).find(i => i.id === run.industryId);
        return h('div', { class: 't-menu' },
            run ? h('button', { class: 'btn btn-gold t-resume', type: 'button', on: { click: () => this.app.showScreen('quarter') } },
                h('span', { class: 't-btn-main', text: 'RESUME' }),
                h('span', { class: 't-btn-sub', text: `${industry?.name || 'Your run'}, quarter ${run.quarter + 1} of ${run.maxQuarters}` }))
                : null,
            h('button', { class: `btn ${run ? '' : 'btn-gold '}t-play`, type: 'button', on: { click: () => this._play() } },
                h('span', { class: 't-btn-main', text: run ? 'NEW RUN' : 'PLAY' }),
                h('span', { class: 't-btn-sub', text: '8 quarters, about 3 minutes' })));
    }

    _stats() {
        const stat = (key, label) => h('div', { class: 't-stat', 'data-stat': key },
            h('dt', { text: label }), h('dd', { class: 't-stat-value', text: '…' }));
        this.nextEl = h('p', { class: 't-next' });
        this.badgesEl = h('p', { class: 't-badges', hidden: true });
        this.statsEl = h('section', { class: 't-stats', 'aria-label': 'Your progress' },
            h('dl', { class: 't-stat-grid' },
                stat('best', 'Personal best'),
                stat('rank', "Today's rank"),
                stat('chairmen', 'Chairmen met')),
            this.nextEl,
            this.badgesEl);
        this._paintStats(this.progress);
        return this.statsEl;
    }

    _teaser() {
        this.topList = h('ol', { class: 't-top' });
        this.topEmpty = h('p', { class: 't-top-empty', text: 'Loading…' });
        return h('section', { class: 't-board', 'aria-label': "Today's top scores" },
            h('h2', { text: "Today's top 3" }),
            this.topList,
            this.topEmpty,
            h('button', { class: 'btn t-lb', type: 'button', text: 'LEADERBOARD', on: { click: () => this.showLeaderboard() } }));
    }

    _more() {
        const unlocked = new Set(this.progress?.unlocked || []);
        const proOpen = unlocked.has('mode:pro');
        this.crises = CRISES.filter(c => unlocked.has(`crisis:${c.id}`));
        this.crisisList = h('div', { class: 't-crises', hidden: true },
            this.crises.map(c => h('button', { class: 'btn t-crisis', type: 'button', 'data-crisis': c.id, text: c.label,
                on: { click: () => this.startCrisis(c.id) } })));
        const entry = (cls, title, rule, onClick, open) => h('button', {
            class: `btn ${cls}${open ? '' : ' is-locked'}`, type: 'button', disabled: !open,
            on: { click: onClick }
        }, h('span', { class: 't-btn-main', text: title }), open ? null : h('span', { class: 't-btn-sub', text: `Locked. ${rule}` }));
        return h('div', { class: 't-more' },
            h('div', { class: 't-more-row' },
                entry('t-pro', 'PRO', unlockRuleText('mode:pro'), () => this._pro(), proOpen),
                entry('t-crises-btn', 'CRISES', unlockRuleText('crisis:*'), () => {
                    this.crisisOpen = !this.crisisOpen;
                    this.crisisList.hidden = !this.crisisOpen;
                }, this.crises.length > 0)),
            this.crisisList,
            h('button', { class: 'btn t-howto', type: 'button', text: 'HOW TO PLAY', on: { click: () => this.app.showScreen('howtoplay') } }));
    }

    // ── Painting async data ───────────────────────────────────────────────

    _paintStats(p) {
        if (!this.statsEl || !p) return;
        const set = (key, text) => { this.statsEl.querySelector(`[data-stat="${key}"] .t-stat-value`).textContent = text; };
        set('best', p.best?.simple > 0 ? num(p.best.simple) : '—');
        set('chairmen', `${(p.chairmenMet || []).length}/${CHAIRMEN_TOTAL}`);
        const next = nextUnlockHint(p, this.app.content);
        this.nextEl.textContent = next || 'Everything unlocked. Now beat your best.';
        const badges = (p.crisisBadges || []).map(id => badgeLabel(id, this.app.content));
        this.badgesEl.textContent = badges.length ? `Crisis badges: ${badges.join(', ')}` : '';
        this.badgesEl.hidden = !badges.length;
    }

    _paintBoard(entries, offline) {
        this.topList.replaceChildren(...entries.slice(0, TEASER_SIZE).map(e => h('li', {},
            h('span', { class: 't-top-rank', text: `${e.rank}.` }),
            h('span', { class: 't-top-name', text: e.playerName || 'Anonymous' }),
            h('span', { class: 't-top-score', text: num(Number(e.score) || 0) }))));
        this.topEmpty.textContent = offline ? 'Leaderboard unavailable offline' : 'No scores yet today. Be the first.';
        this.topEmpty.hidden = !offline && entries.length > 0;
        if (this.statsEl) {
            // The board carries no emails (GDPR), so "you" is the entry with your name and company.
            const me = this.reg && entries.find(e => e.playerName === this.reg.playerName && (e.company || '') === (this.reg.company || ''));
            this.statsEl.querySelector('[data-stat="rank"] .t-stat-value').textContent = offline ? 'Offline' : me ? `#${me.rank}` : '—';
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────

    _viaGuide(returnScreen) {
        if (!hasSeenGuide() && this.app.screens?.howtoplay) {
            const guide = this.app.screens.howtoplay;
            guide.fromAutoShow = true;
            guide.returnScreen = returnScreen;
            this.app.showScreen('howtoplay');
            return;
        }
        this.app.showScreen(returnScreen);
    }

    _play() {
        this._viaGuide('industry');
    }

    _pro() {
        this.app.gameMode = 'quickplay';
        this._viaGuide('setup');
    }

    // R39: forget this player completely before the next one registers.
    _notYou() {
        clearRegistration();
        this.app.runController?.reset();
        this.app.showScreen('registration');
    }

    async startCrisis(crisisId) {
        const crisis = CRISES.find(c => c.id === crisisId);
        if (!crisis || this.starting) return;
        this.starting = true;
        try {
            await startRun(this.app, crisis.industryId, { crisisId });
            this.app.showScreen('quarter');
        } catch (err) {
            console.error('TitleScreen: could not start the crisis', err);
            this.app.showToast?.("Couldn't start the crisis. Check your connection and try again.", 'error');
        } finally {
            this.starting = false;
        }
    }

    _toggleSound(btn) {
        const on = soundFX.toggle();
        btn.textContent = on ? 'SOUND ON' : 'SOUND OFF';
        btn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
        if (on) soundFX.click();
    }

    async showLeaderboard() {
        const body = h('div', { class: 'lb-body' }, h('p', { text: 'Loading scores…' }));
        const close = h('button', { class: 'btn lb-close', type: 'button', text: 'CLOSE' });
        const overlay = h('div', { class: 'v3-modal', role: 'dialog', 'aria-label': 'Leaderboard' },
            h('div', { class: 'v3-modal-box' }, h('h2', { text: 'Leaderboard' }), body, close));
        const doc = globalThis.document;
        (doc.getElementById('game-viewport') || doc.body).appendChild(overlay);
        close.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        close.focus?.();
        try {
            const entries = await this.api.fetchLeaderboard({ mode: 'simple', period: 'event', limit: 20 });
            body.replaceChildren(entries.length
                ? h('ol', { class: 'lb-list' }, entries.map(e => h('li', {},
                    h('span', { class: 'lb-rank', text: `${e.rank}.` }),
                    h('span', { class: 'lb-name' },
                        h('span', { text: e.playerName || 'Anonymous' }),
                        e.company ? h('span', { class: 'lb-company', text: e.company }) : null),
                    h('span', { class: 'lb-score', text: num(Number(e.score) || 0) }))))
                : h('p', { text: 'No scores yet. Be the first.' }));
        } catch {
            body.replaceChildren(h('p', { text: 'Leaderboard unavailable offline.' }));
        }
    }
}
