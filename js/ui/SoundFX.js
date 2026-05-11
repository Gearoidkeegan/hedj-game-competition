// SoundFX — retro synthesised sound effects using Web Audio API
// No external audio files needed — all sounds generated procedurally

class SoundFXController {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = 0.3;
    }

    /**
     * Lazily initialise AudioContext (must be triggered by user gesture).
     */
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('SoundFX: Web Audio not available');
            this.enabled = false;
        }
    }

    /**
     * Toggle sound on/off.
     */
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    /**
     * Set volume (0-1).
     */
    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
    }

    // ------ Sound primitives ------

    /**
     * Play a simple tone.
     */
    tone(freq, duration = 0.1, type = 'square', volume = 1) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(this.volume * volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + duration);
    }

    /**
     * Play noise burst (for percussive sounds).
     */
    noise(duration = 0.05, volume = 0.5) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.volume * volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start();
    }

    // ------ Game sound effects ------

    /**
     * UI click / button press.
     */
    click() {
        this.tone(800, 0.05, 'square', 0.3);
    }

    /**
     * Quarter begins — ascending arpeggio.
     */
    quarterStart() {
        this.tone(440, 0.08, 'square', 0.4);
        setTimeout(() => this.tone(554, 0.08, 'square', 0.4), 80);
        setTimeout(() => this.tone(659, 0.12, 'square', 0.5), 160);
    }

    /**
     * Trade executed — short confirmation beep.
     */
    tradeExecute() {
        this.tone(660, 0.06, 'square', 0.4);
        setTimeout(() => this.tone(880, 0.1, 'square', 0.4), 60);
    }

    /**
     * Trade error (wrong direction) — descending buzz.
     */
    tradeError() {
        this.tone(300, 0.15, 'sawtooth', 0.5);
        setTimeout(() => this.tone(200, 0.2, 'sawtooth', 0.5), 100);
        setTimeout(() => this.noise(0.1, 0.3), 200);
    }

    /**
     * Margin call — alarm sound.
     */
    marginCall() {
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                this.tone(880, 0.1, 'square', 0.6);
                setTimeout(() => this.tone(440, 0.1, 'square', 0.6), 100);
            }, i * 250);
        }
    }

    /**
     * Event popup — notification chime.
     */
    eventPopup() {
        this.tone(523, 0.08, 'sine', 0.4);
        setTimeout(() => this.tone(659, 0.08, 'sine', 0.4), 100);
        setTimeout(() => this.tone(784, 0.15, 'sine', 0.5), 200);
    }

    /**
     * Board review — ominous low tone.
     */
    boardReview() {
        this.tone(220, 0.3, 'triangle', 0.3);
        setTimeout(() => this.tone(196, 0.4, 'triangle', 0.3), 200);
    }

    /**
     * Positive P&L — cheerful jingle.
     */
    positivePnL() {
        this.tone(523, 0.1, 'square', 0.3);
        setTimeout(() => this.tone(659, 0.1, 'square', 0.3), 100);
        setTimeout(() => this.tone(784, 0.1, 'square', 0.3), 200);
        setTimeout(() => this.tone(1047, 0.2, 'square', 0.4), 300);
    }

    /**
     * Negative P&L — sad descending.
     */
    negativePnL() {
        this.tone(523, 0.12, 'triangle', 0.3);
        setTimeout(() => this.tone(440, 0.12, 'triangle', 0.3), 120);
        setTimeout(() => this.tone(349, 0.2, 'triangle', 0.4), 240);
    }

    /**
     * Level complete — fanfare.
     */
    levelComplete() {
        const notes = [523, 659, 784, 1047, 784, 1047];
        notes.forEach((freq, i) => {
            setTimeout(() => this.tone(freq, 0.15, 'square', 0.4), i * 120);
        });
    }

    /**
     * Game over — dramatic chord.
     */
    gameOver() {
        this.tone(262, 0.5, 'triangle', 0.3);
        this.tone(330, 0.5, 'triangle', 0.3);
        this.tone(392, 0.5, 'triangle', 0.3);
        setTimeout(() => {
            this.tone(247, 0.8, 'triangle', 0.4);
            this.tone(311, 0.8, 'triangle', 0.4);
            this.tone(370, 0.8, 'triangle', 0.4);
        }, 500);
    }

    /**
     * Fired by board — harsh buzzer.
     */
    fired() {
        this.tone(150, 0.3, 'sawtooth', 0.5);
        setTimeout(() => this.tone(100, 0.5, 'sawtooth', 0.6), 300);
        setTimeout(() => this.noise(0.2, 0.4), 600);
    }

    /**
     * Typewriter tick — for dialogue.
     */
    typewriterTick() {
        this.noise(0.01, 0.1);
    }

    /**
     * Coin / cash sound — for settlements.
     */
    coin() {
        this.tone(1200, 0.05, 'square', 0.3);
        setTimeout(() => this.tone(1600, 0.08, 'square', 0.3), 50);
    }
}

// Singleton
export const soundFX = new SoundFXController();
