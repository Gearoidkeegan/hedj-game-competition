// IsometricScene: the Pro dashboard's industry scene. Kept as a thin wrapper
// so DashboardScreen's `new IsometricScene(canvas)`, `.start(sceneType,
// yearOffset, quarter)` and `.stop()` keep working; all drawing now goes
// through the code-drawn pixel scenes (js/ui/pixel/Scene.js). No images.

import { SceneLoop } from './pixel/Scene.js';

const PRO_SCENE_STATE = Object.freeze({ mood: 'calm', cashLevel: 0.5, highlight: null });

export class IsometricScene {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = 'airport';
        this.yearOffset = 0;
        this.quarter = 1;
        this.loop = null;
    }

    // sceneType is an industries.json `scene` name (e.g. 'roastery') or an industry id.
    start(sceneType, yearOffset = 0, quarter = 1) {
        this.scene = sceneType || 'airport';
        this.yearOffset = yearOffset;
        this.quarter = quarter;
        // SceneLoop makes the canvas fill the dashboard viewport and sizes it.
        this.canvas.style.imageRendering = 'pixelated';
        if (!this.loop) {
            this.loop = new SceneLoop(this.canvas, () => ({ industryId: this.scene, sceneState: PRO_SCENE_STATE }));
        }
        this.loop.start();
    }

    stop() {
        if (this.loop) this.loop.stop();
    }
}
