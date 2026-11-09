import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadJson(relPath) {
    return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

function stripMeta(data) {
    const { _meta, ...rest } = data;
    return rest;
}

export function loadMarketData() {
    return {
        fx: stripMeta(loadJson('data/market/fx-monthly.json')),
        rates: stripMeta(loadJson('data/market/rates-monthly.json')),
        commodities: stripMeta(loadJson('data/market/commodities-monthly.json'))
    };
}

export function loadIndustries() {
    return loadJson('data/industries.json').industries;
}
