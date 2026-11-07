import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { json, parseBody, errorResponse, validName } from '../lib/http.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TOKEN_TTL_HOURS = 120;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function validCompany(s) {
    return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 60 && !/[<>]/.test(s);
}

export function createHandler(deps) {
    const { ddb, env, now, uuid } = deps;
    const ttlHours = Number(env.TOKEN_TTL_HOURS) > 0 ? Number(env.TOKEN_TTL_HOURS) : DEFAULT_TOKEN_TTL_HOURS;

    return async function handler(event) {
        let body;
        try {
            body = parseBody(event);
        } catch (err) {
            return errorResponse(err);
        }

        const { playerName, email, company, consentGiven, marketingConsent } = body;

        if (typeof playerName !== 'string' || !validName(playerName.trim())) {
            return json(400, { error: "Player name must be 1-20 letters, numbers, emoji or . ' _ -" });
        }
        if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
            return json(400, { error: 'Valid email is required' });
        }
        if (!validCompany(company)) {
            return json(400, { error: 'Company name is required (max 60 characters, no < or >)' });
        }
        if (consentGiven !== true) {
            return json(400, { error: 'Consent is required to register' });
        }

        const gameToken = uuid();
        const nowMs = now();
        const gameTokenExpiry = nowMs + ttlHours * 60 * 60 * 1000;

        const names = {};
        const values = {
            ':pn': playerName.trim(),
            ':co': company.trim(),
            ':t': true,
            ':ra': new Date(nowMs).toISOString(),
            ':mc': marketingConsent === true,
            ':gt': gameToken,
            ':ge': gameTokenExpiry
        };
        const sets = [
            'playerName = :pn', 'company = :co', 'consentGiven = :t',
            'registeredAt = if_not_exists(registeredAt, :ra)',
            // true when sent true, otherwise keep what is stored (default false)
            marketingConsent === true ? 'marketingConsent = :mc' : 'marketingConsent = if_not_exists(marketingConsent, :mc)',
            'gameToken = :gt', 'gameTokenExpiry = :ge'
        ];
        const endMs = Date.parse(env.EVENT_END_ISO || '');
        if (Number.isFinite(endMs)) {
            names['#ttl'] = 'ttl';
            values[':ttl'] = Math.floor((endMs + RETENTION_MS) / 1000);
            sets.push('#ttl = :ttl');
        }

        await ddb.send(new UpdateCommand({
            TableName: env.PLAYERS_TABLE,
            Key: { email: email.toLowerCase().trim() },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
            ExpressionAttributeValues: values
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
