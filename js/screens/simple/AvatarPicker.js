// AvatarPicker (v3.1): the player picks a character from pictures. Shown once before the first run when no
// character is stored for the current player (main.js puts it in front of the industry pick), and again from the
// title's CHARACTER button.
//
// The eight pictures are a radio group (role="radiogroup", role="radio" buttons labelled "Character 1" to
// "Character 8", never a description of a person). Arrow keys, Home and End move the checked radio and the focus
// (roving tabindex); a tap, Enter or Space picks it, saves it for this player and carries on to `nextScreen`
// (the title when unset). The tap guard (R53) drops taps just after the screen opens, and a pick happens once.
//
// Storage is device-local per player (the guest in free play), never synced to /progress (Ruling V1).
// No innerHTML: the DOM is built node by node (R7).

import { h } from '../../ui/dom.js';
import { AVATAR_IDS, AVATAR_SIZE, isAvatarId, drawAvatar } from '../../ui/pixel/avatars.js';
import { createTapGuard } from '../../ui/tapGuard.js';
import * as realStorage from '../../utils/storage.js';

const PICK_PX = 64;   // CSS size of each picture in the picker

// Whose character it is: the guest in free play, else the registered player's email, else null.
export function avatarPlayer(storage = realStorage) {
    if (storage.isFreePlay?.()) return storage.GUEST_PLAYER;
    return storage.getRegistration?.()?.email || null;
}

// The player's stored character, or null when none is stored or the id is unknown.
export function storedAvatar(storage = realStorage, player = avatarPlayer(storage)) {
    if (!player || typeof storage.getAvatar !== 'function') return null;
    const id = storage.getAvatar(player);
    return isAvatarId(id) ? id : null;
}

// True when there is a player to store for and they have no valid character yet.
export function needsAvatar(storage = realStorage) {
    const player = avatarPlayer(storage);
    return !!player && storedAvatar(storage, player) === null;
}

// The whole-number drawing scale for a character shown about `cssPx` wide at `dpr`: the nearest integer to
// cssPx x dpr / 32, at least 1.
export function avatarScale(cssPx, dpr) {
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const css = Number.isFinite(cssPx) && cssPx > 0 ? cssPx : AVATAR_SIZE;
    return Math.max(1, Math.round((css * d) / AVATAR_SIZE));
}

// The character in a fixed slot of the nominal `cssPx` size (so layouts never jump), with the canvas centred in it.
// The canvas is 32 x scale device pixels and shown at exactly (32 x scale / dpr) CSS pixels, so every source pixel
// is the same whole number of device pixels (1:1, crisp). The shown size can differ from cssPx by up to about a
// third. The scale is measured when the screen is built (each render). Returns the slot; the canvas inside carries
// `className` and the data-avatar / data-mood attributes. Drawing is cosmetic: without a 2D context (tests) the
// canvas is simply left blank.
export function avatarCanvas(id, mood, cssPx, className = 'av-face', label = null) {
    const dpr = Math.min(3, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
    const px = AVATAR_SIZE * avatarScale(cssPx, dpr);
    const canvas = h('canvas', {
        class: className, width: String(px), height: String(px), 'data-avatar': id, 'data-mood': mood,
        role: label ? 'img' : null, 'aria-label': label, 'aria-hidden': label ? null : 'true'
    });
    const shown = `${px / dpr}px`;
    canvas.style.width = shown;
    canvas.style.height = shown;
    const slot = h('span', { class: 'av-slot' }, canvas);
    slot.style.width = `${cssPx}px`;
    slot.style.height = `${cssPx}px`;
    paintAvatar(canvas, id, mood);
    return slot;
}

// Redraws an avatarCanvas with a new mood.
export function paintAvatar(canvas, id, mood) {
    if (!canvas) return;
    canvas.setAttribute('data-mood', mood);
    if (canvas.getAttribute('role') === 'img') canvas.setAttribute('aria-label', moodLabel(mood));
    try {
        const ctx = canvas.getContext?.('2d');
        if (!ctx) return;
        const size = Number(canvas.getAttribute('width')) || Number(canvas.width) || AVATAR_SIZE;
        const scale = Math.max(1, Math.floor(size / AVATAR_SIZE));   // whole number: avatarCanvas sizes it 32 x scale
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, size, size);
        drawAvatar(ctx, id, mood, 0, 0, scale);
    } catch (err) {
        console.warn('Avatar unavailable', err);
    }
}

export function moodLabel(mood) {
    return `Your character looks ${mood}`;
}

export class AvatarPicker {
    // deps (tests): storage, now (the tap guard's clock).
    constructor(app, { storage = realStorage, now } = {}) {
        this.app = app;
        this.storage = storage;
        this.tapGuard = createTapGuard({ now });
        this.nextScreen = null;   // set by main.js (the gate before the industry pick) or the title
        this.el = null;
        this.radios = [];
        this.index = 0;
        this.chosen = false;
    }

    render() {
        this.chosen = false;
        const current = storedAvatar(this.storage);
        this.index = Math.max(0, AVATAR_IDS.indexOf(current));
        this.radios = AVATAR_IDS.map((id, i) => h('button', {
            class: 'av-option', type: 'button', role: 'radio', 'aria-label': `Character ${i + 1}`,
            'data-avatar': id, on: { click: this.tapGuard.wrap(() => this.choose(i)) }
        }, avatarCanvas(id, 'happy', PICK_PX, 'av-pic')));
        this.group = h('div', { class: 'av-grid', role: 'radiogroup', 'aria-label': 'Characters',
            on: { keydown: e => this._key(e) } }, this.radios);
        this.el = h('div', { class: 'screen active v3 avatar-screen' },
            h('header', { class: 'v3-head' },
                h('button', { class: 'btn av-back', type: 'button', text: 'BACK', 'aria-label': 'Back to title',
                    on: { click: () => this._leave('title') } }),
                h('h1', { text: 'Pick your character' })),
            h('div', { class: 'v3-body' },
                h('p', { class: 'v3-lede', text: 'This is you in the treasury hot seat. Change it any time from the title.' }),
                this.group));
        this._paint();
        return this.el;
    }

    mount() {
        this.tapGuard.arm();
    }

    unmount() {
        this.chosen = true;   // nothing more from this visit
    }

    // Saves the character for the current player and carries on.
    choose(i) {
        const id = AVATAR_IDS[i];
        if (this.chosen || !id) return;
        this.chosen = true;
        this.index = i;
        this._paint();
        const player = avatarPlayer(this.storage);
        if (player) this.storage.saveAvatar(player, id);
        this._leave(this.nextScreen || 'title');
    }

    _leave(screenId) {
        this.chosen = true;
        this.nextScreen = null;
        this.app.showScreen(screenId);
    }

    _key(e) {
        const n = this.radios.length;
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (this.index + 1) % n;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (this.index - 1 + n) % n;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = n - 1;
        if (next === null) return;
        e.preventDefault?.();
        this.index = next;
        this._paint();
        this.radios[next].focus?.();
    }

    _paint() {
        this.radios.forEach((btn, i) => {
            btn.setAttribute('aria-checked', String(i === this.index));
            btn.setAttribute('tabindex', i === this.index ? '0' : '-1');
            btn.classList.toggle('is-on', i === this.index);
        });
    }
}
