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
