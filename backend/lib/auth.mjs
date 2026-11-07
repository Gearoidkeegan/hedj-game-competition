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
    if (player.gameToken !== gameToken) throw new HttpError(401, 'Invalid game token');
    if (nowMs > player.gameTokenExpiry) throw new HttpError(401, 'Game token expired — please register again');
    return player;
}
