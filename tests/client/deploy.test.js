// Deploy wiring checks (Task H, R56, R58): every run deploys the backend, then the frontend; every backend
// parameter is passed; the frontend carries no copy of the event id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const path = rel => new URL(`../../${rel}`, import.meta.url);
const read = rel => readFileSync(path(rel), 'utf8');
const wf = () => read('.github/workflows/deploy.yml');
// The text of one top-level job: from "  <name>:" to the next two-space-indented key.
const job = name => {
    const jobs = wf().split(/\r?\njobs:\r?\n/)[1];
    const m = jobs.match(new RegExp(`(?:^|\\n)  ${name}:\\r?\\n([\\s\\S]*?)(?=\\r?\\n  [a-z]|$)`));
    assert.ok(m, `missing job ${name}`);
    return m[1];
};

test('one combined deploy workflow replaces the separate backend and frontend ones (R56)', () => {
    assert.ok(existsSync(path('.github/workflows/deploy.yml')));
    assert.ok(!existsSync(path('.github/workflows/deploy-backend.yml')));
    assert.ok(!existsSync(path('.github/workflows/deploy-frontend.yml')));
});

test('deploys never overlap, and a manual run can pick both, backend or frontend', () => {
    const w = wf();
    assert.match(w, /concurrency:\s*\r?\n\s+group: deploy-comp\s*\r?\n\s+cancel-in-progress: false/);
    assert.match(w, /workflow_dispatch:[\s\S]*type: choice[\s\S]*- both\s+- backend\s+- frontend/);
    assert.match(w, /id-token: write/);
});

test('no change detection: every run deploys the backend, then the frontend (R58)', () => {
    // A queued run that a newer push replaces must not lose its backend change, so nothing is diffed.
    const w = wf();
    assert.ok(!/\n  changes:/.test(w), 'no change-detection job');
    assert.ok(!w.includes('git diff') && !w.includes('github.event.before'));
    assert.match(w, /push:\s*\r?\n\s+branches:[\s\S]*?paths:/, 'the trigger-level paths filter stays');
    const b = job('backend');
    assert.match(b, /if: github\.event_name == 'push' \|\| inputs\.target != 'frontend'/);
    assert.ok(b.includes('--no-fail-on-empty-changeset'), 'an unchanged backend is a cheap no-op');
});

test('the frontend waits for the backend and never runs after a failed or cancelled backend deploy', () => {
    const f = job('frontend');
    assert.match(f, /needs: backend\r?\n/);
    assert.ok(f.includes('always()'));
    assert.ok(f.includes("(github.event_name == 'push' || inputs.target != 'backend')"));
    assert.ok(f.includes("(needs.backend.result == 'success' || needs.backend.result == 'skipped')"));
});

test('backend deploy passes EventId, EventEndIso and TokenTtlHours from repository variables', () => {
    const b = job('backend');
    for (const v of ['vars.COMP_EVENT_ID', 'vars.COMP_EVENT_END_ISO', 'vars.COMP_TOKEN_TTL_HOURS']) {
        assert.ok(b.includes(v), `missing ${v}`);
    }
    for (const p of ['AdminKey=', 'EventId=', 'EventEndIso=', 'TokenTtlHours=']) {
        assert.ok(b.includes(p), `parameter override ${p} missing`);
    }
    assert.ok(/COMP_EVENT_ID \|\| 'test'/.test(b), 'EventId must fall back to test');
    assert.ok(/COMP_TOKEN_TTL_HOURS \|\| '120'/.test(b), 'TokenTtlHours must fall back to 120');
});

test('no secret or variable is interpolated straight into a shell script', () => {
    // Every "run:" body must be free of ${{ }}; values come in through env:.
    const bodies = wf().split(/run: \|\r?\n/).slice(1).map(s => s.split(/\r?\n\s*(?:- name:|\r?\n  [a-z])/)[0]);
    assert.ok(bodies.length >= 5);
    for (const body of bodies) assert.ok(!body.includes('${{'), `inline expression in:\n${body.slice(0, 200)}`);
});

test('frontend config carries no event id (the backend EVENT_ID alone selects the board)', () => {
    assert.ok(!/eventId/.test(read('js/config.js')));
});

test('no PWA leftovers in the trigger paths (R55)', () => {
    const w = wf();
    assert.ok(!w.includes('manifest.json') && !w.includes('sw.js'));
});

test('frontend deploy keeps the dev-file excludes (R27)', () => {
    const f = job('frontend');
    for (const ex of ['tests/*', 'docs/*', 'node_modules/*', 'package.json', 'package-lock.json', '.superpowers/*',
        'Open Game.url', 'Individual industry sample images.png', 'backend/*', 'tools/*', '*.md']) {
        assert.ok(f.includes(`--exclude "${ex}"`), `missing exclude ${ex}`);
    }
});

test('fonts ship as font/woff2 with a long immutable cache', () => {
    const f = job('frontend');
    assert.ok(f.includes('--exclude "assets/fonts/*.woff2"'), 'main sync must leave woff2 to the font step');
    const fontStep = f.split('Sync fonts')[1];
    assert.ok(fontStep, 'missing a "Sync fonts" step');
    assert.ok(fontStep.includes('--content-type "font/woff2"'));
    assert.ok(fontStep.includes('max-age=31536000, immutable'));
    assert.ok(fontStep.includes('--include "*.woff2"'));
});
