// MiniChart — pixel-art sparkline charts for inline data visualisation
// Renders small bar/line charts directly into a container element

export class MiniChart {

    /**
     * Render a bar sparkline into a container.
     * @param {HTMLElement} container - element to render into
     * @param {number[]} data - array of values
     * @param {object} [opts]
     * @param {number} [opts.width=120] - chart width in px
     * @param {number} [opts.height=32] - chart height in px
     * @param {number} [opts.barWidth=4] - width of each bar
     * @param {number} [opts.gap=1] - gap between bars
     * @param {string} [opts.positiveColor='#33cc66']
     * @param {string} [opts.negativeColor='#ff4444']
     * @param {string} [opts.neutralColor='#88aacc']
     * @param {boolean} [opts.showZeroLine=true]
     */
    static bar(container, data, opts = {}) {
        if (!container || !data || data.length === 0) return;

        const width = opts.width || Math.max(120, data.length * 6);
        const height = opts.height || 32;
        const barWidth = opts.barWidth || 4;
        const gap = opts.gap || 1;
        const posColor = opts.positiveColor || '#33cc66';
        const negColor = opts.negativeColor || '#ff4444';
        const neuColor = opts.neutralColor || '#88aacc';
        const showZero = opts.showZeroLine !== false;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.imageRendering = 'pixelated';
        canvas.className = 'mini-chart-canvas';

        const ctx = canvas.getContext('2d');

        const maxAbs = Math.max(...data.map(Math.abs), 0.001);
        const midY = height / 2;

        // Zero line
        if (showZero) {
            ctx.strokeStyle = 'rgba(136, 170, 204, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(width, midY);
            ctx.stroke();
        }

        // Bars
        const totalBarSpace = barWidth + gap;
        const startX = Math.max(0, width - data.length * totalBarSpace);

        data.forEach((val, i) => {
            const x = startX + i * totalBarSpace;
            const barH = (Math.abs(val) / maxAbs) * (midY - 2);

            if (val > 0) {
                ctx.fillStyle = posColor;
                ctx.fillRect(x, midY - barH, barWidth, barH);
            } else if (val < 0) {
                ctx.fillStyle = negColor;
                ctx.fillRect(x, midY, barWidth, barH);
            } else {
                ctx.fillStyle = neuColor;
                ctx.fillRect(x, midY - 1, barWidth, 2);
            }
        });

        container.innerHTML = '';
        container.appendChild(canvas);
    }

    /**
     * Render a line sparkline into a container.
     * @param {HTMLElement} container
     * @param {number[]} data
     * @param {object} [opts]
     * @param {number} [opts.width=120]
     * @param {number} [opts.height=32]
     * @param {string} [opts.lineColor='#44ccdd']
     * @param {string} [opts.fillColor] - optional area fill below line
     * @param {number} [opts.lineWidth=2]
     */
    static line(container, data, opts = {}) {
        if (!container || !data || data.length < 2) return;

        const width = opts.width || Math.max(120, data.length * 8);
        const height = opts.height || 32;
        const lineColor = opts.lineColor || '#44ccdd';
        const fillColor = opts.fillColor || null;
        const lineW = opts.lineWidth || 2;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.imageRendering = 'auto'; // Lines look better without pixelation
        canvas.className = 'mini-chart-canvas';

        const ctx = canvas.getContext('2d');

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const padding = 2;

        const xStep = (width - padding * 2) / (data.length - 1);

        const getY = (val) => {
            return padding + (height - padding * 2) * (1 - (val - min) / range);
        };

        // Area fill
        if (fillColor) {
            ctx.beginPath();
            ctx.moveTo(padding, getY(data[0]));
            data.forEach((val, i) => {
                ctx.lineTo(padding + i * xStep, getY(val));
            });
            ctx.lineTo(padding + (data.length - 1) * xStep, height - padding);
            ctx.lineTo(padding, height - padding);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        }

        // Line
        ctx.beginPath();
        ctx.moveTo(padding, getY(data[0]));
        data.forEach((val, i) => {
            ctx.lineTo(padding + i * xStep, getY(val));
        });
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineW;
        ctx.stroke();

        // End dot
        const lastX = padding + (data.length - 1) * xStep;
        const lastY = getY(data[data.length - 1]);
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();

        container.innerHTML = '';
        container.appendChild(canvas);
    }

    /**
     * Render an inline satisfaction gauge.
     * @param {HTMLElement} container
     * @param {number[]} data - satisfaction values over time
     * @param {object} [opts]
     */
    static satisfaction(container, data, opts = {}) {
        MiniChart.line(container, data, {
            width: opts.width || 120,
            height: opts.height || 24,
            lineColor: data[data.length - 1] >= 50 ? '#33cc66' : data[data.length - 1] >= 25 ? '#ffcc00' : '#ff4444',
            fillColor: 'rgba(68, 204, 221, 0.1)',
            lineWidth: 2
        });
    }
}
