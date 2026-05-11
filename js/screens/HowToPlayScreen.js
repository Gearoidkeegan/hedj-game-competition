// How to Play — stepped walkthrough of game mechanics
// Auto-shown on first visit, also accessible from title menu

import { markGuideSeen } from '../utils/storage.js';
import { soundFX } from '../ui/SoundFX.js';

const STEPS = [
    {
        title: 'WELCOME, TREASURER',
        blurb: `You run treasury for a growing company. Your job: forecast cash flows, hedge market risk, keep the board happy, and survive each quarter. Grades are awarded based on P&L variance vs forecast, board confidence, and stress.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">YOUR MISSION</div>
                <div class="guide-mock-row"><span>Survive 8 quarters</span><span class="m-ok">REQUIRED</span></div>
                <div class="guide-mock-row"><span>Beat forecast variance</span><span class="m-ok">SCORED</span></div>
                <div class="guide-mock-row"><span>Keep board confidence</span><span class="m-warn">WATCH</span></div>
                <div class="guide-mock-row"><span>Stay below burnout</span><span class="m-bad">CRITICAL</span></div>
            </div>
        `,
        callouts: [
            { x: 78, y: 70, text: 'Stress > 80% = risk of leaving' }
        ]
    },
    {
        title: 'MAIN EXPOSURES',
        blurb: `Your business has natural exposures — foreign currency revenue, fuel or commodity input costs, and floating-rate debt. Market moves translate directly into P&L variance. Identify them on the dashboard before you can manage them.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">EXPOSURES — AIRLINE</div>
                <div class="guide-mock-row"><span>EUR/USD revenue</span><span class="m-cyan">€2.4M</span></div>
                <div class="guide-mock-row"><span>Jet fuel (mT)</span><span class="m-cyan">200,000 mT</span></div>
                <div class="guide-mock-row"><span>Brent crude (bbl)</span><span class="m-cyan">hedge ref.</span></div>
                <div class="guide-mock-row"><span>Floating-rate debt</span><span class="m-cyan">$5.0M</span></div>
                <div class="guide-mock-row m-totalrow"><span>Net P&amp;L sensitivity</span><span class="m-bad">±$340k</span></div>
            </div>
        `,
        callouts: [
            { x: 80, y: 82, text: 'Jet fuel in mT; Brent hedge ref. in barrels (bbl)' }
        ]
    },
    {
        title: 'HEDGING POLICY',
        blurb: `Reduce variance by locking rates. Forwards fix the rate at zero up-front cost. Options give protection but carry a premium. Pick a hedge ratio (% of exposure covered) — too little leaves you exposed, too much wastes premium and looks reckless to the board.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">NEW HEDGE</div>
                <div class="guide-mock-row"><span>Instrument</span><span class="m-gold">FORWARD</span></div>
                <div class="guide-mock-row"><span>Notional</span><span class="m-cyan">€2.0M</span></div>
                <div class="guide-mock-row"><span>Hedge ratio</span><span class="m-cyan">80%</span></div>
                <div class="guide-mock-row"><span>Tenor</span><span class="m-cyan">2 quarters</span></div>
                <div class="guide-mock-row m-totalrow"><span>Locked rate</span><span class="m-ok">1.0842</span></div>
            </div>
        `,
        callouts: [
            { x: 82, y: 50, text: '60–80% is the sweet spot' }
        ]
    },
    {
        title: 'BANKS',
        blurb: `Each trade goes through a counterparty bank. Banks differ on pricing (spread), credit lines, and reliability. Pick the cheapest with capacity — but don't concentrate everything with one name or your board will flag concentration risk.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">COUNTERPARTIES</div>
                <div class="guide-mock-row"><span>Goldsmith &amp; Co</span><span class="m-ok">SPREAD 2bps</span></div>
                <div class="guide-mock-row"><span>HSBNC</span><span class="m-cyan">SPREAD 4bps</span></div>
                <div class="guide-mock-row"><span>BarclayBank</span><span class="m-warn">LINE 60% USED</span></div>
                <div class="guide-mock-row m-totalrow"><span>Concentration</span><span class="m-bad">68% w/ 1 bank</span></div>
            </div>
        `,
        callouts: [
            { x: 80, y: 78, text: 'Spread > 50% with one bank = board concern' }
        ]
    },
    {
        title: 'TREASURY MANAGEMENT SYSTEM',
        blurb: `Your TMS starts basic — it tracks positions but forecasts are rough. Purchase upgrade modules to improve forecast accuracy and get better market intelligence. Modules are expensive, so prioritise wisely. A better TMS means tighter variance and higher grades.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">TMS MODULES</div>
                <div class="guide-mock-row"><span>Base TMS</span><span class="m-ok">INSTALLED</span></div>
                <div class="guide-mock-row"><span>FX Forecast Engine</span><span class="m-warn">$45,000</span></div>
                <div class="guide-mock-row"><span>Commodity Analytics</span><span class="m-warn">$38,000</span></div>
                <div class="guide-mock-row"><span>Rates Intelligence</span><span class="m-bad">$62,000</span></div>
                <div class="guide-mock-row m-totalrow"><span>Forecast accuracy</span><span class="m-bad">LOW</span></div>
            </div>
        `,
        callouts: [
            { x: 82, y: 78, text: 'Better TMS = tighter variance = higher grade' }
        ]
    },
    {
        title: 'QUARTERLY REVIEW',
        blurb: `At the end of each quarter, your actual P&L is compared to forecast. Tight variance = praise. Big surprise (good or bad) = uncomfortable questions. The review feeds your grade and the board's confidence in you.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">Q3 RESULTS</div>
                <div class="guide-mock-row"><span>Forecast P&amp;L</span><span class="m-cyan">$420k</span></div>
                <div class="guide-mock-row"><span>Actual P&amp;L</span><span class="m-cyan">$408k</span></div>
                <div class="guide-mock-row"><span>Variance</span><span class="m-ok">-2.8%</span></div>
                <div class="guide-mock-row m-totalrow"><span>Quarter grade</span><span class="m-gold">A</span></div>
            </div>
        `,
        callouts: [
            { x: 80, y: 78, text: 'Within ±5% is the target band' }
        ]
    },
    {
        title: 'RANDOM EVENTS',
        blurb: `Markets move and shocks happen — central bank surprises, geopolitical events, supply disruptions. You'll see news headlines and have a chance to react before resolution. Hedge, unwind, adjust product mix, ignore? The choices are yours, as are the consequences.`,
        mockup: () => `
            <div class="guide-mock-panel guide-mock-event">
                <div class="guide-mock-title m-bad">⚠ BREAKING</div>
                <div class="guide-mock-event-body">FED HIKES BY 75bps — UNEXPECTED</div>
                <div class="guide-mock-row"><span>USD strengthens</span><span class="m-bad">+1.4%</span></div>
                <div class="guide-mock-row"><span>Your hedge ratio</span><span class="m-ok">80% covered</span></div>
                <div class="guide-mock-row m-totalrow"><span>Estimated impact</span><span class="m-warn">-$24k</span></div>
            </div>
        `,
        callouts: [
            { x: 78, y: 62, text: 'Hedges absorb most of the shock' }
        ]
    },
    {
        title: 'BOARD APPROVAL & STRESS',
        blurb: `Every quarter the board reviews your performance. Confidence rises with steady results and falls with surprises. Your stress level rises with workload and big losses. Hit zero confidence and you're fired; hit max stress and you walk.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">STATUS</div>
                <div class="guide-mock-bar">
                    <div class="guide-mock-bar-label">BOARD CONFIDENCE</div>
                    <div class="guide-mock-bar-track"><div class="guide-mock-bar-fill m-fill-ok" style="width:72%"></div></div>
                    <div class="guide-mock-bar-val">72%</div>
                </div>
                <div class="guide-mock-bar">
                    <div class="guide-mock-bar-label">STRESS</div>
                    <div class="guide-mock-bar-track"><div class="guide-mock-bar-fill m-fill-warn" style="width:58%"></div></div>
                    <div class="guide-mock-bar-val">58%</div>
                </div>
            </div>
        `,
        callouts: [
            { x: 82, y: 78, text: 'Both bars matter — keep them balanced' }
        ]
    },
    {
        title: 'FINAL RANKING',
        blurb: `After your final quarter, performance is graded A+ to F based on cumulative variance, board confidence, stress, and survival. Top scores land on the leaderboard. Lower grades mean a tougher career path — or LinkedIn.`,
        mockup: () => `
            <div class="guide-mock-panel">
                <div class="guide-mock-title">FINAL GRADE</div>
                <div class="guide-mock-grade m-gold">A+</div>
                <div class="guide-mock-row"><span>Total score</span><span class="m-cyan">8,420</span></div>
                <div class="guide-mock-row"><span>Quarters survived</span><span class="m-ok">8 / 8</span></div>
                <div class="guide-mock-row m-totalrow"><span>Leaderboard rank</span><span class="m-gold">#1</span></div>
            </div>
        `,
        callouts: [
            { x: 78, y: 28, text: 'A+ unlocks Chief Risk Officer route' }
        ]
    }
];

export class HowToPlayScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.currentStep = 0;
        this.fromAutoShow = false;
        this.returnScreen = 'title';
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active howtoplay-screen';
        this.el.innerHTML = this.buildHTML();
        return this.el;
    }

    buildHTML() {
        const step = STEPS[this.currentStep];
        const total = STEPS.length;
        const isLast = this.currentStep === total - 1;
        const isFirst = this.currentStep === 0;

        const dots = STEPS.map((_, i) =>
            `<span class="guide-dot ${i === this.currentStep ? 'active' : ''}"></span>`
        ).join('');

        const callouts = (step.callouts || []).map(c => `
            <div class="guide-callout" style="left:${c.x}%;top:${c.y}%;">
                <div class="guide-callout-line"></div>
                <div class="guide-callout-text">${c.text}</div>
            </div>
        `).join('');

        return `
            <div class="guide-container">
                <div class="guide-header">
                    <div class="pixel-text guide-step-counter">STEP ${this.currentStep + 1} OF ${total}</div>
                    <button class="btn guide-skip-btn" id="guide-skip">SKIP</button>
                </div>

                <div class="guide-step">
                    <h2 class="pixel-text guide-step-title">${step.title}</h2>
                    <p class="readable-text guide-step-blurb">${step.blurb}</p>

                    <div class="guide-mockup-wrap">
                        <div class="guide-mockup">
                            ${step.mockup()}
                            ${callouts}
                        </div>
                    </div>
                </div>

                <div class="guide-footer">
                    <button class="btn" id="guide-back" ${isFirst ? 'disabled' : ''}>BACK</button>
                    <div class="guide-dots">${dots}</div>
                    <button class="btn btn-gold" id="guide-next">${isLast ? 'START GAME' : 'NEXT'}</button>
                </div>
            </div>
        `;
    }

    rerender() {
        this.el.innerHTML = this.buildHTML();
        this.bindStepButtons();
    }

    bindStepButtons() {
        this.el.querySelector('#guide-back').addEventListener('click', () => {
            if (this.currentStep > 0) {
                this.currentStep--;
                soundFX.click();
                this.rerender();
            }
        });

        this.el.querySelector('#guide-next').addEventListener('click', () => {
            soundFX.click();
            if (this.currentStep < STEPS.length - 1) {
                this.currentStep++;
                this.rerender();
            } else {
                this.finish();
            }
        });

        this.el.querySelector('#guide-skip').addEventListener('click', () => {
            soundFX.click();
            this.finish(true);
        });
    }

    finish(skipped = false) {
        markGuideSeen();
        if (skipped && this.fromAutoShow) {
            this.app.showToast('Guide skipped — find it on the title screen', 'info', 2500);
        }
        this.app.showScreen(this.returnScreen);
    }

    mount() {
        this.bindStepButtons();
    }

    unmount() {
        this.fromAutoShow = false;
        this.returnScreen = 'title';
        this.currentStep = 0;
    }
}
