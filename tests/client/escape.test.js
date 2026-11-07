import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../js/utils/escape.js';

test('escapeHtml leaves no angle brackets from an injection attempt', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>');
    assert.ok(!out.includes('<'));
    assert.ok(!out.includes('>'));
});

test('escapeHtml escapes & < > " \' and keeps emoji and accents', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    assert.equal(escapeHtml('Zoë 🚀'), 'Zoë 🚀');
});

test('escapeHtml tolerates null and undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});
