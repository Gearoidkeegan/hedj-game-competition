// Admin page logic, moved out of admin.html so the page works under the CSP's script-src 'self' (no inline
// script, no on*= handlers). Behaviour is unchanged from the inline version.
// initAdmin takes its browser dependencies as optional arguments so Node tests can drive it with a fake DOM.

const API = '/api';

export function initAdmin(env = {}) {
    const doc = env.document ?? globalThis.document;
    const fetchFn = env.fetch ?? ((...a) => globalThis.fetch(...a));
    const storage = env.sessionStorage ?? (() => { try { return globalThis.sessionStorage; } catch { return null; } })();
    const alertFn = env.alert ?? ((m) => globalThis.alert(m));
    const BlobCtor = env.Blob ?? globalThis.Blob;
    const urlApi = env.URL ?? globalThis.URL;
    const $ = id => doc.getElementById(id);

    let adminKey = '';
    let playersData = [];

    function getStoredKey() {
        try { return storage.getItem('hedj_admin_key') || ''; } catch { return ''; }
    }

    function storeKey(k) {
        try { storage.setItem('hedj_admin_key', k); } catch {}
    }

    async function login() {
        const input = $('admin-key-input');
        const key = input.value.trim();
        if (!key) return;
        adminKey = key;
        storeKey(key);
        await loadAll();
    }

    async function apiFetch(path, headers = {}) {
        const res = await fetchFn(API + path, {
            headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...headers }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function loadAll() {
        const authMsg = $('auth-msg');
        authMsg.style.display = 'none';
        try {
            const [analyticsData, playersResult, metrics] = await Promise.all([
                apiFetch('/analytics'),
                apiFetch('/admin/players'),
                apiFetch('/admin/metrics').catch(err => (/40[13]/.test(err.message) ? Promise.reject(err) : {}))
            ]);

            // Unlock UI
            $('auth-section').style.display = 'none';
            $('data-section').style.display = 'block';

            // Stats
            const counts = analyticsData.counts || {};
            $('stat-visits').textContent = (counts.visit || 0).toLocaleString();
            $('stat-plays').textContent = (counts.play || 0).toLocaleString();

            const pct = n => Math.round((n || 0) * 100) + '%';
            $('m-unique').textContent = (metrics.uniquePlayers || 0).toLocaleString();
            $('m-runs').textContent = (metrics.runsPerPlayer || 0).toFixed(1);
            $('m-return').textContent = pct(metrics.returnRate);
            $('m-multiday').textContent = pct(metrics.multiDayRate);

            // Players
            playersData = playersResult.players || [];
            $('stat-regs').textContent = playersData.length.toLocaleString();
            renderPlayers(playersData);

        } catch (err) {
            if (err.message.includes('401') || err.message.includes('403')) {
                authMsg.textContent = 'INVALID ADMIN KEY';
            } else {
                authMsg.textContent = 'ERROR: ' + err.message;
            }
            authMsg.style.display = 'block';
            adminKey = '';
            storeKey('');
        }
    }

    function renderPlayers(players) {
        const tbody = $('players-tbody');
        const msg = $('players-msg');
        const wrap = $('players-table-wrap');
        const badge = $('player-count');

        badge.textContent = players.length + ' PLAYERS';

        if (players.length === 0) {
            msg.textContent = 'NO REGISTRATIONS YET';
            msg.className = 'msg empty';
            msg.style.display = 'block';
            wrap.style.display = 'none';
            return;
        }

        msg.style.display = 'none';
        wrap.style.display = 'block';

        tbody.innerHTML = players.map((p, i) => `
            <tr>
                <td class="muted">${i + 1}</td>
                <td>${esc(p.playerName)}</td>
                <td>${esc(p.email)}</td>
                <td>${esc(p.company)}</td>
                <td class="muted">${formatDate(p.registeredAt)}</td>
                <td style="color:${p.marketingConsent ? 'var(--pnl-positive)' : 'var(--text-muted)'}">
                    ${p.marketingConsent ? 'YES' : 'no'}
                </td>
            </tr>
        `).join('');
    }

    function saveFile(text, filename) {
        const url = urlApi.createObjectURL(new BlobCtor([text], { type: 'text/csv' }));
        const a = doc.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        urlApi.revokeObjectURL(url);
    }

    function downloadCSV() {
        if (!playersData.length) return;
        const csvEscape = v => `"${(v || '').replace(/"/g, '""')}"`;
        const rows = [
            'Name,Email,Company,Registered At,Marketing Consent',
            ...playersData.map(p =>
                [p.playerName, p.email, p.company, p.registeredAt, p.marketingConsent ? 'Yes' : 'No'].map(csvEscape).join(','))
        ].join('\r\n');
        saveFile(rows, `players-${new Date().toISOString().slice(0, 10)}.csv`);
    }

    // The prize export needs the admin key header, so fetch it and save the response as a file.
    async function downloadPrize(mode, period) {
        if (!adminKey) return;
        try {
            const res = await fetchFn(`${API}/admin/prize?mode=${mode}&period=${period}&limit=10`, { headers: { 'x-admin-key': adminKey } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            saveFile(await res.text(), `prize-${mode}-${period}-${new Date().toISOString().slice(0, 10)}.csv`);
        } catch (err) {
            alertFn('Prize export failed: ' + err.message);
        }
    }

    function refresh() {
        if (!adminKey) return;
        $('stat-visits').textContent = '—';
        $('stat-plays').textContent = '—';
        $('stat-regs').textContent = '—';
        $('players-msg').textContent = 'LOADING...';
        $('players-msg').className = 'msg loading';
        $('players-msg').style.display = 'block';
        $('players-table-wrap').style.display = 'none';
        return loadAll();
    }

    // Wiring (these were inline handler attributes in admin.html)
    $('admin-key-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
    });
    $('btn-login').addEventListener('click', () => login());
    $('btn-download-csv').addEventListener('click', () => downloadCSV());
    $('btn-refresh').addEventListener('click', () => refresh());
    for (const btn of doc.querySelectorAll('[data-prize-mode]')) {
        btn.addEventListener('click', () => downloadPrize(btn.getAttribute('data-prize-mode'), btn.getAttribute('data-prize-period')));
    }

    // Auto-unlock if key is stored in session
    let ready = Promise.resolve();
    const storedKey = getStoredKey();
    if (storedKey) {
        adminKey = storedKey;
        $('admin-key-input').value = storedKey;
        ready = loadAll();
    }

    return { ready, login, refresh, downloadCSV, downloadPrize };
}

function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('en-IE', {
            dateStyle: 'short', timeStyle: 'short'
        });
    } catch { return iso; }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initAdmin();
