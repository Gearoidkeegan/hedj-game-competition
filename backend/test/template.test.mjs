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
