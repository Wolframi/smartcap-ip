    // --- ИНСТРУМЕНТЫ ---
    let _activeToolBtn = null;

    function setTool(tool) {
        if (tool !== 'text' && window.activeTextBox && typeof cancelTextBox === 'function') {
            cancelTextBox(window.activeTextBox);
        }
        if (typeof isDrawing !== 'undefined' && isDrawing && typeof window.abortActiveDrawing === 'function') {
            window.abortActiveDrawing();
        }
        currentTool = tool;
        if (_activeToolBtn) _activeToolBtn.classList.remove('active');
        const inFloatMove = document.body.classList.contains('float-edit')
            && document.body.classList.contains('float-move');
        const btn = document.getElementById('btn-' + tool);
        if (btn && !inFloatMove) {
            btn.classList.add('active');
            _activeToolBtn = btn;
        } else {
            _activeToolBtn = null;
        }
        if (tool === 'blur') ensureBlurLayersSized();
        if (typeof schedulePersistCropperSettings === 'function') schedulePersistCropperSettings();
    }

    function clearActiveDrawTool() {
        if (_activeToolBtn) {
            _activeToolBtn.classList.remove('active');
            _activeToolBtn = null;
        }
    }

    function syncActiveTextBoxColor() {
        if (!window.activeTextBox) return;
        window.activeTextBox.style.color = typeof getMainStrokeColor === 'function'
            ? getMainStrokeColor()
            : currentColor;
    }

    function setColor(hex) {
        currentColor = hex;
        pickerThumb.style.background = hex;
        syncActiveTextBoxColor();
        if (typeof schedulePersistCropperSettings === 'function') schedulePersistCropperSettings();
    }
    const OPACITY_MIN_VISIBLE = 0.05;

    function opacityToSliderValue(opacity) {
        const o = Math.max(OPACITY_MIN_VISIBLE, Math.min(1, opacity));
        return o <= OPACITY_MIN_VISIBLE ? 0 : o;
    }

    /** val — видимость штриха 0…1 (вправо = ярче; край слева = почти невидимо). */
    function setOpacity(val) {
        let opacity = parseFloat(val);
        if (!Number.isFinite(opacity)) opacity = 1;
        opacity = Math.round(opacity * 10) / 10;
        if (opacity <= 0) opacity = OPACITY_MIN_VISIBLE;
        opacity = Math.min(1, opacity);
        currentOpacity = opacity;
        const slider = document.getElementById('opacity-slider');
        const sliderVal = opacityToSliderValue(opacity);
        if (slider && slider.value !== String(sliderVal)) slider.value = String(sliderVal);
        if (typeof schedulePersistCropperSettings === 'function') schedulePersistCropperSettings();
    }
    function setToolSize(val, snap) {
        const doSnap = snap === true;
        const raw = parseFloat(val);
        let size = Math.round(raw);
        if (!Number.isFinite(raw)) size = TOOL_SIZE_DEFAULT;
        size = Math.max(TOOL_SIZE_MIN, Math.min(TOOL_SIZE_MAX, size));
        currentToolSize = size;
        const slider = document.getElementById('tool-size-slider');
        const wrap = document.getElementById('tool-size-wrap');
        const title = String(size);
        if (slider) {
            if (doSnap) slider.value = String(size);
            slider.setAttribute('title', title);
        }
        if (wrap) wrap.setAttribute('title', 'Размер');
        if (typeof schedulePersistCropperSettings === 'function') schedulePersistCropperSettings();
    }

    /** Сколько шагов «назад» помним при новом рисовании */
    const UNDO_STACK_MAX = 30;
    const VECTOR_DRAW_TOOLS = new Set(['pen', 'line', 'arrow', 'rect', 'oval', 'step']);
    let drawVectorOps = [];
    let drawVectorBaseline = null;
    /** Если патч больше этой доли холста — сохраняем полный клон (paste, full-screen). */
    const PATCH_FULL_THRESHOLD = 0.35;
    const _blurScratch = {};
    const _scratchCtx = {};

    function captureCanvasFastClone(sourceCanvas) {
        const c = document.createElement('canvas');
        c.width = sourceCanvas.width;
        c.height = sourceCanvas.height;
        c.getContext('2d').drawImage(sourceCanvas, 0, 0);
        return c;
    }

    function clampRectToCanvas(rect, cw, ch) {
        if (!rect || cw < 1 || ch < 1) return { x: 0, y: 0, w: 0, h: 0 };
        const x = Math.max(0, Math.floor(rect.x));
        const y = Math.max(0, Math.floor(rect.y));
        const x2 = Math.min(cw, Math.ceil(rect.x + rect.w));
        const y2 = Math.min(ch, Math.ceil(rect.y + rect.h));
        return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
    }

    function intersectRects(a, b) {
        if (!a || !b || a.w < 1 || a.h < 1 || b.w < 1 || b.h < 1) {
            return { x: 0, y: 0, w: 0, h: 0 };
        }
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.w, b.x + b.w);
        const y2 = Math.min(a.y + a.h, b.y + b.h);
        return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
    }

    function isBlurClippedToFrame() {
        return document.body.classList.contains('float-edit');
    }

    /** В float — обрезка по рамке скриншота; в обычном режиме размытие может выходить за рамку выделения. */
    function clampRectToSelection(rect) {
        if (!rect) return { x: 0, y: 0, w: 0, h: 0 };
        if (!isBlurClippedToFrame()) return rect;
        if (typeof selectionMode === 'undefined' || selectionMode === 'full') {
            if (typeof selW !== 'undefined' && selW > 0 && selH > 0) {
                return intersectRects(rect, { x: selX, y: selY, w: selW, h: selH });
            }
            return rect;
        }
        if (typeof selW === 'undefined' || !selW || !selH) return rect;
        return intersectRects(rect, { x: selX, y: selY, w: selW, h: selH });
    }

    function withBlurSelectionClip(drawFn) {
        if (!isBlurClippedToFrame()) {
            drawFn();
            return;
        }
        if (typeof selectionMode === 'undefined' || selectionMode === 'full' || !selW || !selH) {
            drawFn();
            return;
        }
        ctxBlur.save();
        ctxBlur.beginPath();
        ctxBlur.rect(selX, selY, selW, selH);
        ctxBlur.clip();
        drawFn();
        ctxBlur.restore();
    }

    /** Удаляет размытие за пределами рамки — только в float. */
    function purgeBlurOutsideSelection() {
        if (!isBlurClippedToFrame()) return;
        if (!selW || !selH || !blurCanvas.width) return;
        const cw = blurCanvas.width;
        const ch = blurCanvas.height;
        const sx = Math.max(0, selX);
        const sy = Math.max(0, selY);
        const sw = Math.min(selW, cw - sx);
        const sh = Math.min(selH, ch - sy);
        if (sw < 1 || sh < 1) {
            ctxBlur.clearRect(0, 0, cw, ch);
            return;
        }
        if (sy > 0) ctxBlur.clearRect(0, 0, cw, sy);
        if (sy + sh < ch) ctxBlur.clearRect(0, sy + sh, cw, ch - sy - sh);
        if (sx > 0) ctxBlur.clearRect(0, sy, sx, sh);
        if (sx + sw < cw) ctxBlur.clearRect(sx + sw, sy, cw - sx - sw, sh);
    }

    function getSelectionCanvasBounds() {
        const cw = drawCanvas.width;
        const ch = drawCanvas.height;
        if (!cw || !ch) return { x: 0, y: 0, w: 0, h: 0 };
        const pad = getStrokeBoundsPad();
        if (typeof selW !== 'undefined' && selW > 0 && selH > 0) {
            return clampRectToCanvas(
                { x: selX - pad, y: selY - pad, w: selW + pad * 2, h: selH + pad * 2 },
                cw, ch
            );
        }
        return { x: 0, y: 0, w: cw, h: ch };
    }

    function getBlurLayerUndoBounds() {
        const sel = getSelectionCanvasBounds();
        const pad = getBlurPaddingPx(getBlurStrengthPx());
        return expandBlurRect(sel, pad, blurMaskCanvas.width || bgCanvas.width, blurMaskCanvas.height || bgCanvas.height);
    }

    function captureCanvasRegionUndo(sourceCanvas, ctx, rect) {
        const cw = sourceCanvas.width;
        const ch = sourceCanvas.height;
        const r = clampRectToCanvas(rect, cw, ch);
        if (r.w < 1 || r.h < 1) return null;
        if (r.w * r.h >= cw * ch * PATCH_FULL_THRESHOLD) {
            return { kind: 'full', canvas: captureCanvasFastClone(sourceCanvas) };
        }
        return { kind: 'patch', x: r.x, y: r.y, w: r.w, h: r.h, data: ctx.getImageData(r.x, r.y, r.w, r.h) };
    }

    function captureDrawUndoPatch(drawBounds) {
        if (drawBounds === null) {
            return { kind: 'full', canvas: captureCanvasFastClone(drawCanvas) };
        }
        const patch = captureCanvasRegionUndo(drawCanvas, ctxDraw, drawBounds || getSelectionCanvasBounds());
        return patch || { kind: 'full', canvas: captureCanvasFastClone(drawCanvas) };
    }

    function isVectorDrawTool(tool) {
        return VECTOR_DRAW_TOOLS.has(tool);
    }

    function cloneVectorOp(op) {
        if (!op) return null;
        const c = {
            tool: op.tool,
            color: op.color,
            opacity: op.opacity,
            width: op.width
        };
        if (op.points) c.points = op.points.map(p => ({ x: p.x, y: p.y }));
        if (op.x1 != null) c.x1 = op.x1;
        if (op.y1 != null) c.y1 = op.y1;
        if (op.x2 != null) c.x2 = op.x2;
        if (op.y2 != null) c.y2 = op.y2;
        if (op.x != null) c.x = op.x;
        if (op.y != null) c.y = op.y;
        if (op.label != null) c.label = op.label;
        return c;
    }

    function cloneVectorOps(ops) {
        return (ops || []).map(cloneVectorOp);
    }

    function captureVectorBaselineIfNeeded() {
        if (drawVectorBaseline !== null) return;
        if (!drawCanvas || drawCanvas.width < 1 || drawCanvas.height < 1) return;
        drawVectorBaseline = captureCanvasFastClone(drawCanvas);
    }

    function resetVectorDrawHistory() {
        drawVectorOps = [];
        if (drawVectorBaseline) {
            drawVectorBaseline.width = 0;
            drawVectorBaseline.height = 0;
            drawVectorBaseline = null;
        }
    }

    function registerVectorDrawOp(op) {
        drawVectorOps.push(cloneVectorOp(op));
    }

    /** После commit: весь draw-layer в baseline, ops очищаются — canvas и undo не расходятся. */
    function flattenVectorDrawHistory() {
        if (!drawCanvas || drawCanvas.width < 1 || drawCanvas.height < 1) return;
        if (drawVectorBaseline) {
            drawVectorBaseline.width = 0;
            drawVectorBaseline.height = 0;
        }
        drawVectorBaseline = captureCanvasFastClone(drawCanvas);
        drawVectorOps = [];
    }

    function rebuildDrawLayerFromVectors() {
        if (!drawCanvas || !ctxDraw || drawCanvas.width < 1 || drawCanvas.height < 1) return;
        ctxDraw.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        if (drawVectorBaseline) {
            ctxDraw.drawImage(drawVectorBaseline, 0, 0);
        }
        for (const op of drawVectorOps) {
            if (typeof window.renderDrawVectorOp === 'function') {
                window.renderDrawVectorOp(ctxDraw, op);
            }
        }
    }

    function syncDrawLayerFromVectorHistory() {
        if (drawVectorOps.length > 0 || drawVectorBaseline) {
            rebuildDrawLayerFromVectors();
        }
    }

    function restoreCanvasRegionUndo(targetCtx, cw, ch, undoPatch) {
        if (!undoPatch) return;
        if (undoPatch.kind === 'full' && undoPatch.canvas) {
            targetCtx.save();
            targetCtx.globalAlpha = 1;
            targetCtx.clearRect(0, 0, cw, ch);
            targetCtx.drawImage(undoPatch.canvas, 0, 0);
            targetCtx.restore();
            return;
        }
        if (undoPatch.kind === 'patch' && undoPatch.data) {
            targetCtx.putImageData(undoPatch.data, undoPatch.x, undoPatch.y);
            return;
        }
        if (undoPatch.kind === 'imageData' && undoPatch.data) {
            targetCtx.putImageData(undoPatch.data, 0, 0);
            return;
        }
        if (undoPatch.kind === 'tiles' && undoPatch.tiles) {
            undoPatch.tiles.forEach(t => targetCtx.putImageData(t.data, t.x, t.y));
        }
    }

    function restoreDrawUndo(drawUndo) {
        if (!drawUndo) return;
        restoreCanvasRegionUndo(ctxDraw, drawCanvas.width, drawCanvas.height, drawUndo);
    }

    function normalizeBlurRect(x, y, w, h) {
        const rx = Math.round(Math.min(x, x + w));
        const ry = Math.round(Math.min(y, y + h));
        return { x: rx, y: ry, w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) };
    }

    function expandBlurRect(rect, pad, maxW, maxH) {
        const x = Math.max(0, rect.x - pad);
        const y = Math.max(0, rect.y - pad);
        const x2 = Math.min(maxW, rect.x + rect.w + pad);
        const y2 = Math.min(maxH, rect.y + rect.h + pad);
        return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
    }

    function historySnapshotCaptureFlags(entry) {
        if (!entry) return { includeBlurLayers: false, includeBgLayer: false };
        return {
            includeBlurLayers: !!(
                entry.blurMaskPatch || entry.blurResultPatch
                || entry.blurMaskCanvas || entry.blurResultCanvas
                || entry.blurMaskData || entry.blurResultData
                || entry.blurMask || entry.blurResult
            ),
            includeBgLayer: !!(entry.bgPatch || entry.bgCanvas)
        };
    }

    /** Снимок слоёв: векторные штрихи или растровый патч draw-layer. */
    function captureHistorySnapshot(includeBlurLayers = false, includeBgLayer = false, drawBounds = null) {
        if (drawVectorOps.length > 0 || drawVectorBaseline) {
            captureVectorBaselineIfNeeded();
        }
        const snapshot = {
            stepCounter: stepCounter
        };
        if (drawVectorOps.length > 0 || drawVectorBaseline) {
            snapshot.type = 'vector-draw';
            snapshot.vectorOps = cloneVectorOps(drawVectorOps);
            snapshot.drawBaseline = drawVectorBaseline
                ? captureCanvasFastClone(drawVectorBaseline)
                : null;
        } else {
            snapshot.drawUndo = captureDrawUndoPatch(drawBounds);
        }
        if (includeBlurLayers) {
            ensureBlurLayersSized();
            if (blurCanvas.width > 0 && blurCanvas.height > 0) {
                snapshot.blurResultPatch = { kind: 'full', canvas: captureCanvasFastClone(blurCanvas) };
            }
            if (blurMaskCanvas.width > 0 && blurMaskCanvas.height > 0) {
                snapshot.blurMaskPatch = { kind: 'full', canvas: captureCanvasFastClone(blurMaskCanvas) };
            }
        }
        if (includeBgLayer) {
            snapshot.bgPatch = captureCanvasRegionUndo(bgCanvas, ctxBg, getSelectionCanvasBounds());
        }
        return snapshot;
    }

    function applyHistorySnapshot(entry) {
        if (!entry) return;
        if (entry.type === 'selection') {
            restoreSelection(entry.prevSelection);
            return;
        }
        if (entry.type === 'vector-draw') {
            drawVectorOps = cloneVectorOps(entry.vectorOps || []);
            if (entry.drawBaseline) {
                if (drawVectorBaseline) {
                    drawVectorBaseline.width = 0;
                    drawVectorBaseline.height = 0;
                }
                drawVectorBaseline = captureCanvasFastClone(entry.drawBaseline);
            } else {
                if (drawVectorBaseline) {
                    drawVectorBaseline.width = 0;
                    drawVectorBaseline.height = 0;
                }
                drawVectorBaseline = null;
            }
            rebuildDrawLayerFromVectors();
        } else if (entry.data) {
            resetVectorDrawHistory();
            ctxDraw.putImageData(entry.data, 0, 0);
        } else if (entry.drawUndo) {
            resetVectorDrawHistory();
            restoreDrawUndo(entry.drawUndo);
        }
        if (entry.bgPatch) {
            restoreCanvasRegionUndo(ctxBg, bgCanvas.width, bgCanvas.height, entry.bgPatch);
        } else if (entry.bgCanvas) {
            ctxBg.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
            ctxBg.drawImage(entry.bgCanvas, 0, 0);
        }
        if (entry.blurMaskPatch || entry.blurResultPatch || entry.blurMaskData || entry.blurResultData || entry.blurMaskCanvas || entry.blurResultCanvas) {
            restoreBlurUndo({
                blurMaskPatch: entry.blurMaskPatch,
                blurResultPatch: entry.blurResultPatch,
                blurMaskData: entry.blurMaskData,
                blurResultData: entry.blurResultData,
                blurMaskCanvas: entry.blurMaskCanvas,
                blurResultCanvas: entry.blurResultCanvas
            });
        } else if (entry.blurMask || entry.blurResult) {
            if (entry.blurMask) ctxBlurMask.putImageData(entry.blurMask, 0, 0);
            else ctxBlurMask.clearRect(0, 0, blurMaskCanvas.width, blurMaskCanvas.height);
            if (entry.blurResult) ctxBlur.putImageData(entry.blurResult, 0, 0);
            else ctxBlur.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
        }
        if (typeof entry.stepCounter === 'number') {
            stepCounter = Math.max(1, entry.stepCounter);
        }
    }

    function restoreBlurUndo(entry) {
        if (entry.blurMaskPatch) {
            restoreCanvasRegionUndo(ctxBlurMask, blurMaskCanvas.width, blurMaskCanvas.height, entry.blurMaskPatch);
        } else if (entry.blurMaskData) {
            ctxBlurMask.putImageData(entry.blurMaskData, 0, 0);
        } else if (entry.blurMaskCanvas) {
            ctxBlurMask.clearRect(0, 0, blurMaskCanvas.width, blurMaskCanvas.height);
            ctxBlurMask.drawImage(entry.blurMaskCanvas, 0, 0);
        } else {
            ctxBlurMask.clearRect(0, 0, blurMaskCanvas.width, blurMaskCanvas.height);
        }
        if (entry.blurResultPatch) {
            restoreCanvasRegionUndo(ctxBlur, blurCanvas.width, blurCanvas.height, entry.blurResultPatch);
        } else if (entry.blurResultData) {
            ctxBlur.putImageData(entry.blurResultData, 0, 0);
        } else if (entry.blurResultCanvas) {
            ctxBlur.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
            ctxBlur.drawImage(entry.blurResultCanvas, 0, 0);
        } else {
            ctxBlur.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
        }
        purgeBlurOutsideSelection();
    }

    function freeUndoPatch(patch) {
        if (!patch) return;
        if (patch.canvas) {
            patch.canvas.width = 0;
            patch.canvas.height = 0;
        }
        if (patch.data) patch.data = null;
        if (patch.tiles) patch.tiles.forEach(t => { if (t.data) t.data = null; });
    }

    function freeSnapshotMemory(snapshot) {
        if (!snapshot) return;
        freeUndoPatch(snapshot.drawUndo);
        if (snapshot.drawBaseline) {
            snapshot.drawBaseline.width = 0;
            snapshot.drawBaseline.height = 0;
            snapshot.drawBaseline = null;
        }
        if (snapshot.vectorOps) snapshot.vectorOps = null;
        freeUndoPatch(snapshot.blurMaskPatch);
        freeUndoPatch(snapshot.blurResultPatch);
        freeUndoPatch(snapshot.bgPatch);
        if (snapshot.blurMaskCanvas) {
            snapshot.blurMaskCanvas.width = 0;
            snapshot.blurMaskCanvas.height = 0;
        }
        if (snapshot.blurResultCanvas) {
            snapshot.blurResultCanvas.width = 0;
            snapshot.blurResultCanvas.height = 0;
        }
        if (snapshot.bgCanvas) {
            snapshot.bgCanvas.width = 0;
            snapshot.bgCanvas.height = 0;
        }
    }

    function getDefaultDrawUndoBounds(tool, mx, my) {
        if (tool === 'paste') return null;
        if (tool === 'step') {
            const r = 26 + getStrokeBoundsPad();
            return { x: mx - r, y: my - r, w: r * 2, h: r * 2 };
        }
        return getSelectionCanvasBounds();
    }

    function pushUndoState(tool, mx, my, drawBoundsOverride) {
        if (redoStack.length > 0) {
            redoStack.forEach(freeSnapshotMemory);
            redoStack = [];
        }
        const drawBounds = drawBoundsOverride !== undefined
            ? drawBoundsOverride
            : getDefaultDrawUndoBounds(tool, mx, my);
        if (isVectorDrawTool(tool)) {
            captureVectorBaselineIfNeeded();
            if (typeof window.rebuildDrawLayerFromVectors === 'function') {
                window.rebuildDrawLayerFromVectors();
            }
        }
        undoStack.push(captureHistorySnapshot(
            tool === 'blur' || tool === 'paste',
            tool === 'paste',
            isVectorDrawTool(tool) ? null : drawBounds
        ));
        if (undoStack.length > UNDO_STACK_MAX) {
            const removed = undoStack.shift();
            freeSnapshotMemory(removed);
        }
    }

    function getStrokeBoundsPad() {
        if (typeof getStrokeHaloExtentPx === 'function') return getStrokeHaloExtentPx();
        return (typeof getStrokeHaloWidth === 'function' ? getStrokeHaloWidth() : 16) + 6;
    }

    function boundsFromPoints(points) {
        if (!points || !points.length) return null;
        let minX = points[0].x;
        let maxX = points[0].x;
        let minY = points[0].y;
        let maxY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        const pad = getStrokeBoundsPad();
        return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }

    function boundsFromShapeDraft(endX, endY) {
        const pad = currentTool === 'blur' ? 6 : getStrokeBoundsPad();
        let minX = Math.min(shapeStartX, endX);
        let maxX = Math.max(shapeStartX, endX);
        let minY = Math.min(shapeStartY, endY);
        let maxY = Math.max(shapeStartY, endY);
        if (currentTool === 'arrow' && typeof getArrowHeadLength === 'function') {
            const head = getArrowHeadLength();
            minX -= head;
            minY -= head;
            maxX += head;
            maxY += head;
        }
        return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }

    function getScratchCanvas(name, w, h) {
        let canvas = _blurScratch[name];
        if (!canvas) {
            canvas = document.createElement('canvas');
            _blurScratch[name] = canvas;
            delete _scratchCtx[name];
        }
        if (canvas.width < w || canvas.height < h) {
            canvas.width = Math.max(canvas.width, w);
            canvas.height = Math.max(canvas.height, h);
            delete _scratchCtx[name];
        }
        return canvas;
    }

    function getScratchContext(name, w, h) {
        const canvas = getScratchCanvas(name, w, h);
        let ctx = _scratchCtx[name];
        if (!ctx) {
            ctx = canvas.getContext('2d');
            _scratchCtx[name] = ctx;
        }
        return ctx;
    }

    function ensureBlurLayersSized() {
        const w = bgCanvas.width;
        const h = bgCanvas.height;
        if (!w || !h) return;
        if (blurCanvas.width !== w || blurCanvas.height !== h) {
            blurCanvas.width = w;
            blurCanvas.height = h;
            ctxBlur.clearRect(0, 0, w, h);
        }
        if (blurMaskCanvas.width !== w || blurMaskCanvas.height !== h) {
            blurMaskCanvas.width = w;
            blurMaskCanvas.height = h;
            ctxBlurMask.clearRect(0, 0, w, h);
        }
    }

    /** Сила размытия в CSS-пикселях; в canvas умножается на scaleRatio. */
    function getBlurStrengthPx() {
        return BLUR_STRENGTH * (window.scaleRatio || 1);
    }

    function getBlurPaddingPx(blurStrength) {
        return Math.ceil(blurStrength * 3);
    }

    /** Скопировать фрагмент canvas в patch с повторением крайних пикселей за границами. */
    function drawCanvasPatchClamped(ctx, canvas, originX, originY, patchW, patchH, destX, destY, compositeOp) {
        if (!canvas || canvas.width < 1 || canvas.height < 1) return;
        const cw = canvas.width;
        const ch = canvas.height;
        ctx.save();
        if (compositeOp) ctx.globalCompositeOperation = compositeOp;

        const sx0 = originX;
        const sy0 = originY;
        const sx1 = originX + patchW;
        const sy1 = originY + patchH;

        const visX0 = Math.max(0, sx0);
        const visY0 = Math.max(0, sy0);
        const visX1 = Math.min(cw, sx1);
        const visY1 = Math.min(ch, sy1);

        if (visX1 > visX0 && visY1 > visY0) {
            ctx.drawImage(
                canvas,
                visX0, visY0, visX1 - visX0, visY1 - visY0,
                destX + (visX0 - sx0), destY + (visY0 - sy0),
                visX1 - visX0, visY1 - visY0
            );
        }

        const leftPad = Math.max(0, -sx0);
        if (leftPad > 0) {
            const col = 0;
            const y0 = Math.max(0, sy0);
            const y1 = Math.min(ch, sy1);
            if (y1 > y0) {
                ctx.drawImage(canvas, col, y0, 1, y1 - y0, destX, destY + (y0 - sy0), leftPad, y1 - y0);
            }
        }

        const rightPad = Math.max(0, sx1 - cw);
        if (rightPad > 0) {
            const col = cw - 1;
            const y0 = Math.max(0, sy0);
            const y1 = Math.min(ch, sy1);
            if (y1 > y0) {
                ctx.drawImage(
                    canvas, col, y0, 1, y1 - y0,
                    destX + patchW - rightPad, destY + (y0 - sy0),
                    rightPad, y1 - y0
                );
            }
        }

        const topPad = Math.max(0, -sy0);
        if (topPad > 0) {
            const row = 0;
            const x0 = Math.max(0, sx0);
            const x1 = Math.min(cw, sx1);
            if (x1 > x0) {
                ctx.drawImage(canvas, x0, row, x1 - x0, 1, destX + (x0 - sx0), destY, x1 - x0, topPad);
            }
        }

        const bottomPad = Math.max(0, sy1 - ch);
        if (bottomPad > 0) {
            const row = ch - 1;
            const x0 = Math.max(0, sx0);
            const x1 = Math.min(cw, sx1);
            if (x1 > x0) {
                ctx.drawImage(
                    canvas, x0, row, x1 - x0, 1,
                    destX + (x0 - sx0), destY + patchH - bottomPad,
                    x1 - x0, bottomPad
                );
            }
        }

        if (leftPad > 0 && topPad > 0) {
            ctx.drawImage(canvas, 0, 0, 1, 1, destX, destY, leftPad, topPad);
        }
        if (rightPad > 0 && topPad > 0) {
            ctx.drawImage(canvas, cw - 1, 0, 1, 1, destX + patchW - rightPad, destY, rightPad, topPad);
        }
        if (leftPad > 0 && bottomPad > 0) {
            ctx.drawImage(canvas, 0, ch - 1, 1, 1, destX, destY + patchH - bottomPad, leftPad, bottomPad);
        }
        if (rightPad > 0 && bottomPad > 0) {
            ctx.drawImage(canvas, cw - 1, ch - 1, 1, 1, destX + patchW - rightPad, destY + patchH - bottomPad, rightPad, bottomPad);
        }

        ctx.restore();
    }

    /** Размывает только фон; рисунки остаются на draw-layer поверх. Жёсткая прямоугольная маска. */
    function applyBlurRect(x, y, w, h) {
        ensureBlurLayersSized();
        const rect = clampRectToSelection(normalizeBlurRect(x, y, w, h));
        const { x: rx, y: ry, w: rw, h: rh } = rect;
        if (rw < 2 || rh < 2) return;

        const blurStrength = getBlurStrengthPx();
        const pad = getBlurPaddingPx(blurStrength);
        const patchW = rw + pad * 2;
        const patchH = rh + pad * 2;
        const originX = rx - pad;
        const originY = ry - pad;

        const sctx = getScratchContext('blurSource', patchW, patchH);
        sctx.clearRect(0, 0, patchW, patchH);
        drawCanvasPatchClamped(sctx, bgCanvas, originX, originY, patchW, patchH, 0, 0);

        const bctx = getScratchContext('blurredOut', patchW, patchH);
        bctx.clearRect(0, 0, patchW, patchH);
        bctx.filter = `blur(${blurStrength}px)`;
        bctx.drawImage(_blurScratch.blurSource, 0, 0, patchW, patchH, 0, 0, patchW, patchH);
        bctx.filter = 'none';

        withBlurSelectionClip(() => {
            ctxBlur.save();
            ctxBlur.beginPath();
            ctxBlur.rect(rx, ry, rw, rh);
            ctxBlur.clip();
            ctxBlur.globalCompositeOperation = 'copy';
            ctxBlur.drawImage(_blurScratch.blurredOut, pad, pad, rw, rh, rx, ry, rw, rh);
            ctxBlur.restore();
        });
    }
    window.applyBlurRect = applyBlurRect;

    /** Применить размытие один раз (mouseup), без живого превью на blur-слое. */
    function commitBlurRect(x, y, w, h) {
        applyBlurRect(x, y, w, h);
        purgeBlurOutsideSelection();
    }
    window.commitBlurRect = commitBlurRect;
    window.clampRectToSelection = clampRectToSelection;
    window.purgeBlurOutsideSelection = purgeBlurOutsideSelection;

    function freeBlurScratchMemory() {
        if (typeof _blurScratch !== 'object') return;
        for (const key in _blurScratch) {
            if (_blurScratch[key]) {
                _blurScratch[key].width = 0;
                _blurScratch[key].height = 0;
                _blurScratch[key] = null;
            }
        }
        for (const key in _scratchCtx) delete _scratchCtx[key];
    }
    window.freeBlurScratchMemory = freeBlurScratchMemory;
    window.ensureBlurLayersSized = ensureBlurLayersSized;
    window.registerVectorDrawOp = registerVectorDrawOp;
    window.resetVectorDrawHistory = resetVectorDrawHistory;
    window.rebuildDrawLayerFromVectors = rebuildDrawLayerFromVectors;
    window.flattenVectorDrawHistory = flattenVectorDrawHistory;
    window.syncDrawLayerFromVectorHistory = syncDrawLayerFromVectorHistory;
    window.setTool = setTool;
    window.clearActiveDrawTool = clearActiveDrawTool;
    window.setColor = setColor;
    window.setOpacity = setOpacity;
    window.setToolSize = setToolSize;
    window.syncActiveTextBoxColor = syncActiveTextBoxColor;
