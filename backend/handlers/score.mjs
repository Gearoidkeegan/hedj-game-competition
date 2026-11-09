import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { json, parseBody, errorResponse, validName } from '../lib/http.mjs';
import { loadPlayer } from '../lib/auth.mjs';
import { validCompany, dublinDate, ttlSeconds } from '../lib/util.mjs';
import { isLive, inScoreGrace } from '../lib/event.mjs';

const SCORE_MAX = 10000;
// A plausibility check, not anti-cheat (R19, R63): a run must last at least max(15 s, 3 s per quarter played).
const MIN_RUN_MS = 15000;
const MIN_MS_PER_QUARTER = 3000;
const INDUSTRY_RE = /^[a-z0-9_-]{1,40}$/;
const MODES = ['simple', 'pro'];

export function createHandler(deps) {
    const { ddb, env, now } = deps;
    const eventId = env.EVENT_ID;

    async function rankOf(board, score) {
        const result = await ddb.send(new QueryCommand({
            TableName: env.BEST_TABLE,
            IndexName: 'ByScore',
            KeyConditionExpression: '#b = :b AND #s > :s',
            ExpressionAttributeNames: { '#b': 'board', '#s': 'score' },
            ExpressionAttributeValues: { ':b': board, ':s': score },
            Select: 'COUNT'
        }));
        return (result.Count || 0) + 1;
    }

    // Writes the player's row on a board only when the new score is higher. Returns true if written.
    async function putIfHigher(board, item) {
        try {
            await ddb.send(new PutCommand({
                TableName: env.BEST_TABLE,
                Item: { board, ...item },
                ConditionExpression: 'attribute_not_exists(score) OR score < :s',
                ExpressionAttributeValues: { ':s': item.score }
            }));
            return true;
        } catch (err) {
            if (err?.name === 'ConditionalCheckFailedException') return false;
            throw err;
        }
    }

    return async function handler(event) {
        try {
            const body = parseBody(event);
            const { gameToken, gameId, email, mode, score, quartersPlayed, startedAt, industryId, playerName, company } = body;
            const nowMs = now();
            // Free play (R66): closed outside a live competition, except a run started before the end and sent
            // within the grace after it. An empty EVENT_ID is never live, so no row is written under it.
            if (!isLive(env, nowMs) && !inScoreGrace(env, nowMs, startedAt)) {
                return json(403, { error: 'competition_closed' });
            }

            if (typeof gameId !== 'string' || !gameId || gameId.length > 64 || typeof email !== 'string') {
                return json(400, { error: 'gameToken, gameId and email are required' });
            }
            if (!MODES.includes(mode)) return json(400, { error: 'mode must be simple or pro' });
            if (!Number.isInteger(score) || score < 0 || score > SCORE_MAX) {
                return json(400, { error: `score must be an integer between 0 and ${SCORE_MAX}` });
            }
            if (!Number.isInteger(quartersPlayed) || quartersPlayed < 1 || quartersPlayed > 8) {
                return json(400, { error: 'quartersPlayed must be between 1 and 8' });
            }
            const minRunMs = Math.max(MIN_RUN_MS, quartersPlayed * MIN_MS_PER_QUARTER);
            if (!Number.isFinite(startedAt) || nowMs - startedAt < minRunMs) {
                return json(400, { error: 'Run too short' });
            }
            if (typeof industryId !== 'string' || !INDUSTRY_RE.test(industryId)) {
                return json(400, { error: 'Invalid industryId' });
            }
            if (typeof playerName !== 'string' || !validName(playerName.trim())) {
                return json(400, { error: 'Invalid player name' });
            }
            if (company !== undefined && !validCompany(company)) {
                return json(400, { error: 'Invalid company name' });
            }

            const player = await loadPlayer(ddb, env.PLAYERS_TABLE, email, gameToken, nowMs);

            // Boards always show the identity stored at registration, never the submitted one.
            const name = player.playerName || playerName.trim().normalize('NFC');
            const comp = player.company || (typeof company === 'string' ? company.trim() : '');
            const industry = industryId;
            const ttl = ttlSeconds(env, nowMs);
            const submittedAt = new Date(nowMs).toISOString();

            const seen = await ddb.send(new GetCommand({ TableName: env.SCORES_TABLE, Key: { scoreId: gameId } }));
            if (seen.Item) return json(200, { duplicate: true });

            const day = dublinDate(nowMs);
            const bestItem = { email: player.email, score, playerName: name, company: comp, industryId: industry, submittedAt, gameId, ttl };
            const allBoard = `${eventId}#${mode}#all`;
            const wroteBest = await putIfHigher(allBoard, bestItem);
            await putIfHigher(`${eventId}#${mode}#${day}`, bestItem);

            await ddb.send(new UpdateCommand({
                TableName: env.PLAYERS_TABLE,
                Key: { email: player.email },
                UpdateExpression: 'ADD playCount :one, playDays :d',
                ExpressionAttributeValues: { ':one': 1, ':d': new Set([day]) }
            }));

            // Dedupe marker is written last so a retry after a partial failure re-runs the (idempotent) board updates.
            const scoreItem = {
                scoreId: gameId, email: player.email, eventId, mode, score, quartersPlayed,
                startedAt, industryId: industry, playerName: name, company: comp, submittedAt, ttl
            };

            try {
                await ddb.send(new PutCommand({
                    TableName: env.SCORES_TABLE,
                    Item: scoreItem,
                    ConditionExpression: 'attribute_not_exists(scoreId)'
                }));
            } catch (err) {
                if (err?.name === 'ConditionalCheckFailedException') return json(200, { duplicate: true });
                throw err;
            }

            // wroteBest means first score or strictly higher. If not written, this is only "best" when the stored row
            // came from this same gameId (a retry after a partial failure).
            let best = score;
            let isBest = wroteBest;
            if (!wroteBest) {
                const row = await ddb.send(new GetCommand({ TableName: env.BEST_TABLE, Key: { board: allBoard, email: player.email } }));
                best = row.Item?.score ?? score;
                isBest = row.Item?.gameId === gameId;
            }
            return json(200, { rank: await rankOf(allBoard, best), best, isBest });
        } catch (err) {
            return errorResponse(err);
        }
    };
}

export const handler = createHandler({
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    env: process.env,
    now: () => Date.now()
});
