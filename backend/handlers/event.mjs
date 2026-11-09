// GET /event: whether the competition is live, for the game, the stand and the admin page (R66). Public, reads no
// table, never cached (the switch to and from free play happens at the event dates).
import { json } from '../lib/http.mjs';
import { eventStatus } from '../lib/event.mjs';

export function createHandler(deps) {
    const { env, now } = deps;
    return async function handler() {
        return json(200, eventStatus(env, now()), { 'Cache-Control': 'no-store' });
    };
}

export const handler = createHandler({
    env: process.env,
    now: () => Date.now()
});
