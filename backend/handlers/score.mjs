import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { json, parseBody, errorResponse } from '../lib/http.mjs';

const LEADERBOARD_PARTITION = 'all';

export function createHandler(deps) {
    const { ddb, env, now, uuid } = deps;
    const PLAYERS_TABLE = env.PLAYERS_TABLE;
    const SCORES_TABLE = env.SCORES_TABLE;

    async function getRank(score) {
        try {
            const result = await ddb.send(new QueryCommand({
                TableName: SCORES_TABLE,
                IndexName: 'GlobalLeaderboard',
                KeyConditionExpression: '#lb = :lb AND #sc > :score',
                ExpressionAttributeNames: {
                    '#lb': 'leaderboard',
                    '#sc': 'score'
                },
                ExpressionAttributeValues: {
                    ':lb': LEADERBOARD_PARTITION,
                    ':score': score
                },
                Select: 'COUNT'
            }));
            return (result.Count || 0) + 1;
        } catch {
            return null;
        }
    }

    return async function handler(event) {
        let body;
        try {
            body = parseBody(event);
        } catch (err) {
            return errorResponse(err);
        }

        const { gameToken, gameId, email, playerName, company, industry, industryId,
                score, grade, quartersPlayed, seed, cumulativePnL } = body;

        if (!gameToken || !gameId || !email || typeof email !== 'string') {
            return json(400, { error: 'gameToken, gameId and email are required' });
        }
        if (typeof score !== 'number' || score < 0 || score > 100) {
            return json(400, { error: 'score must be a number between 0 and 100' });
        }
        if (typeof quartersPlayed !== 'number' || quartersPlayed < 1 || quartersPlayed > 16) {
            return json(400, { error: 'quartersPlayed must be between 1 and 16' });
        }

        const playerEmail = email.toLowerCase().trim();
        const playerResult = await ddb.send(new GetCommand({
            TableName: PLAYERS_TABLE,
            Key: { email: playerEmail }
        }));

        if (!playerResult.Item) {
            return json(401, { error: 'Player not registered' });
        }

        const player = playerResult.Item;
        if (player.gameToken !== gameToken) {
            return json(401, { error: 'Invalid game token' });
        }
        if (now() > player.gameTokenExpiry) {
            return json(401, { error: 'Game token expired — please register again' });
        }

        // Idempotency: check if this gameId was already submitted by this player
        const existing = await ddb.send(new QueryCommand({
            TableName: SCORES_TABLE,
            IndexName: 'GlobalLeaderboard',
            KeyConditionExpression: '#lb = :lb',
            FilterExpression: '#gameId = :gameId AND #playerEmail = :email',
            ExpressionAttributeNames: {
                '#lb': 'leaderboard',
                '#gameId': 'gameId',
                '#playerEmail': 'playerEmail'
            },
            ExpressionAttributeValues: {
                ':lb': LEADERBOARD_PARTITION,
                ':gameId': gameId,
                ':email': playerEmail
            },
            Select: 'COUNT'
        }));

        if (existing.Count > 0) {
            const rank = await getRank(score);
            return json(200, { rank, duplicate: true });
        }

        const submittedAt = new Date(now()).toISOString();
        const roundedScore = Math.round(score * 10) / 10;

        await ddb.send(new PutCommand({
            TableName: SCORES_TABLE,
            Item: {
                scoreId: uuid(),
                leaderboard: LEADERBOARD_PARTITION,
                score: roundedScore,
                email: playerEmail,
                playerEmail,
                playerName: (playerName || player.playerName || '').trim(),
                company: (company || player.company || '').trim(),
                industry: industry || '',
                industryId: industryId || '',
                grade: grade || '',
                quartersPlayed,
                seed: seed || 0,
                gameId,
                submittedAt,
                cumulativePnL: typeof cumulativePnL === 'number' ? cumulativePnL : 0
            }
        }));

        const rank = await getRank(roundedScore);
        return json(200, { rank });
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now(),
    uuid: () => randomUUID()
});
