    // --- ЛОГИКА ЦВЕТА (Оптимизировано) ---
    let colorPickRaf = false, lastColorX = null, colorPickerRectCache = null;

    pickerWrap.addEventListener('mousedown', (e) => {
        isDraggingColor = true;
        colorPickerRectCache = pickerWrap.getBoundingClientRect();
        updateGradientColor(e.clientX);
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingColor) return;
        lastColorX = e.clientX;
        if (colorPickRaf) return;
        colorPickRaf = true;
        requestAnimationFrame(() => {
            colorPickRaf = false;
            if (lastColorX != null) updateGradientColor(lastColorX);
        });
    });

    document.addEventListener('mouseup', () => {
        isDraggingColor = false;
        lastColorX = null;
        colorPickerRectCache = null;
    });

    function updateGradientColor(clientX) {
        const rect = colorPickerRectCache || pickerWrap.getBoundingClientRect();
        let x = clientX - rect.left; 
        if (x < 0) x = 0; 
        if (x > rect.width) x = rect.width;
        pickerThumb.style.left = x + 'px';
        const hue = (x / rect.width) * 360; 
        currentColor = `hsl(${hue}, 100%, 50%)`;
        pickerThumb.style.background = currentColor;
        if (typeof syncActiveTextBoxColor === 'function') syncActiveTextBoxColor();
        if (typeof schedulePersistCropperSettings === 'function') schedulePersistCropperSettings();
    }

    // --- РИСОВАНИЕ (кэшированный scaleRatio, throttle через rAF) ---
    let rafScheduled = false;
    let lastEvt = null;
    let penTracePoints = null;
    let penSmoothAnimId = null;
    let selectionHasDrag = false;
    const PEN_MIN_POINT_DIST = 1.15;
    const PEN_CHAIKIN_PASSES = 3;
    const PEN_CATMULL_TENSION = 0.48;

    function stopPenSmoothAnimFrame() {
        if (penSmoothAnimId != null) {
            cancelAnimationFrame(penSmoothAnimId);
            penSmoothAnimId = null;
        }
    }

    function cancelPenSmoothAnim() {
        stopPenSmoothAnimFrame();
        clearPenPreviewLayer();
    }

    function abortActiveDrawing() {
        stopPenSmoothAnimFrame();
        penTracePoints = null;
        clearPenPreviewLayer();
        if (typeof window.rebuildDrawLayerFromVectors === 'function') {
            window.rebuildDrawLayerFromVectors();
        }
        isDrawing = false;
        ctxDraw.beginPath();
        setPanelsPointerEvents(true);
    }

    function clearPenPreviewLayer() {
        if (!penPreviewCanvas || !ctxPenPreview) return;
        ctxPenPreview.clearRect(0, 0, penPreviewCanvas.width, penPreviewCanvas.height);
    }

    function pointsToFlat(points) {
        const flat = new Float32Array(points.length * 2);
        for (let i = 0; i < points.length; i++) {
            flat[i * 2] = points[i].x;
            flat[i * 2 + 1] = points[i].y;
        }
        return flat;
    }

    function flatToPoints(flat) {
        const n = flat.length >> 1;
        const pts = new Array(n);
        for (let i = 0; i < n; i++) {
            pts[i] = { x: flat[i * 2], y: flat[i * 2 + 1] };
        }
        return pts;
    }

    let _chaikinBufA = null;
    let _chaikinBufB = null;
    let _chaikinBufCap = 0;

    function ensureChaikinBuffers(minLen) {
        if (_chaikinBufCap >= minLen) return;
        let cap = _chaikinBufCap || 128;
        while (cap < minLen) cap *= 2;
        _chaikinBufA = new Float32Array(cap);
        _chaikinBufB = new Float32Array(cap);
        _chaikinBufCap = cap;
    }

    function chaikinPassFlat(flat, outBuf) {
        const n = flat.length >> 1;
        if (n < 2) return flat;
        const outLen = (n - 1) * 4 + 4;
        ensureChaikinBuffers(outLen);
        const out = outBuf || _chaikinBufA;
        let oi = 0;
        out[oi++] = flat[0];
        out[oi++] = flat[1];
        for (let i = 0; i < n - 1; i++) {
            const ax = flat[i * 2];
            const ay = flat[i * 2 + 1];
            const bx = flat[i * 2 + 2];
            const by = flat[i * 2 + 3];
            out[oi++] = ax * 0.75 + bx * 0.25;
            out[oi++] = ay * 0.75 + by * 0.25;
            out[oi++] = ax * 0.25 + bx * 0.75;
            out[oi++] = ay * 0.25 + by * 0.75;
        }
        out[oi++] = flat[(n - 1) * 2];
        out[oi++] = flat[(n - 1) * 2 + 1];
        return out.subarray(0, oi);
    }

    function getPenPointsForSmoothLevel(points, level) {
        let flat = pointsToFlat(points);
        let useA = true;
        for (let i = 0; i < level; i++) {
            flat = chaikinPassFlat(flat, useA ? _chaikinBufB : _chaikinBufA);
            useA = !useA;
        }
        return flatToPoints(flat);
    }

    function appendRawPenPath(ctx, points) {
        if (!points || points.length === 0) return;
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
    }

    function appendSmoothPenPath(ctx, points) {
        if (!points || points.length === 0) return;
        if (points.length === 1) {
            ctx.moveTo(points[0].x, points[0].y);
            return;
        }
        if (points.length === 2) {
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            return;
        }
        const n = points.length;
        const t = PEN_CATMULL_TENSION;
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < n - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(n - 1, i + 2)];
            const cp1x = p1.x + (p2.x - p0.x) * t / 6;
            const cp1y = p1.y + (p2.y - p0.y) * t / 6;
            const cp2x = p2.x - (p3.x - p1.x) * t / 6;
            const cp2y = p2.y - (p3.y - p1.y) * t / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
    }

    function getPenPointsForDrawing(points) {
        if (!points || points.length < 4) return points;
        return getPenPointsForSmoothLevel(points, PEN_CHAIKIN_PASSES);
    }

    /** Живой превью: те же сегменты, что и у «сырого» штриха — без скачка геометрии на хвосте. */
    function paintPenPathLive(points, targetCtx) {
        if (!points || points.length === 0) return;
        const ctx = targetCtx || ctxPenPreview;
        if (!ctx) return;
        ctx.save();
        applyMainStrokeStyle(ctx);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (points.length === 1) {
            const p = points[0];
            const r = getStrokeWidth() / 2;
            if (typeof fillCircleWithHalo === 'function') fillCircleWithHalo(ctx, p.x, p.y, r);
            else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.beginPath();
            appendRawPenPath(ctx, points);
            if (typeof strokeWithHaloPreview === 'function') strokeWithHaloPreview(ctx);
            else ctx.stroke();
        }
        ctx.restore();
    }

    function paintPenPath(points, withGlow, mode, targetCtx) {
        if (!points || points.length === 0) return;
        const ctx = targetCtx || ctxDraw;
        if (!ctx) return;
        const smoothMode = mode !== 'raw';
        ctx.save();

        applyMainStrokeStyle(ctx);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (points.length === 1) {
            const p = points[0];
            const r = getStrokeWidth() / 2;
            if (withGlow && typeof fillCircleWithHalo === 'function') {
                fillCircleWithHalo(ctx, p.x, p.y, r);
            } else {
                ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.beginPath();
            if (smoothMode) appendSmoothPenPath(ctx, points);
            else appendRawPenPath(ctx, points);

            if (withGlow && typeof strokeWithHalo === 'function') {
                strokeWithHalo(ctx);
            } else {
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function commitPenStrokeToDrawLayer(points) {
        if (!points || !points.length) return;
        paintPenPath(points, true, 'raw', ctxDraw);
        if (typeof window.flattenVectorDrawHistory === 'function') {
            window.flattenVectorDrawHistory();
        }
    }

    /** Живой штрих: пересобрать сохранённое + дорисовать текущий trace на draw-layer. */
    function redrawPenLivePreview() {
        if (!ctxDraw) return;
        if (typeof window.rebuildDrawLayerFromVectors === 'function') {
            window.rebuildDrawLayerFromVectors();
        }
        if (penTracePoints && penTracePoints.length) {
            paintPenPathLive(penTracePoints, ctxDraw);
        }
        clearPenPreviewLayer();
    }

    function normalizeRect(x, y, w, h) {
        const rw = Math.abs(w);
        const rh = Math.abs(h);
        return { x: w < 0 ? x - rw : x, y: h < 0 ? y - rh : y, w: rw, h: rh };
    }

    function appendPenPoint(x, y) {
        if (!penTracePoints) return;
        const last = penTracePoints[penTracePoints.length - 1];
        if (last) {
            const dx = x - last.x;
            const dy = y - last.y;
            if (dx * dx + dy * dy < PEN_MIN_POINT_DIST * PEN_MIN_POINT_DIST) return;
        }
        penTracePoints.push({ x, y });
    }

    function createPenVectorOp(points) {
        return {
            tool: 'pen',
            color: currentColor,
            opacity: currentOpacity,
            width: getStrokeWidth(),
            points: points.map(p => ({ x: p.x, y: p.y }))
        };
    }

    function createShapeVectorOp(tool, endX, endY) {
        return {
            tool,
            color: currentColor,
            opacity: currentOpacity,
            width: getStrokeWidth(),
            x1: shapeStartX,
            y1: shapeStartY,
            x2: endX,
            y2: endY
        };
    }

    function applyVectorOpStyle(op, fn) {
        const prevColor = currentColor;
        const prevOpacity = currentOpacity;
        const prevSize = currentToolSize;
        currentColor = op.color;
        currentOpacity = op.opacity;
        if (op.width != null) {
            const ratio = window.scaleRatio || 1;
            currentToolSize = ratio > 0 ? op.width / ratio : op.width;
        }
        try {
            fn();
        } finally {
            currentColor = prevColor;
            currentOpacity = prevOpacity;
            currentToolSize = prevSize;
        }
    }

    window.renderDrawVectorOp = function (ctx, op) {
        if (!op || !ctx) return;
        applyVectorOpStyle(op, () => {
            if (op.tool === 'pen') {
                paintPenPath(op.points, true, 'raw', ctx);
            } else if (op.tool === 'line' || op.tool === 'arrow' || op.tool === 'rect' || op.tool === 'oval') {
                const savedTool = currentTool;
                const sx = shapeStartX;
                const sy = shapeStartY;
                currentTool = op.tool;
                shapeStartX = op.x1;
                shapeStartY = op.y1;
                paintShapeGeometry(op.x2, op.y2, ctx);
                currentTool = savedTool;
                shapeStartX = sx;
                shapeStartY = sy;
            } else if (op.tool === 'step') {
                const r = 20;
                ctx.save();
                ctx.globalAlpha = 1;
                if (typeof fillCircleWithHaloOpaque === 'function') {
                    fillCircleWithHaloOpaque(ctx, op.x, op.y, r);
                } else if (typeof fillCircleWithHalo === 'function') {
                    fillCircleWithHalo(ctx, op.x, op.y, r, true);
                }
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 24px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(op.label), op.x, op.y + 2);
                ctx.restore();
            }
        });
    };

    function finishSmoothPenPoint(x, y) {
        if (!penTracePoints) return;
        stopPenSmoothAnimFrame();
        appendPenPoint(x, y);
        const points = penTracePoints.map(p => ({ x: p.x, y: p.y }));
        penTracePoints = null;
        clearPenPreviewLayer();

        if (typeof window.rebuildDrawLayerFromVectors === 'function') {
            window.rebuildDrawLayerFromVectors();
        }

        const bounds = typeof boundsFromPoints === 'function' ? boundsFromPoints(points) : null;
        pushUndoState('pen', 0, 0, bounds);
        commitPenStrokeToDrawLayer(points);
    }

    function appendArrowPath(ctx, tipX, tipY, tailX, tailY) {
        const sc = typeof snapCoord === 'function' ? snapCoord : (c) => c;
        const headlen = getArrowHeadLength();
        const angle = Math.atan2(tailY - tipY, tailX - tipX);
        const hx1 = tailX - headlen * Math.cos(angle - Math.PI / 6);
        const hy1 = tailY - headlen * Math.sin(angle - Math.PI / 6);
        const hx2 = tailX - headlen * Math.cos(angle + Math.PI / 6);
        const hy2 = tailY - headlen * Math.sin(angle + Math.PI / 6);
        const tx = sc(tipX);
        const ty = sc(tipY);
        const tlx = sc(tailX);
        const tly = sc(tailY);

        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tlx, tly);
        ctx.moveTo(sc(hx1), sc(hy1));
        ctx.lineTo(tlx, tly);
        ctx.lineTo(sc(hx2), sc(hy2));
    }

    function strokeShapeGlow(ctx) {
        if (typeof strokeWithHalo === 'function') strokeWithHalo(ctx);
        else ctx.stroke();
    }

    function paintShapeGeometry(endX, endY, targetCtx = ctxDraw) {
        const w = endX - shapeStartX;
        const h = endY - shapeStartY;
        const sc = typeof snapCoord === 'function' ? snapCoord : (c) => c;
        applyMainStrokeStyle(targetCtx);
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';

        if (currentTool === 'line') {
            targetCtx.beginPath();
            targetCtx.moveTo(sc(shapeStartX), sc(shapeStartY));
            targetCtx.lineTo(sc(endX), sc(endY));
            strokeShapeGlow(targetCtx);
        } else if (currentTool === 'arrow') {
            appendArrowPath(targetCtx, endX, endY, shapeStartX, shapeStartY);
            strokeShapeGlow(targetCtx);
        } else if (currentTool === 'rect') {
            const rect = normalizeRect(shapeStartX, shapeStartY, w, h);
            targetCtx.beginPath();
            targetCtx.rect(sc(rect.x), sc(rect.y), Math.round(rect.w), Math.round(rect.h));
            strokeShapeGlow(targetCtx);
        } else if (currentTool === 'oval') {
            const rect = normalizeRect(shapeStartX, shapeStartY, w, h);
            targetCtx.beginPath();
            targetCtx.ellipse(
                sc(rect.x + rect.w / 2),
                sc(rect.y + rect.h / 2),
                Math.abs(rect.w / 2),
                Math.abs(rect.h / 2),
                0, 0, 2 * Math.PI
            );
            strokeShapeGlow(targetCtx);
        } else if (currentTool === 'blur') {
            let rect = normalizeRect(shapeStartX, shapeStartY, w, h);
            if (typeof clampRectToSelection === 'function') {
                rect = clampRectToSelection(rect);
            }
            targetCtx.save();
            targetCtx.globalAlpha = 1;
            targetCtx.setLineDash([6, 4]);
            targetCtx.strokeStyle = 'rgba(0, 122, 204, 0.95)';
            targetCtx.lineWidth = getBlurPreviewStrokeWidth();
            targetCtx.strokeRect(sc(rect.x), sc(rect.y), Math.round(rect.w), Math.round(rect.h));
            targetCtx.restore();
        }
        targetCtx.globalAlpha = 1;
    }

    function paintShapeDraft(endX, endY) {
        clearPenPreviewLayer();
        paintShapeGeometry(endX, endY, ctxPenPreview);
    }

    function setPanelsPointerEvents(enabled) {
        const v = enabled ? 'auto' : 'none';
        if (drawBar) drawBar.style.pointerEvents = v;
        if (sideBar) sideBar.style.pointerEvents = v;
    }

    /** Viewport- и canvas-координаты с учётом float-edit (картинка смещена внутри окна). */
    function pointerCoords(clientX, clientY) {
        const r = scaleRatio || 1;
        if (document.body.classList.contains('float-edit')) {
            const ox = window.uiX || 0;
            const oy = window.uiY || 0;
            return { px: clientX, py: clientY, mX: (clientX - ox) * r, mY: (clientY - oy) * r };
        }
        const fx = window.floatOffX || 0;
        const fy = window.floatOffY || 0;
        return { px: clientX + fx, py: clientY + fy, mX: (clientX + fx) * r, mY: (clientY + fy) * r };
    }

    function tryResizeOrMoveFromPoint(e) {
        if (state !== 'editing') return false;
        if (selectionResizeLocked || selectionMode === 'full') return false;
        const resizeHandle = typeof getSelectionResizeHandleFromPoint === 'function'
            ? getSelectionResizeHandleFromPoint(e.clientX, e.clientY)
            : null;
        if (resizeHandle) {
            e.preventDefault();
            e.stopPropagation();
            startSelectionResizeAt(e.clientX, e.clientY, resizeHandle);
            return true;
        }
        return false;
    }

    drawCanvas.addEventListener('mousedown', e => {
        if (state === 'form') return;
        if (document.body.classList.contains('float-edit') && document.body.classList.contains('float-move')) {
            return;
        }
        if (tryResizeOrMoveFromPoint(e)) return;
        const { px, py, mX, mY } = pointerCoords(e.clientX, e.clientY);

        if (state === 'idle') {
            selectionHasDrag = false;
            state = 'selecting';
            uiStartX = px; uiStartY = py;
            startX = mX; startY = mY;
            hideToolbars();
            ctxDraw.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            clearPenPreviewLayer();
        }
        else if (state === 'editing') {
            if (window.activeTextBox && currentTool !== 'text') {
                if (typeof cancelTextBox === 'function') cancelTextBox(window.activeTextBox);
            }

            const inSel = px >= uiX && px <= uiX + uiW &&
                py >= uiY && py <= uiY + uiH;

            if (typeof isSelectionEstablished === 'function' && !isSelectionEstablished()) return;

            if (selectionMode === 'area' && !inSel) return;
            applyMainStrokeStyle(ctxDraw);

            if (currentTool === 'step') {
                pushUndoState(currentTool, mX, mY);
                window.registerVectorDrawOp({
                        tool: 'step',
                        color: currentColor,
                        opacity: 1,
                        width: getStrokeWidth(),
                        x: mX,
                        y: mY,
                        label: stepCounter
                    });
                drawStepCircle(mX, mY);
                if (typeof window.flattenVectorDrawHistory === 'function') {
                    window.flattenVectorDrawHistory();
                }
                return;
            }
            if (currentTool === 'text') {
                e.preventDefault();
                e.stopPropagation();
                if (window.activeTextBox) {
                    if (typeof commitTextBox === 'function') commitTextBox(window.activeTextBox);
                }
                openTextBox(mX, mY, e.clientX, e.clientY); // clientX/Y — позиция DOM-элемента в окне (без offset)
                return;
            }

            // Для инструментов с отложенным commit — undo снимаем в mouseup по bbox штриха
            const deferUndoUntilCommit = currentTool === 'pen'
                || currentTool === 'line' || currentTool === 'arrow'
                || currentTool === 'rect' || currentTool === 'oval';
            if (!deferUndoUntilCommit) {
                pushUndoState(currentTool, mX, mY);
            }

            isDrawing = true; shapeStartX = mX; shapeStartY = mY;
            setPanelsPointerEvents(false);
            if (currentTool === 'pen') {
                cancelPenSmoothAnim();
                penTracePoints = [{ x: mX, y: mY }];
                redrawPenLivePreview();
            } else if (currentTool === 'blur') {
                clearPenPreviewLayer();
            } else {
                ctxDraw.beginPath();
                ctxDraw.moveTo(mX, mY);
            }
        }
    });

    function onMouseMoveDraw(e) {
        const { px, py, mX, mY } = pointerCoords(e.clientX, e.clientY);
        if (typeof updateDrawLayerCursor === 'function') {
            updateDrawLayerCursor(e.clientX, e.clientY, e.target);
        }

        if (resizeSelection) {
            resizeSelectedArea(e.clientX, e.clientY);
            return;
        }
        if (moveSelection) {
            moveSelectedArea(e.clientX, e.clientY);
            return;
        }

        if (state === 'editing' && isDrawing && currentTool === 'pen') {
            appendPenPoint(mX, mY);
        }

        if (state === 'editing' && isDrawing && currentTool === 'blur') {
            paintShapeDraft(mX, mY);
            return;
        }

        lastEvt = e;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            const ev = lastEvt;
            if (!ev) return;
            const c = pointerCoords(ev.clientX, ev.clientY);

            if (state === 'selecting') {
                selW = Math.abs(c.mX - startX); selH = Math.abs(c.mY - startY);
                selX = Math.min(c.mX, startX); selY = Math.min(c.mY, startY);
                uiW = Math.abs(c.px - uiStartX); uiH = Math.abs(c.py - uiStartY);
                uiX = Math.min(c.px, uiStartX); uiY = Math.min(c.py, uiStartY);
                if (uiW >= 8 || uiH >= 8) selectionHasDrag = true;
                if (typeof scheduleSelectionOverlayRedraw === 'function') {
                    scheduleSelectionOverlayRedraw();
                } else {
                    redrawSelectionOverlay();
                }
            } else if (state === 'editing' && isDrawing) {
                if (currentTool === 'pen') {
                    redrawPenLivePreview();
                } else {
                    paintShapeDraft(c.mX, c.mY);
                }
            }
        });
    }
    document.addEventListener('mousemove', onMouseMoveDraw);

    function finalizePointerUp(e) {
        const c = pointerCoords(e.clientX, e.clientY);
        if (resizeSelection) {
            if (typeof syncSelectionFromUi === 'function') syncSelectionFromUi();
            clearResizeSelection();
            redrawSelectionOverlay();
            void showToolbars().catch(() => {});
            return;
        }
        if (moveSelection) {
            if (typeof syncSelectionFromUi === 'function') syncSelectionFromUi();
            clearMoveSelection();
            redrawSelectionOverlay();
            void showToolbars().catch(() => {});
            return;
        }
        if (state === 'selecting') {
            if (typeof syncSelectionFromUi === 'function') syncSelectionFromUi();
            const ok = typeof canConfirmAreaSelection === 'function'
                ? canConfirmAreaSelection(selectionHasDrag)
                : selectionHasDrag && selW >= 10 && selH >= 10;
            selectionHasDrag = false;
            if (ok) {
                if (typeof clearSelectionResizeLock === 'function') clearSelectionResizeLock();
                state = 'editing';
                redrawSelectionOverlay();
                void showToolbars().catch(() => {});
            } else {
                if (typeof setInitialAreaSelection === 'function') setInitialAreaSelection();
                else resetAll();
                if (typeof showCropperNotice === 'function') {
                    showCropperNotice('Выделите область: зажмите мышь и потяните по экрану.', 2800);
                }
            }
        }
        else if (state === 'editing') {
            if (!isDrawing) return;
            if (isDrawing && currentTool === 'pen') {
                finishSmoothPenPoint(c.mX, c.mY);
            }
            if (isDrawing && (currentTool === 'line' || currentTool === 'arrow' || currentTool === 'rect' || currentTool === 'oval')) {
                clearPenPreviewLayer();
                pushUndoState(currentTool, 0, 0);
                window.registerVectorDrawOp(createShapeVectorOp(currentTool, c.mX, c.mY));
                paintShapeGeometry(c.mX, c.mY, ctxDraw);
                if (typeof window.flattenVectorDrawHistory === 'function') {
                    window.flattenVectorDrawHistory();
                }
            }
            if (isDrawing && currentTool === 'blur') {
                clearPenPreviewLayer();
                let rect = normalizeRect(shapeStartX, shapeStartY, c.mX - shapeStartX, c.mY - shapeStartY);
                if (typeof clampRectToSelection === 'function') {
                    rect = clampRectToSelection(rect);
                }
                if (rect.w >= 2 && rect.h >= 2) {
                    if (typeof commitBlurRect === 'function') {
                        commitBlurRect(rect.x, rect.y, rect.w, rect.h);
                    } else {
                        applyBlurRect(rect.x, rect.y, rect.w, rect.h);
                    }
                }
            }
            isDrawing = false; ctxDraw.beginPath();
            setPanelsPointerEvents(true);
        }
    }
    document.addEventListener('mouseup', finalizePointerUp);

    function drawStepCircle(x, y) {
        const r = 20;

        ctxDraw.save();
        ctxDraw.globalAlpha = 1.0;

        if (typeof fillCircleWithHaloOpaque === 'function') {
            fillCircleWithHaloOpaque(ctxDraw, x, y, r);
        } else if (typeof fillCircleWithHalo === 'function') {
            fillCircleWithHalo(ctxDraw, x, y, r, true);
        } else {
            ctxDraw.fillStyle = colorWithAlpha(currentColor, 1.0);
            ctxDraw.beginPath();
            ctxDraw.arc(x, y, r, 0, 2 * Math.PI);
            ctxDraw.fill();
        }

        ctxDraw.fillStyle = '#ffffff';
        ctxDraw.font = 'bold 24px sans-serif';
        ctxDraw.textAlign = 'center';
        ctxDraw.textBaseline = 'middle';
        ctxDraw.fillText(stepCounter, x, y + 2);
        stepCounter++;
        ctxDraw.restore();
    }

    window.abortActiveDrawing = abortActiveDrawing;
