// Tap guard (R53). The v3 screens put their main action in the same footer slot (RUN THE QUARTER, NEXT,
// PLAY AGAIN), so the second tap of a double tap on one screen would land on the next screen's button.
// Each screen arms a guard in mount(); its primary and footer actions ignore taps for TAP_GUARD_MS after that.
//
//   const guard = createTapGuard({ now });       // now: () => ms (tests inject a clock)
//   button onClick: guard.wrap(() => this._run())
//   mount(): guard.arm()
//
// Until arm() is called (a rendered but unmounted screen) taps pass through.

export const TAP_GUARD_MS = 600;

const defaultNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export function createTapGuard({ ms = TAP_GUARD_MS, now = defaultNow } = {}) {
    let armedAt = -Infinity;
    const ready = () => now() - armedAt >= ms;
    return {
        arm() { armedAt = now(); },
        ready,
        // Returns a handler that drops the call while the guard is closed.
        wrap(fn) {
            return (...args) => (ready() ? fn(...args) : undefined);
        }
    };
}
