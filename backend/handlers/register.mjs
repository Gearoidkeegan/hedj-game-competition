import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { json, parseBody, errorResponse } from '../lib/http.mjs';

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (E1-2 switches to TOKEN_TTL_HOURS)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createHandler(deps) {
    const { ddb, env, now, uuid } = deps;

    return async function handler(event) {
        let body;
        try {
            body = parseBody(event);
        } catch (err) {
            return errorResponse(err);
        }

        const { playerName, email, company, consentGiven, marketingConsent } = body;

        if (!playerName || typeof playerName !== 'string' || !playerName.trim()) {
            return json(400, { error: 'Player name is required' });
        }
        if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
            return json(400, { error: 'Valid email is required' });
        }
        if (!company || typeof company !== 'string' || !company.trim()) {
            return json(400, { error: 'Company name is required' });
        }
        if (consentGiven !== true) {
            return json(400, { error: 'Consent is required to register' });
        }

        const gameToken = uuid();
        const nowMs = now();
        const gameTokenExpiry = nowMs + TOKEN_TTL_MS;
        const registeredAt = new Date(nowMs).toISOString();

        await ddb.send(new PutCommand({
            TableName: env.PLAYERS_TABLE,
            Item: {
                email: email.toLowerCase().trim(),
                playerName: playerName.trim(),
                company: company.trim(),
                registeredAt,
                consentGiven: true,
                marketingConsent: marketingConsent === true,
                gameToken,
                gameTokenExpiry
            }
        }));

        return json(200, { gameToken, expiresAt: gameTokenExpiry });
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now(),
    uuid: () => randomUUID()
});
