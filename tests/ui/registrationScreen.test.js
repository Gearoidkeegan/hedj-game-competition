// R64: the registration name field asks for the leaderboard name the server accepts (20 or fewer, its charset),
// and says what is wrong before the round trip.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from '../helpers/fakeDom.js';
import { RegistrationScreen, NAME_ERROR, COMPANY_ERROR } from '../../js/screens/RegistrationScreen.js';

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

beforeEach(() => { globalThis.localStorage = new FakeStorage(); });
afterEach(() => { delete globalThis.localStorage; delete globalThis.document; });

// render() builds its markup with innerHTML (static text plus escaped prefill), so record the string.
function renderedHtml() {
    globalThis.document = { createElement: () => ({ className: '', set innerHTML(v) { this.html = v; } }) };
    return new RegistrationScreen({}).render().html;
}

// The elements mount() and checkName() use, on the fake DOM.
function mounted() {
    const doc = createFakeDocument();
    const el = doc.createElement('div');
    const add = (tag, id, cls) => {
        const e = doc.createElement(tag);
        e.id = id;
        if (cls) e.className = cls;
        el.appendChild(e);
        return e;
    };
    add('input', 'reg-name', 'text-input');
    add('div', 'reg-name-error', 'reg-error');
    add('input', 'reg-email', 'text-input');
    add('input', 'reg-company', 'text-input');
    add('input', 'reg-consent');
    add('input', 'reg-marketing');
    add('div', 'reg-error', 'reg-error');
    add('button', 'reg-submit');
    add('button', 'reg-switch');
    const screen = new RegistrationScreen({ showScreen() {} });
    screen.el = el;
    screen.mount();
    const name = el.querySelector('#reg-name');
    const type = v => { name.value = v; name.dispatchEvent({ type: 'input' }); };
    return { screen, el, name, type, nameError: el.querySelector('#reg-name-error') };
}

test('the name field is the leaderboard name: label, 20-character cap, nickname autofill', () => {
    const html = renderedHtml();
    assert.ok(html.includes('>NAME ON LEADERBOARD *<'));
    assert.ok(!html.includes('FULL NAME'));
    const nameInput = html.match(/<input id="reg-name"[^>]*>/)[0];
    assert.match(nameInput, /maxlength="20"/);
    assert.match(nameInput, /autocomplete="nickname"/);
    assert.match(html.match(/<input id="reg-company"[^>]*>/)[0], /maxlength="60"/);
    assert.ok(html.includes('id="reg-name-error"'));
});

test('validate refuses what the server would refuse, with a clear message', () => {
    const s = new RegistrationScreen({});
    const ok = (name, company = 'Acme') => s.validate(name, 'a@b.co', company, true);
    assert.equal(ok('Jane Smith'), null);
    assert.equal(ok('Zoë 🚀'), null);
    for (const bad of ['Christopher Montgomery', 'Smith, Jane', 'Jane (CFO)', 'Ann/Bob', '<b>', '...']) {
        assert.equal(ok(bad), NAME_ERROR, bad);
    }
    assert.equal(ok(''), 'A name for the leaderboard is required');
    assert.equal(ok('Jane', 'c'.repeat(61)), COMPANY_ERROR);
    assert.equal(ok('Jane', 'x<y'), COMPANY_ERROR);
    assert.equal(ok('Jane', 'c'.repeat(60)), null);
});

test('typing a name the server would refuse shows an inline error under the field, and clears it when fixed', () => {
    const { type, name, nameError } = mounted();
    type('Smith, Jane');
    assert.equal(nameError.style.display, 'block');
    assert.equal(nameError.textContent, NAME_ERROR);
    assert.equal(name.getAttribute('aria-invalid'), 'true');
    type('Jane Smith');
    assert.equal(nameError.style.display, 'none');
    assert.equal(nameError.textContent, '');
    assert.equal(name.getAttribute('aria-invalid'), 'false');
    type('');
    assert.equal(nameError.style.display, 'none', 'an empty field is not an error until submit');
});
