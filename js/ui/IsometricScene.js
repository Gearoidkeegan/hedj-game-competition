// IsometricScene: the Pro dashboard's industry scene. Kept as a thin wrapper
// so DashboardScreen's `new IsometricScene(canvas)`, `.start(sceneType,
// yearOffset, quarter, sceneState)` and `.stop()` keep working; all drawing now goes
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
        this.sceneState = PRO_SCENE_STATE;
    }

    // sceneType is an industries.json `scene` name (e.g. 'roastery') or an industry id.
    // sceneState (optional): the SceneState mood from the last quarter (proAdapter.proSceneState).
    start(sceneType, yearOffset = 0, quarter = 1, sceneState = PRO_SCENE_STATE) {
        this.scene = sceneType || 'airport';
        this.yearOffset = yearOffset;
        this.quarter = quarter;
        this.sceneState = sceneState || PRO_SCENE_STATE;
        // SceneLoop makes the canvas fill the dashboard viewport and sizes it.
        this.canvas.style.imageRendering = 'pixelated';
        if (!this.loop) {
            this.loop = new SceneLoop(this.canvas, () => ({ industryId: this.scene, sceneState: this.sceneState }));
        }
        this.loop.start();
    }

    stop() {
        if (this.loop) this.loop.stop();
    }
}
