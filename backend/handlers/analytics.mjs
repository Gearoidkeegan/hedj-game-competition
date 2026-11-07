import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { json, parseBody, isAdmin, errorResponse } from '../lib/http.mjs';

const VALID_EVENTS = new Set(['visit', 'play']);

export function createHandler(deps) {
    const { ddb, env } = deps;
    const ANALYTICS_TABLE = env.ANALYTICS_TABLE;

    async function handlePost(event) {
        let body;
        try {
            body = parseBody(event);
        } catch (err) {
            return errorResponse(err);
        }

        const { event: eventName } = body;
        if (!VALID_EVENTS.has(eventName)) {
            return json(400, { error: 'event must be "visit" or "play"' });
        }

        await ddb.send(new UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { metricName: eventName },
            UpdateExpression: 'ADD #count :one',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: { ':one': 1 }
        }));

        return json(204, null);
    }

    async function handleGet(event) {
        if (!isAdmin(event, env)) {
            const result = await ddb.send(new GetCommand({
                TableName: ANALYTICS_TABLE,
                Key: { metricName: 'play' }
            }));
            return json(200, { play: result.Item?.count || 0 });
        }

        const result = await ddb.send(new ScanCommand({ TableName: ANALYTICS_TABLE }));
        const counts = {};
        for (const item of result.Items || []) {
            counts[item.metricName] = item.count || 0;
        }
        return json(200, { counts });
    }

    return async function handler(event) {
        if (event.requestContext?.http?.method === 'GET') {
            return handleGet(event);
        }
        return handlePost(event);
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now(),
    uuid: () => randomUUID()
});
