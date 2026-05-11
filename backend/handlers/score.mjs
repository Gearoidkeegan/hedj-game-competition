import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const PLAYERS_TABLE = process.env.PLAYERS_TABLE;
const SCORES_TABLE = process.env.SCORES_TABLE;

const LEADERBOARD_PARTITION = 'all';

function response(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

export async function handler(event) {
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return response(400, { error: 'Invalid JSON' });
    }

    const { gameToken, gameId, email, playerName, company, industry, industryId,
            score, grade, quartersPlayed, seed, cumulativePnL } = body;

    // Basic validation
    if (!gameToken || !gameId || !email) {
        return response(400, { error: 'gameToken, gameId and email are required' });
    }
    if (typeof score !== 'number' || score < 0 || score > 100) {
        return response(400, { error: 'score must be a number between 0 and 100' });
    }
    if (typeof quartersPlayed !== 'number' || quartersPlayed < 1 || quartersPlayed > 16) {
        return response(400, { error: 'quartersPlayed must be between 1 and 16' });
    }

    // Verify game token
    const playerResult = await ddb.send(new GetCommand({
        TableName: PLAYERS_TABLE,
        Key: { email: email.toLowerCase().trim() }
    }));

    if (!playerResult.Item) {
        return response(401, { error: 'Player not registered' });
    }

    const player = playerResult.Item;
    if (player.gameToken !== gameToken) {
        return response(401, { error: 'Invalid game token' });
    }
    if (Date.now() > player.gameTokenExpiry) {
        return response(401, { error: 'Game token expired — please register again' });
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
            ':email': email.toLowerCase().trim()
        },
        Select: 'COUNT'
    }));

    if (existing.Count > 0) {
        // Already submitted — return success without inserting duplicate
        const rank = await getRank(score);
        return response(200, { rank, duplicate: true });
    }

    const submittedAt = new Date().toISOString();
    const scoreId = randomUUID();
    const roundedScore = Math.round(score * 10) / 10;

    await ddb.send(new PutCommand({
        TableName: SCORES_TABLE,
        Item: {
            scoreId,
            leaderboard: LEADERBOARD_PARTITION,
            score: roundedScore,
            email: email.toLowerCase().trim(),
            playerEmail: email.toLowerCase().trim(),
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
    return response(200, { rank });
}

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
