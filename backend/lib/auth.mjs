import { timingSafeEqual } from 'node:crypto';
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
    const match = tokens.find(t => sameToken(t.token, gameToken));
    if (!match) throw new HttpError(401, 'Invalid game token');
    if (nowMs > match.expiry) throw new HttpError(401, 'Game token expired — please register again');
    return player;
}

function sameToken(a, b) {
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && timingSafeEqual(x, y);
}

// All tokens on a player row: the gameTokens list plus the legacy single gameToken/gameTokenExpiry fields.
export function playerTokens(player) {
    const list = Array.isArray(player.gameTokens)
        ? player.gameTokens.filter(t => t && typeof t.token === 'string' && Number.isFinite(t.expiry))
        : [];
    if (typeof player.gameToken === 'string' && Number.isFinite(player.gameTokenExpiry) && !list.some(t => t.token === player.gameToken)) {
        list.push({ token: player.gameToken, expiry: player.gameTokenExpiry });
    }
    return list;
}
