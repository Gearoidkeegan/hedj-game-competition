// Extend Screen — "The board is offering to extend your contract"

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { GAME_CONFIG } from '../utils/constants.js';
import { formatQuarter } from '../utils/formatters.js';

export class ExtendScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active extend-screen';

        const state = gameState.get();
        const extensionsRemaining = GAME_CONFIG.MAX_EXTENSIONS - state.extensionsUsed;
        const additionalQuarters = GAME_CONFIG.EXTENSION_QUARTERS;

        this.el.innerHTML = `
            <div style="max-width:500px;">
                <h2 style="font-size:14px;line-height:1.8;">CONTRACT EXTENSION</h2>

                <div style="margin:16px 0;">
                    <div class="panel" style="text-align:left;">
                        <div class="panel-title">MEMO FROM THE BOARD</div>
                        <p class="readable-text" style="font-size:18px;line-height:1.5;padding:8px;">
                            The board has reviewed your performance and is offering to extend
                            your contract for another ${additionalQuarters} quarters (1 year).
                        </p>
                        <p class="readable-text" style="font-size:16px;color:var(--text-muted);padding:0 8px 8px;">
                            Current satisfaction: <span style="color:${state.boardSatisfaction >= 50 ? 'var(--pnl-positive)' : 'var(--warning)'}">${state.boardSatisfaction}%</span>
                            <br>Extensions remaining: ${extensionsRemaining}
                        </p>
                    </div>
                </div>

                <p class="readable-text" style="color:var(--text-secondary);margin-bottom:24px;">
                    Do you accept the extension, or take your results and cash out?
                </p>

                <div class="extend-buttons">
                    <button class="btn btn-gold" id="btn-extend" style="flex:1;">
                        ACCEPT (+${additionalQuarters} QUARTERS)
                    </button>
                    <button class="btn btn-danger" id="btn-end" style="flex:1;">
                        CASH OUT
                    </button>
                </div>
            </div>
        `;

        return this.el;
    }

    mount() {
        this.el.querySelector('#btn-extend').addEventListener('click', () => {
            gameLoop.extendGame();
            this.app.showToast('Contract extended! New quarters added.', 'success');
        });

        this.el.querySelector('#btn-end').addEventListener('click', () => {
            gameLoop.endGame();
        });
    }

    unmount() {}
}
