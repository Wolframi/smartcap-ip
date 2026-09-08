    // --- УПРАВЛЕНИЕ КЛАВИШАМИ (CTRL+C, CTRL+Z, ESC) ---
    function performUndo() {
        if (undoStack.length === 0) return;
        if (typeof captureHistorySnapshot === 'function') {
            const snapToRestore = undoStack[undoStack.length - 1];
            const flags = typeof historySnapshotCaptureFlags === 'function'
                ? historySnapshotCaptureFlags(snapToRestore)
                : { includeBlurLayers: false, includeBgLayer: false };
            redoStack.push(captureHistorySnapshot(flags.includeBlurLayers, flags.includeBgLayer));
            if (redoStack.length > UNDO_STACK_MAX) {
                const removed = redoStack.shift();
                if (typeof freeSnapshotMemory === 'function') freeSnapshotMemory(removed);
            }
        }
        const snapshot = undoStack.pop();
        if (typeof applyHistorySnapshot === 'function') applyHistorySnapshot(snapshot);
        if (typeof freeSnapshotMemory === 'function') freeSnapshotMemory(snapshot);
    }

    function performRedo() {
        if (redoStack.length === 0) return;
        if (typeof captureHistorySnapshot === 'function') {
            const snapToRestore = redoStack[redoStack.length - 1];
            const flags = typeof historySnapshotCaptureFlags === 'function'
                ? historySnapshotCaptureFlags(snapToRestore)
                : { includeBlurLayers: false, includeBgLayer: false };
            undoStack.push(captureHistorySnapshot(flags.includeBlurLayers, flags.includeBgLayer));
            if (undoStack.length > UNDO_STACK_MAX) {
                const removed = undoStack.shift();
                if (typeof freeSnapshotMemory === 'function') freeSnapshotMemory(removed);
            }
        }
        const snapshot = redoStack.pop();
        if (typeof applyHistorySnapshot === 'function') applyHistorySnapshot(snapshot);
        if (typeof freeSnapshotMemory === 'function') freeSnapshotMemory(snapshot);
    }

    const ICO_SELECT_AREA = '../../ico/Выделение области.png';
    const ICO_SELECT_FULL = '../../ico/ВоВесьЭкран.png';

    function updateSelectAreaButton() {
        const btn = document.getElementById('btn-select-area');
        const icon = document.getElementById('btn-select-area-icon');
        if (!btn) return;
        if (document.body.classList.contains('float-edit')) return;
        if (selectionMode === 'full') {
            btn.title = 'Выбрать область';
            if (icon) icon.src = ICO_SELECT_AREA;
        } else {
            btn.title = 'Во весь экран';
            if (icon) icon.src = ICO_SELECT_FULL;
        }
        // Галочка (плавающее окно) не имеет смысла для полного экрана — прячем её в этом режиме.
        // В плавающем окне эта кнопка переназначена на «Свернуть» — не трогаем её.
        const floatBtn = document.getElementById('btn-float');
        if (floatBtn && !document.body.classList.contains('float-edit')) {
            floatBtn.style.display = selectionMode === 'full' ? 'none' : '';
        }
    }

    document.getElementById('btn-undo').addEventListener('click', performUndo);
    document.getElementById('btn-redo').addEventListener('click', performRedo);
    document.getElementById('btn-select-area').addEventListener('click', toggleSelectionMode);
    const btnCopy = document.getElementById('btn-copy');
    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            void performCopyToClipboardAndClose().then((ok) => {
                if (!ok && typeof showCropperNotice === 'function') {
                    showCropperNotice('Сначала выделите область для копирования.', 2800);
                }
            });
        });
    }

    function updateSmartBoardButtonsState() {
        ['btn-open-form', 'btn-open-update'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.remove('disabled');
            btn.setAttribute('aria-disabled', 'false');
        });
        syncBoardButtonsWrapVisibility();
        if (document.body.classList.contains('float-edit') && window.floatEditLayout) {
            if (typeof window.applyFloatEditToolbarLayout === 'function') {
                window.applyFloatEditToolbarLayout(window.floatEditLayout);
            }
            if (typeof window.repositionOpenForm === 'function') {
                window.repositionOpenForm();
            }
        }
    }

    function syncBoardButtonsWrapVisibility() {
        const boardWrap = document.getElementById('board-buttons-wrap');
        if (!boardWrap || !window.sideBar) return;
        const fd = (window.sideBar.style.flexDirection
            || window.getComputedStyle(window.sideBar).flexDirection
            || 'column').toLowerCase();
        const horizontal = fd === 'row' || fd === 'row-reverse';
        boardWrap.style.display = horizontal ? 'flex' : 'block';
        boardWrap.style.flexDirection = horizontal ? 'row' : 'column';
        boardWrap.style.gap = horizontal ? '8px' : '0';
    }

    (function initQuickTooltips() {
        const tooltip = document.createElement('div');
        tooltip.className = 'quick-tooltip';
        document.body.appendChild(tooltip);
        let tooltipTimer = null;
        let hideAfterDragTimer = null;
        let currentTarget = null;
        const sizeWrap = document.getElementById('tool-size-wrap');

        const positionTooltipNear = (el) => {
            const rect = el.getBoundingClientRect();
            const left = Math.max(8, Math.min(
                rect.left + rect.width / 2 - tooltip.offsetWidth / 2,
                window.innerWidth - tooltip.offsetWidth - 8
            ));
            let top = rect.top - tooltip.offsetHeight - 8;
            if (top < 8) top = rect.bottom + 8;
            tooltip.style.left = Math.round(left) + 'px';
            tooltip.style.top = Math.round(top) + 'px';
        };

        const hideTooltip = (force) => {
            if (!force && sizeWrap && sizeWrap.classList.contains('is-dragging')) return;
            clearTimeout(tooltipTimer);
            clearTimeout(hideAfterDragTimer);
            tooltipTimer = null;
            hideAfterDragTimer = null;
            tooltip.classList.remove('visible');
            if (currentTarget && currentTarget.dataset.nativeTitle) {
                currentTarget.setAttribute('title', currentTarget.dataset.nativeTitle);
                delete currentTarget.dataset.nativeTitle;
            }
            currentTarget = null;
        };

        window.showToolSizeTooltip = (value) => {
            if (!sizeWrap) return;
            clearTimeout(tooltipTimer);
            clearTimeout(hideAfterDragTimer);
            tooltipTimer = null;
            if (currentTarget && currentTarget !== sizeWrap && currentTarget.dataset.nativeTitle) {
                currentTarget.setAttribute('title', currentTarget.dataset.nativeTitle);
                delete currentTarget.dataset.nativeTitle;
            }
            currentTarget = sizeWrap;
            tooltip.textContent = String(value);
            tooltip.classList.add('visible');
            requestAnimationFrame(() => positionTooltipNear(sizeWrap));
        };

        window.hideQuickTooltip = hideTooltip;

        document.addEventListener('mouseover', (e) => {
            const btn = e.target.closest && e.target.closest(
                '.toolbar [title], .tool-btn[title], .settings-group[title], #color-picker-wrap[title], #opacity-wrap[title], #tool-size-wrap[title]'
            );
            if (!btn) return;
            if (btn === sizeWrap && sizeWrap.classList.contains('is-dragging')) return;
            hideTooltip(true);
            currentTarget = btn;
            const text = btn.getAttribute('title') || '';
            if (!text) return;
            btn.dataset.nativeTitle = text;
            btn.removeAttribute('title');
            tooltip.textContent = text;
            tooltipTimer = setTimeout(() => {
                positionTooltipNear(btn);
                tooltip.classList.add('visible');
            }, 120);
        });

        document.addEventListener('mouseout', (e) => {
            if (!currentTarget) return;
            if (e.relatedTarget && currentTarget.contains(e.relatedTarget)) return;
            hideTooltip();
        });

        document.addEventListener('mousedown', (e) => {
            if (e.target.closest && e.target.closest('#tool-size-wrap')) return;
            hideTooltip();
        });
    })();

    (function initSteppedToolSizeSlider() {
        const slider = document.getElementById('tool-size-slider');
        const wrap = document.getElementById('tool-size-wrap');
        if (!slider || !wrap) return;
        const thumb = wrap.querySelector('.tool-size-thumb');
        const fill = wrap.querySelector('.tool-size-fill');
        const min = TOOL_SIZE_MIN;
        const max = TOOL_SIZE_MAX;
        const thumbPx = 14;
        let lastSnapped = null;
        let stepAnimTimer = null;

        const snapSize = (raw) => {
            const n = Math.round(parseFloat(raw));
            if (!Number.isFinite(n)) return TOOL_SIZE_DEFAULT;
            return Math.max(min, Math.min(max, n));
        };

        const setVisual = (size, animateStep) => {
            const t = (size - min) / (max - min);
            const pos = `calc((100% - ${thumbPx}px) * ${t} + ${thumbPx / 2}px)`;
            if (animateStep) {
                wrap.classList.add('is-stepping');
                clearTimeout(stepAnimTimer);
                stepAnimTimer = setTimeout(() => wrap.classList.remove('is-stepping'), 180);
            } else {
                wrap.classList.remove('is-stepping');
            }
            if (thumb) thumb.style.left = pos;
            if (fill) fill.style.width = pos;
        };

        const applySnapped = (raw, animateStep) => {
            const snapped = snapSize(raw);
            if (String(slider.value) !== String(snapped)) slider.value = String(snapped);
            const stepChanged = lastSnapped !== snapped;
            lastSnapped = snapped;
            setVisual(snapped, animateStep && stepChanged);
            setToolSize(snapped, true);
            if (typeof window.showToolSizeTooltip === 'function') {
                window.showToolSizeTooltip(snapped);
            }
            return snapped;
        };

        slider.addEventListener('pointerdown', () => {
            wrap.classList.add('is-dragging');
            applySnapped(slider.value, false);
        });
        slider.addEventListener('input', () => applySnapped(slider.value, true));
        slider.addEventListener('pointerup', () => {
            wrap.classList.remove('is-dragging');
            applySnapped(slider.value, true);
            clearTimeout(window._toolSizeTooltipHideTimer);
            window._toolSizeTooltipHideTimer = setTimeout(() => {
                if (!wrap.matches(':hover') && typeof window.hideQuickTooltip === 'function') {
                    window.hideQuickTooltip(true);
                }
            }, 700);
        });
        slider.addEventListener('pointercancel', () => {
            wrap.classList.remove('is-dragging');
            applySnapped(slider.value, true);
        });

        window.updateToolSizeSliderVisual = (value, animateStep) => {
            const snapped = snapSize(value);
            lastSnapped = snapped;
            setVisual(snapped, animateStep === true);
        };

        applySnapped(slider.value, false);
    })();

    function isEditableTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    async function copyCroppedScreenshotToClipboard() {
        const base64 = await window.getCroppedBase64Async();
        if (!base64) return false;
        if (window.smartCap.clipboardWriteImageFromDataUrl(base64)) return true;
        const raw = base64.includes(',') ? base64.split(',')[1] : base64;
        try {
            return !!(await ipcRenderer.invoke('clipboard-write-png-base64', raw));
        } catch (e) {
            return false;
        }
    }

    function ensureCopySelectionReady() {
        if (state === 'idle' || state === 'selecting') {
            if (typeof window.setInitialFullSelection === 'function') {
                window.setInitialFullSelection();
                return true;
            }
            return false;
        }
        if (state === 'editing') {
            if (typeof window.isSelectionEstablished === 'function' && window.isSelectionEstablished()) {
                return true;
            }
            if (typeof window.switchToFullScreenSelection === 'function') {
                window.switchToFullScreenSelection();
                return true;
            }
            if (typeof window.setInitialFullSelection === 'function') {
                window.setInitialFullSelection();
                return true;
            }
            return false;
        }
        return false;
    }

    async function performCopyToClipboardAndClose() {
        if (state === 'form') return false;
        if (!ensureCopySelectionReady()) return false;
        if (!selW || !selH) return false;

        if (!(await copyCroppedScreenshotToClipboard())) {
            if (typeof showCropperNotice === 'function') {
                showCropperNotice('Ошибка копирования изображения.', 2800);
            }
            return false;
        }

        if (typeof closeCropper === 'function') closeCropper();
        else ipcRenderer.send('close-cropper');
        return true;
    }

    function loadImageFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('clipboard-image-load-error'));
            img.src = dataUrl;
        });
    }

    function drawImageHighQuality(ctx, img, x, y, w, h) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
    }

    function focusCropperForKeyboard() {
        try {
            if (document.body && typeof document.body.focus === 'function') {
                document.body.focus({ preventScroll: true });
            }
        } catch (e) {}
    }

    function canPasteClipboardImage() {
        return state !== 'form' && !activeTextBox && !isEditableTarget(document.activeElement);
    }

    async function pasteClipboardImage() {
        if (!canPasteClipboardImage()) return;
        if (!bgCanvas.width || !bgCanvas.height) {
            showCropperNotice('Сначала сделайте скриншот (Ctrl+Alt+S), затем вставляйте изображение.', 4000);
            return;
        }

        let clipDataUrl = null;
        try {
            clipDataUrl = await window.smartCap.clipboardReadImageAsDataUrl();
        } catch (e) {
            clipDataUrl = null;
        }
        if (!clipDataUrl) {
            showCropperNotice('В буфере обмена нет изображения.', 3500);
            return;
        }

        if (isDrawing && typeof abortActiveDrawing === 'function') abortActiveDrawing();

        try {
            selectionMode = 'area';
            toolbarLayoutMode = 'selection';
            updateSelectAreaButton();

            const ratio = scaleRatio || 1;
            const primaryViewX = (primaryBounds.x - virtualBounds.x) / ratio;
            const primaryViewY = (primaryBounds.y - virtualBounds.y) / ratio;
            const primaryCanvasW = primaryBounds.width || bgCanvas.width;
            const primaryCanvasH = primaryBounds.height || bgCanvas.height;
            const primaryViewW = primaryCanvasW / ratio;
            const primaryViewH = primaryCanvasH / ratio;
            const img = await loadImageFromDataUrl(clipDataUrl);
            const fitRatio = Math.min(
                (primaryCanvasW * CLIPBOARD_IMAGE_MAX_SCREEN_SCALE) / img.naturalWidth,
                (primaryCanvasH * CLIPBOARD_IMAGE_MAX_SCREEN_SCALE) / img.naturalHeight,
                1
            );

            const targetW = Math.max(1, Math.round(img.naturalWidth * fitRatio));
            const targetH = Math.max(1, Math.round(img.naturalHeight * fitRatio));

            uiW = targetW / ratio;
            uiH = targetH / ratio;
            uiX = primaryViewX + (primaryViewW - uiW) / 2;
            uiY = primaryViewY + (primaryViewH - uiH) / 2;

            if (uiX < 10) uiX = 10;
            if (uiY < 10) uiY = 10;
            if (uiX + uiW > window.innerWidth - 10) uiX = window.innerWidth - uiW - 10;
            if (uiY + uiH > window.innerHeight - 10) uiY = window.innerHeight - uiH - 10;

            selX = Math.round(uiX * ratio);
            selY = Math.round(uiY * ratio);
            selW = targetW;
            selH = targetH;

            selectionResizeLocked = true;
            if (typeof ensureBlurLayersSized === 'function') ensureBlurLayersSized();
            pushUndoState('paste', selX, selY);
            ctxDraw.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            if (blurCanvas.width > 1 && blurCanvas.height > 1) {
                ctxBlur.clearRect(selX, selY, selW, selH);
            }
            drawImageHighQuality(ctxBg, img, selX, selY, selW, selH);

            redrawSelectionOverlay(CLIPBOARD_IMAGE_DIM_ALPHA);

            state = 'editing';
            void showToolbars().catch(() => {});
        } catch (e) {
            if (typeof abortActiveDrawing === 'function') abortActiveDrawing();
            throw e;
        }
    }

    // Единый размер для текста, линий, стрелок и кругов.

    let pasteClipboardInFlight = false;

    function requestPasteClipboardImage() {
        if (pasteClipboardInFlight) return;
        if (!canPasteClipboardImage()) return;
        pasteClipboardInFlight = true;
        void pasteClipboardImage()
            .catch(() => {
                showCropperNotice('Не удалось вставить изображение из буфера.', 3500);
            })
            .finally(() => {
                pasteClipboardInFlight = false;
            });
    }

    if (window.smartCap && typeof window.smartCap.on === 'function') {
        window.smartCap.on('trigger-paste-clipboard', () => {
            requestPasteClipboardImage();
        });
    }

    // --- УПРАВЛЕНИЕ КЛАВИШАМИ (ИСПРАВЛЕННОЕ) ---
    window.addEventListener('keydown', (e) => {
        // 1. ESCAPE - закрыть text box, FIO форму или кроппер
        if (e.code === 'Escape') {
            const fioOverlay = document.getElementById('fio-overlay');
            if (fioOverlay && fioOverlay.style.display === 'block') {
                e.preventDefault();
                hideFioOverlay();
            } else if (activeTextBox) {
                e.preventDefault();
                cancelTextBox(activeTextBox);
            } else if (typeof window.floatHandleEscape === 'function' && window.floatHandleEscape()) {
                e.preventDefault();
                e.stopPropagation();
            } else {
                if (typeof closeCropper === 'function') closeCropper();
                else ipcRenderer.send('close-cropper');
            }
        }
        
        // 2. CTRL+Z — отмена действия
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ')) {
            if (state === 'form' || activeTextBox || isEditableTarget(document.activeElement)) return;
            e.preventDefault();
            performUndo();
        }

        // 3. CTRL+V — вставка из буфера (картинка или файл из Проводника)
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyV')) {
            if (canPasteClipboardImage()) {
                e.preventDefault();
                e.stopPropagation();
                requestPasteClipboardImage();
            }
        }

        // 4. CTRL+C — сразу в буфер обмена и закрыть кроппер (без задержки и подсветки кнопок)
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyC')) {
            if (state === 'form' || activeTextBox || isEditableTarget(document.activeElement)) return;
            e.preventDefault();
            void performCopyToClipboardAndClose();
        }
    }, true);

    // --- ОБРАБОТЧИКИ КНОПОК ---
    
    // 1. Сохранить в файл (новая кнопка)
    // --- 1. Сохранить в файл (новая кнопка) ---
    const btnSaveDisk = document.getElementById('btn-save-disk');
    if (btnSaveDisk) {
        btnSaveDisk.addEventListener('click', async () => {
            if (btnSaveDisk.classList.contains('active')) return;
            const base64 = await window.getCroppedBase64Async();
            if (base64) {
                if (typeof persistCropperSettingsNow === 'function') void persistCropperSettingsNow();
                btnSaveDisk.classList.add('active');
                btnSaveDisk.title = 'Выбор папки...';
                btnSaveDisk.style.pointerEvents = 'none';
                ipcRenderer.send('save-direct-file', base64);
            }
        });
    }

    function resetSaveDiskButton() {
        if (btnSaveDisk) {
            btnSaveDisk.classList.remove('active');
            btnSaveDisk.title = 'Сохранить в папку';
            btnSaveDisk.style.pointerEvents = 'auto';
        }
    }
    ipcRenderer.on('save-cancelled', resetSaveDiskButton);
    ipcRenderer.on('save-complete', resetSaveDiskButton);

    // Позиционирование меню
    async function showToolbars() {
        if (typeof refreshBoardServerStateQuick === 'function') {
            await refreshBoardServerStateQuick();
        }
        if (typeof refreshBoardServerStateInBackground === 'function') {
            refreshBoardServerStateInBackground();
        }
        updateSmartBoardButtonsState();
        focusCropperForKeyboard();
        drawBar.style.display = 'flex'; sideBar.style.display = 'flex';
        const toolbarGap = 12;
        const viewportPadding = 10;

        function setSideBarLayout(layout) {
            const horizontal = layout === 'row';
            sideBar.style.flexDirection = horizontal ? 'row' : 'column';
            syncBoardButtonsWrapVisibility();
        }

        const clampLeft = (left, width) => {
            const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
            return Math.max(viewportPadding, Math.min(left, maxLeft));
        };
        const clampTop = (top, height) => {
            const maxTop = Math.max(viewportPadding, window.innerHeight - height - viewportPadding);
            return Math.max(viewportPadding, Math.min(top, maxTop));
        };
        const rectsOverlap = (a, b) => {
            return a.left < b.left + b.width &&
                a.left + a.width > b.left &&
                a.top < b.top + b.height &&
                a.top + a.height > b.top;
        };
        const makeRect = (left, top, width, height) => ({ left, top, width, height });
        const applyPosition = (el, left, top) => {
            el.style.left = Math.round(left) + 'px';
            el.style.top = Math.round(top) + 'px';
        };
        const measureSideBar = () => ({
            width: sideBar.offsetWidth,
            height: sideBar.offsetHeight
        });

        const ratio = scaleRatio || 1;
        const primaryViewX = (primaryBounds.x - virtualBounds.x) / ratio;
        const primaryViewY = (primaryBounds.y - virtualBounds.y) / ratio;
        const primaryViewW = (primaryBounds.width || bgCanvas.width) / ratio;
        const dbW = drawBar.offsetWidth;
        const dbH = drawBar.offsetHeight;

        if (toolbarLayoutMode === 'full') {
            setSideBarLayout('row');
            const sideSize = measureSideBar();
            const sbW = sideSize.width;
            const sbH = sideSize.height;
            const topY = clampTop(primaryViewY + viewportPadding, Math.max(dbH, sbH));
            const dbLeft = clampLeft(primaryViewX + (primaryViewW - dbW) / 2, dbW);
            const drawRect = makeRect(dbLeft, topY, dbW, dbH);

            applyPosition(drawBar, dbLeft, topY);

            const placeSideBar = (left, top) => {
                const rect = makeRect(clampLeft(left, sbW), clampTop(top, sbH), sbW, sbH);
                return rectsOverlap(drawRect, rect) ? null : rect;
            };

            let sideRect = placeSideBar(
                dbLeft + dbW + toolbarGap,
                topY + (dbH - sbH) / 2
            );
            if (!sideRect) {
                sideRect = placeSideBar(
                    dbLeft - sbW - toolbarGap,
                    topY + (dbH - sbH) / 2
                );
            }
            if (!sideRect) {
                sideRect = makeRect(
                    clampLeft(dbLeft + (dbW - sbW) / 2, sbW),
                    clampTop(topY + dbH + toolbarGap, sbH),
                    sbW,
                    sbH
                );
            }

            applyPosition(sideBar, sideRect.left, sideRect.top);
            return;
        }

        setSideBarLayout('column');
        let sideSize = measureSideBar();
        let sbW = sideSize.width;
        let sbH = sideSize.height;

        let dbTop = uiY + uiH + toolbarGap;
        if (dbTop + dbH > window.innerHeight - viewportPadding) dbTop = uiY - dbH - toolbarGap;
        dbTop = clampTop(dbTop, dbH);

        let dbLeft = uiX + (uiW / 2) - (dbW / 2);
        dbLeft = clampLeft(dbLeft, dbW);
        const drawRect = makeRect(dbLeft, dbTop, dbW, dbH);
        const selectionRect = makeRect(uiX, uiY, uiW, uiH);
        const isFreeRect = (rect) => !rectsOverlap(drawRect, rect) && !rectsOverlap(selectionRect, rect);

        const sideCandidates = [
            [uiX + uiW + toolbarGap, uiY],
            [uiX - sbW - toolbarGap, uiY]
        ];
        let best = null;
        for (const [left, top] of sideCandidates) {
            const fitsSide = left >= viewportPadding && left + sbW <= window.innerWidth - viewportPadding;
            const rect = makeRect(left, clampTop(top, sbH), sbW, sbH);
            if (fitsSide && isFreeRect(rect)) {
                best = rect;
                break;
            }
        }

        if (!best) {
            setSideBarLayout('row');
            sideSize = measureSideBar();
            sbW = sideSize.width;
            sbH = sideSize.height;
            const centeredOnSelection = uiX + (uiW - sbW) / 2;
            const centeredOnDraw = dbLeft + (dbW - sbW) / 2;
            const fallbackCandidates = [
                [centeredOnSelection, uiY + uiH + toolbarGap],
                [centeredOnSelection, uiY - sbH - toolbarGap],
                [centeredOnDraw, dbTop + dbH + toolbarGap],
                [centeredOnDraw, dbTop - sbH - toolbarGap]
            ];
            for (const [left, top] of fallbackCandidates) {
                const rect = makeRect(clampLeft(left, sbW), clampTop(top, sbH), sbW, sbH);
                if (isFreeRect(rect)) {
                    best = rect;
                    break;
                }
            }
            if (!best) {
                setSideBarLayout('column');
                sideSize = measureSideBar();
                sbW = sideSize.width;
                sbH = sideSize.height;
                const rightLeft = clampLeft(uiX + uiW + toolbarGap, sbW);
                const leftLeft = clampLeft(uiX - sbW - toolbarGap, sbW);
                const rightRect = makeRect(rightLeft, clampTop(uiY, sbH), sbW, sbH);
                const leftRect = makeRect(leftLeft, clampTop(uiY, sbH), sbW, sbH);
                best = !rectsOverlap(drawRect, rightRect) ? rightRect : leftRect;
            }
        }

        applyPosition(drawBar, dbLeft, dbTop);
        applyPosition(sideBar, best.left, best.top);
    }

    function hideToolbars() { 
        drawBar.style.display = 'none'; sideBar.style.display = 'none'; 
        taskForm.style.display = 'none'; updateForm.style.display = 'none';
        if (settingsForm) settingsForm.style.display = 'none';
        if (typeof hideFioOverlay === 'function') hideFioOverlay();
        hideSelectionHandles();
    }
    function closeForms() {
        const createWasOpen = taskForm && taskForm.style.display === 'block';
        const updateWasOpen = updateForm && updateForm.style.display === 'block';
        if (createWasOpen && typeof saveSessionCreateSelection === 'function') saveSessionCreateSelection();
        if (updateWasOpen && typeof saveSessionUpdateSelection === 'function') saveSessionUpdateSelection();
        if (typeof flushPersistCreateDefaultsIfRemember === 'function') void flushPersistCreateDefaultsIfRemember();
        if (typeof flushLastFormSelection === 'function') void flushLastFormSelection();
        if (typeof stopCropperSettingsRecording === 'function') stopCropperSettingsRecording();
        taskForm.style.display = 'none'; updateForm.style.display = 'none';
        if (settingsForm) settingsForm.style.display = 'none';
        if (typeof hideFioOverlay === 'function') hideFioOverlay();
        state = 'editing'; 
    }
    window.syncBoardButtonsWrapVisibility = syncBoardButtonsWrapVisibility;
    window.closeForms = closeForms;

    document.querySelectorAll('.toolbar').forEach(bar => {
        bar.addEventListener('mousedown', (e) => {
            if (!window.activeTextBox) return;
            if (e.target.closest('#btn-cancel, #btn-save-disk, #btn-settings, .btn-save, .btn-cancel')) return;
            e.preventDefault();
        });
    });
