import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { json } from '../lib/http.mjs';
import { dublinDate } from '../lib/util.mjs';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function createHandler(deps) {
    const { ddb, env, now } = deps;
    const eventId = env.EVENT_ID;

    return async function handler(event) {
        const q = event?.queryStringParameters || {};
        const mode = q.mode || 'simple';
        const period = q.period || 'event';
        if (mode !== 'simple' && mode !== 'pro') return json(400, { error: 'mode must be simple or pro' });
        if (period !== 'event' && period !== 'today') return json(400, { error: 'period must be event or today' });

        const rawLimit = parseInt(q.limit ?? DEFAULT_LIMIT, 10);
        const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT));
        // No event configured: nothing to show. With one, its board stays readable after the end (R66).
        if (!eventId) return json(200, { entries: [] }, { 'Cache-Control': 'public, max-age=30' });
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

        // email intentionally excluded (GDPR)
        const entries = (result.Items || []).map((item, index) => ({
            rank: index + 1,
            playerName: item.playerName || 'Anonymous',
            company: item.company || '',
            score: item.score,
            industryId: item.industryId || ''
        }));

        return json(200, { entries }, { 'Cache-Control': 'public, max-age=30' });
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now()
});
