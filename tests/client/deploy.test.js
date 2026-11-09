// Deploy wiring checks (Task H, R56, R58): every run deploys the backend, then the frontend; every backend
// parameter is passed; the frontend carries no copy of the event id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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

test('backend deploy passes EventId, EventStartIso, EventEndIso and TokenTtlHours from repository variables', () => {
    const b = job('backend');
    for (const v of ['vars.COMP_EVENT_ID', 'vars.COMP_EVENT_START_ISO', 'vars.COMP_EVENT_END_ISO', 'vars.COMP_TOKEN_TTL_HOURS']) {
        assert.ok(b.includes(v), `missing ${v}`);
    }
    for (const p of ['AdminKey=', 'EventId=', 'EventStartIso=', 'EventEndIso=', 'TokenTtlHours=']) {
        assert.ok(b.includes(p), `parameter override ${p} missing`);
    }
    assert.ok(!/COMP_EVENT_ID \|\|/.test(b), 'no expression fallback: an unset id is free play');
    assert.ok(/COMP_TOKEN_TTL_HOURS \|\| '120'/.test(b), 'TokenTtlHours must fall back to 120');
});

// The "SAM deploy" step's script, run in bash the way Actions runs it (bash -eo pipefail), with `sam` stubbed to
// print one argument per line. Returns { status, out } where out holds the stub's output and any ::error:: line.
const bashOk = spawnSync('bash', ['-c', 'date -u -d 2026-01-01T00:00Z >/dev/null'], { encoding: 'utf8' }).status === 0;
function runSamDeploy(env) {
    const step = job('backend').split('- name: SAM deploy')[1];
    const lines = step.split(/run: \|\r?\n/)[1].split(/\r?\n/);
    const body = [];
    for (const line of lines) {
        if (line.trim() && !line.startsWith(' '.repeat(10))) break;
        body.push(line.slice(10));
    }
    const script = `sam() { printf '%s\\n' "$@"; }\n${body.join('\n')}`;
    const base = { EVENT_NAME: 'push', ADMIN_KEY: 'k3y', EVENT_ID: 'expo', EVENT_START_ISO: '', EVENT_END_ISO: '', TOKEN_TTL_HOURS: '120' };
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', script], { env: { ...process.env, ...base, ...env }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
}

test('SAM deploy: every override is double-quoted, so SAM parses values with spaces or commas whole', { skip: !bashOk && 'no bash' }, () => {
    const r = runSamDeploy({ ADMIN_KEY: "a b,c=d'e", EVENT_START_ISO: '2026-11-19T08:00Z', EVENT_END_ISO: '2026-11-20T18:00:00Z' });
    assert.equal(r.status, 0, r.out);
    for (const p of ['AdminKey="a b,c=d\'e"', 'EventId="expo"', 'EventStartIso="2026-11-19T08:00Z"',
        'EventEndIso="2026-11-20T18:00:00Z"', 'TokenTtlHours="120"']) {
        assert.ok(r.out.split(/\r?\n/).includes(p), `missing override ${p} in:\n${r.out}`);
    }
});

test('SAM deploy: unset dates are passed as EventStartIso="" and EventEndIso=""', { skip: !bashOk && 'no bash' }, () => {
    const r = runSamDeploy({ EVENT_START_ISO: '', EVENT_END_ISO: '' });
    assert.equal(r.status, 0, r.out);
    const lines = r.out.split(/\r?\n/);
    assert.ok(lines.includes('EventStartIso=""') && lines.includes('EventEndIso=""'), r.out);
});

test('SAM deploy: the start and end dates must be strict ISO-8601 UTC', { skip: !bashOk && 'no bash' }, () => {
    for (const [name, variable] of [['EVENT_START_ISO', 'COMP_EVENT_START_ISO'], ['EVENT_END_ISO', 'COMP_EVENT_END_ISO']]) {
        for (const ok of ['2026-11-20T18:00Z', '2026-11-20T18:00:00Z']) {
            assert.equal(runSamDeploy({ [name]: ok }).status, 0, `${name}=${ok}`);
        }
        for (const bad of ['tomorrow', 'next friday', '2026-11-20 18:00', '2026-11-20', '2026-11-20T18:00:00+01:00',
            '2026-11-20T18:00:00.000Z', '2026-13-40T18:00Z', ' 2026-11-20T18:00Z', '2026-11-20T18:00Z\nx']) {
            const r = runSamDeploy({ [name]: bad });
            assert.notEqual(r.status, 0, `${name} accepted ${JSON.stringify(bad)}`);
            assert.ok(r.out.includes(`::error::${variable}`), r.out);
            assert.ok(!r.out.includes('deploy'), 'sam never ran');
        }
    }
});

test('SAM deploy: with both dates set, the start must be before the end', { skip: !bashOk && 'no bash' }, () => {
    for (const [start, end] of [['2026-11-20T18:00Z', '2026-11-20T18:00:00Z'], ['2026-11-21T09:00Z', '2026-11-20T18:00Z']]) {
        const r = runSamDeploy({ EVENT_START_ISO: start, EVENT_END_ISO: end });
        assert.notEqual(r.status, 0, `accepted ${start} .. ${end}`);
        assert.ok(r.out.includes('::error::COMP_EVENT_START_ISO must be before COMP_EVENT_END_ISO'), r.out);
        assert.ok(!r.out.includes('deploy'), 'sam never ran');
    }
    assert.equal(runSamDeploy({ EVENT_START_ISO: '2026-11-20T17:59Z', EVENT_END_ISO: '2026-11-20T18:00Z' }).status, 0);
});

test('SAM deploy: an admin key SAM cannot carry inside quotes is refused', { skip: !bashOk && 'no bash' }, () => {
    for (const bad of ['', 'a"b', 'a\\b']) {
        const r = runSamDeploy({ ADMIN_KEY: bad });
        assert.notEqual(r.status, 0, `accepted ${JSON.stringify(bad)}`);
        assert.ok(r.out.includes('::error::COMP_ADMIN_KEY'), r.out);
    }
});

test('SAM deploy: an unset event id deploys free play (EventId="") on a push and a manual run alike (R66)', { skip: !bashOk && 'no bash' }, () => {
    for (const EVENT_NAME of ['push', 'workflow_dispatch']) {
        const r = runSamDeploy({ EVENT_NAME, EVENT_ID: '' });
        assert.equal(r.status, 0, r.out);
        const lines = r.out.split(/\r?\n/);
        assert.ok(lines.includes('EventId=""'), r.out);
        assert.ok(!lines.includes('EventId="test"'), 'no fallback to the test event');
        assert.ok(lines.includes('Deploying EventId=(free play) EventStartIso=<empty> EventEndIso=<empty> TokenTtlHours=120'), r.out);
    }
    const set = runSamDeploy({ EVENT_ID: 'expo', EVENT_START_ISO: '2026-11-19T08:00Z', EVENT_END_ISO: '2026-11-20T18:00Z' });
    assert.ok(set.out.split(/\r?\n/)
        .includes('Deploying EventId=expo EventStartIso=2026-11-19T08:00Z EventEndIso=2026-11-20T18:00Z TokenTtlHours=120'), set.out);
    for (const bad of ['bad id', 'a#b', 'x'.repeat(41)]) {
        const r = runSamDeploy({ EVENT_ID: bad });
        assert.notEqual(r.status, 0, `accepted event id ${JSON.stringify(bad)}`);
        assert.ok(r.out.includes('::error::COMP_EVENT_ID'), r.out);
    }
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

test('the backend job builds on Node 22, matching the Lambda runtime (R62)', () => {
    assert.match(job('backend'), /node-version: '22'/);
    assert.ok(!/node-version: '20'/.test(wf()));
});

test('every leaderboard URL in the cutover runbook uses a period the API accepts (M5)', () => {
    const doc = read('docs/cutover.md');
    const periods = [...doc.matchAll(/\/api\/leaderboard\?[^"'\s`]*period=([a-z]+)/g)].map(m => m[1]);
    assert.ok(periods.length >= 1, 'the runbook smoke-tests the leaderboard');
    for (const p of periods) assert.ok(['event', 'today'].includes(p), `period=${p}`);
});
