import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { json, parseBody, errorResponse, headerValue, HttpError } from '../lib/http.mjs';
import { loadPlayer } from '../lib/auth.mjs';
import { mergeProgress } from '../lib/progress.mjs';
import { requireLive } from '../lib/event.mjs';

export function createHandler(deps) {
    const { ddb, env, now } = deps;

    return async function handler(event) {
        try {
            const method = event?.requestContext?.http?.method || 'GET';
            if (method !== 'GET' && method !== 'PUT') throw new HttpError(405, 'Method not allowed');
            requireLive(env, now());   // free play (R66): progress is never synced outside a live competition

            const player = await loadPlayer(ddb, env.PLAYERS_TABLE,
                headerValue(event, 'x-player-email'), headerValue(event, 'x-game-token'), now());

            if (method === 'GET') return json(200, { progress: player.progress || null });

            const body = parseBody(event, 4096);
            if (!body.progress || typeof body.progress !== 'object' || Array.isArray(body.progress)) {
                throw new HttpError(400, 'progress is required');
            }
            const progress = mergeProgress(player.progress, body.progress);
            await ddb.send(new UpdateCommand({
                TableName: env.PLAYERS_TABLE,
                Key: { email: player.email },
                UpdateExpression: 'SET progress = :p',
                ExpressionAttributeValues: { ':p': progress }
            }));
            return json(200, { progress });
        } catch (err) {
            return errorResponse(err);
        }
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now()
});
