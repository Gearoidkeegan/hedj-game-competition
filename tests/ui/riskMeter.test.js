// v3.1 Task 3: the RISK COVERED meter under the cash meter. Pure DOM; the cover itself comes from the engine.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { RiskMeter, WRONG_FOCUS_NOTE, coverPercent } from '../../js/ui/RiskMeter.js';

let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

function meter() {
    const host = dom.document.createElement('div');
    dom.document.body.appendChild(host);
    const m = new RiskMeter(host);
    const q = s => host.querySelector(s);
    return { m, host, q };
}

test('shows the label, the rounded cover, a fill and the band as a shaded zone', () => {
    const { m, q } = meter();
    m.set({ cover: 0.6667, mandate: { min: 0.5, max: 0.75 }, wrongFocus: false, warn: false });
    assert.equal(q('.rk-label').textContent, 'RISK COVERED');
    assert.equal(q('.rk-value').textContent, '67%');
    assert.equal(q('.rk-fill').style.width, '66.7%');
    assert.equal(q('.rk-band').hidden, false);
    assert.equal(q('.rk-band').style.left, '50.0%');
    assert.equal(q('.rk-band').style.width, '25.0%');
    assert.equal(q('.risk-meter').getAttribute('role'), 'meter');
    assert.equal(q('.risk-meter').getAttribute('aria-valuenow'), '67');
    assert.equal(q('.risk-meter').classList.contains('is-warn'), false);
    assert.equal(q('.rk-note').hidden, true);
    assert.equal(m.cover, 0.6667);
});

test('amber when the check would fail; the wrong-focus line shows only for wrong focus', () => {
    const { m, q } = meter();
    m.set({ cover: 0.2, mandate: { min: 0.5, max: 0.75 }, wrongFocus: false, warn: true });
    assert.equal(q('.risk-meter').classList.contains('is-warn'), true);
    assert.equal(q('.rk-note').hidden, true);
    m.set({ cover: 0.6, mandate: { min: 0.5, max: 0.75 }, wrongFocus: true, warn: true });
    assert.equal(q('.risk-meter').classList.contains('is-warn'), true);
    assert.equal(q('.rk-note').hidden, false);
    assert.equal(q('.rk-note').textContent, WRONG_FOCUS_NOTE);
    assert.equal(WRONG_FOCUS_NOTE, 'Big exposure under-hedged');
    m.set({ cover: 0.6, mandate: { min: 0.5, max: 0.75 }, wrongFocus: false, warn: false });
    assert.equal(q('.risk-meter').classList.contains('is-warn'), false);
    assert.equal(q('.rk-note').hidden, true);
});

test('no policy: no band; a noHedge board: a zero-width band marked at 0', () => {
    const { m, q } = meter();
    m.set({ cover: 0.25, mandate: null, wrongFocus: false, warn: false });
    assert.equal(q('.rk-band').hidden, true);
    m.set({ cover: 0, mandate: { min: 0, max: 0 }, wrongFocus: false, warn: false });
    assert.equal(q('.rk-band').hidden, false);
    assert.equal(q('.rk-band').classList.contains('is-point'), true);
    assert.equal(q('.rk-band').style.left, '0.0%');
    assert.equal(q('.rk-value').textContent, '0%');
});

test('nothing hedgeable (all locked or zero this quarter): a dash, an empty bar and a plain note, never NaN', () => {
    const { m, q, host } = meter();
    m.set({ cover: null, mandate: { min: 0.25, max: 0.5 }, wrongFocus: false, warn: false });
    assert.equal(q('.rk-value').textContent, '–');
    assert.equal(q('.rk-fill').style.width, '0.0%');
    assert.equal(q('.rk-note').hidden, false);
    assert.equal(q('.rk-note').textContent, 'Nothing you can hedge yet');
    assert.equal(q('.risk-meter').getAttribute('aria-valuenow'), null);
    assert.ok(!host.textContent.includes('NaN'));
    m.set({ cover: NaN, mandate: null });
    assert.equal(q('.rk-value').textContent, '–');
    assert.ok(!host.textContent.includes('NaN'));
});

test('final M2: the shown percentage never rounds onto the band when the cover is outside it', () => {
    const band = { min: 0.5, max: 0.75 };
    assert.equal(coverPercent(0.497, band), 49, 'just under: floor');
    assert.equal(coverPercent(0.7504, band), 76, 'just over: ceil');
    assert.equal(coverPercent(0.5 - 1e-12, band), 50, 'inside the engine tolerance counts as in');
    assert.equal(coverPercent(0.604, band), 60);
    assert.equal(coverPercent(0.004, { min: 0, max: 0 }), 1, 'a sliver on a no-hedge board is not "0%"');
    assert.equal(coverPercent(0.497, null), 50, 'no band: plain rounding');
    assert.equal(coverPercent(null, band), null);
    const { m, q } = meter();
    m.set({ cover: 0.497, mandate: band, wrongFocus: false, warn: true });
    assert.equal(q('.rk-value').textContent, '49%');
    assert.equal(q('.risk-meter').getAttribute('aria-valuenow'), '49');
});
