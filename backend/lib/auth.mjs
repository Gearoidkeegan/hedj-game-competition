import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { HttpError } from './http.mjs';

// Loads the player row and checks the game token. Throws HttpError(401) on any failure.
export async function loadPlayer(ddb, table, email, gameToken, nowMs) {
    if (typeof email !== 'string' || !email || typeof gameToken !== 'string' || !gameToken) {
        throw new HttpError(401, 'Missing credentials');
    }
    const result = await ddb.send(new GetCommand({ TableName: table, Key: { email: email.toLowerCase().trim() } }));
    const player = result.Item;
    if (!player) throw new HttpError(401, 'Player not registered');
    const tokens = playerTokens(player);
    const match = tokens.find(t => t.token === gameToken);
    if (!match) throw new HttpError(401, 'Invalid game token');
    if (nowMs > match.expiry) throw new HttpError(401, 'Game token expired — please register again');
    return player;
}

// All tokens on a player row: the gameTokens list plus the legacy single gameToken/gameTokenExpiry fields.
export function playerTokens(player) {
    const list = Array.isArray(player.gameTokens)
        ? player.gameTokens.filter(t => t && typeof t.token === 'string' && Number.isFinite(t.expiry))
        : [];
    if (typeof player.gameToken === 'string' && !list.some(t => t.token === player.gameToken)) {
        list.push({ token: player.gameToken, expiry: player.gameTokenExpiry });
    }
    return list;
}
