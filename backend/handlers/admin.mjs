import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { json, requireAdmin, errorResponse } from '../lib/http.mjs';

export function createHandler(deps) {
    const { ddb, env } = deps;

    return async function handler(event) {
        try {
            requireAdmin(event, env);
        } catch (err) {
            return errorResponse(err);
        }

        const result = await ddb.send(new ScanCommand({ TableName: env.PLAYERS_TABLE }));
        const players = (result.Items || [])
            .map(({ playerName, email, company, registeredAt, marketingConsent }) =>
                ({ playerName, email, company, registeredAt, marketingConsent: marketingConsent === true }))
            .sort((a, b) => (a.registeredAt || '').localeCompare(b.registeredAt || ''));

        const format = event.queryStringParameters?.format;
        if (format === 'csv') {
            // Prefix ' on values a spreadsheet would read as a formula (= + - @ tab CR).
            const csvEscape = v => {
                let str = typeof v === 'string' ? v : String(v ?? '');
                if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
                return `"${str.replace(/"/g, '""')}"`;
            };
            const rows = [
                'Name,Email,Company,Registered At,Marketing Consent',
                ...players.map(p =>
                    [p.playerName, p.email, p.company, p.registeredAt, p.marketingConsent ? 'Yes' : 'No'].map(csvEscape).join(','))
            ].join('\r\n');
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': 'attachment; filename=players.csv'
                },
                body: rows
            };
        }

        return json(200, { players, total: players.length });
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now(),
    uuid: () => randomUUID()
});
