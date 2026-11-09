import assert from 'node:assert/strict';

export const MAX_LEN = 90;

// Collects every string in a JSON value with its path, so failures name the offending entry.
export function allStrings(value, path = '$', out = []) {
    if (typeof value === 'string') out.push({ path, s: value });
    else if (Array.isArray(value)) value.forEach((v, i) => allStrings(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) allStrings(v, `${path}.${k}`, out);
    }
    return out;
}

// Asserts every string in a JSON value is non-empty and at most MAX_LEN characters.
export function assertLengths(data, file) {
    const strings = allStrings(data);
    assert.ok(strings.length > 0, `${file} has strings`);
    const empty = strings.filter(({ s }) => s.trim() === '').map(({ path }) => path);
    assert.deepEqual(empty, [], `${file} has no empty strings`);
    const tooLong = strings.filter(({ s }) => s.length > MAX_LEN).map(({ path, s }) => `${path} (${s.length})`);
    assert.deepEqual(tooLong, [], `${file} strings are <= ${MAX_LEN} characters`);
}

// Lists a JSON value's structure: every array as `path[length]` and every leaf as `path:type`.
export function jsonShape(value, path = '$', out = []) {
    if (Array.isArray(value)) {
        out.push(`${path}[${value.length}]`);
        value.forEach((v, i) => jsonShape(v, `${path}[${i}]`, out));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) jsonShape(v, `${path}.${k}`, out);
    } else {
        out.push(`${path}:${value === null ? 'null' : typeof value}`);
    }
    return out;
}
