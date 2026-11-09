// PixelCanvas: a small logical-resolution colour buffer that scenes draw into,
// then blit to a real 2D context as crisp, scaled rectangles.
//
// Colours are CSS hex strings; null is transparent. Every primitive goes
// through pixel(), which honours three drawing modes used by the scenes:
//   - an offset (ox, oy), used by outlined() to stamp silhouettes;
//   - a forced colour, used by outlined() to paint those silhouettes one colour;
//   - "under" mode, which only fills pixels that are still transparent (the sky
//     is painted under a finished scene so it is never colour-graded twice).

export class PixelCanvas {
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.buf = new Array(w * h).fill(null);
        this.ox = 0;
        this.oy = 0;
        this.force = null;
        this.under = false;
    }

    clear(c = null) {
        this.buf.fill(c);
    }

    get(x, y) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
        return this.buf[y * this.w + x];
    }

    pixel(x, y, c) {
        if (c == null) return;
        x = Math.floor(x + this.ox);
        y = Math.floor(y + this.oy);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = y * this.w + x;
        if (this.under && this.buf[i] !== null) return;
        this.buf[i] = this.force || c;
    }

    rect(x, y, w, h, c) {
        if (c == null) return;
        x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h);
        const x0 = Math.max(x, -this.ox), y0 = Math.max(y, -this.oy);
        const x1 = Math.min(x + w, this.w - this.ox), y1 = Math.min(y + h, this.h - this.oy);
        for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) this.pixel(xx, yy, c);
        }
    }

    // A 2-colour checkerboard: the classic way to blend bands in pixel art.
    dither(x, y, w, h, c1, c2) {
        for (let yy = y; yy < y + h; yy++) {
            for (let xx = x; xx < x + w; xx++) this.pixel(xx, yy, ((xx + yy) & 1) ? c2 : c1);
        }
    }

    hline(x, y, w, c) { this.rect(x, y, w, 1, c); }
    vline(x, y, h, c) { this.rect(x, y, 1, h, c); }

    line(x0, y0, x1, y1, c) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < 2048; guard++) {
            this.pixel(x0, y0, c);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
        }
    }

    // Filled disc centred on (cx, cy).
    disc(cx, cy, r, c) {
        const r2 = r * r + r * 0.8;
        for (let y = -r; y <= r; y++) {
            for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) this.pixel(cx + x, cy + y, c);
        }
    }

    // map: array of strings, one char per pixel; chars missing from paletteMap
    // (conventionally '.' or ' ') are transparent. flip mirrors horizontally.
    sprite(map, x, y, paletteMap, flip = false) {
        for (let row = 0; row < map.length; row++) {
            const line = map[row];
            const n = line.length;
            for (let col = 0; col < n; col++) {
                const c = paletteMap[line[col]];
                if (c != null) this.pixel(x + (flip ? n - 1 - col : col), y + row, c);
            }
        }
    }

    // Draw fn's shapes once in colour c offset by one pixel in each direction,
    // then draw them normally: a one-pixel outline around any silhouette.
    outlined(c, fn) {
        const { ox, oy, force } = this;
        this.force = c;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            this.ox = ox + dx;
            this.oy = oy + dy;
            fn();
        }
        this.ox = ox;
        this.oy = oy;
        this.force = force;
        fn();
    }

    // Remap every opaque pixel through fn (memoised by the caller).
    remap(fn) {
        const b = this.buf;
        for (let i = 0; i < b.length; i++) if (b[i] !== null) b[i] = fn(b[i]);
    }

    // Paint the buffer onto ctx at the given scale with integer-snapped edges,
    // so non-integer scales never leave seams. Horizontal runs of one colour are
    // merged, and identical runs on consecutive rows are merged into one rect.
    blitTo(ctx, scale, offsetX = 0, offsetY = 0) {
        const { w, h, buf } = this;
        const edgeX = (x) => Math.round(offsetX + x * scale);
        const edgeY = (y) => Math.round(offsetY + y * scale);
        const flush = (r) => {
            const X0 = edgeX(r.x0), Y0 = edgeY(r.y);
            const W = edgeX(r.x1) - X0, H = edgeY(r.y + r.h) - Y0;
            if (W <= 0 || H <= 0) return;
            ctx.fillStyle = r.c;
            ctx.fillRect(X0, Y0, W, H);
        };
        let open = new Map();
        for (let y = 0; y < h; y++) {
            const next = new Map();
            let x = 0;
            while (x < w) {
                const c = buf[y * w + x];
                let x1 = x + 1;
                while (x1 < w && buf[y * w + x1] === c) x1++;
                if (c !== null) {
                    const key = x + ',' + x1 + ',' + c;
                    const prev = open.get(key);
                    if (prev) {
                        prev.h++;
                        open.delete(key);
                        next.set(key, prev);
                    } else {
                        next.set(key, { x0: x, x1, y, h: 1, c });
                    }
                }
                x = x1;
            }
            for (const r of open.values()) flush(r);
            open = next;
        }
        for (const r of open.values()) flush(r);
    }
}
