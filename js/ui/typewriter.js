// Typewriter text for the Pro board screen. Fast (v3 pacing) and a tap completes it.
// timers: injectable for tests ({ setTimeout, setInterval, clearTimeout, clearInterval }).

export const MS_PER_CHAR = 8;
export const START_DELAY_MS = 100;

const globalTimers = () => ({
    setTimeout: (...a) => globalThis.setTimeout(...a),
    setInterval: (...a) => globalThis.setInterval(...a),
    clearTimeout: (...a) => globalThis.clearTimeout(...a),
    clearInterval: (...a) => globalThis.clearInterval(...a)
});

/**
 * Types `text` into `textEl` one character per MS_PER_CHAR, then hides `cursorEl`.
 * @returns {{ complete(): void, cancel(): void, done: boolean }}
 *   complete() shows the whole text now; cancel() stops and leaves what is typed.
 */
export function typewrite({ textEl, cursorEl = null, text, delay = START_DELAY_MS, msPerChar = MS_PER_CHAR, timers = globalTimers() }) {
    let index = 0;
    let startTimer = null;
    let typeTimer = null;

    const stop = () => {
        if (startTimer !== null) { timers.clearTimeout(startTimer); startTimer = null; }
        if (typeTimer !== null) { timers.clearInterval(typeTimer); typeTimer = null; }
    };
    const handle = {
        done: false,
        complete() {
            stop();
            textEl.textContent = text;
            index = text.length;
            finish();
        },
        cancel() { stop(); }
    };
    function finish() {
        handle.done = true;
        if (cursorEl) cursorEl.style.display = 'none';
    }

    textEl.textContent = '';
    startTimer = timers.setTimeout(() => {
        startTimer = null;
        typeTimer = timers.setInterval(() => {
            if (index < text.length) {
                textEl.textContent += text[index++];
            }
            if (index >= text.length) {
                stop();
                finish();
            }
        }, msPerChar);
    }, delay);
    return handle;
}
