    function hideSelectionHandles() {
        if (selectionHandles) selectionHandles.style.display = 'none';
    }

    function clearSelectionResizeLock() {
        selectionResizeLocked = false;
    }

    function updateSelectionHandles() {
        if (!selectionHandles || state !== 'editing' || selectionMode === 'full' || !uiW || !uiH || selectionResizeLocked) {
            hideSelectionHandles();
            return;
        }
        const points = {
            nw: [uiX, uiY],
            n: [uiX + uiW / 2, uiY],
            ne: [uiX + uiW, uiY],
            e: [uiX + uiW, uiY + uiH / 2],
            se: [uiX + uiW, uiY + uiH],
            s: [uiX + uiW / 2, uiY + uiH],
            sw: [uiX, uiY + uiH],
            w: [uiX, uiY + uiH / 2]
        };
        Object.entries(points).forEach(([name, point]) => {
            const el = selectionHandles.querySelector(`[data-handle="${name}"]`);
            if (!el) return;
            el.style.left = point[0] + 'px';
            el.style.top = point[1] + 'px';
        });
        selectionHandles.style.display = 'block';
    }

    const AREA_SELECTION_DIM_ALPHA = 0.3;
    let _selectionOverlayRaf = 0;
    let _selectionOverlayAlpha = AREA_SELECTION_DIM_ALPHA;

    function scheduleSelectionOverlayRedraw(alpha = _selectionOverlayAlpha) {
        _selectionOverlayAlpha = alpha;
        if (_selectionOverlayRaf) return;
        _selectionOverlayRaf = requestAnimationFrame(() => {
            _selectionOverlayRaf = 0;
            redrawSelectionOverlay(_selectionOverlayAlpha);
        });
    }

    /** Равномерное затемнение всего экрана (режим «выделение области», до начала drag). */
    function paintFullAreaDimOverlay(alpha = AREA_SELECTION_DIM_ALPHA) {
        const w = dimCanvas.width;
        const h = dimCanvas.height;
        if (!w || !h) return;
        ctxDim.globalCompositeOperation = 'source-over';
        ctxDim.clearRect(0, 0, w, h);
        ctxDim.fillStyle = '#000';
        ctxDim.globalAlpha = alpha;
        ctxDim.fillRect(0, 0, w, h);
        ctxDim.globalAlpha = 1;
    }

    function redrawSelectionOverlay(alpha = AREA_SELECTION_DIM_ALPHA) {
        const w = dimCanvas.width;
        const h = dimCanvas.height;
        if (!w || !h) return;
        if (!resizeSelection && !moveSelection && state === 'editing' && selectionMode === 'area' && uiW > 0 && uiH > 0 &&
            (uiW < SELECTION_MIN_UI_PX || uiH < SELECTION_MIN_UI_PX)) {
            syncSelectionFromUi();
        }
        const sx = Math.max(0, Math.min(selX, w));
        const sy = Math.max(0, Math.min(selY, h));
        const sw = Math.max(0, Math.min(selW, w - sx));
        const sh = Math.max(0, Math.min(selH, h - sy));

        ctxDim.globalCompositeOperation = 'source-over';
        ctxDim.clearRect(0, 0, w, h);
        ctxDim.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctxDim.fillRect(0, 0, w, sy);
        ctxDim.fillRect(0, sy + sh, w, h - sy - sh);
        ctxDim.fillRect(0, sy, sx, sh);
        ctxDim.fillRect(sx + sw, sy, w - sx - sw, sh);
        if (sw > 0 && sh > 0) {
            ctxDim.strokeStyle = selectionResizeLocked ? '#00a8e8' : '#007acc';
            ctxDim.lineWidth = selectionResizeLocked ? 2 : 1;
            ctxDim.strokeRect(sx + 0.5, sy + 0.5, Math.max(0, sw - 1), Math.max(0, sh - 1));
        }

        updateSelectionHandles();
    }

    const SELECTION_MIN_UI_PX = 28;
    const SELECTION_MIN_DRAG_UI_PX = 8;
    function isSelectionEstablished() {
        if (!uiW || !uiH || !selW || !selH) return false;
        const minCanvas = Math.max(10, Math.round(SELECTION_MIN_UI_PX * (scaleRatio || 1)));
        return uiW >= SELECTION_MIN_UI_PX && uiH >= SELECTION_MIN_UI_PX &&
            selW >= minCanvas && selH >= minCanvas;
    }

    function canConfirmAreaSelection(hasDrag) {
        if (!hasDrag) return false;
        if (uiW < SELECTION_MIN_DRAG_UI_PX || uiH < SELECTION_MIN_DRAG_UI_PX) return false;
        return isSelectionEstablished();
    }

    function syncSelectionFromUi() {
        const ratio = scaleRatio || 1;
        const minW = SELECTION_MIN_UI_PX;
        const minH = SELECTION_MIN_UI_PX;
        const maxW = window.innerWidth;
        const maxH = window.innerHeight;

        if (uiW > 0 && uiW < minW) {
            const cx = uiX + uiW / 2;
            uiW = Math.min(minW, maxW);
            uiX = Math.max(0, Math.min(cx - uiW / 2, maxW - uiW));
        }
        if (uiH > 0 && uiH < minH) {
            const cy = uiY + uiH / 2;
            uiH = Math.min(minH, maxH);
            uiY = Math.max(0, Math.min(cy - uiH / 2, maxH - uiH));
        }

        uiW = Math.max(minW, Math.min(uiW, maxW));
        uiH = Math.max(minH, Math.min(uiH, maxH));
        uiX = Math.max(0, Math.min(uiX, maxW - uiW));
        uiY = Math.max(0, Math.min(uiY, maxH - uiH));

        selX = Math.round(uiX * ratio);
        selY = Math.round(uiY * ratio);
        selW = Math.round(uiW * ratio);
        selH = Math.round(uiH * ratio);
        if (typeof invalidateScreenshotBoundsCache === 'function') invalidateScreenshotBoundsCache();
        if (typeof purgeBlurOutsideSelection === 'function') purgeBlurOutsideSelection();
    }

    /** Resize из dim-зоны: весь квадрант снаружи рамки → нужная сторона/угол. */
    function getSelectionResizeHandleFromPoint(clientX, clientY) {
        if (selectionResizeLocked || state !== 'editing' || selectionMode === 'full' || !uiW || !uiH) {
            return null;
        }
        const right = uiX + uiW;
        const bottom = uiY + uiH;
        const inSelection = clientX >= uiX && clientX <= right &&
            clientY >= uiY && clientY <= bottom;
        if (inSelection) return null;

        const isLeft = clientX < uiX;
        const isRight = clientX > right;
        const isAbove = clientY < uiY;
        const isBelow = clientY > bottom;

        if (isAbove && isLeft) return 'nw';
        if (isAbove && isRight) return 'ne';
        if (isBelow && isRight) return 'se';
        if (isBelow && isLeft) return 'sw';
        if (isAbove) return 'n';
        if (isRight) return 'e';
        if (isBelow) return 's';
        if (isLeft) return 'w';
        return null;
    }

    let resizeSelection = null;
    let moveSelection = null;

    function startSelectionResizeAt(clientX, clientY, handle) {
        if (selectionResizeLocked || state !== 'editing' || selectionMode === 'full') return;
        const right = uiX + uiW;
        const bottom = uiY + uiH;
        resizeSelection = {
            handle,
            left: uiX,
            top: uiY,
            right,
            bottom,
            offsetLeft: clientX - uiX,
            offsetRight: clientX - right,
            offsetTop: clientY - uiY,
            offsetBottom: clientY - bottom
        };
        drawBar.style.display = 'none';
        sideBar.style.display = 'none';
        taskForm.style.display = 'none';
        updateForm.style.display = 'none';
        updateSelectionHandles();
    }

    function resizeSelectedArea(clientX, clientY) {
        if (!resizeSelection) return;
        const minSize = 1;
        const { left, top, right, bottom, handle, offsetLeft, offsetRight, offsetTop, offsetBottom } = resizeSelection;
        const x = Math.max(0, Math.min(clientX, window.innerWidth));
        const y = Math.max(0, Math.min(clientY, window.innerHeight));

        let nextLeft = left;
        let nextRight = right;
        let nextTop = top;
        let nextBottom = bottom;

        if (handle.includes('w') || handle.includes('e')) {
            const anchorX = handle.includes('w') ? right : left;
            const edgeX = handle.includes('w') ? x - offsetLeft : x - offsetRight;
            nextLeft = Math.min(anchorX, edgeX);
            nextRight = Math.max(anchorX, edgeX);
        }
        if (handle.includes('n') || handle.includes('s')) {
            const anchorY = handle.includes('n') ? bottom : top;
            const edgeY = handle.includes('n') ? y - offsetTop : y - offsetBottom;
            nextTop = Math.min(anchorY, edgeY);
            nextBottom = Math.max(anchorY, edgeY);
        }

        uiX = Math.max(0, Math.min(nextLeft, window.innerWidth - minSize));
        uiY = Math.max(0, Math.min(nextTop, window.innerHeight - minSize));
        uiW = Math.max(minSize, Math.min(nextRight, window.innerWidth) - uiX);
        uiH = Math.max(minSize, Math.min(nextBottom, window.innerHeight) - uiY);
        const ratio = scaleRatio || 1;
        selX = Math.round(uiX * ratio);
        selY = Math.round(uiY * ratio);
        selW = Math.round(uiW * ratio);
        selH = Math.round(uiH * ratio);
        scheduleSelectionOverlayRedraw();
    }

    function startSelectionResize(e, handle) {
        e.preventDefault();
        e.stopPropagation();
        startSelectionResizeAt(e.clientX, e.clientY, handle);
    }

    if (selectionHandles) {
        selectionHandles.querySelectorAll('.selection-handle').forEach((handleEl) => {
            handleEl.addEventListener('mousedown', (e) => {
                startSelectionResize(e, handleEl.dataset.handle || 'se');
            });
        });
    }

    function clearResizeSelection() {
        resizeSelection = null;
    }

    function clearMoveSelection() {
        moveSelection = null;
    }

    function isInsideSelectionInterior(clientX, clientY) {
        const inset = 16;
        return clientX > uiX + inset && clientX < uiX + uiW - inset &&
            clientY > uiY + inset && clientY < uiY + uiH - inset;
    }

    function startSelectionMoveAt(clientX, clientY) {
        if (selectionResizeLocked || state !== 'editing' || selectionMode === 'full') return;
        moveSelection = {
            startX: clientX,
            startY: clientY,
            origUiX: uiX,
            origUiY: uiY
        };
        drawBar.style.display = 'none';
        sideBar.style.display = 'none';
        taskForm.style.display = 'none';
        updateForm.style.display = 'none';
        updateSelectionHandles();
    }

    function moveSelectedArea(clientX, clientY) {
        if (!moveSelection) return;
        uiX = moveSelection.origUiX + (clientX - moveSelection.startX);
        uiY = moveSelection.origUiY + (clientY - moveSelection.startY);
        const ratio = scaleRatio || 1;
        selX = Math.round(uiX * ratio);
        selY = Math.round(uiY * ratio);
        scheduleSelectionOverlayRedraw();
    }

    function resetAll() {
        clearSelectionResizeLock();
        if (typeof cancelPenSmoothAnim === 'function') cancelPenSmoothAnim();
        clearResizeSelection();
        clearMoveSelection();
        if (activeTextBox) {
            activeTextBox.remove();
            activeTextBox = null;
            drawCanvas.style.pointerEvents = '';
        }
        _cropCanvas = null;
        state = 'idle';
        hideToolbars();
        if (typeof window.hideQuickTooltip === 'function') window.hideQuickTooltip(true);
        const w = bgCanvas.width; const h = bgCanvas.height;
        ctxBg.clearRect(0,0,w,h);
        ctxDim.clearRect(0,0,w,h);
        ctxDraw.clearRect(0,0,w,h);
        ctxBlur.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
        ctxBlurMask.clearRect(0, 0, blurMaskCanvas.width, blurMaskCanvas.height);
        if (typeof clearPenPreviewLayer === 'function') clearPenPreviewLayer();
        clearDrawLayersForModeSwitch();

        document.getElementById('inp-title').value = ''; 
        document.getElementById('inp-desc').value = ''; 
        document.getElementById('inp-date').value = '';
        document.getElementById('form-submit').innerHTML = 'Сохранить';

        const btnSaveDisk = document.getElementById('btn-save-disk');
        if (btnSaveDisk) {
            btnSaveDisk.classList.remove('active');
            btnSaveDisk.title = 'Сохранить в папку';
            btnSaveDisk.style.pointerEvents = 'auto';
        }

        stepCounter = 1;

        if (typeof window.resetVectorDrawHistory === 'function') {
            window.resetVectorDrawHistory();
        }

        if (typeof freeSnapshotMemory === 'function') {
            undoStack.forEach(freeSnapshotMemory);
            redoStack.forEach(freeSnapshotMemory);
        }
        if (typeof window.freeBlurScratchMemory === 'function') {
            window.freeBlurScratchMemory();
        }
        undoStack = [];
        redoStack = [];
    }

    function startSelectingArea() {
        if (state !== 'editing') return;
        clearSelectionResizeLock();
        resetDrawPreviewState();
        selectionMode = 'area';
        toolbarLayoutMode = 'selection';
        updateSelectAreaButton();
        selX = 0;
        selY = 0;
        selW = 0;
        selH = 0;
        uiX = 0;
        uiY = 0;
        uiW = 0;
        uiH = 0;
        state = 'idle';
        hideToolbars();
        hideSelectionHandles();
        paintFullAreaDimOverlay();
    }

    function switchToFullScreenSelection() {
        if (state === 'idle') {
            setInitialFullSelection();
            return;
        }
        if (state !== 'editing') return;
        selectionMode = 'full';
        toolbarLayoutMode = 'full';
        updateSelectAreaButton();
        setInitialFullSelection();
    }

    function resetDrawPreviewState() {
        if (typeof cancelPenSmoothAnim === 'function') cancelPenSmoothAnim();
        if (typeof clearPenPreviewLayer === 'function') clearPenPreviewLayer();
    }

    function clearDrawLayersForModeSwitch() {
        clearSelectionResizeLock();
        resetDrawPreviewState();
        ctxDraw.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        ctxBlur.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
        ctxBlurMask.clearRect(0, 0, blurMaskCanvas.width, blurMaskCanvas.height);

        if (typeof freeSnapshotMemory === 'function') {
            undoStack.forEach(freeSnapshotMemory);
            redoStack.forEach(freeSnapshotMemory);
        }

        undoStack = [];
        redoStack = [];
        stepCounter = 1;

        if (typeof window.resetVectorDrawHistory === 'function') {
            window.resetVectorDrawHistory();
        }
    }

    function toggleSelectionMode() {
        if (document.body.classList.contains('float-edit')) return;
        clearDrawLayersForModeSwitch();
        if (selectionMode === 'full') startSelectingArea();
        else switchToFullScreenSelection();
    }

    function setInitialFullSelection() {
        clearSelectionResizeLock();
        selectionMode = 'full';
        toolbarLayoutMode = 'full';
        updateSelectAreaButton();
        selX = 0;
        selY = 0;
        selW = bgCanvas.width;
        selH = bgCanvas.height;
        uiX = 0;
        uiY = 0;
        uiW = window.innerWidth;
        uiH = window.innerHeight;

        redrawSelectionOverlay(0.18);
        state = 'editing';
        void showToolbars().catch(() => {});
    }

    function setInitialAreaSelection() {
        clearSelectionResizeLock();
        selectionMode = 'area';
        toolbarLayoutMode = 'selection';
        updateSelectAreaButton();
        selX = 0;
        selY = 0;
        selW = 0;
        selH = 0;
        uiX = 0;
        uiY = 0;
        uiW = 0;
        uiH = 0;
        state = 'idle';
        hideToolbars();
        hideSelectionHandles();
        paintFullAreaDimOverlay();
    }

    function restoreSelection(selection) {
        if (!selection || !selection.selW || !selection.selH) {
            resetAll();
            return;
        }
        selX = selection.selX;
        selY = selection.selY;
        selW = selection.selW;
        selH = selection.selH;
        uiX = selection.uiX;
        uiY = selection.uiY;
        uiW = selection.uiW;
        uiH = selection.uiH;

        state = 'editing';
        redrawSelectionOverlay();
        void showToolbars().catch(() => {});
    }

    const SELECTION_HANDLE_CURSORS = {
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        nw: 'nwse-resize',
        se: 'nwse-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize'
    };

    const UI_CURSOR_BLOCK_SELECTOR = '.toolbar, #task-form, #update-form, #settings-form, #fio-overlay, .quick-tooltip, #cropper-notice, .text-input-box';

    function updateDrawLayerCursor(clientX, clientY, target) {
        if (!drawCanvas) return;
        if (target && target.closest && target.closest(UI_CURSOR_BLOCK_SELECTOR + ', .selection-handle')) {
            drawCanvas.style.cursor = '';
            return;
        }
        if (resizeSelection && resizeSelection.handle) {
            drawCanvas.style.cursor = SELECTION_HANDLE_CURSORS[resizeSelection.handle] || 'default';
            return;
        }
        if (moveSelection) {
            drawCanvas.style.cursor = 'move';
            return;
        }
        if (state === 'selecting') {
            drawCanvas.style.cursor = 'crosshair';
            return;
        }
        if (state !== 'editing') {
            drawCanvas.style.cursor = '';
            return;
        }
        if (document.body.classList.contains('float-edit')
            && document.body.classList.contains('float-move')) {
            drawCanvas.style.cursor = 'move';
            return;
        }
        if (selectionMode === 'full') {
            drawCanvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
            return;
        }
        if (activeTextBox) {
            drawCanvas.style.cursor = '';
            return;
        }
        const edgeHandle = getSelectionResizeHandleFromPoint(clientX, clientY);
        if (edgeHandle) {
            drawCanvas.style.cursor = SELECTION_HANDLE_CURSORS[edgeHandle] || 'default';
            return;
        }
        if (currentTool === 'text') {
            const inSel = clientX >= uiX && clientX <= uiX + uiW &&
                clientY >= uiY && clientY <= uiY + uiH;
            drawCanvas.style.cursor = inSel ? 'text' : 'default';
            return;
        }
        drawCanvas.style.cursor = 'crosshair';
    }

    window.updateDrawLayerCursor = updateDrawLayerCursor;
    window.startSelectionMoveAt = startSelectionMoveAt;
    window.startSelectionResizeAt = startSelectionResizeAt;
    window.resizeSelectedArea = resizeSelectedArea;
    window.scheduleSelectionOverlayRedraw = scheduleSelectionOverlayRedraw;
    window.moveSelectedArea = moveSelectedArea;
    window.clearMoveSelection = clearMoveSelection;
    window.clearResizeSelection = clearResizeSelection;
    window.isInsideSelectionInterior = isInsideSelectionInterior;
    window.getSelectionResizeHandleFromPoint = getSelectionResizeHandleFromPoint;
    window.resetAll = resetAll;
    window.setInitialAreaSelection = setInitialAreaSelection;
    window.paintFullAreaDimOverlay = paintFullAreaDimOverlay;
    window.setInitialFullSelection = setInitialFullSelection;
    window.switchToFullScreenSelection = switchToFullScreenSelection;
    window.isSelectionEstablished = isSelectionEstablished;
    window.clearSelectionResizeLock = clearSelectionResizeLock;
    window.syncSelectionFromUi = syncSelectionFromUi;
