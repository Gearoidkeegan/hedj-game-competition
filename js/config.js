// The event (leaderboard partition) is chosen only by the backend's EVENT_ID parameter, set at deploy time
// from the COMP_EVENT_ID repository variable. The client never sends an event id, so there is nothing to keep
// in step here.
export const CONFIG = {
    apiBase: '/api'
};
