import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { json, requireAdmin, errorResponse } from '../lib/http.mjs';
import { dublinDate } from '../lib/util.mjs';

// Prefix ' on values a spreadsheet would read as a formula (= + - @ tab CR).
export function csvEscape(v) {
    let str = typeof v === 'string' ? v : String(v ?? '');
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
}

const csvResponse = (rows, filename) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename=${filename}` },
    body: rows.join('\r\n')
});

const PRIZE_DEFAULT_LIMIT = 10;
const PRIZE_MAX_LIMIT = 200;

export function createHandler(deps) {
    const { ddb, env, now } = deps;
    const eventId = env.EVENT_ID;   // empty: no event, so the prize export has no rows

    async function scanAll(table) {
        const items = [];
        let key;
        do {
            const r = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key }));
            items.push(...(r.Items || []));
            key = r.LastEvaluatedKey;
        } while (key);
        return items;
    }

    async function listPlayers(event) {
        const players = (await scanAll(env.PLAYERS_TABLE))
            .map(({ playerName, email, company, registeredAt, marketingConsent }) =>
                ({ playerName, email, company, registeredAt, marketingConsent: marketingConsent === true }))
            .sort((a, b) => (a.registeredAt || '').localeCompare(b.registeredAt || ''));

        if (event.queryStringParameters?.format === 'csv') {
            return csvResponse([
                'Name,Email,Company,Registered At,Marketing Consent',
                ...players.map(p =>
                    [p.playerName, p.email, p.company, p.registeredAt, p.marketingConsent ? 'Yes' : 'No'].map(csvEscape).join(','))
            ], 'players.csv');
        }
        return json(200, { players, total: players.length });
    }

    // playsByDay counts players active on each Dublin date (the per-player playDays set), not individual runs.
    async function metrics() {
        const rows = await scanAll(env.PLAYERS_TABLE);
        let plays = 0, uniquePlayers = 0, returning = 0, multiDay = 0;
        const playsByDay = {};
        for (const p of rows) {
            const count = Number.isFinite(p.playCount) ? p.playCount : 0;
            plays += count;
            if (count < 1) continue;
            uniquePlayers++;
            if (count >= 2) returning++;
            const days = p.playDays ? [...p.playDays] : [];
            if (days.length >= 2) multiDay++;
            for (const d of days) playsByDay[d] = (playsByDay[d] || 0) + 1;
        }
        const share = n => (uniquePlayers ? n / uniquePlayers : 0);
        return json(200, {
            players: rows.length, plays, uniquePlayers,
            runsPerPlayer: share(plays), returnRate: share(returning), multiDayRate: share(multiDay),
            playsByDay
        });
    }

    async function prize(event) {
        const q = event.queryStringParameters || {};
        const mode = q.mode || 'simple';
        const period = q.period || 'event';
        if (mode !== 'simple' && mode !== 'pro') return json(400, { error: 'mode must be simple or pro' });
        if (period !== 'event' && period !== 'today') return json(400, { error: 'period must be event or today' });
        const rawLimit = parseInt(q.limit ?? PRIZE_DEFAULT_LIMIT, 10);
        const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? PRIZE_DEFAULT_LIMIT : rawLimit, PRIZE_MAX_LIMIT));
        const header = 'rank,playerName,company,email,score,marketingConsent';
        if (!eventId) return csvResponse([header], `prize-${mode}-${period}.csv`);
        const board = `${eventId}#${mode}#${period === 'today' ? dublinDate(now()) : 'all'}`;

        const result = await ddb.send(new QueryCommand({
            TableName: env.BEST_TABLE,
            IndexName: 'ByScore',
            KeyConditionExpression: '#b = :b',
            ExpressionAttributeNames: { '#b': 'board' },
            ExpressionAttributeValues: { ':b': board },
            ScanIndexForward: false,
            Limit: limit
        }));
        const rows = [];
        for (const [i, item] of (result.Items || []).entries()) {
            // Consent lives on the player row; a missing row is treated as no consent.
            const { Item: player } = await ddb.send(new GetCommand({ TableName: env.PLAYERS_TABLE, Key: { email: item.email } }));
            rows.push([i + 1, item.playerName, item.company, item.email, item.score, player?.marketingConsent === true ? 'Yes' : 'No']
                .map(csvEscape).join(','));
        }
        return csvResponse([header, ...rows], `prize-${mode}-${period}.csv`);
    }

    return async function handler(event) {
        try {
            requireAdmin(event, env);
        } catch (err) {
            return errorResponse(err);
        }
        const path = (event.rawPath || '/admin/players').replace(/\/+$/, '');
        if (path.endsWith('/admin/players')) return listPlayers(event);
        if (path.endsWith('/admin/metrics')) return metrics();
        if (path.endsWith('/admin/prize')) return prize(event);
        return json(404, { error: 'Not found' });
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now(),
    uuid: () => randomUUID()
});
