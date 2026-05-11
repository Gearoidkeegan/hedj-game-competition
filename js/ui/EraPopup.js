// EraPopup — wraps content in era-appropriate communication styling
// Based on hidden game year: fax (90s), Outlook (00s), BlackBerry (late 00s), Slack (10s), Teams (20s)

import { gameState } from '../engine/GameState.js';

export class EraPopup {

    /**
     * Get the current era identifier.
     */
    static getEra() {
        return gameState.getEra();
    }

    /**
     * Wrap event/message content in era-appropriate chrome.
     * @param {object} opts
     * @param {string} opts.title - Message subject/title
     * @param {string} opts.from - Sender name
     * @param {string} opts.body - HTML body content
     * @param {string} opts.category - Optional category badge
     * @param {string} [opts.era] - Override era (otherwise auto-detected)
     * @returns {string} HTML string
     */
    static wrap({ title, from, body, category, era }) {
        const currentEra = era || this.getEra();

        switch (currentEra) {
            case 'fax':
                return this.renderFax({ title, from, body, category });
            case 'outlook':
                return this.renderOutlook({ title, from, body, category });
            case 'blackberry':
                return this.renderBlackberry({ title, from, body, category });
            case 'slack-early':
                return this.renderSlack({ title, from, body, category });
            case 'teams':
                return this.renderTeams({ title, from, body, category });
            default:
                return this.renderOutlook({ title, from, body, category });
        }
    }

    /**
     * 1994-1999: Fax memo — dot-matrix font, paper texture, "FAX" header
     */
    static renderFax({ title, from, body, category }) {
        const date = this.getFormattedDate();
        return `
            <div class="era-popup era-fax">
                <div class="fax-header">
                    <div class="fax-banner">*** FACSIMILE TRANSMISSION ***</div>
                    <div class="fax-meta">
                        <div>TO: Treasury Department</div>
                        <div>FROM: ${from || 'Head Office'}</div>
                        <div>DATE: ${date}</div>
                        <div>RE: ${title}</div>
                        <div>PAGES: 1 of 1</div>
                    </div>
                    <div class="fax-line"></div>
                </div>
                <div class="fax-body">
                    ${category ? `<div class="fax-category">[${category.toUpperCase()}]</div>` : ''}
                    ${body}
                </div>
                <div class="fax-footer">
                    *** END OF TRANSMISSION ***
                </div>
            </div>
        `;
    }

    /**
     * 2000-2005: Outlook 2000 — blue/grey window, toolbar, RE: FW: RE: subject
     */
    static renderOutlook({ title, from, body, category }) {
        const date = this.getFormattedDate();
        const subject = `RE: FW: RE: ${title}`;
        return `
            <div class="era-popup era-outlook">
                <div class="outlook-titlebar">
                    <span class="outlook-title-text">${subject} — Message</span>
                    <div class="outlook-window-btns">
                        <span class="outlook-btn-min">_</span>
                        <span class="outlook-btn-max">□</span>
                        <span class="outlook-btn-close">X</span>
                    </div>
                </div>
                <div class="outlook-toolbar">
                    <span class="outlook-tool">Reply</span>
                    <span class="outlook-tool">Reply All</span>
                    <span class="outlook-tool">Forward</span>
                    <span class="outlook-tool-sep">|</span>
                    <span class="outlook-tool">Delete</span>
                </div>
                <div class="outlook-meta">
                    <div><strong>From:</strong> ${from || 'Head Office'}</div>
                    <div><strong>Sent:</strong> ${date}</div>
                    <div><strong>To:</strong> Treasury Manager</div>
                    <div><strong>Subject:</strong> ${subject}</div>
                    ${category ? `<div><strong>Priority:</strong> <span style="color:#cc0000;">High</span></div>` : ''}
                </div>
                <div class="outlook-body">
                    ${body}
                </div>
            </div>
        `;
    }

    /**
     * 2006-2011: BlackBerry — small screen, BB chrome, notification style
     */
    static renderBlackberry({ title, from, body, category }) {
        const time = this.getFormattedTime();
        return `
            <div class="era-popup era-blackberry">
                <div class="bb-statusbar">
                    <span class="bb-carrier">Vodafone UK</span>
                    <span class="bb-time">${time}</span>
                    <span class="bb-battery">■■■□</span>
                </div>
                <div class="bb-header">
                    <div class="bb-icon">✉</div>
                    <div class="bb-from">${from || 'Head Office'}</div>
                    ${category ? `<span class="bb-priority">!</span>` : ''}
                </div>
                <div class="bb-subject">${title}</div>
                <div class="bb-body">
                    ${body}
                </div>
                <div class="bb-footer">
                    Sent from my BlackBerry
                </div>
            </div>
        `;
    }

    /**
     * 2012-2017: Slack — flat design, channel name, notification badge
     */
    static renderSlack({ title, from, body, category }) {
        const time = this.getFormattedTime();
        const channel = category ? `#treasury-${category}` : '#treasury-general';
        return `
            <div class="era-popup era-slack">
                <div class="slack-header">
                    <span class="slack-channel">${channel}</span>
                    ${category ? `<span class="slack-badge">1</span>` : ''}
                </div>
                <div class="slack-message">
                    <div class="slack-avatar">${(from || 'HO')[0].toUpperCase()}</div>
                    <div class="slack-content">
                        <div class="slack-meta">
                            <span class="slack-sender">${from || 'Head Office'}</span>
                            <span class="slack-time">${time}</span>
                        </div>
                        <div class="slack-title">${title}</div>
                        <div class="slack-body">${body}</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 2018-2024: Teams — chat bubble, emoji reactions, "typing..." indicator
     */
    static renderTeams({ title, from, body, category }) {
        const time = this.getFormattedTime();
        return `
            <div class="era-popup era-teams">
                <div class="teams-header">
                    <span class="teams-channel-icon">👥</span>
                    <span class="teams-channel-name">Treasury Team</span>
                    <span class="teams-badge">${category ? '!' : ''}</span>
                </div>
                <div class="teams-chat">
                    <div class="teams-message">
                        <div class="teams-avatar">${(from || 'HO')[0].toUpperCase()}</div>
                        <div class="teams-bubble">
                            <div class="teams-meta">
                                <span class="teams-sender">${from || 'Head Office'}</span>
                                <span class="teams-time">${time}</span>
                            </div>
                            <div class="teams-subject">${title}</div>
                            <div class="teams-body">${body}</div>
                        </div>
                    </div>
                    <div class="teams-reactions">
                        <span class="teams-reaction">👀 2</span>
                        <span class="teams-reaction">😬 1</span>
                    </div>
                    <div class="teams-typing">
                        <span class="teams-typing-dots">...</span> CFO is typing
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Format a date string appropriate to the era.
     */
    static getFormattedDate() {
        const state = gameState.get();
        const year = state.startYear + (state.currentYearOffset || 0);
        const q = state.currentQuarter || 1;
        const months = ['January', 'April', 'July', 'October'];
        const days = [15, 12, 18, 9]; // Arbitrary mid-quarter days
        return `${days[q - 1]} ${months[q - 1]} ${year}`;
    }

    /**
     * Format a short time string.
     */
    static getFormattedTime() {
        const state = gameState.get();
        const rng = gameState.getRng();
        // Deterministic-ish time based on quarter
        const hour = 8 + ((state.totalQuartersPlayed * 3) % 9);
        const min = (state.totalQuartersPlayed * 17) % 60;
        return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
}
