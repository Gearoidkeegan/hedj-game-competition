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

    function conditionOk(existing, expr, names) {
        if (!expr) return true;
        const m = expr.match(/^attribute_not_exists\((#?\w+)\)$/);
        if (!m) throw new Error(`Unsupported ConditionExpression: ${expr}`);
        return !(existing && resolve(m[1], names) in existing);
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
            if (!conditionOk(rows.get(key), input.ConditionExpression, input.ExpressionAttributeNames)) {
                const err = new Error('The conditional request failed');
                err.name = 'ConditionalCheckFailedException';
                throw err;
            }
            rows.set(key, { ...input.Item });
            return {};
        }

        if (kind === 'UpdateCommand') {
            const key = keyOf(def, input.Key);
            const m = (input.UpdateExpression || '').match(/^ADD\s+(#?\w+)\s+(:\w+)$/);
            if (!m) throw new Error(`Unsupported UpdateExpression: ${input.UpdateExpression}`);
            const attr = resolve(m[1], input.ExpressionAttributeNames);
            const item = rows.get(key) || { ...input.Key };
            item[attr] = (item[attr] || 0) + input.ExpressionAttributeValues[m[2]];
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
