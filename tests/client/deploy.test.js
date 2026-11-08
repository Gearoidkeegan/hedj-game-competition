// Deploy wiring checks (Task H): the workflow passes every backend parameter, and the
// frontend does not carry its own copy of the event id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const backendWf = () => read('.github/workflows/deploy-backend.yml');

test('backend deploy passes EventId, EventEndIso and TokenTtlHours from repository variables', () => {
    const wf = backendWf();
    for (const v of ['vars.COMP_EVENT_ID', 'vars.COMP_EVENT_END_ISO', 'vars.COMP_TOKEN_TTL_HOURS']) {
        assert.ok(wf.includes(v), `missing ${v}`);
    }
    for (const p of ['AdminKey=', 'EventId=', 'EventEndIso=', 'TokenTtlHours=']) {
        assert.ok(wf.includes(p), `parameter override ${p} missing`);
    }
    assert.ok(/COMP_EVENT_ID \|\| 'test'/.test(wf), 'EventId must fall back to test');
    assert.ok(/COMP_TOKEN_TTL_HOURS \|\| '120'/.test(wf), 'TokenTtlHours must fall back to 120');
});

test('backend deploy does not interpolate secrets or variables straight into the shell script', () => {
    const run = backendWf().split('SAM deploy')[1].split('Print API URL')[0].split('run: |')[1];
    assert.ok(!run.includes('${{'), 'pass secrets and vars through env:, not inline');
});

test('frontend config carries no event id (the backend EVENT_ID alone selects the board)', () => {
    assert.ok(!/eventId/.test(read('js/config.js')));
});

const frontendWf = () => read('.github/workflows/deploy-frontend.yml');

test('frontend deploy has no PWA leftovers in its trigger paths (R55)', () => {
    const wf = frontendWf();
    assert.ok(!wf.includes('manifest.json') && !wf.includes('sw.js'));
});

test('frontend deploy keeps the dev-file excludes (R27)', () => {
    const wf = frontendWf();
    for (const ex of ['tests/*', 'docs/*', 'node_modules/*', 'package.json', 'package-lock.json', '.superpowers/*',
        'Open Game.url', 'Individual industry sample images.png', 'backend/*', 'tools/*', '*.md']) {
        assert.ok(wf.includes(`--exclude "${ex}"`), `missing exclude ${ex}`);
    }
});

test('fonts ship as font/woff2 with a long immutable cache', () => {
    const wf = frontendWf();
    assert.ok(wf.includes('--exclude "assets/fonts/*.woff2"'), 'main sync must leave woff2 to the font step');
    const fontStep = wf.split('Sync fonts')[1];
    assert.ok(fontStep, 'missing a "Sync fonts" step');
    assert.ok(fontStep.includes('--content-type "font/woff2"'));
    assert.ok(fontStep.includes('max-age=31536000, immutable'));
    assert.ok(fontStep.includes('--include "*.woff2"'));
});
