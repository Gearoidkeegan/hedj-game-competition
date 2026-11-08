import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, key } from '../helpers/fakeDom.js';
import { HedgeDial, DETENTS } from '../../js/ui/HedgeDial.js';

let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

function make(opts = {}) {
    const host = dom.document.createElement('div');
    dom.document.body.appendChild(host);
    const changes = [];
    const dial = new HedgeDial(host, { onChange: v => changes.push(v), ...opts });
    const steps = () => host.querySelectorAll('[data-step]');
    const step = v => host.querySelector(`[data-step="${v}"]`);
    const slider = host.querySelector('[role="slider"]');
    return { host, dial, changes, steps, step, slider };
}

test('five detents at 0/25/50/75/100, rendered as buttons', () => {
    assert.deepEqual([...DETENTS], [0, 0.25, 0.5, 0.75, 1]);
    const { steps } = make({ value: 0.5 });
    const s = steps();
    assert.equal(s.length, 5);
    assert.deepEqual(s.map(b => b.textContent), ['0%', '25%', '50%', '75%', '100%']);
    assert.ok(s.every(b => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button'));
});

test('the initial value snaps to the nearest detent and is shown as pressed', () => {
    const { dial, step, slider } = make({ value: 0.6 });
    assert.equal(dial.value, 0.5);
    assert.equal(step(0.5).getAttribute('aria-pressed'), 'true');
    assert.equal(step(0.25).getAttribute('aria-pressed'), 'false');
    assert.equal(slider.getAttribute('aria-valuenow'), '50');
    assert.equal(slider.getAttribute('aria-valuetext'), '50% hedged');
});

test('tapping a detent sets the value and calls onChange once', () => {
    const { dial, changes, step } = make({ value: 0 });
    step(0.75).click();
    assert.equal(dial.value, 0.75);
    assert.deepEqual(changes, [0.75]);
    step(0.75).click();   // same value: no second change
    assert.deepEqual(changes, [0.75]);
    assert.ok(step(0.25).classList.contains('is-filled'), 'steps up to the value are filled');
    assert.ok(!step(1).classList.contains('is-filled'));
});

test('steps above the cap are locked: disabled, marked, and unreachable by tap', () => {
    const { dial, changes, step } = make({ value: 0.25, max: 0.5 });
    assert.equal(step(0.75).disabled, true);
    assert.equal(step(1).disabled, true);
    assert.ok(step(0.75).classList.contains('is-locked'));
    assert.equal(step(0.5).disabled, false);
    step(1).click();
    assert.equal(dial.value, 0.25);
    assert.deepEqual(changes, []);
    // The value itself is clamped to the cap.
    const capped = make({ value: 1, max: 0.5 });
    assert.equal(capped.dial.value, 0.5);
});

test('arrow keys move one detent, stay inside 0..cap, and Home/End jump to the ends', () => {
    const { dial, changes, slider } = make({ value: 0.25, max: 0.75 });
    assert.equal(slider.getAttribute('tabindex'), '0');
    let e = key(slider, 'ArrowRight');
    assert.equal(dial.value, 0.5);
    assert.equal(e.defaultPrevented, true);
    key(slider, 'ArrowUp');
    assert.equal(dial.value, 0.75);
    key(slider, 'ArrowRight');   // at the cap
    assert.equal(dial.value, 0.75);
    key(slider, 'ArrowLeft');
    key(slider, 'ArrowDown');
    assert.equal(dial.value, 0.25);
    key(slider, 'Home');
    assert.equal(dial.value, 0);
    key(slider, 'ArrowLeft');    // at the floor
    assert.equal(dial.value, 0);
    key(slider, 'End');
    assert.equal(dial.value, 0.75);
    assert.deepEqual(changes, [0.5, 0.75, 0.5, 0.25, 0, 0.75]);
    e = key(slider, 'Tab');
    assert.equal(e.defaultPrevented, false, 'other keys pass through');
});

test('a fully locked dial (cap 0) explains why and ignores keys', () => {
    const { dial, changes, slider, host, steps } = make({ value: 0, max: 0, lockedReason: "Your bank doesn't offer commodity hedging" });
    key(slider, 'ArrowRight');
    assert.equal(dial.value, 0);
    assert.deepEqual(changes, []);
    assert.equal(steps().filter(s => s.disabled).length, 4);
    const note = host.querySelector('.hd-note');
    assert.equal(note.hidden, false);
    assert.equal(note.textContent, "Your bank doesn't offer commodity hedging");
    assert.ok(host.querySelector('.hedge-dial').classList.contains('is-locked'));
});

test('the mandate band is shaded on the steps inside it', () => {
    const band = make({ value: 0.5, mandate: { min: 0.5, max: 0.75 } });
    const shaded = band.steps().filter(s => s.classList.contains('is-band')).map(s => s.getAttribute('data-step'));
    assert.deepEqual(shaded, ['0.5', '0.75']);

    const noHedge = make({ value: 0, mandate: { min: 0, max: 0 } });
    assert.deepEqual(noHedge.steps().filter(s => s.classList.contains('is-band')).map(s => s.getAttribute('data-step')), ['0']);

    const none = make({ value: 0, mandate: null });
    assert.equal(none.steps().filter(s => s.classList.contains('is-band')).length, 0);
});

test('a band the cap cannot reach shows the conflict on the dial (R51)', () => {
    const { dial, host } = make({ value: 0.5, max: 0.5, mandate: { min: 0.75, max: 1 } });
    assert.equal(dial.conflict, true);
    const note = host.querySelector('.hd-note');
    assert.equal(note.hidden, false);
    assert.equal(note.textContent, 'Your board wants 75–100%; your bank lines cap you at 50%');
    assert.ok(host.querySelector('.hedge-dial').classList.contains('has-conflict'));
    // Raising the cap (facilities) clears it.
    dial.setMax(1);
    assert.equal(dial.conflict, false);
    assert.equal(note.hidden, true);
    // A reachable band is not a conflict.
    assert.equal(make({ value: 0.5, max: 0.5, mandate: { min: 0.25, max: 0.5 } }).dial.conflict, false);
});

test('lowering the cap pulls the value down and reports it; setValue is silent', () => {
    const { dial, changes, step } = make({ value: 0.25, max: 1 });
    step(1).click();
    dial.setMax(0.5);
    assert.equal(dial.value, 0.5);
    assert.deepEqual(changes, [1, 0.5]);
    assert.equal(step(0.75).disabled, true);
    dial.setValue(0);
    assert.equal(dial.value, 0);
    assert.deepEqual(changes, [1, 0.5], 'setValue does not call onChange');
});

test('setMandate re-shades the band', () => {
    const { dial, steps } = make({ value: 0, mandate: null });
    dial.setMandate({ min: 0.25, max: 0.5 });
    assert.deepEqual(steps().filter(s => s.classList.contains('is-band')).map(s => s.getAttribute('data-step')), ['0.25', '0.5']);
});

test('destroy empties the host and removes the key listener', () => {
    const { dial, host, slider } = make({ value: 0 });
    assert.equal(slider.listenerCount('keydown'), 1);
    dial.destroy();
    assert.equal(slider.listenerCount('keydown'), 0);
    assert.equal(host.children.length, 0);
});
