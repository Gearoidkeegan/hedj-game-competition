// Registration gate for competition prize eligibility
// Shown before SetupScreen when no valid game token is stored

import { register } from '../utils/api.js';
import { saveRegistration, getRegistration, clearRegistration } from '../utils/storage.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RegistrationScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active registration-screen';

        const existing = getRegistration();
        const prefillName = existing?.playerName || '';
        const prefillEmail = existing?.email || '';
        const prefillCompany = existing?.company || '';

        this.el.innerHTML = `
            <div class="registration-wrap">
                <div class="reg-logo">
                    <img src="assets/images/hedj-logo.png" alt="Hedj" style="width:64px;height:auto;display:block;margin:0 auto 8px;image-rendering:auto;" />
                    <div class="pixel-text" style="font-size:8px;color:var(--gold);letter-spacing:2px;">TREASURY MANAGER SIMULATOR</div>
                </div>

                <div class="reg-panel">
                    <div class="reg-title pixel-text">COMPETITION REGISTRATION</div>
                    <div class="reg-subtitle readable-text">Enter your details to be eligible for prizes.</div>

                    <div class="reg-fields">
                        <div class="reg-field">
                            <label class="pixel-text" for="reg-name">FULL NAME *</label>
                            <input id="reg-name" class="text-input" type="text" maxlength="60"
                                placeholder="e.g. Jane Smith" value="${escapeHtml(prefillName)}" autocomplete="name" />
                        </div>
                        <div class="reg-field">
                            <label class="pixel-text" for="reg-email">EMAIL ADDRESS *</label>
                            <input id="reg-email" class="text-input" type="email" maxlength="120"
                                placeholder="jane@company.com" value="${escapeHtml(prefillEmail)}" autocomplete="email" />
                        </div>
                        <div class="reg-field">
                            <label class="pixel-text" for="reg-company">COMPANY *</label>
                            <input id="reg-company" class="text-input" type="text" maxlength="80"
                                placeholder="Acme Corp" value="${escapeHtml(prefillCompany)}" autocomplete="organization" />
                        </div>

                        <div class="reg-consent">
                            <label class="reg-consent-label">
                                <input id="reg-consent" type="checkbox" />
                                <span class="readable-text" style="font-size:12px;">
                                    I agree that Hedj may store my contact details to administer this competition
                                    and contact me if I win. Data will be deleted within 90 days of the competition
                                    closing. See our <a href="https://www.hedj.eu/privacy" target="_blank" rel="noopener"
                                    style="color:var(--cyan);">privacy policy</a>.
                                </span>
                            </label>
                        </div>

                        <div id="reg-error" class="reg-error" style="display:none;"></div>

                        <button id="reg-submit" class="btn btn-gold" style="width:100%;margin-top:8px;">
                            REGISTER &amp; PLAY
                        </button>
                    </div>

                    <div class="reg-already" style="margin-top:16px;text-align:center;">
                        <button id="reg-switch" class="btn" style="font-size:11px;min-height:28px;padding:4px 12px;color:var(--text-muted);">
                            Already registered? Play as someone else
                        </button>
                    </div>
                </div>
            </div>
        `;

        return this.el;
    }

    mount() {
        const submitBtn = this.el.querySelector('#reg-submit');
        const switchBtn = this.el.querySelector('#reg-switch');

        submitBtn.addEventListener('click', () => this.handleSubmit());

        // Allow Enter key to submit
        this.el.querySelectorAll('.text-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.handleSubmit();
            });
        });

        switchBtn.addEventListener('click', () => {
            clearRegistration();
            this.el.querySelector('#reg-name').value = '';
            this.el.querySelector('#reg-email').value = '';
            this.el.querySelector('#reg-company').value = '';
            this.el.querySelector('#reg-consent').checked = false;
            this.el.querySelector('#reg-name').focus();
        });

        // Focus first empty field
        const nameInput = this.el.querySelector('#reg-name');
        if (!nameInput.value) nameInput.focus();
        else this.el.querySelector('#reg-email').focus();
    }

    unmount() {}

    async handleSubmit() {
        const name = this.el.querySelector('#reg-name').value.trim();
        const email = this.el.querySelector('#reg-email').value.trim();
        const company = this.el.querySelector('#reg-company').value.trim();
        const consent = this.el.querySelector('#reg-consent').checked;

        const error = this.validate(name, email, company, consent);
        if (error) {
            this.showError(error);
            return;
        }

        const btn = this.el.querySelector('#reg-submit');
        btn.disabled = true;
        btn.textContent = 'REGISTERING...';
        this.showError(null);

        try {
            const result = await register(name, email, company);
            saveRegistration({
                playerName: name,
                email,
                company,
                gameToken: result.gameToken,
                gameTokenExpiry: result.expiresAt
            });
            this.app.showScreen('setup');
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'REGISTER & PLAY';
            const msg = err.status === 400
                ? err.message
                : 'Could not connect — check your connection and try again.';
            this.showError(msg);
        }
    }

    validate(name, email, company, consent) {
        if (!name) return 'Full name is required';
        if (!email || !EMAIL_RE.test(email)) return 'A valid email address is required';
        if (!company) return 'Company name is required';
        if (!consent) return 'You must agree to the data processing terms to register';
        return null;
    }

    showError(msg) {
        const el = this.el.querySelector('#reg-error');
        if (!msg) {
            el.style.display = 'none';
            el.textContent = '';
        } else {
            el.style.display = 'block';
            el.textContent = msg;
        }
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
