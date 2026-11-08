// Career mode was removed in v3 (ruling R5); its engine is gone. This no-op stub only keeps the
// remaining importers (main.js, TitleScreen.js, LevelCompleteScreen.js) loading until stream B
// removes them. B1 deletes this file. Nothing here changes game state.
export const careerEngine = Object.freeze({
    careerActive: false,
    async loadLevels() {},
    reset() {},
    startCareer() {}
});
