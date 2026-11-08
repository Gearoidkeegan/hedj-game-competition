// Tiny DOM builder for the v3 Simple screens. Text goes in through textContent only, so player-supplied strings
// (names, companies) can never be parsed as HTML (R7).
//
//   h('button', { class: 'btn', type: 'button', text: 'RUN', on: { click: fn } }, child, 'text', [more])
//
// Props: class, text, on {event: fn}, disabled/hidden (booleans, set as properties), anything else as an attribute
// (true -> empty attribute; null/undefined/false -> skipped).
export function h(tag, props = {}, ...children) {
    const doc = globalThis.document;
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = String(v);
        else if (k === 'on') for (const [type, fn] of Object.entries(v)) el.addEventListener(type, fn);
        else if (k === 'disabled' || k === 'hidden') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
    }
    return el;
}
