import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE;
const ADMIN_KEY = process.env.ADMIN_KEY;

const VALID_EVENTS = new Set(['visit', 'play']);

function response(statusCode, body = null) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: body !== null ? JSON.stringify(body) : ''
    };
}

export async function handler(event) {
    if (event.requestContext?.http?.method === 'GET') {
        return handleGet(event);
    }
    return handlePost(event);
}

async function handlePost(event) {
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return response(400, { error: 'Invalid JSON' });
    }

    const { event: eventName } = body;
    if (!VALID_EVENTS.has(eventName)) {
        return response(400, { error: 'event must be "visit" or "play"' });
    }

    await ddb.send(new UpdateCommand({
        TableName: ANALYTICS_TABLE,
        Key: { metricName: eventName },
        UpdateExpression: 'ADD #count :one',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':one': 1 }
    }));

    return response(204);
}

async function handleGet(event) {
    const adminKey = event.headers?.['x-admin-key'];
    if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
        return response(401, { error: 'Unauthorized' });
    }

    const result = await ddb.send(new ScanCommand({ TableName: ANALYTICS_TABLE }));
    const counts = {};
    for (const item of result.Items || []) {
        counts[item.metricName] = item.count || 0;
    }

    return response(200, { counts });
}
