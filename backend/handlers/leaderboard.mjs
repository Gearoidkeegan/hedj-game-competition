import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const SCORES_TABLE = process.env.SCORES_TABLE;
const LEADERBOARD_PARTITION = 'all';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function response(statusCode, body, extraHeaders = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30',
            ...extraHeaders
        },
        body: JSON.stringify(body)
    };
}

export async function handler(event) {
    const rawLimit = parseInt(event.queryStringParameters?.limit || DEFAULT_LIMIT, 10);
    const limit = Math.min(isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);

    const result = await ddb.send(new QueryCommand({
        TableName: SCORES_TABLE,
        IndexName: 'GlobalLeaderboard',
        KeyConditionExpression: '#lb = :lb',
        ExpressionAttributeNames: { '#lb': 'leaderboard' },
        ExpressionAttributeValues: { ':lb': LEADERBOARD_PARTITION },
        ScanIndexForward: false,
        Limit: limit
    }));

    const entries = (result.Items || []).map((item, index) => ({
        rank: index + 1,
        playerName: item.playerName || 'Anonymous',
        company: item.company || '',
        industry: item.industry || '',
        score: item.score,
        grade: item.grade || '',
        quartersPlayed: item.quartersPlayed || 0,
        submittedAt: item.submittedAt || ''
        // email intentionally excluded (GDPR)
    }));

    return response(200, { entries, total: entries.length });
}
