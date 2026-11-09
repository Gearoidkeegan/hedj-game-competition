// Title screen (v3): PLAY, RESUME for the registered player's own saved run, their stats, a leaderboard teaser,
// PRO and CRISES entries, and "Not you?" for a shared device.
// Per player (R39): everything personal comes from app.runController, which only ever reads the registered
// player's namespaced save and progress. Player strings are set with textContent (R7); no innerHTML.
// Free play (R66): the local guest's progress and RESUME, a PRACTICE MODE line instead of the player line, no
// rank or top 3, and the last event's leaderboard only when it has entries.
// v3.1: CHARACTER (for a registered player or the guest) reopens the character picker, then comes back here.

import * as apiModule from '../utils/api.js';
import { getRegistration, clearRegistration, hasSeenGuide, isFreePlay } from '../utils/storage.js';
import { practiceLine } from '../utils/eventStatus.js';
import { CRISES } from '../engine/sim/crises.js';
import { CHAIRMAN_SPRITES } from '../ui/pixel/sprites.js';
import { soundFX } from '../ui/SoundFX.js';
import { h } from '../ui/dom.js';
import { badgeLabel, nextUnlockHint, unlockRuleText } from '../ui/labels.js';
import { startRun } from './simple/IndustryScreen.js';
import { avatarCanvas, storedAvatar } from './simple/AvatarPicker.js';

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
        this.checking = false;   // PLAY is waiting on the event re-check (R66)
    }

    render() {
        const rc = this.app.runController;
        this.free = isFreePlay();
        this.reg = this.free ? null : validRegistration();
        // Unlocks and stats only for a valid registration (or the guest in free play): an expired one shows the
        // first-time view (PRO/CRISES locked).
        const player = this.free || !!this.reg;
        this.progress = player && rc ? rc.progress() : null;
        // resume() only ever returns the current player's run, and resets the controller otherwise.
        this.resumeRun = player && rc ? rc.resume() : null;
        this.crisisOpen = false;
        this.statsEl = null;

        this.el = h('div', { class: 'screen active v3 title-v3' },
            h('div', { class: 'v3-body t-body' },
                h('div', { class: 't-logo' },
                    h('img', { src: 'assets/images/hedj-logo.png', alt: 'Hedj', width: '72', height: '72' }),
                    h('h1', { text: 'Treasury Manager' }),
                    h('p', { class: 't-tag', text: 'Eight quarters to prove you deserve the job.' })),
                this.free ? this._practiceLine() : this._playerLine(),
                this._menu(),
                this.reg || this.free ? this._stats() : null,
                this.free ? this._lastEvent() : this._teaser(),
                this._more()),
            h('footer', { class: 't-footer' },
                h('button', { class: 'btn t-sound', type: 'button', 'aria-label': soundFX.enabled ? 'Sound on' : 'Sound off',
                    text: soundFX.enabled ? 'SOUND ON' : 'SOUND OFF',
                    on: { click: e => this._toggleSound(e.currentTarget) } }),
                h('a', { href: 'https://www.hedj.eu', target: '_blank', rel: 'noopener', text: 'Powered by Hedj' })));
        return this.el;
    }

    mount() {
        const id = ++this.mountId;
        const live = () => id === this.mountId;
        // R66 (I1): a stale event status is checked again as the title shows; a changed mode redraws the title.
        const em = this.app.eventMode;
        if (typeof em?.isStale === 'function' && em.isStale()) {
            Promise.resolve()
                .then(() => em.refresh())
                .then(() => { if (live() && em.apply()) this.app.showScreen('title'); })
                .catch(() => {});
        }
        if (this.free) {
            // Only whether the last event's board has entries: it decides if its LEADERBOARD button shows.
            Promise.resolve()
                .then(() => this.api.fetchLeaderboard({ mode: 'simple', period: 'event', limit: 1 }))
                .then(entries => { if (live()) this.lastBoardBtn.hidden = !(Array.isArray(entries) && entries.length); })
                .catch(() => {});
            return;
        }
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
        this._closeLeaderboard();
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

    _practiceLine() {
        return h('p', { class: 't-practice' },
            h('span', { class: 't-practice-tag', text: 'PRACTICE MODE' }),
            h('span', { class: 't-practice-line', text: practiceLine(this.app.event, this.app.eventMode?.now?.() ?? Date.now()) }));
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
                this.free ? null : stat('rank', "Today's rank"),
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

    // Free play: the last event's final board, hidden until mount() finds it has entries.
    _lastEvent() {
        this.lastBoardBtn = h('button', { class: 'btn t-lb', type: 'button', text: "Last event's leaderboard", hidden: true,
            on: { click: () => this.showLeaderboard() } });
        return this.lastBoardBtn;
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
            h('div', { class: (this.reg || this.free) ? 't-more-row' : 't-more-one' },
                (this.reg || this.free) ? this._characterButton() : null,
                h('button', { class: 'btn t-howto', type: 'button', text: 'HOW TO PLAY', on: { click: () => this.app.showScreen('howtoplay') } })));
    }

    _characterButton() {
        const id = storedAvatar();
        return h('button', { class: 'btn t-character', type: 'button', on: { click: () => this._character() } },
            id ? avatarCanvas(id, 'happy', 24, 'av-face t-character-face') : null,
            h('span', { text: 'CHARACTER' }));
    }

    _character() {
        if (this.app.screens?.avatar) this.app.screens.avatar.nextScreen = 'title';
        this.app.showScreen('avatar');
    }

    // ── Painting async data ───────────────────────────────────────────────

    _paintStats(p) {
        if (!this.statsEl || !p) return;
        const set = (key, text) => { this.statsEl.querySelector(`[data-stat="${key}"] .t-stat-value`).textContent = text; };
        set('best', p.best?.simple > 0 ? num(p.best.simple) : '-');
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
        if (this.statsEl && !this.free) {
            // The board carries no emails (GDPR), so "you" is the entry with your name and company.
            const me = this.reg && entries.find(e => e.playerName === this.reg.playerName && (e.company || '') === (this.reg.company || ''));
            this.statsEl.querySelector('[data-stat="rank"] .t-stat-value').textContent = offline ? 'Offline' : me ? `#${me.rank}` : '-';
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
        this._afterEventCheck('.t-play', () => this._viaGuide('industry'));
    }

    _pro() {
        this.app.gameMode = 'quickplay';
        // PRO was offered from the other mode's unlocks: if the mode changes, show the title again instead.
        this._afterEventCheck('.t-pro', () => this._viaGuide('setup'), { titleIfChanged: true });
    }

    // R66: when the event status is stale (the last check failed, it is over a minute old, or a cached start or end
    // has passed), check again first, with CHECKING… on the button. The wait ends at the check's 4 s timeout. A
    // switch to live then sends the player to register at the run start; a switch to free play starts a guest run.
    _afterEventCheck(selector, next, { titleIfChanged = false } = {}) {
        const em = this.app.eventMode;
        if (typeof em?.isStale !== 'function' || !em.isStale()) {
            const changed = em?.apply?.() === true;
            if (changed && titleIfChanged) this.app.showScreen('title');
            else next();
            return;
        }
        if (this.checking) return;
        this.checking = true;
        const id = this.mountId;
        const btn = this.el?.querySelector(selector);
        const label = btn?.querySelector('.t-btn-main');
        const text = label?.textContent;
        if (btn) btn.disabled = true;
        if (label) label.textContent = 'CHECKING…';
        Promise.resolve()
            .then(() => em.beforePlay())
            .catch(() => false)
            .then((changed) => {
                this.checking = false;
                if (btn) btn.disabled = false;
                if (label) label.textContent = text;
                if (id !== this.mountId) return;
                if (changed && titleIfChanged) this.app.showScreen('title');
                else next();
            });
    }

    // R39: forget this player completely before the next one registers.
    _notYou() {
        clearRegistration();
        this.app.runController?.reset();
        this.app.showScreen('registration');
    }

    async startCrisis(crisisId) {
        const crisis = CRISES.find(c => c.id === crisisId);
        if (!crisis || this.starting || !(this.reg || this.free)) return;   // a crisis needs a player (or the guest)
        const id = this.mountId;
        this.starting = true;
        try {
            await startRun(this.app, crisis.industryId, { crisisId });
            if (id === this.mountId) this.app.showScreen('quarter');   // not if the player left meanwhile
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

    _closeLeaderboard() {
        const m = this._modal;
        if (!m) return;
        this._modal = null;
        globalThis.document.removeEventListener('keydown', m.onKey);
        m.overlay.remove();
        m.opener?.focus?.();
    }

    async showLeaderboard() {
        this._closeLeaderboard();
        const body = h('div', { class: 'lb-body' }, h('p', { text: 'Loading scores…' }));
        const close = h('button', { class: 'btn lb-close', type: 'button', text: 'CLOSE' });
        const heading = this.free ? "Last event's leaderboard" : 'Leaderboard';
        const overlay = h('div', { class: 'v3-modal', role: 'dialog', 'aria-label': heading },
            h('div', { class: 'v3-modal-box' }, h('h2', { text: heading }), body, close));
        const doc = globalThis.document;
        const onKey = e => { if (e.key === 'Escape') this._closeLeaderboard(); };
        this._modal = { overlay, onKey, opener: doc.activeElement };
        (doc.getElementById('game-viewport') || doc.body).appendChild(overlay);
        close.addEventListener('click', () => this._closeLeaderboard());
        overlay.addEventListener('click', e => { if (e.target === overlay) this._closeLeaderboard(); });
        doc.addEventListener('keydown', onKey);
        close.focus?.();
        try {
            const entries = await this.api.fetchLeaderboard({ mode: 'simple', period: 'event', limit: 20 });
            if (this._modal?.overlay !== overlay) return;
            body.replaceChildren(entries.length
                ? h('ol', { class: 'lb-list' }, entries.map(e => h('li', {},
                    h('span', { class: 'lb-rank', text: `${e.rank}.` }),
                    h('span', { class: 'lb-name' },
                        h('span', { text: e.playerName || 'Anonymous' }),
                        e.company ? h('span', { class: 'lb-company', text: e.company }) : null),
                    h('span', { class: 'lb-score', text: num(Number(e.score) || 0) }))))
                : h('p', { text: this.free ? 'No scores from the last event.' : 'No scores yet. Be the first.' }));
        } catch {
            body.replaceChildren(h('p', { text: 'Leaderboard unavailable offline.' }));
        }
    }
}
