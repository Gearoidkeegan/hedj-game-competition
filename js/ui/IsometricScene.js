// Isometric Scene Renderer — Hedj industry map style
// Clean vector-like illustrations with light blue ground, white roads,
// dark outlines, muted blue/grey palette with safety-orange accents.
//
// Two render paths:
//   1. Pre-rendered PNG backdrop from assets/images/scenes/<scene>.png
//      (matches the website's industry-map.png style). PNGs are loaded once
//      into a module-level cache. Animated overlays (smoke, blinkers,
//      vehicles) are drawn on top of the PNG each frame.
//   2. Procedural canvas drawing fallback (drawAirport / drawFactory / …)
//      kicks in when the PNG is missing or hasn't loaded yet.

const SCENE_TYPES = ['airport', 'roastery', 'factory', 'lab', 'building_site', 'energy_grid', 'shopping_centre'];
const SCENE_IMAGE_PATH = 'assets/images/scenes/';

// Module-level cache shared across IsometricScene instances.
// Each entry: HTMLImageElement (image.complete + naturalWidth>0 once loaded).
const sceneImageCache = {};
let scenePreloadStarted = false;

function preloadAllScenes() {
    if (scenePreloadStarted) return;
    scenePreloadStarted = true;
    for (const type of SCENE_TYPES) {
        const img = new Image();
        img.src = SCENE_IMAGE_PATH + type + '.png';
        // onerror leaves naturalWidth = 0 → fallback path is used.
        sceneImageCache[type] = img;
    }
}

// Per-scene overlay configuration. Coordinates are in canvas pixels for the
// default 620×200 canvas (overlays are scaled if the canvas differs).
//
// Supported overlay types:
//   smoke    — rising puffs from { x, y }, optional scale
//   blinker  — pulsing dot at { x, y, color }
//   vehicle  — small block sliding L→R (or R→L if speed<0) at { y, speed, color }
//   truck    — bigger cab+trailer sliding along y
//   airplane — isometric airplane sliding along runway at y
//   windmill — three rotating blades at { x, y, radius, phase }
//   craneJib — slowly rotating crane jib at { x, y, length, phase }
//   shopper  — tiny dot wandering around { x, y, range, speed }
const SCENE_OVERLAYS = {
    factory: [
        { type: 'smoke', x: 240, y: 28, scale: 1.3 },
        { type: 'smoke', x: 282, y: 22, scale: 1.1 },
        { type: 'truck', y: 148, speed: 0.45, color: '#f0f0f0' },
    ],
    energy_grid: [
        { type: 'smoke', x: 70,  y: 32, scale: 1.6 },
        { type: 'smoke', x: 118, y: 40, scale: 1.4 },
        { type: 'windmill', x: 378, y: 38, radius: 11, phase: 0.0 },
        { type: 'windmill', x: 442, y: 42, radius: 11, phase: 0.7 },
        { type: 'windmill', x: 506, y: 30, radius: 11, phase: 1.4 },
        { type: 'windmill', x: 558, y: 36, radius: 9,  phase: 2.1 },
        { type: 'blinker',  x: 595, y: 24, color: '#f04040' },
    ],
    roastery: [
        { type: 'smoke', x: 328, y: 30, scale: 1.3 },
        { type: 'truck', y: 138, speed: 0.35, color: '#a05030' },
    ],
    building_site: [
        { type: 'craneJib', x: 130, y: 38, length: 60, phase: 0.0 },
        { type: 'craneJib', x: 470, y: 44, length: 60, phase: 1.5 },
        { type: 'blinker',  x: 130, y: 38, color: '#f08040' },
        { type: 'blinker',  x: 470, y: 44, color: '#f08040' },
    ],
    airport: [
        { type: 'airplane', y: 110, speed: 1.1, color: '#ffffff' },
        { type: 'truck',    y: 158, speed: 0.5, color: '#f0c040' },
        { type: 'blinker',  x: 80,  y: 28, color: '#f04040' },
    ],
    lab: [
        { type: 'truck',   y: 132, speed: 0.4,  color: '#ffffff' },
        { type: 'truck',   y: 150, speed: -0.3, color: '#ffffff' },
        { type: 'blinker', x: 360, y: 52, color: '#5cb85c' },
    ],
    shopping_centre: [
        { type: 'truck',   y: 152, speed: 0.4,  color: '#a86840' },
        { type: 'truck',   y: 168, speed: -0.25, color: '#ffffff' },
        { type: 'shopper', x: 360, y: 130, range: 30, speed: 0.04, phase: 0.0 },
        { type: 'shopper', x: 410, y: 142, range: 25, speed: 0.05, phase: 1.0 },
        { type: 'shopper', x: 460, y: 134, range: 28, speed: 0.035, phase: 2.0 },
    ],
};

export class IsometricScene {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        this.frame = 0;
        this.animHandle = null;
        this.scene = 'airport';
        this.quarter = 0;
        this.yearOffset = 0;

        // Isometric grid
        this.tileW = 28;
        this.tileH = 14;
        this.originX = this.width / 2 - 20;
        this.originY = 40;

        // Hedj palette — pastel blues/greys/white with safety-orange accents,
        // tightened to match the new PNG backdrops.
        this.colors = {
            sky: '#f0f5fa',
            ground: '#dde7f0',
            groundDark: '#c4d2e0',
            road: '#ffffff',
            roadDash: '#8898a8',
            outline: '#2a3a5a',
            outlineLight: '#5a7090',
            building: '#dce4ec',
            buildingMid: '#b4c0cc',
            buildingDark: '#8898a8',
            roof: '#e4ecf2',
            window: '#90a8c0',
            windowLit: '#f0d888',
            accent: '#f08040',
            accentDark: '#c46028',
            crane: '#f08040',
            craneDark: '#c46028',
            metal: '#788898',
            metalDark: '#607080',
            grass: '#88b870',
            grassDark: '#70a058',
            tree: '#608850',
            treeDark: '#487038',
            trunk: '#6a5040',
            water: '#88b8d8',
            wheat: '#d8c070',
            wheatDark: '#c0a858',
            dirt: '#c0a880',
            smoke: '#c8d0d8',
        };

        // Kick off PNG preload (idempotent).
        preloadAllScenes();
    }

    start(sceneType, yearOffset = 0, quarter = 1) {
        this.scene = sceneType;
        this.yearOffset = yearOffset;
        this.quarter = quarter;
        this.frame = 0;
        this.animate();
    }

    stop() {
        if (this.animHandle) {
            cancelAnimationFrame(this.animHandle);
            this.animHandle = null;
        }
    }

    animate() {
        this.draw();
        this.frame++;
        this.animHandle = requestAnimationFrame(() => this.animate());
    }

    draw() {
        const ctx = this.ctx;
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, this.width, this.height);

        // Try PNG backdrop first.
        const img = sceneImageCache[this.scene];
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, this.width, this.height);
            this.drawOverlays(ctx);
            return;
        }

        // Procedural fallback (also runs while PNG is still loading).
        switch (this.scene) {
            case 'airport': this.drawAirport(ctx); break;
            case 'roastery': this.drawRoastery(ctx); break;
            case 'factory': this.drawFactory(ctx); break;
            case 'lab': this.drawLab(ctx); break;
            case 'building_site': this.drawBuildingSite(ctx); break;
            case 'energy_grid': this.drawEnergyGrid(ctx); break;
            case 'shopping_centre': this.drawShoppingCentre(ctx); break;
            default: this.drawAirport(ctx); break;
        }
    }

    // =========== ANIMATED OVERLAYS (drawn on top of PNG backdrop) ===========

    drawOverlays(ctx) {
        const overlays = SCENE_OVERLAYS[this.scene];
        if (!overlays) return;

        // Scale overlay coords to actual canvas size (designed at 620x200).
        const sx = this.width / 620;
        const sy = this.height / 200;
        // Use min for "object" scaling so circles stay round.
        const s = Math.min(sx, sy);

        for (const o of overlays) {
            switch (o.type) {
                case 'smoke':
                    this.drawSmoke(ctx, o.x * sx, o.y * sy, (o.scale || 1) * s);
                    break;
                case 'blinker':
                    this.drawBlinker(ctx, o.x * sx, o.y * sy, o.color || '#f08040', s);
                    break;
                case 'vehicle':
                    this.drawVehicle(ctx, o.y * sy, o.speed || 0.3, o.color || '#f08040', s);
                    break;
                case 'truck':
                    this.drawTruck(ctx, o.y * sy, o.speed || 0.35, o.color || '#ffffff', s);
                    break;
                case 'airplane':
                    this.drawAirplane(ctx, o.y * sy, o.speed || 1.0, o.color || '#ffffff', s);
                    break;
                case 'windmill':
                    this.drawWindmill(ctx, o.x * sx, o.y * sy, (o.radius || 10) * s, o.phase || 0);
                    break;
                case 'craneJib':
                    this.drawCraneJib(ctx, o.x * sx, o.y * sy, (o.length || 30) * s, o.phase || 0);
                    break;
                case 'shopper':
                    this.drawShopper(ctx, o.x * sx, o.y * sy, (o.range || 20) * s, o.speed || 0.04, o.phase || 0);
                    break;
            }
        }
    }

    drawSmoke(ctx, x, y, scale = 1) {
        // Three rising puffs offset by frame phase.
        ctx.save();
        for (let i = 0; i < 3; i++) {
            const t = ((this.frame + i * 30) % 90) / 90; // 0..1
            const py = y - t * 28 * scale;
            const px = x + Math.sin((this.frame * 0.04) + i) * 3 * scale;
            const r = (3 + t * 4) * scale;
            ctx.fillStyle = `rgba(200, 208, 216, ${0.7 * (1 - t)})`;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    drawBlinker(ctx, x, y, color, scale = 1) {
        const t = (Math.sin(this.frame * 0.15) + 1) / 2; // 0..1
        const alpha = 0.4 + t * 0.6;
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, 3 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, 6 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    drawVehicle(ctx, y, speed, color, scale = 1) {
        const cycle = this.width + 40;
        const x = ((this.frame * speed) % cycle) - 20;
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = this.colors.outline;
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, 12 * scale, 6 * scale);
        ctx.strokeRect(x + 0.5, y + 0.5, 12 * scale, 6 * scale);
        ctx.restore();
    }

    // Cab + trailer with wheels — reads as a delivery truck at small sizes.
    drawTruck(ctx, y, speed, color, scale = 1) {
        const w = 22 * scale;
        const h = 7 * scale;
        const cycle = this.width + w * 2;
        // Negative speed = right→left
        let x;
        if (speed >= 0) {
            x = ((this.frame * speed) % cycle) - w;
        } else {
            x = this.width - (((this.frame * -speed) % cycle) - w);
        }

        ctx.save();
        ctx.strokeStyle = this.colors.outline;
        ctx.lineWidth = 0.8;

        // Trailer (back box)
        ctx.fillStyle = color;
        ctx.fillRect(x, y - h, 14 * scale, h);
        ctx.strokeRect(x + 0.5, y - h + 0.5, 14 * scale, h);

        // Cab (front, slightly shorter and offset down)
        const cabX = x + 14 * scale;
        const cabY = y - h * 0.85;
        ctx.fillStyle = '#5a7090';
        ctx.fillRect(cabX, cabY, 6 * scale, h * 0.85);
        ctx.strokeRect(cabX + 0.5, cabY + 0.5, 6 * scale, h * 0.85);

        // Cab window
        ctx.fillStyle = '#90a8c0';
        ctx.fillRect(cabX + 1, cabY + 1, 4 * scale, 2 * scale);

        // Wheels
        ctx.fillStyle = '#2a3a5a';
        const wheelR = 1.4 * scale;
        ctx.beginPath(); ctx.arc(x + 3 * scale,  y, wheelR, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 11 * scale, y, wheelR, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 17 * scale, y, wheelR, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // Stylised airplane sliding along a runway. White fuselage with wings.
    drawAirplane(ctx, y, speed, color, scale = 1) {
        const w = 32 * scale;
        const cycle = this.width + w * 2;
        const x = ((this.frame * speed) % cycle) - w;

        ctx.save();
        ctx.strokeStyle = this.colors.outline;
        ctx.lineWidth = 0.8;
        ctx.fillStyle = color;

        // Fuselage
        ctx.beginPath();
        ctx.ellipse(x + 16 * scale, y, 16 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Wings (slight isometric — tilted forward triangles)
        ctx.beginPath();
        ctx.moveTo(x + 14 * scale, y);
        ctx.lineTo(x + 20 * scale, y - 6 * scale);
        ctx.lineTo(x + 24 * scale, y - 6 * scale);
        ctx.lineTo(x + 18 * scale, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + 14 * scale, y);
        ctx.lineTo(x + 20 * scale, y + 6 * scale);
        ctx.lineTo(x + 24 * scale, y + 6 * scale);
        ctx.lineTo(x + 18 * scale, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Tail fin
        ctx.beginPath();
        ctx.moveTo(x + 4 * scale, y);
        ctx.lineTo(x + 6 * scale, y - 4 * scale);
        ctx.lineTo(x + 9 * scale, y - 4 * scale);
        ctx.lineTo(x + 8 * scale, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Nose tip in safety orange
        ctx.fillStyle = '#f08040';
        ctx.beginPath();
        ctx.arc(x + 31 * scale, y, 1.5 * scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // Three rotating blades around a hub — wind turbine.
    drawWindmill(ctx, x, y, radius, phase = 0) {
        const angle = this.frame * 0.06 + phase;
        ctx.save();
        ctx.strokeStyle = '#f0f5fa';
        ctx.fillStyle = '#f0f5fa';
        ctx.lineWidth = Math.max(1, radius * 0.18);
        ctx.lineCap = 'round';

        // Three blades 120° apart
        for (let i = 0; i < 3; i++) {
            const a = angle + (i * Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
            ctx.stroke();
        }

        // Hub
        ctx.fillStyle = '#5a7090';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, radius * 0.18), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Slowly rotating crane jib — a horizontal arm pivoting around a tower top.
    drawCraneJib(ctx, x, y, length, phase = 0) {
        const angle = Math.sin(this.frame * 0.012 + phase) * 0.6; // gentle swing
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        ctx.strokeStyle = this.colors.outline;
        ctx.lineWidth = 1;

        // Main jib (horizontal lattice arm)
        ctx.fillStyle = '#f08040';
        ctx.fillRect(-length * 0.25, -2, length, 3);
        ctx.strokeRect(-length * 0.25 + 0.5, -1.5, length, 3);

        // Counter-weight on the back
        ctx.fillStyle = '#5a7090';
        ctx.fillRect(-length * 0.25 - 4, -3, 4, 5);
        ctx.strokeRect(-length * 0.25 - 3.5, -2.5, 4, 5);

        // Hook line dropping from jib tip
        const tipX = length * 0.7;
        const swayY = 8 + Math.sin(this.frame * 0.04) * 2;
        ctx.beginPath();
        ctx.moveTo(tipX, 1);
        ctx.lineTo(tipX, swayY);
        ctx.stroke();
        // Hook
        ctx.fillStyle = '#2a3a5a';
        ctx.beginPath();
        ctx.arc(tipX, swayY + 1, 1, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // A tiny shopper/pedestrian — small dot wandering inside a range.
    drawShopper(ctx, cx, cy, range, speed, phase = 0) {
        const t = this.frame * speed + phase;
        const x = cx + Math.cos(t) * range;
        const y = cy + Math.sin(t * 1.3) * (range * 0.3);
        ctx.save();
        // Body
        ctx.fillStyle = '#5a7090';
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.fillStyle = '#d4b896';
        ctx.beginPath();
        ctx.arc(x, y - 1.6, 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // =========== SHARED DRAWING PRIMITIVES ===========

    iso(ix, iy) {
        return {
            x: this.originX + (ix - iy) * (this.tileW / 2),
            y: this.originY + (ix + iy) * (this.tileH / 2)
        };
    }

    // Draw isometric box with clean outlines
    box(ctx, ix, iy, w, h, d, colors, outline = true) {
        const tw = this.tileW / 2;
        const th = this.tileH / 2;
        const base = this.iso(ix, iy);

        // Right face (darkest)
        ctx.fillStyle = colors[2];
        ctx.beginPath();
        ctx.moveTo(base.x + w * tw, base.y + w * th - d * th);
        ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th - d * th);
        ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th);
        ctx.lineTo(base.x + w * tw, base.y + w * th);
        ctx.closePath();
        ctx.fill();

        // Left face (medium)
        ctx.fillStyle = colors[1];
        ctx.beginPath();
        ctx.moveTo(base.x - h * tw, base.y + h * th - d * th);
        ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th - d * th);
        ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th);
        ctx.lineTo(base.x - h * tw, base.y + h * th);
        ctx.closePath();
        ctx.fill();

        // Top face (lightest)
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.moveTo(base.x, base.y - d * th);
        ctx.lineTo(base.x + w * tw, base.y + w * th - d * th);
        ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th - d * th);
        ctx.lineTo(base.x - h * tw, base.y + h * th - d * th);
        ctx.closePath();
        ctx.fill();

        if (outline) {
            ctx.strokeStyle = this.colors.outline;
            ctx.lineWidth = 1.2;
            // Top outline
            ctx.beginPath();
            ctx.moveTo(base.x, base.y - d * th);
            ctx.lineTo(base.x + w * tw, base.y + w * th - d * th);
            ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th - d * th);
            ctx.lineTo(base.x - h * tw, base.y + h * th - d * th);
            ctx.closePath();
            ctx.stroke();
            // Left vertical
            ctx.beginPath();
            ctx.moveTo(base.x - h * tw, base.y + h * th - d * th);
            ctx.lineTo(base.x - h * tw, base.y + h * th);
            ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th);
            ctx.stroke();
            // Right vertical
            ctx.beginPath();
            ctx.moveTo(base.x + w * tw, base.y + w * th - d * th);
            ctx.lineTo(base.x + w * tw, base.y + w * th);
            ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th);
            ctx.stroke();
        }
    }

    // Flat isometric tile
    tile(ctx, ix, iy, w, h, color, outline = false) {
        const tw = this.tileW / 2;
        const th = this.tileH / 2;
        const base = this.iso(ix, iy);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(base.x + w * tw, base.y + w * th);
        ctx.lineTo(base.x + (w - h) * tw, base.y + (w + h) * th);
        ctx.lineTo(base.x - h * tw, base.y + h * th);
        ctx.closePath();
        ctx.fill();
        if (outline) {
            ctx.strokeStyle = this.colors.outlineLight;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
    }

    // Light sky background
    sky(ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, this.height * 0.5);
        grad.addColorStop(0, '#f0f5fa');
        grad.addColorStop(1, '#dde8f0');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.width, this.height);
    }

    // Light blue ground plane
    ground(ctx) {
        const c = this.colors;
        const corners = [this.iso(-10, -10), this.iso(14, -10), this.iso(14, 14), this.iso(-10, 14)];
        ctx.fillStyle = c.ground;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fill();

        // Outline
        ctx.strokeStyle = c.outlineLight;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // White road with dashed center line
    road(ctx, ix1, iy1, ix2, iy2, width = 2) {
        const a = this.iso(ix1, iy1);
        const b = this.iso(ix2, iy2);
        const c = this.colors;

        // Road surface
        ctx.strokeStyle = c.road;
        ctx.lineWidth = width * this.tileH;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Road outline
        ctx.strokeStyle = c.outlineLight;
        ctx.lineWidth = 1;
        // Top edge and bottom edge approximated
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Dashed center line
        ctx.strokeStyle = c.roadDash;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Clean vector-style tree (round canopy like in the Hedj map)
    tree(ctx, x, y, size = 1) {
        const s = size;
        const c = this.colors;
        // Shadow
        ctx.fillStyle = 'rgba(40,60,80,0.12)';
        ctx.beginPath();
        ctx.ellipse(x + 2, y + 1, 6 * s, 3 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        // Trunk
        ctx.fillStyle = c.trunk;
        ctx.fillRect(x - 1, y - 8 * s, 2, 8 * s);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(x - 1, y - 8 * s, 2, 8 * s);
        // Canopy (single round shape)
        ctx.fillStyle = c.tree;
        ctx.beginPath();
        ctx.arc(x, y - 14 * s, 7 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        // Highlight
        ctx.fillStyle = c.grass;
        ctx.beginPath();
        ctx.arc(x - 2 * s, y - 16 * s, 3 * s, 0, Math.PI * 2);
        ctx.fill();
    }

    // Small person (simplified)
    person(ctx, x, y, color = '#4070a0', walking = false) {
        const bob = walking ? Math.sin(this.frame * 0.12 + x) * 1 : 0;
        ctx.fillStyle = 'rgba(40,60,80,0.15)';
        ctx.fillRect(x - 1, y + 1, 4, 2);
        ctx.fillStyle = '#404858';
        ctx.fillRect(x, y - 3 + bob, 1, 3);
        ctx.fillRect(x + 2, y - 3 - bob, 1, 3);
        ctx.fillStyle = color;
        ctx.fillRect(x - 1, y - 6 + bob, 4, 4);
        ctx.fillStyle = '#e8d0b8';
        ctx.fillRect(x, y - 8 + bob, 2, 2);
    }

    // Vehicle
    vehicle(ctx, x, y, bodyColor, direction = 'right', length = 20) {
        const c = this.colors;
        ctx.fillStyle = 'rgba(40,60,80,0.12)';
        ctx.beginPath();
        ctx.ellipse(x, y + 3, length * 0.6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        const hw = length / 2;
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x - hw, y - 7, length, 7);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - hw, y - 7, length, 7);
        // Cabin
        ctx.fillStyle = '#d0dce8';
        if (direction === 'right') {
            ctx.fillRect(x + hw - 7, y - 6, 5, 3);
        } else {
            ctx.fillRect(x - hw + 2, y - 6, 5, 3);
        }
        // Wheels
        ctx.fillStyle = '#303840';
        ctx.fillRect(x - hw + 3, y, 3, 2);
        ctx.fillRect(x + hw - 6, y, 3, 2);
    }

    // Smoke puffs
    smoke(ctx, x, y, count = 4, spread = 12) {
        const t = this.frame;
        for (let i = 0; i < count; i++) {
            const age = ((t * 0.6 + i * 35) % 100) / 100;
            const px = x + Math.sin(t * 0.015 + i * 1.5) * spread * age;
            const py = y - age * 30;
            const size = 2 + age * 6;
            const alpha = 0.25 * (1 - age);
            ctx.fillStyle = `rgba(180,190,200,${alpha})`;
            ctx.beginPath();
            ctx.arc(px, py, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Chimney/smokestack
    chimney(ctx, x, y, height, width = 6) {
        const c = this.colors;
        ctx.fillStyle = c.buildingMid;
        ctx.fillRect(x - width / 2, y - height, width, height);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - width / 2, y - height, width, height);
        // Red/white stripes
        for (let i = 0; i < height; i += 8) {
            ctx.fillStyle = i % 16 < 8 ? c.accent : '#e8e0d8';
            ctx.fillRect(x - width / 2, y - height + i, width, Math.min(8, height - i));
        }
        ctx.strokeRect(x - width / 2, y - height, width, height);
    }

    // Cooling tower
    coolingTower(ctx, x, y, height = 30, topR = 10, botR = 14) {
        const c = this.colors;
        ctx.fillStyle = c.building;
        ctx.beginPath();
        ctx.moveTo(x - botR, y);
        ctx.quadraticCurveTo(x - topR + 2, y - height * 0.6, x - topR, y - height);
        ctx.lineTo(x + topR, y - height);
        ctx.quadraticCurveTo(x + topR - 2, y - height * 0.6, x + botR, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Opening at top
        ctx.fillStyle = c.buildingDark;
        ctx.beginPath();
        ctx.ellipse(x, y - height, topR, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    // Wind turbine
    windTurbine(ctx, x, y, height = 40) {
        const c = this.colors;
        // Tower
        ctx.fillStyle = '#e0e4e8';
        ctx.beginPath();
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x - 1, y - height);
        ctx.lineTo(x + 1, y - height);
        ctx.lineTo(x + 2, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        // Hub
        ctx.fillStyle = '#d0d4d8';
        ctx.beginPath();
        ctx.arc(x, y - height, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.stroke();
        // Blades (rotating)
        const angle = this.frame * 0.03;
        ctx.strokeStyle = '#c0c8d0';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const a = angle + i * (Math.PI * 2 / 3);
            const bx = x + Math.cos(a) * 18;
            const by = y - height + Math.sin(a) * 18;
            ctx.beginPath();
            ctx.moveTo(x, y - height);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
            const a = angle + i * (Math.PI * 2 / 3);
            const bx = x + Math.cos(a) * 18;
            const by = y - height + Math.sin(a) * 18;
            ctx.beginPath();
            ctx.moveTo(x, y - height);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }
    }

    // Crane
    crane(ctx, x, y, height = 50, armLen = 40) {
        const c = this.colors;
        // Vertical mast
        ctx.fillStyle = c.crane;
        ctx.fillRect(x - 2, y - height, 4, height);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - 2, y - height, 4, height);
        // Cross-bracing on mast
        ctx.strokeStyle = c.craneDark;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < height; i += 8) {
            ctx.beginPath();
            ctx.moveTo(x - 2, y - i);
            ctx.lineTo(x + 2, y - i - 8);
            ctx.stroke();
        }
        // Horizontal arm
        ctx.fillStyle = c.crane;
        ctx.fillRect(x - 5, y - height - 2, armLen, 3);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - 5, y - height - 2, armLen, 3);
        // Counter-weight arm
        ctx.fillRect(x - 15, y - height - 2, 12, 3);
        ctx.strokeRect(x - 15, y - height - 2, 12, 3);
        // Counter-weight
        ctx.fillStyle = c.metalDark;
        ctx.fillRect(x - 14, y - height + 1, 6, 5);
        // Cable + hook (animated)
        const hookX = x + armLen * 0.6;
        const hookY = y - height + 15 + Math.sin(this.frame * 0.02) * 3;
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(hookX, y - height);
        ctx.lineTo(hookX, hookY);
        ctx.stroke();
        // Hook
        ctx.fillStyle = c.metal;
        ctx.fillRect(hookX - 2, hookY, 4, 3);
    }

    // Cargo ship
    ship(ctx, x, y, length = 50) {
        const c = this.colors;
        // Hull
        ctx.fillStyle = c.metalDark;
        ctx.beginPath();
        ctx.moveTo(x - length / 2, y - 6);
        ctx.lineTo(x + length / 2, y - 6);
        ctx.lineTo(x + length / 2 + 5, y);
        ctx.lineTo(x - length / 2 - 3, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Red bottom stripe
        ctx.fillStyle = c.accent;
        ctx.beginPath();
        ctx.moveTo(x - length / 2, y - 2);
        ctx.lineTo(x + length / 2, y - 2);
        ctx.lineTo(x + length / 2 + 3, y);
        ctx.lineTo(x - length / 2 - 2, y);
        ctx.closePath();
        ctx.fill();
        // Deck containers
        const containerColors = ['#4080b0', '#c05030', '#40a060', '#d0a030'];
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = containerColors[i];
            ctx.fillRect(x - 16 + i * 9, y - 12, 8, 5);
            ctx.strokeStyle = c.outline;
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x - 16 + i * 9, y - 12, 8, 5);
        }
        // Bridge
        ctx.fillStyle = '#e0e4e8';
        ctx.fillRect(x + length / 2 - 10, y - 18, 8, 12);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(x + length / 2 - 10, y - 18, 8, 12);
    }

    // Airplane
    airplane(ctx, x, y, scale = 1, angle = 0) {
        const c = this.colors;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        // Fuselage
        ctx.fillStyle = '#e8ecf0';
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
        // Wings
        ctx.fillStyle = '#d0d8e0';
        ctx.beginPath();
        ctx.moveTo(-5, -3);
        ctx.lineTo(5, -15);
        ctx.lineTo(8, -15);
        ctx.lineTo(2, -3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-5, 3);
        ctx.lineTo(5, 15);
        ctx.lineTo(8, 15);
        ctx.lineTo(2, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Tail
        ctx.fillStyle = '#c8d0d8';
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        ctx.lineTo(-22, -6);
        ctx.lineTo(-16, -6);
        ctx.lineTo(-14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Nose
        ctx.fillStyle = c.outline;
        ctx.beginPath();
        ctx.arc(19, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Windows on building face
    windowsOnFace(ctx, x, y, w, h, cols, rows) {
        const c = this.colors;
        for (let r = 0; r < rows; r++) {
            for (let col = 0; col < cols; col++) {
                const wx = x + (col + 0.5) * (w / cols) - 2;
                const wy = y + (r + 0.3) * (h / rows) - 1;
                const lit = Math.sin(this.frame * 0.008 + col * 3.1 + r * 2.3) > -0.2;
                ctx.fillStyle = lit ? c.windowLit : c.window;
                ctx.fillRect(wx, wy, 4, 3);
                ctx.strokeStyle = c.outlineLight;
                ctx.lineWidth = 0.4;
                ctx.strokeRect(wx, wy, 4, 3);
            }
        }
    }

    // Tractor (for agriculture)
    tractor(ctx, x, y) {
        const c = this.colors;
        // Body
        ctx.fillStyle = '#d04020';
        ctx.fillRect(x - 6, y - 8, 12, 6);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - 6, y - 8, 12, 6);
        // Cabin
        ctx.fillStyle = '#d0dce8';
        ctx.fillRect(x - 4, y - 14, 6, 6);
        ctx.strokeRect(x - 4, y - 14, 6, 6);
        // Big rear wheels
        ctx.fillStyle = '#303840';
        ctx.beginPath();
        ctx.arc(x - 3, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.stroke();
        // Small front wheel
        ctx.beginPath();
        ctx.arc(x + 5, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // Fuel tank (cylindrical storage)
    fuelTank(ctx, x, y, radius = 10, height = 8) {
        const c = this.colors;
        // Body
        ctx.fillStyle = '#c8ccd0';
        ctx.fillRect(x - radius, y - height, radius * 2, height);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - radius, y - height, radius * 2, height);
        // Top ellipse
        ctx.fillStyle = '#d8dce0';
        ctx.beginPath();
        ctx.ellipse(x, y - height, radius, radius * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        // Band stripe
        ctx.fillStyle = c.accent;
        ctx.fillRect(x - radius, y - height * 0.4, radius * 2, 2);
    }

    // Parking lot with varied cars
    parkingLot(ctx, ix, iy, rows, cols) {
        const carColors = ['#4070a0', '#a04040', '#606870', '#e0e0e0', '#3a8050', '#a07020', '#7050a0', '#c07030'];
        for (let r = 0; r < rows; r++) {
            for (let col = 0; col < cols; col++) {
                const cp = this.iso(ix + col, iy + r * 2);
                this.vehicle(ctx, cp.x, cp.y, carColors[(r * cols + col) % carColors.length], 'right', 10);
            }
        }
    }

    // Antenna / radio mast
    antenna(ctx, x, y, height = 30) {
        const c = this.colors;
        ctx.strokeStyle = c.metalDark;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - height);
        ctx.stroke();
        // Cross struts
        ctx.lineWidth = 0.5;
        for (let i = 0; i < height; i += 6) {
            ctx.beginPath();
            ctx.moveTo(x - 3, y - i);
            ctx.lineTo(x + 3, y - i - 4);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + 3, y - i);
            ctx.lineTo(x - 3, y - i - 4);
            ctx.stroke();
        }
        // Blinking light at top
        const blink = Math.sin(this.frame * 0.08) > 0;
        ctx.fillStyle = blink ? '#ff3333' : '#880000';
        ctx.beginPath();
        ctx.arc(x, y - height, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Flag pole
    flagPole(ctx, x, y, height = 25, flagColor = '#4070a0') {
        const c = this.colors;
        ctx.fillStyle = c.metalDark;
        ctx.fillRect(x - 0.5, y - height, 1, height);
        // Flag (animated wave)
        const wave = Math.sin(this.frame * 0.06) * 2;
        ctx.fillStyle = flagColor;
        ctx.beginPath();
        ctx.moveTo(x + 1, y - height);
        ctx.quadraticCurveTo(x + 7, y - height + 3 + wave, x + 12, y - height + 2);
        ctx.lineTo(x + 12, y - height + 8 + wave * 0.5);
        ctx.quadraticCurveTo(x + 7, y - height + 6 - wave, x + 1, y - height + 8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    // Garden / flower bed
    flowerBed(ctx, x, y, w, h) {
        ctx.fillStyle = this.colors.grass;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = this.colors.outlineLight;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, h);
        // Flowers
        const flowerColors = ['#e06080', '#e0d040', '#8060d0', '#e08040'];
        for (let i = 0; i < 5; i++) {
            const fx = x + 3 + i * (w - 6) / 4;
            const fy = y + h / 2 + Math.sin(this.frame * 0.03 + i) * 1;
            ctx.fillStyle = flowerColors[i % flowerColors.length];
            ctx.beginPath();
            ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // =========== AIRPORT SCENE ===========
    drawAirport(ctx) {
        this.sky(ctx);
        this.ground(ctx);
        const c = this.colors;

        // Grass apron areas
        this.tile(ctx, -6, 4, 4, 6, c.grass, false);
        this.tile(ctx, 10, -8, 3, 4, c.grass, false);

        // Runway
        this.tile(ctx, -2, -6, 12, 2, '#707880', true);
        // Runway markings — center line
        const rStart = this.iso(-1, -5);
        const rEnd = this.iso(10, -5);
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(rStart.x, rStart.y);
        ctx.lineTo(rEnd.x, rEnd.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Runway threshold markings
        for (let i = 0; i < 3; i++) {
            const mk = this.iso(-1, -5.8 + i * 0.4);
            ctx.fillStyle = '#e0e0e0';
            ctx.fillRect(mk.x - 4, mk.y, 8, 1.5);
        }

        // Taxiway
        this.road(ctx, 6, -4, 6, 2);
        this.road(ctx, 2, -4, 6, -4);

        // Terminal building — main
        this.box(ctx, 3, 1, 6, 3, 4, [c.roof, c.buildingMid, c.buildingDark]);
        const tb = this.iso(3, 1);
        this.windowsOnFace(ctx, tb.x - 20, tb.y - 15, 50, 20, 6, 2);

        // Terminal gate extensions (jet bridges)
        for (let i = 0; i < 3; i++) {
            this.box(ctx, 3 + i * 2, -1, 1, 0.5, 2, [c.buildingMid, c.buildingDark, '#707880']);
        }

        // Cargo terminal (left side)
        this.box(ctx, -4, 2, 3, 2, 3, [c.metal, c.metalDark, '#506070']);
        // Cargo containers
        const cg = this.iso(-3, 3);
        const containerColors = ['#4080b0', '#c05030', '#40a060'];
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = containerColors[i];
            ctx.fillRect(cg.x + i * 10 - 10, cg.y - 6, 8, 5);
            ctx.strokeStyle = c.outline;
            ctx.lineWidth = 0.4;
            ctx.strokeRect(cg.x + i * 10 - 10, cg.y - 6, 8, 5);
        }

        // Control tower
        this.box(ctx, 8, 2, 1, 1, 8, [c.roof, c.buildingMid, c.buildingDark]);
        const ct = this.iso(8, 2);
        ctx.fillStyle = '#a0b8c8';
        ctx.fillRect(ct.x - 8, ct.y - 62, 16, 4);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(ct.x - 8, ct.y - 62, 16, 4);
        ctx.fillStyle = '#88c8e8';
        ctx.fillRect(ct.x - 6, ct.y - 58, 12, 8);
        ctx.strokeRect(ct.x - 6, ct.y - 58, 12, 8);
        // Antenna on tower
        this.antenna(ctx, ct.x, ct.y - 66, 15);

        // Fuel tanks
        const ft = this.iso(10, 4);
        this.fuelTank(ctx, ft.x, ft.y, 8, 6);
        this.fuelTank(ctx, ft.x + 22, ft.y + 4, 7, 5);

        // Airplane on runway (animated taxiing)
        const planeX = this.iso(-1 + (this.frame * 0.02) % 10, -5);
        this.airplane(ctx, planeX.x, planeX.y - 4, 0.8, -0.3);

        // Airplane taking off (animated)
        const flyPhase = (this.frame * 0.005) % 1;
        const flyX = 100 + flyPhase * (this.width - 200);
        const flyY = 60 - flyPhase * 30;
        this.airplane(ctx, flyX, flyY, 0.5 + flyPhase * 0.3, -0.15);

        // Parked airplane at gate
        const gateP = this.iso(5, -1);
        this.airplane(ctx, gateP.x, gateP.y - 4, 0.6, -0.3);

        // Fire station (small red building)
        this.box(ctx, -6, 0, 2, 1, 2, [c.accent, c.accentDark, '#902818']);

        // Trees along perimeter
        for (let i = 0; i < 5; i++) {
            const tp = this.iso(-4, 5 + i * 1.5);
            this.tree(ctx, tp.x, tp.y, 0.7 + Math.sin(i) * 0.15);
        }

        // Vehicles — fuel truck, baggage car, shuttle bus
        const v1 = this.iso(6, 0);
        this.vehicle(ctx, v1.x, v1.y, '#e8e080', 'right', 12);
        const v2 = this.iso(4, -2);
        this.vehicle(ctx, v2.x, v2.y, '#e0e4e8', 'left', 8);
        const v3 = this.iso(7, 4);
        this.vehicle(ctx, v3.x, v3.y, '#4070a0', 'right', 18);

        // Wind sock
        const ws = this.iso(-1, -8);
        ctx.fillStyle = c.metalDark;
        ctx.fillRect(ws.x, ws.y - 12, 1, 12);
        const sockWave = Math.sin(this.frame * 0.06) * 2;
        ctx.fillStyle = '#e07030';
        ctx.beginPath();
        ctx.moveTo(ws.x + 1, ws.y - 12);
        ctx.lineTo(ws.x + 10 + sockWave, ws.y - 11);
        ctx.lineTo(ws.x + 8 + sockWave, ws.y - 8);
        ctx.lineTo(ws.x + 1, ws.y - 9);
        ctx.closePath();
        ctx.fill();

        // People near terminal
        for (let i = 0; i < 4; i++) {
            const pp = this.iso(4 + i, 4);
            this.person(ctx, pp.x, pp.y, ['#4070a0', '#a05030', '#508060', '#806030'][i], true);
        }

        // Flags
        this.flagPole(ctx, tb.x - 30, tb.y + 2, 20, '#4070a0');
        this.flagPole(ctx, tb.x - 22, tb.y + 2, 20, '#00b894');
    }

    // =========== AGRI-FOODS / ROASTERY ===========
    drawRoastery(ctx) {
        this.sky(ctx);
        const c = this.colors;

        // Ground — mix of farm and facility
        const corners = [this.iso(-10, -10), this.iso(14, -10), this.iso(14, 14), this.iso(-10, 14)];
        ctx.fillStyle = c.ground;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fill();

        // Wheat field (right side) — larger
        this.tile(ctx, 5, -7, 8, 7, c.wheat, true);
        // Wheat texture lines (denser)
        ctx.strokeStyle = c.wheatDark;
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 14; i++) {
            const a = this.iso(6 + i * 0.5, -6);
            const b = this.iso(6 + i * 0.5, 0);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        // Animated wheat sway
        ctx.strokeStyle = '#d0b860';
        ctx.lineWidth = 0.4;
        for (let i = 0; i < 8; i++) {
            const wx = this.iso(7 + i * 0.8, -4);
            const sway = Math.sin(this.frame * 0.04 + i * 0.7) * 2;
            ctx.beginPath();
            ctx.moveTo(wx.x, wx.y);
            ctx.lineTo(wx.x + sway, wx.y - 6);
            ctx.stroke();
        }

        // Green pasture area
        this.tile(ctx, -8, -6, 4, 6, c.grass, true);

        // Dirt area / barn yard
        this.tile(ctx, 4, -7, 1, 7, c.dirt, true);

        // Roads
        this.road(ctx, 0, -2, 6, -2);
        this.road(ctx, 0, -2, 0, 6);

        // Processing facility — main building
        this.box(ctx, -4, 0, 4, 3, 5, [c.roof, c.buildingMid, c.buildingDark]);
        const facP = this.iso(-4, 0);
        this.windowsOnFace(ctx, facP.x - 10, facP.y - 20, 30, 15, 3, 2);

        // Cold storage / refrigeration wing
        this.box(ctx, -4, 3, 3, 2, 3, ['#d0e0f0', '#b0c8d8', '#90a8b8']);
        // Refrigeration units on top
        const refP = this.iso(-3, 4);
        ctx.fillStyle = '#b0b8c0';
        ctx.fillRect(refP.x - 6, refP.y - 26, 5, 4);
        ctx.fillRect(refP.x + 4, refP.y - 26, 5, 4);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(refP.x - 6, refP.y - 26, 5, 4);
        ctx.strokeRect(refP.x + 4, refP.y - 26, 5, 4);

        // Silos — 3 now, with different sizes
        for (let i = 0; i < 3; i++) {
            const sp = this.iso(-7 + i * 2, -3);
            const siloH = 18 + i * 4;
            const siloR = 7 + i;
            ctx.fillStyle = '#c8d0d8';
            ctx.beginPath();
            ctx.ellipse(sp.x, sp.y - siloH, siloR, siloR * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(sp.x - siloR, sp.y - siloH, siloR * 2, siloH);
            ctx.strokeStyle = c.outline;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.ellipse(sp.x, sp.y - siloH, siloR, siloR * 0.6, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeRect(sp.x - siloR, sp.y - siloH, siloR * 2, siloH);
            // Ladder
            ctx.strokeStyle = c.metalDark;
            ctx.lineWidth = 0.4;
            ctx.beginPath();
            ctx.moveTo(sp.x + siloR - 1, sp.y);
            ctx.lineTo(sp.x + siloR - 1, sp.y - siloH);
            ctx.stroke();
        }

        // Smoke from processing
        const sm = this.iso(-3, 1);
        this.chimney(ctx, sm.x + 20, sm.y - 30, 18, 5);
        this.smoke(ctx, sm.x + 20, sm.y - 48, 3);

        // Barn / storage shed
        this.box(ctx, 1, -5, 2, 2, 3, [c.accent, c.accentDark, '#902818']);

        // Tractor in field (animated)
        const tractorPos = this.iso(8 + Math.sin(this.frame * 0.01) * 2, -3);
        this.tractor(ctx, tractorPos.x, tractorPos.y);

        // Second tractor (parked near barn)
        const t2 = this.iso(2, -4);
        this.tractor(ctx, t2.x, t2.y);

        // Warehouse
        this.box(ctx, 1, 3, 3, 2, 3, [c.metal, c.metalDark, '#506070']);

        // Loading dock area
        const dock = this.iso(2, 5);
        ctx.fillStyle = '#a0a8b0';
        ctx.fillRect(dock.x - 15, dock.y - 4, 30, 4);
        ctx.strokeStyle = c.outlineLight;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(dock.x - 15, dock.y - 4, 30, 4);

        // Delivery trucks (2)
        const trk = this.iso(3, -2);
        this.vehicle(ctx, trk.x, trk.y, '#e0e4e8', 'left', 18);
        const trk2 = this.iso(1, 6);
        this.vehicle(ctx, trk2.x, trk2.y, '#40a060', 'right', 20);

        // Water tower
        const wt = this.iso(10, 2);
        ctx.fillStyle = c.metalDark;
        ctx.fillRect(wt.x - 1, wt.y - 20, 2, 20);
        ctx.fillRect(wt.x - 6, wt.y - 4, 12, 2);
        ctx.fillStyle = '#88b0c8';
        ctx.beginPath();
        ctx.ellipse(wt.x, wt.y - 28, 8, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Workers near facility
        for (let i = 0; i < 3; i++) {
            const wp = this.iso(-2 + i, 6);
            this.person(ctx, wp.x, wp.y, ['#4070a0', '#e07030', '#508060'][i], true);
        }

        // Trees around facility
        for (let i = 0; i < 4; i++) {
            const tp = this.iso(-9, 1 + i * 2);
            this.tree(ctx, tp.x, tp.y, 0.7 + Math.sin(i) * 0.1);
        }
        // Hedgerow along field edge
        for (let i = 0; i < 6; i++) {
            const hp = this.iso(13, -6 + i);
            this.tree(ctx, hp.x, hp.y, 0.45);
        }

        // Fence along field
        ctx.strokeStyle = c.outlineLight;
        ctx.lineWidth = 0.6;
        const fa = this.iso(5, -7);
        const fb = this.iso(5, 0);
        ctx.beginPath();
        ctx.moveTo(fa.x, fa.y);
        ctx.lineTo(fb.x, fb.y);
        ctx.stroke();
        // Fence posts
        for (let i = 0; i < 5; i++) {
            const fp = this.iso(5, -6 + i * 1.5);
            ctx.fillStyle = c.trunk;
            ctx.fillRect(fp.x - 1, fp.y - 6, 2, 6);
        }

        // Cows in pasture (simple dots)
        for (let i = 0; i < 4; i++) {
            const cow = this.iso(-7 + i * 1.5 + Math.sin(this.frame * 0.005 + i) * 0.3, -4 + i * 0.8);
            ctx.fillStyle = '#e8e0d8';
            ctx.fillRect(cow.x - 3, cow.y - 3, 6, 3);
            ctx.fillStyle = '#303030';
            ctx.fillRect(cow.x - 1, cow.y - 3, 2, 1);
            ctx.fillRect(cow.x + 1, cow.y - 2, 2, 2);
        }
    }

    // =========== CONSTRUCTION SITE ===========
    drawBuildingSite(ctx) {
        this.sky(ctx);
        this.ground(ctx);
        const c = this.colors;

        // Dirt/excavation area
        this.tile(ctx, -3, -4, 6, 4, c.dirt, true);

        // Roads
        this.road(ctx, -4, 2, 8, 2);
        this.road(ctx, 2, -4, 2, 6);
        this.road(ctx, -6, 2, -6, 6);

        // Existing completed building next door
        this.box(ctx, -6, -2, 3, 2, 5, [c.roof, c.building, c.buildingMid]);
        const nb = this.iso(-6, -2);
        this.windowsOnFace(ctx, nb.x - 8, nb.y - 22, 28, 22, 3, 3);

        // Building under construction (partial floors)
        const floors = 3 + Math.floor(this.yearOffset);
        for (let f = 0; f < Math.min(floors, 6); f++) {
            const alpha = f < floors - 1 ? 1 : 0.6;
            ctx.globalAlpha = alpha;
            this.box(ctx, 0, -2, 3, 3, 2 + f * 2, ['#c8d8e8', '#a0b0c0', '#8090a0']);
            ctx.globalAlpha = 1;

            // Floor numbers on building edge
            if (f < floors - 1) {
                const floorP = this.iso(0, -2);
                ctx.font = '6px monospace';
                ctx.fillStyle = c.outlineLight;
                ctx.fillText(`${f + 1}`, floorP.x + 25, floorP.y - (f * 2 + 2) * (this.tileH / 2) + 5);
            }
        }

        // Steel beams showing on top floor
        const topP = this.iso(0, -2);
        const topH = (floors * 2 + 2) * (this.tileH / 2);
        ctx.strokeStyle = c.metal;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(topP.x - 15 + i * 12, topP.y - topH);
            ctx.lineTo(topP.x - 15 + i * 12, topP.y - topH - 10);
            ctx.stroke();
        }
        // Rebar (horizontal on top)
        ctx.strokeStyle = '#808890';
        ctx.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(topP.x - 15, topP.y - topH - 3 - i * 3);
            ctx.lineTo(topP.x + 25, topP.y - topH - 3 - i * 3);
            ctx.stroke();
        }

        // Crane (animated, slight swing)
        this.crane(ctx, topP.x + 30, topP.y + 20, 70, 50);

        // Second smaller crane
        this.crane(ctx, topP.x - 50, topP.y + 30, 45, 30);

        // Scaffolding (more detailed)
        ctx.strokeStyle = c.crane;
        ctx.lineWidth = 0.6;
        const scaffX = topP.x - 30;
        for (let i = 0; i < 6; i++) {
            // Horizontal
            ctx.beginPath();
            ctx.moveTo(scaffX, topP.y - i * 10);
            ctx.lineTo(scaffX + 20, topP.y - i * 10);
            ctx.stroke();
            // Verticals
            ctx.beginPath();
            ctx.moveTo(scaffX, topP.y - i * 10);
            ctx.lineTo(scaffX, topP.y - (i + 1) * 10);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(scaffX + 20, topP.y - i * 10);
            ctx.lineTo(scaffX + 20, topP.y - (i + 1) * 10);
            ctx.stroke();
            // Cross bracing
            ctx.lineWidth = 0.4;
            ctx.beginPath();
            ctx.moveTo(scaffX, topP.y - i * 10);
            ctx.lineTo(scaffX + 20, topP.y - (i + 1) * 10);
            ctx.stroke();
            ctx.lineWidth = 0.6;
        }

        // Site office (portable building)
        this.box(ctx, 5, 4, 2, 1, 1.5, ['#e0e4e8', '#c0c8d0', '#a0a8b0']);
        const siteOff = this.iso(5, 4);
        ctx.fillStyle = c.window;
        ctx.fillRect(siteOff.x + 2, siteOff.y - 10, 6, 3);

        // Cement mixer truck
        const mx = this.iso(4, 3);
        this.vehicle(ctx, mx.x, mx.y, '#e0e070', 'left', 16);

        // Dump truck
        const dt = this.iso(-4, 4);
        this.vehicle(ctx, dt.x, dt.y, '#d0a030', 'right', 20);

        // Skip / dumpster
        const skip = this.iso(6, 1);
        ctx.fillStyle = '#d0a030';
        ctx.fillRect(skip.x - 6, skip.y - 6, 12, 6);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(skip.x - 6, skip.y - 6, 12, 6);

        // Piles of materials (sand, gravel)
        const mp = this.iso(-3, 4);
        ctx.fillStyle = c.dirt;
        ctx.beginPath();
        ctx.moveTo(mp.x - 10, mp.y);
        ctx.lineTo(mp.x, mp.y - 8);
        ctx.lineTo(mp.x + 10, mp.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        // Gravel pile
        const gp = this.iso(-2, 5);
        ctx.fillStyle = '#a0a8b0';
        ctx.beginPath();
        ctx.moveTo(gp.x - 7, gp.y);
        ctx.lineTo(gp.x, gp.y - 5);
        ctx.lineTo(gp.x + 7, gp.y);
        ctx.closePath();
        ctx.fill();

        // Steel beams on ground
        const sb = this.iso(3, 5);
        ctx.fillStyle = c.metal;
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(sb.x - 12 + i * 3, sb.y - 2, 2, 16);
        }

        // Safety barrier / hoarding
        ctx.fillStyle = '#e07030';
        const hStart = this.iso(-3, 2);
        const hEnd = this.iso(5, 2);
        ctx.fillRect(hStart.x, hStart.y - 6, hEnd.x - hStart.x, 6);
        // Stripes
        ctx.fillStyle = '#f0f0f0';
        for (let i = 0; i < (hEnd.x - hStart.x) / 12; i++) {
            ctx.fillRect(hStart.x + i * 12, hStart.y - 6, 6, 6);
        }

        // Workers (more, with hard hats = orange color)
        for (let i = 0; i < 5; i++) {
            const wp = this.iso(-1 + i, 4 + Math.sin(i) * 0.5);
            this.person(ctx, wp.x, wp.y, '#e07030', true);
        }

        // Trees
        const tp1 = this.iso(-8, 0);
        this.tree(ctx, tp1.x, tp1.y, 0.8);
        const tp2 = this.iso(8, 6);
        this.tree(ctx, tp2.x, tp2.y, 0.6);
        const tp3 = this.iso(-7, 5);
        this.tree(ctx, tp3.x, tp3.y, 0.7);
    }

    // =========== ENERGY GRID ===========
    drawEnergyGrid(ctx) {
        this.sky(ctx);
        this.ground(ctx);
        const c = this.colors;

        // Water area (cooling reservoir)
        this.tile(ctx, -6, -6, 4, 4, c.water, true);
        // Water ripples
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 3; i++) {
            const wr = this.iso(-4, -4);
            const ripR = 6 + i * 4 + Math.sin(this.frame * 0.03 + i) * 2;
            ctx.beginPath();
            ctx.ellipse(wr.x, wr.y, ripR, ripR * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Roads
        this.road(ctx, -2, 2, 8, 2);
        this.road(ctx, 4, -4, 4, 6);
        this.road(ctx, -4, 2, -4, 6);

        // Wind turbines (right side) — more of them, varied heights
        for (let i = 0; i < 4; i++) {
            const wp = this.iso(8 + i * 2, -3 + i);
            this.windTurbine(ctx, wp.x, wp.y, 40 + i * 5);
        }

        // Solar panel array
        const spBase = this.iso(6, -6);
        ctx.fillStyle = '#3050a0';
        for (let r = 0; r < 2; r++) {
            for (let col = 0; col < 3; col++) {
                const sx = spBase.x + col * 12 - 12;
                const sy = spBase.y + r * 6 - 6;
                ctx.fillRect(sx, sy, 10, 4);
                // Grid lines on panel
                ctx.strokeStyle = '#4060b0';
                ctx.lineWidth = 0.3;
                ctx.strokeRect(sx, sy, 10, 4);
                ctx.beginPath();
                ctx.moveTo(sx + 5, sy);
                ctx.lineTo(sx + 5, sy + 4);
                ctx.stroke();
            }
        }

        // Power plant building
        this.box(ctx, -4, -2, 4, 3, 4, [c.buildingMid, c.buildingDark, '#606870']);
        const ppB = this.iso(-4, -2);
        this.windowsOnFace(ctx, ppB.x - 10, ppB.y - 16, 30, 16, 3, 2);

        // Chimneys
        const pp = this.iso(-3, -1);
        this.chimney(ctx, pp.x, pp.y - 28, 25, 6);
        this.chimney(ctx, pp.x + 18, pp.y - 24, 22, 5);
        this.smoke(ctx, pp.x, pp.y - 53, 4, 10);
        this.smoke(ctx, pp.x + 18, pp.y - 46, 3, 8);

        // Control room (smaller building)
        this.box(ctx, -6, 2, 2, 2, 2, [c.roof, c.building, c.buildingMid]);

        // Cooling towers
        const ct1 = this.iso(-1, -4);
        this.coolingTower(ctx, ct1.x, ct1.y, 35, 12, 16);
        const ct2 = this.iso(1, -4);
        this.coolingTower(ctx, ct2.x, ct2.y, 30, 10, 14);
        this.smoke(ctx, ct1.x, ct1.y - 35, 3, 8);
        this.smoke(ctx, ct2.x, ct2.y - 30, 2, 6);

        // Oil storage tanks (multiple)
        for (let i = 0; i < 3; i++) {
            const tank = this.iso(-1 + i * 2, 4);
            this.fuelTank(ctx, tank.x, tank.y, 10, 7);
        }

        // Substation (transformer yard)
        const ss = this.iso(3, 4);
        this.box(ctx, 3, 4, 1.5, 1.5, 1, [c.metal, c.metalDark, '#506070']);
        // Transformer units
        ctx.fillStyle = '#708090';
        ctx.fillRect(ss.x - 4, ss.y - 10, 4, 6);
        ctx.fillRect(ss.x + 2, ss.y - 10, 4, 6);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ss.x - 4, ss.y - 10, 4, 6);
        ctx.strokeRect(ss.x + 2, ss.y - 10, 4, 6);
        // Insulators (small circles on top)
        ctx.fillStyle = '#e0e8f0';
        ctx.beginPath(); ctx.arc(ss.x - 2, ss.y - 11, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ss.x + 4, ss.y - 11, 1.5, 0, Math.PI * 2); ctx.fill();

        // Power lines (pylons)
        for (let i = 0; i < 4; i++) {
            const pylonP = this.iso(2 + i * 2, 0);
            ctx.strokeStyle = c.metalDark;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pylonP.x - 3, pylonP.y);
            ctx.lineTo(pylonP.x, pylonP.y - 20);
            ctx.lineTo(pylonP.x + 3, pylonP.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pylonP.x - 6, pylonP.y - 16);
            ctx.lineTo(pylonP.x + 6, pylonP.y - 16);
            ctx.stroke();
            // Second cross arm
            ctx.beginPath();
            ctx.moveTo(pylonP.x - 4, pylonP.y - 12);
            ctx.lineTo(pylonP.x + 4, pylonP.y - 12);
            ctx.stroke();
        }
        // Wire between pylons (two levels)
        ctx.strokeStyle = '#808890';
        ctx.lineWidth = 0.4;
        for (let i = 0; i < 3; i++) {
            const a = this.iso(2 + i * 2, 0);
            const b = this.iso(4 + i * 2, 0);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y - 16);
            ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - 12, b.x, b.y - 16);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(a.x, a.y - 12);
            ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - 8, b.x, b.y - 12);
            ctx.stroke();
        }

        // Tanker truck
        const tt = this.iso(6, 3);
        this.vehicle(ctx, tt.x, tt.y, '#607080', 'right', 22);

        // Workers
        for (let i = 0; i < 2; i++) {
            const wp = this.iso(-3 + i * 2, 6);
            this.person(ctx, wp.x, wp.y, '#e07030', true);
        }

        // Security fence around plant
        ctx.strokeStyle = c.metalDark;
        ctx.lineWidth = 0.5;
        const fenceA = this.iso(-6, -2);
        const fenceB = this.iso(-6, 6);
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(fenceA.x, fenceA.y);
        ctx.lineTo(fenceB.x, fenceB.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // =========== SHOPPING CENTRE / RETAIL ===========
    drawShoppingCentre(ctx) {
        this.sky(ctx);
        this.ground(ctx);
        const c = this.colors;

        // Car park tarmac
        this.tile(ctx, 4, -4, 6, 6, '#808890', true);
        // Parking lines
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.4;
        for (let i = 0; i < 5; i++) {
            const pa = this.iso(5 + i, -3);
            const pb = this.iso(5 + i, -1);
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
        }

        // Roads
        this.road(ctx, -6, 2, 10, 2);
        this.road(ctx, 2, -4, 2, 8);

        // Main shopping building (larger)
        this.box(ctx, -2, -2, 5, 4, 4, [c.roof, c.buildingMid, c.buildingDark]);
        const sf = this.iso(-2, -2);
        this.windowsOnFace(ctx, sf.x - 25, sf.y - 15, 55, 22, 6, 2);

        // Second floor retail
        this.box(ctx, -1, -1, 3, 3, 7, [c.roof, c.building, c.buildingMid]);
        const sf2 = this.iso(-1, -1);
        this.windowsOnFace(ctx, sf2.x - 12, sf2.y - 42, 32, 14, 4, 2);

        // Entrance canopy (wider, with pillars)
        const ent = this.iso(1, 2);
        ctx.fillStyle = c.accent;
        ctx.fillRect(ent.x - 16, ent.y - 30, 32, 3);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(ent.x - 16, ent.y - 30, 32, 3);
        // Pillars
        ctx.fillStyle = c.buildingMid;
        ctx.fillRect(ent.x - 14, ent.y - 27, 2, 10);
        ctx.fillRect(ent.x + 12, ent.y - 27, 2, 10);

        // Store signs
        ctx.font = '5px monospace';
        ctx.fillStyle = '#e0e8f0';
        ctx.fillText('MAINSTREET', ent.x - 12, ent.y - 32);

        // Automatic doors (animated)
        const doorOpen = Math.sin(this.frame * 0.05) > 0;
        ctx.fillStyle = doorOpen ? '#88c8e8' : '#60a0c0';
        ctx.fillRect(ent.x - 4, ent.y - 26, doorOpen ? 3 : 8, 8);
        ctx.fillRect(ent.x + (doorOpen ? 1 : 0), ent.y - 26, doorOpen ? 3 : 0, 8);

        // Parked cars (more, proper grid)
        this.parkingLot(ctx, 5, -3, 2, 4);

        // Loading dock (back, bigger)
        this.box(ctx, -4, -1, 2, 2, 3, [c.metal, c.metalDark, '#506068']);
        // Roll-up dock doors
        const dockP = this.iso(-4, 0);
        for (let i = 0; i < 2; i++) {
            ctx.fillStyle = '#506870';
            ctx.fillRect(dockP.x + i * 12 - 8, dockP.y - 14, 8, 10);
            ctx.strokeStyle = c.outlineLight;
            ctx.lineWidth = 0.3;
            for (let line = 0; line < 4; line++) {
                ctx.beginPath();
                ctx.moveTo(dockP.x + i * 12 - 8, dockP.y - 14 + line * 2.5);
                ctx.lineTo(dockP.x + i * 12, dockP.y - 14 + line * 2.5);
                ctx.stroke();
            }
        }
        // Delivery trucks at dock
        const dock = this.iso(-5, 0);
        this.vehicle(ctx, dock.x, dock.y, '#e0e4e8', 'left', 20);
        const dock2 = this.iso(-5, 2);
        this.vehicle(ctx, dock2.x, dock2.y, '#c05030', 'left', 18);

        // Shopping trolley bay
        const trolley = this.iso(3, 3);
        ctx.fillStyle = c.metal;
        ctx.fillRect(trolley.x - 4, trolley.y - 4, 8, 4);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.4;
        ctx.strokeRect(trolley.x - 4, trolley.y - 4, 8, 4);

        // People walking (more, animated)
        for (let i = 0; i < 7; i++) {
            const px = this.iso(-1 + i * 0.8, 3 + Math.sin(this.frame * 0.02 + i) * 0.5);
            this.person(ctx, px.x, px.y, ['#4070a0', '#a05030', '#508060', '#806030', '#6050a0', '#c07040', '#505080'][i], true);
        }

        // Lamp posts along road
        for (let i = 0; i < 4; i++) {
            const lp = this.iso(-5 + i * 3, 3);
            ctx.fillStyle = c.metalDark;
            ctx.fillRect(lp.x, lp.y - 16, 2, 16);
            ctx.fillStyle = '#f0e0a0';
            ctx.beginPath();
            ctx.arc(lp.x + 1, lp.y - 18, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Flower beds near entrance
        this.flowerBed(ctx, ent.x - 20, ent.y - 18, 8, 4);
        this.flowerBed(ctx, ent.x + 14, ent.y - 18, 8, 4);

        // Trees in car park
        const tp1 = this.iso(6, 1);
        this.tree(ctx, tp1.x, tp1.y, 0.7);
        const tp2 = this.iso(8, 3);
        this.tree(ctx, tp2.x, tp2.y, 0.6);
        const tp3 = this.iso(10, -1);
        this.tree(ctx, tp3.x, tp3.y, 0.8);

        // Bus stop
        const bs = this.iso(-6, 4);
        ctx.fillStyle = c.metalDark;
        ctx.fillRect(bs.x, bs.y - 12, 1, 12);
        ctx.fillRect(bs.x + 8, bs.y - 12, 1, 12);
        ctx.fillStyle = '#4070a0';
        ctx.fillRect(bs.x, bs.y - 12, 9, 2);
        // Bus
        this.vehicle(ctx, bs.x + 15, bs.y, '#40a060', 'right', 22);
    }

    // =========== TECH FACTORY ===========
    drawFactory(ctx) {
        this.sky(ctx);
        this.ground(ctx);
        const c = this.colors;

        // Landscaped lawn area
        this.tile(ctx, -6, -4, 3, 6, c.grass, false);

        // Roads
        this.road(ctx, -2, 3, 10, 3);
        this.road(ctx, 4, -4, 4, 8);

        // Main factory building (larger)
        this.box(ctx, -2, -2, 6, 4, 5, [c.buildingMid, c.buildingDark, '#606870']);
        const fb = this.iso(-2, -2);
        this.windowsOnFace(ctx, fb.x - 22, fb.y - 16, 55, 26, 5, 3);

        // Company logo area on building
        ctx.fillStyle = '#4080b0';
        ctx.fillRect(fb.x + 8, fb.y - 38, 20, 4);
        ctx.font = '4px monospace';
        ctx.fillStyle = '#e0f0ff';
        ctx.fillText('NEXGEN', fb.x + 10, fb.y - 35);

        // Assembly wing (taller)
        this.box(ctx, 4, -3, 3, 3, 4, [c.roof, c.building, c.buildingMid]);
        const aw = this.iso(4, -3);
        this.windowsOnFace(ctx, aw.x - 8, aw.y - 20, 20, 16, 2, 2);

        // R&D building (modern glass)
        this.box(ctx, -4, -4, 2, 2, 6, ['#c0d8e8', '#90b0c8', '#6888a0']);
        const rd = this.iso(-4, -4);
        this.windowsOnFace(ctx, rd.x - 6, rd.y - 36, 18, 30, 2, 4);

        // Roof vents and AC units
        const rv = this.iso(0, -1);
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = c.metal;
            ctx.fillRect(rv.x + i * 12 - 10, rv.y - 38, 6, 4);
            ctx.strokeStyle = c.outline;
            ctx.lineWidth = 0.5;
            ctx.strokeRect(rv.x + i * 12 - 10, rv.y - 38, 6, 4);
            // Fan animation
            const fanAngle = this.frame * 0.1 + i;
            ctx.strokeStyle = c.metalDark;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(rv.x + i * 12 - 7 + Math.cos(fanAngle) * 2, rv.y - 36 + Math.sin(fanAngle) * 1);
            ctx.lineTo(rv.x + i * 12 - 7 - Math.cos(fanAngle) * 2, rv.y - 36 - Math.sin(fanAngle) * 1);
            ctx.stroke();
        }

        // Conveyor belt (animated dots) — longer
        const convStart = this.iso(5, -1);
        const convEnd = this.iso(9, -1);
        ctx.strokeStyle = c.metalDark;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(convStart.x, convStart.y - 4);
        ctx.lineTo(convEnd.x, convEnd.y - 4);
        ctx.stroke();
        // Conveyor rails
        ctx.strokeStyle = '#909898';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(convStart.x, convStart.y - 6);
        ctx.lineTo(convEnd.x, convEnd.y - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(convStart.x, convStart.y - 2);
        ctx.lineTo(convEnd.x, convEnd.y - 2);
        ctx.stroke();
        // Moving items on conveyor (circuit boards)
        for (let i = 0; i < 5; i++) {
            const phase = ((this.frame * 0.5 + i * 16) % 80) / 80;
            const cx = convStart.x + (convEnd.x - convStart.x) * phase;
            const cy = convStart.y + (convEnd.y - convStart.y) * phase - 6;
            ctx.fillStyle = '#30a060';
            ctx.fillRect(cx - 3, cy, 6, 4);
            // IC chip marks
            ctx.fillStyle = '#202020';
            ctx.fillRect(cx - 1, cy + 1, 2, 2);
            ctx.strokeStyle = c.outline;
            ctx.lineWidth = 0.4;
            ctx.strokeRect(cx - 3, cy, 6, 4);
        }

        // Loading bay with trucks
        const lb = this.iso(8, 4);
        this.vehicle(ctx, lb.x, lb.y, '#e0e4e8', 'left', 20);
        const lb2 = this.iso(6, 5);
        this.vehicle(ctx, lb2.x, lb2.y, '#4080b0', 'left', 18);
        // Shipping container
        const sc = this.iso(8, 6);
        ctx.fillStyle = '#c05030';
        ctx.fillRect(sc.x - 10, sc.y - 8, 20, 8);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sc.x - 10, sc.y - 8, 20, 8);

        // Satellite dish on roof
        const sd = this.iso(5, -3);
        ctx.fillStyle = c.metal;
        ctx.beginPath();
        ctx.arc(sd.x, sd.y - 34, 6, Math.PI * 0.8, Math.PI * 2.2);
        ctx.lineTo(sd.x, sd.y - 34);
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        // Second satellite dish
        ctx.fillStyle = c.metal;
        ctx.beginPath();
        ctx.arc(sd.x + 14, sd.y - 32, 4, Math.PI * 0.8, Math.PI * 2.2);
        ctx.lineTo(sd.x + 14, sd.y - 32);
        ctx.fill();
        ctx.stroke();

        // Antenna
        this.antenna(ctx, rd.x + 6, rd.y - 42, 18);

        // Employee parking
        this.parkingLot(ctx, -6, 2, 1, 3);

        // Workers
        for (let i = 0; i < 3; i++) {
            const wp = this.iso(2 + i, 4 + Math.sin(this.frame * 0.015 + i) * 0.3);
            this.person(ctx, wp.x, wp.y, ['#e0e8f0', '#4070a0', '#508060'][i], true);
        }

        // Trees (landscaping)
        for (let i = 0; i < 4; i++) {
            const tp = this.iso(-6, -3 + i * 2);
            this.tree(ctx, tp.x, tp.y, 0.7 + Math.sin(i) * 0.15);
        }
        // Decorative trees near entrance
        const tpEnt = this.iso(-2, 3);
        this.tree(ctx, tpEnt.x - 10, tpEnt.y, 0.5);
        this.tree(ctx, tpEnt.x + 10, tpEnt.y, 0.5);

        // Flag pole
        this.flagPole(ctx, fb.x - 28, fb.y + 4, 22, '#4080b0');
    }

    // =========== PHARMA LAB ===========
    drawLab(ctx) {
        this.sky(ctx);
        this.ground(ctx);
        const c = this.colors;

        // Landscaped areas
        this.tile(ctx, -8, -4, 4, 4, c.grass, false);

        // Roads
        this.road(ctx, -4, 3, 10, 3);
        this.road(ctx, 3, -4, 3, 8);
        this.road(ctx, -4, 3, -4, 6);

        // Main research building (modern glass, taller)
        this.box(ctx, -2, -2, 5, 3, 6, ['#c0d8e8', '#90b0c8', '#6888a0']);
        const lb = this.iso(-2, -2);
        this.windowsOnFace(ctx, lb.x - 18, lb.y - 26, 48, 34, 5, 4);

        // Helipad on roof
        const roofP = this.iso(0, 0);
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(roofP.x, roofP.y - 46, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = '6px monospace';
        ctx.fillStyle = '#e0e0e0';
        ctx.textAlign = 'center';
        ctx.fillText('H', roofP.x, roofP.y - 44);
        ctx.textAlign = 'left';

        // Secondary lab building (taller)
        this.box(ctx, 3, -3, 3, 2, 4, [c.roof, c.building, c.buildingMid]);
        const slb = this.iso(3, -3);
        this.windowsOnFace(ctx, slb.x - 6, slb.y - 20, 20, 16, 2, 2);

        // Biotech wing (distinctive curved-roof look)
        this.box(ctx, 3, 0, 2, 3, 3, ['#d0e8f0', '#b0c8d8', '#90a8b8']);
        // Hazard stripe on door
        const btw = this.iso(4, 2);
        ctx.fillStyle = '#e0c030';
        ctx.fillRect(btw.x - 4, btw.y - 16, 8, 2);
        ctx.fillStyle = '#303030';
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(btw.x - 4 + i * 4, btw.y - 16, 2, 2);
        }

        // Clean room annex (low, white, with airlock)
        this.box(ctx, -4, 2, 2, 3, 2, ['#e8ecf0', '#d0d8e0', '#b8c0c8']);
        // Airlock detail
        const ar = this.iso(-3, 3);
        ctx.fillStyle = '#a0b0c0';
        ctx.fillRect(ar.x - 4, ar.y - 12, 8, 8);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ar.x - 4, ar.y - 12, 8, 8);

        // Ventilation units on roof (more)
        const vp = this.iso(0, -1);
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = '#b0b8c0';
            ctx.fillRect(vp.x + i * 9 - 18, vp.y - 46, 5, 5);
            ctx.strokeStyle = c.outline;
            ctx.lineWidth = 0.5;
            ctx.strokeRect(vp.x + i * 9 - 18, vp.y - 46, 5, 5);
            // Spinning fan indicator
            const fAngle = this.frame * 0.08 + i;
            ctx.strokeStyle = '#808890';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.arc(vp.x + i * 9 - 15.5, vp.y - 43.5, 1.5, fAngle, fAngle + Math.PI);
            ctx.stroke();
        }

        // Cold storage (distinctive)
        this.box(ctx, -6, 0, 2, 2, 2, ['#b0d0e8', '#90b0c8', '#7090a8']);
        const csP = this.iso(-6, 0);
        ctx.fillStyle = '#4080b0';
        ctx.font = '4px monospace';
        ctx.fillText('-20°C', csP.x - 4, csP.y - 12);

        // Delivery vehicles (cold chain vans)
        const dv = this.iso(6, 4);
        this.vehicle(ctx, dv.x, dv.y, '#e0e4e8', 'left', 16);
        const dv2 = this.iso(6, 6);
        this.vehicle(ctx, dv2.x, dv2.y, '#4080b0', 'right', 14);
        // Ambulance / emergency vehicle
        const amb = this.iso(-4, 6);
        this.vehicle(ctx, amb.x, amb.y, '#e0e0e0', 'left', 14);
        // Red cross on ambulance
        ctx.fillStyle = '#d04040';
        ctx.fillRect(amb.x - 2, amb.y - 6, 4, 1);
        ctx.fillRect(amb.x - 0.5, amb.y - 7.5, 1, 4);

        // Scientists walking (more, lab coat white)
        for (let i = 0; i < 5; i++) {
            const sp = this.iso(-1 + i * 1.5, 4 + Math.sin(this.frame * 0.015 + i * 2) * 0.3);
            this.person(ctx, sp.x, sp.y, i < 3 ? '#e0e8f0' : '#4070a0', true);
        }

        // Garden / green area (larger, with path)
        const gp = this.iso(7, -1);
        ctx.fillStyle = c.grass;
        ctx.beginPath();
        ctx.ellipse(gp.x, gp.y, 18, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outlineLight;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        // Pond
        ctx.fillStyle = c.water;
        ctx.beginPath();
        ctx.ellipse(gp.x + 4, gp.y + 2, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.outlineLight;
        ctx.stroke();
        // Path through garden
        ctx.strokeStyle = '#d0d8e0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(gp.x - 16, gp.y);
        ctx.quadraticCurveTo(gp.x - 4, gp.y - 4, gp.x + 8, gp.y - 2);
        ctx.stroke();

        // Bench in garden
        ctx.fillStyle = c.trunk;
        ctx.fillRect(gp.x - 8, gp.y - 6, 10, 2);
        ctx.fillRect(gp.x - 8, gp.y - 6, 1, 4);
        ctx.fillRect(gp.x + 1, gp.y - 6, 1, 4);

        // Trees around campus (more varied)
        for (let i = 0; i < 5; i++) {
            const tp = this.iso(-7, -3 + i * 1.8);
            this.tree(ctx, tp.x, tp.y, 0.6 + Math.sin(i * 1.3) * 0.15);
        }
        this.tree(ctx, gp.x - 14, gp.y - 8, 0.7);
        this.tree(ctx, gp.x + 12, gp.y - 5, 0.6);
        this.tree(ctx, gp.x - 6, gp.y + 6, 0.5);

        // Flower beds near entrance
        const entP = this.iso(-1, 3);
        this.flowerBed(ctx, entP.x - 14, entP.y - 4, 10, 3);
        this.flowerBed(ctx, entP.x + 6, entP.y - 4, 10, 3);

        // Flag poles
        this.flagPole(ctx, lb.x - 24, lb.y + 6, 22, '#4080b0');
        this.flagPole(ctx, lb.x - 16, lb.y + 6, 22, '#00b894');
    }
}
