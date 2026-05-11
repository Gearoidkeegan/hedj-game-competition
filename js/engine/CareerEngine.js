// CareerEngine — manages career mode level progression, parameter scaling, and score gates

import { gameState } from './GameState.js';
import { bankEngine } from './BankEngine.js';
import { eventEngine } from './EventEngine.js';
import { boardAI } from './BoardAI.js';
import { GAME_CONFIG, HEDGING_POLICY_TYPES } from '../utils/constants.js';

class CareerEngineController {
    constructor() {
        this.levelsData = null;
        this.currentLevel = 0;       // 0-indexed (level 1 = index 0)
        this.careerActive = false;
        this.levelScores = [];        // Score per completed level
        this.levelIndustries = [];    // Industry used per level
    }

    /**
     * Load career level definitions. Call once at app startup.
     */
    async loadLevels(basePath = 'data') {
        try {
            const resp = await fetch(`${basePath}/career-levels.json`);
            const data = await resp.json();
            this.levelsData = data.careerLevels || [];
            console.log(`CareerEngine: loaded ${this.levelsData.length} levels`);
        } catch (e) {
            console.warn('CareerEngine: could not load levels', e);
            this.levelsData = [];
        }
    }

    /**
     * Start a new career.
     */
    startCareer() {
        this.currentLevel = 0;
        this.careerActive = true;
        this.levelScores = [];
        this.levelIndustries = [];
    }

    /**
     * Get the current career level definition.
     */
    getCurrentLevel() {
        if (!this.levelsData || this.currentLevel >= this.levelsData.length) return null;
        return this.levelsData[this.currentLevel];
    }

    /**
     * Get all level definitions (for UI display).
     */
    getAllLevels() {
        return this.levelsData || [];
    }

    /**
     * Get career progress summary.
     */
    getProgress() {
        return {
            currentLevel: this.currentLevel,
            totalLevels: this.levelsData?.length || 5,
            levelScores: [...this.levelScores],
            levelIndustries: [...this.levelIndustries],
            careerActive: this.careerActive
        };
    }

    /**
     * Apply career level parameters to an industry template.
     * Scales exposures, cash, revenue, board members based on level config.
     * @param {object} industry - base industry template from industries.json
     * @param {object} rng - SeededRandom
     * @returns {object} modified industry for this career level
     */
    applyLevelParameters(industry, rng) {
        const level = this.getCurrentLevel();
        if (!level) return industry;

        const params = level.parameters;
        const modified = JSON.parse(JSON.stringify(industry));

        // Scale revenue and cash
        modified.annualRevenue = Math.round(industry.annualRevenue * params.revenueMultiplier);
        modified.startingCash = Math.round(industry.startingCash * params.cashMultiplier);

        // Limit exposures to maxExposures
        if (modified.exposures.length > params.maxExposures) {
            // Keep the first N exposures (they're ordered by importance in industries.json)
            modified.exposures = modified.exposures.slice(0, params.maxExposures);
        }

        // Scale exposure notionals proportionally to revenue
        for (const exp of modified.exposures) {
            exp.quarterlyNotional = Math.round(exp.quarterlyNotional * params.revenueMultiplier);
            if (exp.notional) {
                exp.notional = Math.round(exp.notional * params.revenueMultiplier);
            }
            if (exp.physicalNotional) {
                exp.physicalNotional = Math.round(exp.physicalNotional * params.revenueMultiplier);
            }
        }

        // PE takeover: double IR exposure
        if (params.irExposureMultiplier) {
            for (const exp of modified.exposures) {
                if (exp.type === 'ir') {
                    exp.quarterlyNotional = Math.round(exp.quarterlyNotional * params.irExposureMultiplier);
                    if (exp.notional) {
                        exp.notional = Math.round(exp.notional * params.irExposureMultiplier);
                    }
                }
            }
        }

        // Override board members if specified
        if (level.boardPersonalities?.override) {
            modified.boardMembers = level.boardPersonalities.override;
        }

        return modified;
    }

    /**
     * Get game config overrides for the current career level.
     * Returns partial config to merge with GAME_CONFIG.
     */
    getConfigOverrides() {
        const level = this.getCurrentLevel();
        if (!level) return {};

        const params = level.parameters;
        return {
            DEFAULT_QUARTERS: level.quarters,
            STARTING_SATISFACTION: params.satisfactionStart,
            // These are used by BoardAI to scale satisfaction changes
            _satisfactionLossMultiplier: params.satisfactionLossMultiplier,
            _satisfactionGainMultiplier: params.satisfactionGainMultiplier,
            _eventFrequency: params.eventFrequency,
            _maxHedgeQuarters: params.maxHedgeQuarters
        };
    }

    /**
     * Initialize a career level game.
     * Sets up bank counterparties and other level-specific state.
     * @param {object} industry - the modified industry template
     * @param {object} rng - SeededRandom
     */
    initLevel(industry, rng) {
        const level = this.getCurrentLevel();
        if (!level) return;

        const params = level.parameters;

        // Initialize banks
        const creditLimit = Math.round(industry.annualRevenue * params.creditLimitMultiplier);
        bankEngine.init(params.startingBanks, creditLimit, rng);

        // Reset event engine
        eventEngine.reset();

        // Assign CEO persona
        boardAI.assignCEOPersona(rng);

        // Resolve hedging policy for this career level
        const policyId = params.policyId || 'none';
        const policy = HEDGING_POLICY_TYPES.find(p => p.id === policyId) || HEDGING_POLICY_TYPES[0];

        // Store career metadata in game state
        gameState.update({
            careerMode: true,
            careerLevel: this.currentLevel + 1,
            careerLevelName: level.name,
            maxQuarters: level.quarters,
            boardSatisfaction: params.satisfactionStart,
            hedgingPolicy: policy,
            // Store multipliers for BoardAI to use
            satisfactionLossMultiplier: params.satisfactionLossMultiplier || 1.0,
            satisfactionGainMultiplier: params.satisfactionGainMultiplier || 1.0
        });
    }

    /**
     * Check if the player has passed the current level.
     * @param {number} finalScore - the player's score for this level
     * @returns {{ passed: boolean, scoreToAdvance: number, isLastLevel: boolean, specialOutcome: object|null }}
     */
    evaluateLevel(finalScore) {
        const level = this.getCurrentLevel();
        if (!level) return { passed: false, scoreToAdvance: 0, isLastLevel: true };

        const scoreToAdvance = level.scoreToAdvance;
        const isLastLevel = this.currentLevel >= this.levelsData.length - 1;
        const passed = isLastLevel ? true : finalScore >= scoreToAdvance;

        // Check for special outcomes (e.g., Treasury Manager of the Year)
        let specialOutcome = null;
        if (isLastLevel && level.specialOutcomes?.aPlusGrade && finalScore >= 90) {
            specialOutcome = level.specialOutcomes.aPlusGrade;
        }

        return {
            passed,
            scoreToAdvance: scoreToAdvance || 0,
            isLastLevel,
            specialOutcome
        };
    }

    /**
     * Record level completion and advance to next level.
     * @param {number} score - the player's score
     * @param {string} industryId - industry used
     */
    advanceLevel(score, industryId) {
        this.levelScores.push(score);
        this.levelIndustries.push(industryId);
        this.currentLevel++;
    }

    /**
     * Get the flavour text for the current level outcome.
     * @param {boolean} passed
     * @returns {string}
     */
    getFlavourText(passed) {
        const level = this.getCurrentLevel();
        if (!level) return '';

        if (passed) {
            return level.flavourText?.advance || 'Level complete. Moving on...';
        }
        return level.flavourText?.fail || 'Better luck next time.';
    }

    /**
     * Get intro text for the current level.
     */
    getIntroText() {
        const level = this.getCurrentLevel();
        return level?.flavourText?.intro || '';
    }

    /**
     * Calculate overall career score (average of all level scores).
     */
    getCareerScore() {
        if (this.levelScores.length === 0) return 0;
        return this.levelScores.reduce((sum, s) => sum + s, 0) / this.levelScores.length;
    }

    /**
     * Is the career complete (all levels done or failed)?
     */
    isCareerComplete() {
        return this.currentLevel >= this.levelsData.length;
    }

    /**
     * Reset for a new career.
     */
    reset() {
        this.currentLevel = 0;
        this.careerActive = false;
        this.levelScores = [];
        this.levelIndustries = [];
    }
}

// Singleton
export const careerEngine = new CareerEngineController();
