// In-memory stand-in for DynamoDBDocumentClient.send(). Supports only what the handlers use.
// schema: { TableName: { pk, sk?, indexes?: { IndexName: { pk, sk } } } }
export function createFakeDdb(schema) {
    const tables = {};
    for (const name of Object.keys(schema)) tables[name] = new Map();
    const keyOf = (def, item) => def.sk ? `${item[def.pk]}\u0000${item[def.sk]}` : String(item[def.pk]);

    function table(name) {
        if (!schema[name]) throw new Error(`Unknown table ${name}`);
        return { def: schema[name], rows: tables[name] };
    }

    function resolve(token, names) { return names?.[token] ?? token; }

    function parseKeyCondition(expr, names, values) {
        const conds = expr.split(/\s+AND\s+/i).map(part => {
            const m = part.trim().match(/^(#?\w+)\s*(=|>=|<=|>|<)\s*(:\w+)$/);
            if (!m) throw new Error(`Unsupported KeyConditionExpression: ${part}`);
            return { attr: resolve(m[1], names), op: m[2], value: values[m[3]] };
        });
        return conds;
    }

    function cmp(a, op, b) {
        switch (op) {
            case '=': return a === b;
            case '>': return a > b;
            case '<': return a < b;
            case '>=': return a >= b;
            case '<=': return a <= b;
        }
    }

    function matchesFilter(item, expr, names, values) {
        if (!expr) return true;
        return parseKeyCondition(expr, names, values).every(c => cmp(item[c.attr], c.op, c.value));
    }

    // Supports `attribute_not_exists(x)` and `x <op> :v` terms joined by OR.
    function conditionOk(existing, expr, names, values) {
        if (!expr) return true;
        return expr.split(/\s+OR\s+/i).some(term => {
            const ne = term.trim().match(/^attribute_not_exists\((#?\w+)\)$/);
            if (ne) return !(existing && resolve(ne[1], names) in existing);
            const cm = term.trim().match(/^(#?\w+)\s*(=|>=|<=|>|<)\s*(:\w+)$/);
            if (!cm) throw new Error(`Unsupported ConditionExpression: ${term}`);
            const attr = resolve(cm[1], names);
            return !!existing && attr in existing && cmp(existing[attr], cm[2], values[cm[3]]);
        });
    }

    function splitTopLevel(str) {
        const parts = [];
        let depth = 0, cur = '';
        for (const ch of str) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
        }
        if (cur.trim()) parts.push(cur.trim());
        return parts;
    }

    // Supports SET (plain value or if_not_exists) and ADD (number or Set) clauses.
    function applyUpdate(item, expr, names, values) {
        const clauses = [...expr.matchAll(/(SET|ADD)\s+(.*?)(?=\s+(?:SET|ADD)\s+|$)/gi)];
        if (!clauses.length) throw new Error(`Unsupported UpdateExpression: ${expr}`);
        for (const [, verb, body] of clauses) {
            for (const part of splitTopLevel(body)) {
                if (verb.toUpperCase() === 'SET') {
                    const m = part.match(/^(#?\w+)\s*=\s*(?:(:\w+)|if_not_exists\(\s*(#?\w+)\s*,\s*(:\w+)\s*\))$/);
                    if (!m) throw new Error(`Unsupported SET: ${part}`);
                    const attr = resolve(m[1], names);
                    if (m[2]) item[attr] = values[m[2]];
                    else if (!(resolve(m[3], names) in item)) item[attr] = values[m[4]];
                } else {
                    const m = part.match(/^(#?\w+)\s+(:\w+)$/);
                    if (!m) throw new Error(`Unsupported ADD: ${part}`);
                    const attr = resolve(m[1], names);
                    const v = values[m[2]];
                    if (v instanceof Set) item[attr] = new Set([...(item[attr] || []), ...v]);
                    else item[attr] = (item[attr] || 0) + v;
                }
            }
        }
    }

    async function send(command) {
        const kind = command.constructor.name;
        const input = command.input;
        const { def, rows } = table(input.TableName);

        if (kind === 'GetCommand') {
            const item = rows.get(keyOf(def, input.Key));
            return { Item: item ? { ...item } : undefined };
        }

        if (kind === 'PutCommand') {
            const key = keyOf(def, input.Item);
            if (!conditionOk(rows.get(key), input.ConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues)) {
                const err = new Error('The conditional request failed');
                err.name = 'ConditionalCheckFailedException';
                throw err;
            }
            rows.set(key, { ...input.Item });
            return {};
        }

        if (kind === 'UpdateCommand') {
            const key = keyOf(def, input.Key);
            const item = { ...(rows.get(key) || input.Key) };
            applyUpdate(item, input.UpdateExpression || '', input.ExpressionAttributeNames, input.ExpressionAttributeValues);
            rows.set(key, item);
            return {};
        }

        if (kind === 'ScanCommand') {
            const items = [...rows.values()].map(i => ({ ...i }));
            return { Items: items, Count: items.length };
        }

        if (kind === 'QueryCommand') {
            const idx = input.IndexName ? def.indexes?.[input.IndexName] : def;
            if (!idx) throw new Error(`Unknown index ${input.IndexName}`);
            const conds = parseKeyCondition(input.KeyConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
            let items = [...rows.values()].filter(i => conds.every(c => cmp(i[c.attr], c.op, c.value)));
            if (idx.sk) {
                items.sort((a, b) => (a[idx.sk] > b[idx.sk] ? 1 : a[idx.sk] < b[idx.sk] ? -1 : 0));
                if (input.ScanIndexForward === false) items.reverse();
            }
            if (input.FilterExpression) {
                items = items.filter(i => matchesFilter(i, input.FilterExpression.replace(/\s+AND\s+/gi, ' AND '),
                    input.ExpressionAttributeNames, input.ExpressionAttributeValues));
            }
            if (input.Limit) items = items.slice(0, input.Limit);
            if (input.Select === 'COUNT') return { Count: items.length };
            return { Items: items.map(i => ({ ...i })), Count: items.length };
        }

        throw new Error(`Unsupported command ${kind}`);
    }

    return { send, tables };
}
