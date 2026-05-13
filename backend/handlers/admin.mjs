import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const PLAYERS_TABLE = process.env.PLAYERS_TABLE;
const ADMIN_KEY = process.env.ADMIN_KEY;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

export async function handler(event) {
    const adminKey = event.headers?.['x-admin-key'];
    if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    const result = await ddb.send(new ScanCommand({ TableName: PLAYERS_TABLE }));
    const players = (result.Items || [])
        .map(({ playerName, email, company, registeredAt }) =>
            ({ playerName, email, company, registeredAt }))
        .sort((a, b) => (a.registeredAt || '').localeCompare(b.registeredAt || ''));

    const format = event.queryStringParameters?.format;
    if (format === 'csv') {
        const csvEscape = v => `"${(v || '').replace(/"/g, '""')}"`;
        const rows = [
            'Name,Email,Company,Registered At',
            ...players.map(p =>
                [p.playerName, p.email, p.company, p.registeredAt].map(csvEscape).join(','))
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

    return jsonResponse(200, { players, total: players.length });
}
