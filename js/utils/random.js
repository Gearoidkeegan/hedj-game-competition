// Seeded pseudo-random number generator (Mulberry32)
// Allows reproducible games — same seed = same events

export class SeededRandom {
    constructor(seed) {
        this.seed = seed;
        this.state = seed;
    }

    // Returns float in [0, 1)
    next() {
        this.state |= 0;
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Returns integer in [min, max] inclusive
    intRange(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    // Returns float in [min, max)
    floatRange(min, max) {
        return this.next() * (max - min) + min;
    }

    // Pick random element from array
    pick(array) {
        return array[Math.floor(this.next() * array.length)];
    }

    // Shuffle array in place (Fisher-Yates)
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // Weighted random selection
    // items: [{ weight: number, ...rest }]
    weightedPick(items) {
        const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);
        let roll = this.next() * totalWeight;
        for (const item of items) {
            roll -= (item.weight || 1);
            if (roll <= 0) return item;
        }
        return items[items.length - 1];
    }

    // Returns true with given probability (0-1)
    chance(probability) {
        return this.next() < probability;
    }
}

// Generate a random seed from current time
export function generateSeed() {
    return Date.now() ^ (Math.random() * 0xFFFFFFFF) >>> 0;
}
