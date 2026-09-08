(function () {
    'use strict';

    // Галочка: открыть выделение как независимое плавающее окно.
    // Окно охватывает скриншот И панели (как они стоят сейчас), чтобы панели не обрезались.

    function getSideBarLayoutMode() {
        const sb = window.sideBar;
        if (!sb) return 'column';
        const fd = (sb.style.flexDirection || window.getComputedStyle(sb).flexDirection || 'column').toLowerCase();
        return (fd === 'row' || fd === 'row-reverse') ? 'row' : 'column';
    }

    /** Ширина меню SmartBoard/настроек + отступ (как в positionForm). */
    const FLOAT_FORM_PANEL_W = 360;
    const FLOAT_FORM_PANEL_H = 420;
    const FLOAT_FORM_GAP = 10;

    function computeFloatGeom(uix, uiy, imgW, imgH) {
        const dbR = window.drawBar ? window.drawBar.getBoundingClientRect() : null;
        const sbR = window.sideBar ? window.sideBar.getBoundingClientRect() : null;
        const formReserve = FLOAT_FORM_PANEL_W + FLOAT_FORM_GAP;

        let minX = uix, minY = uiy;
        let maxX = uix + imgW, maxY = uiy + imgH;
        [dbR, sbR].forEach(r => {
            if (!r || r.width <= 0 || r.height <= 0) return;
            if (r.left < minX) minX = r.left;
            if (r.top < minY) minY = r.top;
            if (r.right > maxX) maxX = r.right;
            if (r.bottom > maxY) maxY = r.bottom;
        });

        let formPreferRight = true;
        if (sbR && sbR.width > 0) {
            const spaceRight = window.innerWidth - sbR.right;
            if (spaceRight >= formReserve) {
                maxX = Math.max(maxX, sbR.right + formReserve);
                maxY = Math.max(maxY, sbR.top + FLOAT_FORM_PANEL_H);
                formPreferRight = true;
            } else {
                minX = Math.min(minX, sbR.left - formReserve);
                formPreferRight = false;
            }
        }

        minX = Math.floor(minX); minY = Math.floor(minY);
        maxX = Math.ceil(maxX); maxY = Math.ceil(maxY);

        return {
            offX: minX, offY: minY,
            imgW, imgH,
            wrapX: uix - minX, wrapY: uiy - minY,
            dbX: dbR ? Math.round(dbR.left - minX) : 0,
            dbY: dbR ? Math.round(dbR.top - minY) : 0,
            sbX: sbR ? Math.round(sbR.left - minX) : 0,
            sbY: sbR ? Math.round(sbR.top - minY) : 0,
            hasDb: !!(dbR && dbR.width > 0),
            hasSb: !!(sbR && sbR.width > 0),
            sbLayout: getSideBarLayoutMode(),
            formPreferRight,
            formReserve,
            W: maxX - minX,
            H: maxY - minY
        };
    }

    window.toggleFloatMode = async function () {
        if (document.body.classList.contains('float-edit')) return;
        if (typeof state === 'undefined' || state !== 'editing') return;
        if (!window.uiW || !window.uiH || window.uiW < 1 || window.uiH < 1) return;

        if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();
        const uix = Math.round(window.uiX || 0);
        const uiy = Math.round(window.uiY || 0);
        const imgW = Math.max(1, Math.round(window.uiW || 1));
        const imgH = Math.max(1, Math.round(window.uiH || 1));
        const geom = computeFloatGeom(uix, uiy, imgW, imgH);

        if (window.activeTextBox && typeof commitTextBox === 'function') {
            commitTextBox(window.activeTextBox);
        }

        let layers = null;
        try {
            if (typeof window.getCroppedLayersAsync === 'function') {
                layers = await window.getCroppedLayersAsync();
            }
        } catch (e) {
            layers = null;
        }
        if (!layers || !layers.bg) {
            if (typeof showCropperNotice === 'function') {
                showCropperNotice('Сначала выделите область.', 2800);
            }
            return;
        }

        const ipc = window.smartCap || window.ipcRenderer;
        if (ipc && typeof ipc.send === 'function') {
            ipc.send('create-float-window', {
                layers,
                x: geom.offX,
                y: geom.offY,
                w: geom.W,
                h: geom.H,
                layout: geom
            });
        }
    };
})();
