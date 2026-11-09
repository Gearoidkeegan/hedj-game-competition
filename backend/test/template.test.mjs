import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yaml = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8');

test('template has throttling, best table, ByScore index and EventId', () => {
    for (const needle of ['ThrottlingRateLimit', 'ThrottlingBurstLimit', 'HCompBest', 'ByScore', 'EventId', 'EventEndIso', 'TokenTtlHours']) {
        assert.ok(yaml.includes(needle), `missing ${needle}`);
    }
});

test('CORS is not wildcard and allows only the two permitted origins', () => {
    assert.ok(!yaml.includes("AllowOrigins: ['*']"));
    assert.ok(!yaml.includes("'*'"));
    assert.ok(yaml.includes("'https://competition.hedj.eu'"));
    assert.ok(yaml.includes("'http://localhost:8080'"));
    assert.ok(!yaml.includes('localhost:3000'));
});

test('every DynamoDB table is retained on stack delete and on replacement', () => {
    const tables = yaml.split(/\r?\n  (?=[A-Za-z]+:\r?\n)/).filter(b => /^\w+:\r?\n    Type: AWS::DynamoDB::Table/.test(b));
    assert.deepEqual(tables.map(b => b.split(':')[0]), ['HCompPlayers', 'HCompScores', 'HCompBest', 'HCompAnalytics']);
    for (const b of tables) {
        assert.match(b, /\r?\n    DeletionPolicy: Retain\r?\n/, `${b.split(':')[0]} DeletionPolicy`);
        assert.match(b, /\r?\n    UpdateReplacePolicy: Retain\r?\n/, `${b.split(':')[0]} UpdateReplacePolicy`);
    }
});

test('TTL enabled on players, scores and best', () => {
    assert.equal((yaml.match(/AttributeName: ttl\s+Enabled: true/g) || []).length, 3);
});

test('leaderboard function reads only the best table', () => {
    const block = yaml.split('LeaderboardFunction:')[1].split('AnalyticsFunction:')[0];
    assert.ok(block.includes('DynamoDBReadPolicy'));
    assert.ok(block.includes('!Ref HCompBest'));
    assert.ok(!block.includes('HCompScores') && !block.includes('HCompPlayers'));
});

test('register function has CRUD on players only', () => {
    const block = yaml.split('RegisterFunction:')[1].split('ScoreFunction:')[0];
    assert.ok(block.includes('!Ref HCompPlayers'));
    assert.ok(!block.includes('HCompScores') && !block.includes('HCompBest'));
});

test('score function has CRUD on players, scores and best', () => {
    const block = yaml.split('ScoreFunction:')[1].split('LeaderboardFunction:')[0];
    for (const t of ['HCompPlayers', 'HCompScores', 'HCompBest']) assert.ok(block.includes(`!Ref ${t}`), t);
});

test('progress function has GET and PUT routes and CRUD on players only', () => {
    const block = yaml.split('ProgressFunction:')[1].split('Outputs:')[0];
    assert.ok(block.includes('Path: /progress') && block.includes('Method: GET') && block.includes('Method: PUT'));
    assert.ok(block.includes('!Ref HCompPlayers'));
    assert.ok(!block.includes('HCompScores') && !block.includes('HCompBest'));
});

test('CORS allows the player auth headers and PUT', () => {
    for (const needle of ['x-player-email', 'x-game-token', '- PUT']) assert.ok(yaml.includes(needle), needle);
});

test('EventEndIso description no longer claims scores are rejected', () => {
    const desc = yaml.split('EventEndIso:')[1].split('TokenTtlHours:')[0];
    assert.ok(!/no longer accepted/.test(desc));
});

test('admin function: read-only on players and best, three throttled routes', () => {
    const block = yaml.split('AdminFunction:')[1].split('ProgressFunction:')[0];
    for (const path of ['/admin/players', '/admin/metrics', '/admin/prize']) assert.ok(block.includes(`Path: ${path}`), path);
    assert.equal((block.match(/DynamoDBReadPolicy/g) || []).length, 2);
    assert.ok(block.includes('!Ref HCompPlayers') && block.includes('!Ref HCompBest'));
    assert.ok(!block.includes('CrudPolicy') && !block.includes('HCompScores'));
    for (const route of ['GET /admin/players', 'GET /admin/metrics', 'GET /admin/prize']) {
        const rs = yaml.split(`'${route}':`)[1].split('\n').slice(0, 3).join('\n');
        assert.match(rs, /ThrottlingBurstLimit: 5\s+ThrottlingRateLimit: 2/, route);
    }
});

test('HCompBest ByScore projection covers what the prize export reads', () => {
    const idx = yaml.split('HCompBest:')[1].split('HCompAnalytics:')[0].split('IndexName: ByScore')[1];
    assert.match(idx, /ProjectionType: ALL/); // email, playerName, company, score
});

test('every function runs on nodejs22.x (R62: nodejs20.x is past end of life)', () => {
    const runtimes = yaml.match(/Runtime: \S+/g) || [];
    assert.ok(runtimes.length >= 1);
    for (const r of runtimes) assert.equal(r, 'Runtime: nodejs22.x');
    assert.ok(!yaml.includes('nodejs20'));
});

test('the admin key is only in the environment of the two functions that check it (M6)', () => {
    const globals = yaml.split('Globals:')[1].split('Resources:')[0];
    assert.ok(!globals.includes('ADMIN_KEY'), 'not in Globals');
    const block = (name, next) => yaml.split(`  ${name}:`)[1].split(`  ${next}:`)[0];
    const blocks = {
        RegisterFunction: block('RegisterFunction', 'ScoreFunction'),
        ScoreFunction: block('ScoreFunction', 'LeaderboardFunction'),
        LeaderboardFunction: block('LeaderboardFunction', 'AnalyticsFunction'),
        AnalyticsFunction: block('AnalyticsFunction', 'AdminFunction'),
        AdminFunction: block('AdminFunction', 'ProgressFunction'),
        ProgressFunction: yaml.split('  ProgressFunction:')[1].split('Outputs:')[0]
    };
    for (const [name, b] of Object.entries(blocks)) {
        const has = /Environment:\s+Variables:\s+ADMIN_KEY: !Ref AdminKey/.test(b);
        assert.equal(has, name === 'AnalyticsFunction' || name === 'AdminFunction', name);
        if (name !== 'AnalyticsFunction' && name !== 'AdminFunction') assert.ok(!b.includes('ADMIN_KEY'), name);
    }
});

// ── Free play (Task FP) ──────────────────────────────────────────────────

test('EventStartIso is a parameter beside EventEndIso, passed to every function as EVENT_START_ISO', () => {
    const params = yaml.split('Parameters:')[1].split('Globals:')[0];
    assert.match(params, /\n  EventStartIso:\r?\n    Type: String\r?\n    Default: ''/);
    assert.match(params, /\n  EventId:\r?\n    Type: String\r?\n    Default: ''/, 'an empty EventId is free play');
    const globals = yaml.split('Globals:')[1].split('Resources:')[0];
    assert.ok(globals.includes('EVENT_START_ISO: !Ref EventStartIso'));
    assert.ok(globals.includes('EVENT_END_ISO: !Ref EventEndIso'));
});

test('GET /event: its own function on the public throttle, with no table access', () => {
    const block = yaml.split('  EventFunction:')[1].split('Outputs:')[0].split(/\r?\n  [A-Z]\w+:\r?\n/)[0];
    assert.ok(block.includes('Handler: handlers/event.handler'));
    assert.match(block, /Path: \/event\s+Method: GET/);
    assert.ok(!/Polic/.test(block), 'no policies: it reads no table');
    assert.ok(!/HComp/.test(block));
    assert.ok(!block.includes('ADMIN_KEY'));
    const routes = yaml.split('RouteSettings:')[1].split('CorsConfiguration:')[0];
    assert.ok(!routes.includes('/event'), 'the default public throttle, like /leaderboard');
});
