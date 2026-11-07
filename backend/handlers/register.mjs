import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { playerTokens } from '../lib/auth.mjs';
import { json, parseBody, errorResponse, validName } from '../lib/http.mjs';
import { validCompany, ttlSeconds } from '../lib/util.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TOKEN_TTL_HOURS = 120;
const MAX_TOKENS = 5;

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

        const key = email.toLowerCase().trim();
        const existing = (await ddb.send(new GetCommand({ TableName: env.PLAYERS_TABLE, Key: { email: key } }))).Item;

        // Keep unexpired tokens (so other devices stay signed in), add the new one, keep the 5 most recent.
        const kept = existing ? playerTokens(existing).filter(t => t.expiry > nowMs) : [];
        const gameTokens = [...kept, { token: gameToken, expiry: gameTokenExpiry }].slice(-MAX_TOKENS);

        const names = {};
        const values = {
            ':t': true,
            ':ra': new Date(nowMs).toISOString(),
            ':mc': marketingConsent === true,
            ':gts': gameTokens
        };
        const sets = [
            'consentGiven = :t',
            'registeredAt = if_not_exists(registeredAt, :ra)',
            // true when sent true, otherwise keep what is stored (default false)
            marketingConsent === true ? 'marketingConsent = :mc' : 'marketingConsent = if_not_exists(marketingConsent, :mc)',
            'gameTokens = :gts'
        ];
        // Identity is set once: a re-registration never changes the stored name or company.
        const storedName = existing ? existing.playerName : playerName.trim().normalize('NFC');
        const storedCompany = existing ? existing.company : company.trim();
        if (!existing) {
            values[':pn'] = storedName;
            values[':co'] = storedCompany;
            sets.push('playerName = :pn', 'company = :co');
        }
        names['#ttl'] = 'ttl';
        values[':ttl'] = ttlSeconds(env, nowMs);
        sets.push('#ttl = :ttl');

        await ddb.send(new UpdateCommand({
            TableName: env.PLAYERS_TABLE,
            Key: { email: key },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values
        }));

        return json(200, { gameToken, expiresAt: gameTokenExpiry, playerName: storedName, company: storedCompany });
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now(),
    uuid: () => randomUUID()
});
