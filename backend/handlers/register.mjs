import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const PLAYERS_TABLE = process.env.PLAYERS_TABLE;
const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    const { playerName, email, company, consentGiven } = body;

    if (!playerName || typeof playerName !== 'string' || !playerName.trim()) {
        return response(400, { error: 'Player name is required' });
    }
    if (!email || !EMAIL_RE.test(email)) {
        return response(400, { error: 'Valid email is required' });
    }
    if (!company || typeof company !== 'string' || !company.trim()) {
        return response(400, { error: 'Company name is required' });
    }
    if (consentGiven !== true) {
        return response(400, { error: 'Consent is required to register' });
    }

    const gameToken = randomUUID();
    const now = Date.now();
    const gameTokenExpiry = now + TOKEN_TTL_MS;
    const registeredAt = new Date(now).toISOString();

    await ddb.send(new PutCommand({
        TableName: PLAYERS_TABLE,
        Item: {
            email: email.toLowerCase().trim(),
            playerName: playerName.trim(),
            company: company.trim(),
            registeredAt,
            consentGiven: true,
            gameToken,
            gameTokenExpiry
        }
    }));

    return response(200, { gameToken, expiresAt: gameTokenExpiry });
}
