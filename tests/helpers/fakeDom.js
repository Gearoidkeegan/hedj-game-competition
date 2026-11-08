// A minimal fake DOM for Node tests of the Simple-mode screens and widgets.
// Supports what the UI code uses: createElement/createTextNode, appendChild/append/replaceChildren/remove,
// textContent, className/classList, attributes, a style object, disabled/hidden/tabIndex properties,
// add/removeEventListener + dispatchEvent/click/focus, and querySelector(All) for simple selectors
// (compound `tag.class#id[attr][attr="v"]`, joined by descendant spaces).
// No innerHTML parsing: the v3 screens build their DOM node by node, so player text is never parsed as HTML.

class FakeEvent {
    constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
        this.defaultPrevented = false;
        this.propagationStopped = false;
        this.target = null;
        this.currentTarget = null;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
}

class FakeNode {
    constructor(doc) {
        this.ownerDocument = doc;
        this.parentNode = null;
        this.childNodes = [];
        this.listeners = new Map();
    }
    get parentElement() { return this.parentNode; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get isConnected() {
        let n = this;
        while (n.parentNode) n = n.parentNode;
        return n === this.ownerDocument.body;
    }
    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }
    append(...nodes) {
        for (const n of nodes) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n);
    }
    insertBefore(child, ref) {
        if (!ref) return this.appendChild(child);
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.childNodes.splice(this.childNodes.indexOf(ref), 0, child);
        return child;
    }
    removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i >= 0) this.childNodes.splice(i, 1);
        child.parentNode = null;
        return child;
    }
    replaceChildren(...nodes) {
        for (const c of [...this.childNodes]) this.removeChild(c);
        this.append(...nodes);
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
    set textContent(v) {
        for (const c of [...this.childNodes]) this.removeChild(c);
        if (v !== '' && v !== null && v !== undefined) this.appendChild(this.ownerDocument.createTextNode(String(v)));
    }
    addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
        const list = this.listeners.get(type) || [];
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    }
    listenerCount(type) { return (this.listeners.get(type) || []).length; }
    dispatchEvent(event) {
        if (!event.target) event.target = this;
        let node = this;
        while (node && !event.propagationStopped) {
            event.currentTarget = node;
            for (const fn of [...(node.listeners.get(event.type) || [])]) fn.call(node, event);
            node = node.parentNode;
        }
        return !event.defaultPrevented;
    }
}

class FakeText extends FakeNode {
    constructor(doc, text) {
        super(doc);
        this.nodeType = 3;
        this.data = text;
    }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
}

class FakeClassList {
    constructor(el) { this.el = el; }
    _get() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    _set(list) { this.el.setAttribute('class', list.join(' ')); }
    contains(c) { return this._get().includes(c); }
    add(...cs) { const l = this._get(); for (const c of cs) if (!l.includes(c)) l.push(c); this._set(l); }
    remove(...cs) { this._set(this._get().filter(c => !cs.includes(c))); }
    toggle(c, force) {
        const on = force === undefined ? !this.contains(c) : !!force;
        if (on) this.add(c); else this.remove(c);
        return on;
    }
}

class FakeElement extends FakeNode {
    constructor(doc, tag) {
        super(doc);
        this.nodeType = 1;
        this.tagName = String(tag).toUpperCase();
        this.attributes = new Map();
        this.classList = new FakeClassList(this);
        this.style = {};
        this.disabled = false;
        this.hidden = false;
        this.tabIndex = -1;
        this.value = '';
        this.clientWidth = 0;
        this.clientHeight = 0;
        this.context = null;
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', String(v)); }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    hasAttribute(k) { return this.attributes.has(k); }
    removeAttribute(k) { this.attributes.delete(k); }
    set innerHTML(v) {
        // Only clearing is supported; anything else would hide unescaped HTML from the tests.
        if (v !== '') throw new Error('fakeDom: innerHTML with content is not supported');
        this.replaceChildren();
    }
    click() {
        if (this.disabled) return;
        this.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    }
    focus() { this.ownerDocument.activeElement = this; }
    getContext() { return this.context; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
    querySelectorAll(selector) {
        const parts = selector.trim().split(/\s+/).map(parseCompound);
        const out = [];
        const walk = (node) => {
            for (const c of node.children) {
                if (matchesChain(c, parts, this)) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    matches(selector) { return matchesChain(this, selector.trim().split(/\s+/).map(parseCompound), null); }
    closest(selector) {
        let n = this;
        while (n && n.nodeType === 1) {
            if (n.matches(selector)) return n;
            n = n.parentNode;
        }
        return null;
    }
}

function parseCompound(s) {
    const c = { tag: null, ids: [], classes: [], attrs: [] };
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
    let m;
    while ((m = re.exec(s))) {
        if (m[1]) c.tag = m[1].toUpperCase();
        else if (m[2]) c.ids.push(m[2]);
        else if (m[3]) c.classes.push(m[3]);
        else c.attrs.push({ name: m[4], value: m[5] });
    }
    return c;
}

function matchesCompound(el, c) {
    if (c.tag && el.tagName !== c.tag) return false;
    if (c.ids.some(id => el.id !== id)) return false;
    if (c.classes.some(cl => !el.classList.contains(cl))) return false;
    return c.attrs.every(a => el.hasAttribute(a.name) && (a.value === undefined || el.getAttribute(a.name) === a.value));
}

// The last part must match el; earlier parts must match ancestors, in order (descendant combinator).
function matchesChain(el, parts, root) {
    if (!matchesCompound(el, parts[parts.length - 1])) return false;
    let i = parts.length - 2;
    let n = el.parentNode;
    while (i >= 0 && n && n !== root) {
        if (n.nodeType === 1 && matchesCompound(n, parts[i])) i--;
        n = n.parentNode;
    }
    return i < 0;
}

export function createFakeDocument() {
    const doc = {
        activeElement: null,
        hidden: false,
        listeners: new Map(),
        createElement: (tag) => new FakeElement(doc, tag),
        createTextNode: (text) => new FakeText(doc, String(text)),
        getElementById: (id) => doc.body.querySelector(`#${id}`),
        addEventListener(type, fn) { (doc.listeners.get(type) || doc.listeners.set(type, []).get(type)).push(fn); },
        removeEventListener(type, fn) {
            const l = doc.listeners.get(type) || [];
            const i = l.indexOf(fn);
            if (i >= 0) l.splice(i, 1);
        }
    };
    doc.body = new FakeElement(doc, 'body');
    return doc;
}

// Installs a fresh fake document on globalThis (and a stub rAF that never fires). Returns { document, restore }.
export function installFakeDom() {
    const saved = {
        document: globalThis.document,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        cancelAnimationFrame: globalThis.cancelAnimationFrame
    };
    const document = createFakeDocument();
    globalThis.document = document;
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    return {
        document,
        restore() {
            for (const [k, v] of Object.entries(saved)) {
                if (v === undefined) delete globalThis[k];
                else globalThis[k] = v;
            }
        }
    };
}

export function key(el, k) {
    const e = new FakeEvent('keydown', { key: k, bubbles: true });
    el.dispatchEvent(e);
    return e;
}

export { FakeEvent };
