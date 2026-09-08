(function () {
    'use strict';

    const ICO_MOVE = '../../ico/Перемещение.png';
    const ICO_MINUS = '../../ico/Минус.png';

    let moveMode = false;
    let inited = false;
    let isIgnoringMouse = false;
    let floatCustomDragActive = false;

    function el(id) { return document.getElementById(id); }
    function ipc() { return window.smartCap || window.ipcRenderer; }

    function sendIgnoreMouseEvents(ignore, options) {
        const i = ipc();
        if (i && typeof i.send === 'function') {
            i.send('set-ignore-mouse-events', !!ignore, options || {});
        }
    }

    function getScreenshotRect() {
        const wrap = el('canvas-wrapper');
        if (!wrap) return null;
        const r = wrap.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        return r;
    }

    function isScreenshotPoint(clientX, clientY) {
        const r = getScreenshotRect();
        if (!r) return false;
        return clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom;
    }

    function isOverToolbar(clientX, clientY) {
        for (const bar of [window.drawBar, window.sideBar]) {
            if (!bar || bar.style.display === 'none') continue;
            const r = bar.getBoundingClientRect();
            if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
                return true;
            }
        }
        for (const form of [window.taskForm, window.updateForm, window.settingsForm]) {
            if (!form || form.style.display === 'none') continue;
            const r = form.getBoundingClientRect();
            if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
                return true;
            }
        }
        const fio = el('fio-overlay');
        if (fio && fio.style.display !== 'none') {
            const r = fio.getBoundingClientRect();
            if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
                return true;
            }
        }
        return false;
    }

    function isFloatInteractivePoint(clientX, clientY) {
        return isScreenshotPoint(clientX, clientY) || isOverToolbar(clientX, clientY);
    }

    function syncFloatMousePassThrough(clientX, clientY) {
        if (!document.body.classList.contains('float-edit')) return;
        if (floatCustomDragActive || window.isDrawing) return;

        const isBackground = !isFloatInteractivePoint(clientX, clientY);

        if (isBackground && !isIgnoringMouse) {
            isIgnoringMouse = true;
            sendIgnoreMouseEvents(true, { forward: true });
        } else if (!isBackground && isIgnoringMouse) {
            isIgnoringMouse = false;
            sendIgnoreMouseEvents(false);
        }
    }

    /** false = тащим окно за скриншот; true = рисуем на холсте. */
    window.isDrawingMode = false;

    function syncMoveVisuals() {
        document.body.classList.toggle('float-move', moveMode);
        if (moveMode) {
            if (typeof window.clearActiveDrawTool === 'function') {
                window.clearActiveDrawTool();
            } else if (window.drawBar) {
                window.drawBar.querySelectorAll('.tool-btn.active').forEach(b => b.classList.remove('active'));
            }
        }
        const btn = el('btn-select-area');
        const sico = el('btn-select-area-icon');
        if (btn) {
            btn.classList.toggle('active', moveMode);
            if (document.body.classList.contains('float-edit')) {
                if (sico) sico.src = ICO_MOVE;
                btn.title = moveMode
                    ? 'Перемещение: тяните за скриншот (нажмите ещё раз — рисование)'
                    : 'Включить перетаскивание окна';
            }
        }
        if (window.floatEditLayout && typeof window.applyFloatEditChrome === 'function') {
            window.applyFloatEditChrome(window.floatEditLayout);
        }
        const canvas = window.drawCanvas || el('draw-layer');
        if (canvas && document.body.classList.contains('float-edit')) {
            canvas.style.cursor = moveMode ? 'move' : '';
        }
    }

    function setMoveMode(on) {
        moveMode = !!on;
        window.isDrawingMode = !moveMode;
        syncMoveVisuals();
    }

    function setDrawingMode(on) {
        setMoveMode(!on);
    }

    function toggleMoveMode() { setMoveMode(!moveMode); }

    /** Рисование на холсте (выход из режима перетаскивания). */
    window.exitFloatMoveMode = function () {
        if (moveMode) setMoveMode(false);
    };

    /** Перетаскивание окна за скриншот. */
    window.enterFloatMoveMode = function () {
        if (!moveMode) setMoveMode(true);
    };

    function applySideBarLayout(mode) {
        const horizontal = mode === 'row';
        if (window.sideBar) {
            window.sideBar.style.flexDirection = horizontal ? 'row' : 'column';
        }
        if (typeof syncBoardButtonsWrapVisibility === 'function') {
            syncBoardButtonsWrapVisibility();
        }
    }

    /** Зафиксировать панели там, где они были в основном кроппере. */
    window.applyFloatEditToolbarLayout = function (layout) {
        if (!layout) return;
        if (layout.hasSb) {
            applySideBarLayout(layout.sbLayout || 'column');
        }
        if (typeof syncBoardButtonsWrapVisibility === 'function') {
            syncBoardButtonsWrapVisibility();
        }
        const pin = (bar, x, y) => {
            if (!bar) return;
            bar.style.left = Math.round(x) + 'px';
            bar.style.top = Math.round(y) + 'px';
            bar.style.width = 'max-content';
            bar.style.height = 'max-content';
            bar.style.flexShrink = '0';
            bar.style.flexWrap = 'nowrap';
        };
        if (layout.hasDb) pin(window.drawBar, layout.dbX, layout.dbY);
        if (layout.hasSb) pin(window.sideBar, layout.sbX, layout.sbY);
    };

    /** Рамка вокруг скриншота (позиция из layout). */
    window.applyFloatEditChrome = function (layout) {
        const lx = layout ? (layout.wrapX || 0) : 0;
        const ly = layout ? (layout.wrapY || 0) : 0;
        const lw = layout ? (layout.imgW || window.innerWidth) : window.innerWidth;
        const lh = layout ? (layout.imgH || window.innerHeight) : window.innerHeight;

        const frame = el('float-frame');
        if (frame) {
            frame.style.inset = 'auto';
            frame.style.left = lx + 'px';
            frame.style.top = ly + 'px';
            frame.style.width = lw + 'px';
            frame.style.height = lh + 'px';
        }
    };

    /** JS-перетаскивание float-окна за скриншот (без -webkit-app-region: drag). */
    function initFloatWindowDrag() {
        let dragActive = false;

        function startDrag(e) {
            if (!document.body.classList.contains('float-edit')) return;
            if (!document.body.classList.contains('float-move')) return;
            if (e.button !== 0) return;
            if (!isScreenshotPoint(e.clientX, e.clientY)) return;
            if (isOverToolbar(e.clientX, e.clientY)) return;
            e.preventDefault();
            e.stopPropagation();
            if (isIgnoringMouse) {
                isIgnoringMouse = false;
                sendIgnoreMouseEvents(false);
            }
            dragActive = true;
            floatCustomDragActive = true;
            const i = ipc();
            if (i && typeof i.send === 'function') i.send('start-custom-drag');
        }

        function stopDrag() {
            if (!dragActive) return;
            dragActive = false;
            floatCustomDragActive = false;
            const i = ipc();
            if (i && typeof i.send === 'function') i.send('stop-custom-drag');
        }

        const canvas = window.drawCanvas || el('draw-layer');
        const wrapper = el('canvas-wrapper');
        if (canvas) {
            canvas.addEventListener('mousedown', startDrag, true);
        }
        if (wrapper) {
            wrapper.addEventListener('mousedown', startDrag, true);
        }

        document.addEventListener('mouseup', stopDrag, true);
        document.addEventListener('pointerup', stopDrag, true);
        document.addEventListener('pointercancel', stopDrag, true);

        document.addEventListener('contextmenu', (e) => {
            if (!document.body.classList.contains('float-edit')) return;
            if (!document.body.classList.contains('float-move')) return;
            if (!isScreenshotPoint(e.clientX, e.clientY)) return;
            if (isOverToolbar(e.clientX, e.clientY)) return;
            e.preventDefault();
        }, true);
    }

    window.initFloatEditControls = function () {
        if (inited) return;
        inited = true;

        const layout = window.floatEditLayout;
        if (layout) {
            window.applyFloatEditToolbarLayout(layout);
        }
        window.applyFloatEditChrome(layout);

        const sbtn = el('btn-select-area');
        const sico = el('btn-select-area-icon');
        if (sico) sico.src = ICO_MOVE;
        if (sbtn) {
            sbtn.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                e.stopImmediatePropagation();
                e.preventDefault();
                toggleMoveMode();
            }, true);
        }

        const fbtn = el('btn-float');
        const fico = el('btn-float-icon');
        if (fico) fico.src = ICO_MINUS;
        if (fbtn) {
            fbtn.title = 'Свернуть окно';
            fbtn.onclick = function () {
                const i = ipc();
                if (i && typeof i.send === 'function') i.send('float-window-minimize');
            };
        }

        const _origSetTool = typeof window.setTool === 'function' ? window.setTool : null;
        if (_origSetTool) {
            window.setTool = function (tool) {
                setMoveMode(false);
                return _origSetTool.apply(this, arguments);
            };
        }

        window.floatHandleEscape = function () {
            if (window.state === 'form') return false;
            setMoveMode(true);
            return true;
        };

        if (layout) {
            window.showToolbars = async function () {
                try {
                    if (document.body && typeof document.body.focus === 'function') {
                        document.body.focus({ preventScroll: true });
                    }
                } catch (e) { /* ignore */ }
                if (typeof refreshBoardServerStateQuick === 'function') {
                    await refreshBoardServerStateQuick();
                }
                if (typeof refreshBoardServerStateInBackground === 'function') {
                    refreshBoardServerStateInBackground();
                }
                if (typeof updateSmartBoardButtonsState === 'function') {
                    updateSmartBoardButtonsState();
                }
                if (window.drawBar) window.drawBar.style.display = 'flex';
                if (window.sideBar) window.sideBar.style.display = 'flex';
                window.applyFloatEditToolbarLayout(window.floatEditLayout);
                window.applyFloatEditChrome(window.floatEditLayout);
                if (typeof window.repositionOpenForm === 'function') {
                    window.repositionOpenForm();
                }
            };
        }

        /* По умолчанию — перетаскивание за скриншот. */
        setMoveMode(true);

        if (window.drawBar) window.drawBar.style.pointerEvents = 'auto';
        if (window.sideBar) window.sideBar.style.pointerEvents = 'auto';
        if (typeof window.ensureFloatFormsOnBody === 'function') {
            window.ensureFloatFormsOnBody();
        }
        initFloatWindowDrag();
        initFloatMousePassThrough();
        initFloatFocusIndicator();
    };

    /** Проницаемость пустых зон: setIgnoreMouseEvents + forward (Windows). */
    function initFloatMousePassThrough() {
        window.addEventListener('mousemove', (event) => {
            syncFloatMousePassThrough(event.clientX, event.clientY);
        });
        window.addEventListener('mouseleave', () => {
            if (!isIgnoringMouse) return;
            isIgnoringMouse = false;
            sendIgnoreMouseEvents(false);
        });
        syncFloatMousePassThrough(window.innerWidth / 2, window.innerHeight / 2);
    }

    /** Подсветка рамки: синяя — окно в фокусе (Esc, Ctrl+Z и т.д.), серая — неактивное. */
    function initFloatFocusIndicator() {
        function syncFloatFocusVisual() {
            document.body.classList.toggle('float-window-focused', document.hasFocus());
        }
        syncFloatFocusVisual();
        window.addEventListener('focus', syncFloatFocusVisual);
        window.addEventListener('blur', syncFloatFocusVisual);
        document.addEventListener('visibilitychange', syncFloatFocusVisual);
        document.addEventListener('pointerdown', () => {
            try {
                if (document.body && typeof document.body.focus === 'function') {
                    document.body.focus({ preventScroll: true });
                }
            } catch (e) { /* ignore */ }
            requestAnimationFrame(syncFloatFocusVisual);
        }, true);
    }
})();
