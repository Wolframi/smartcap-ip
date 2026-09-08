    const TEXT_INPUT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
    const TEXT_BOX_PADDING = 4;
    const TEXT_BOX_BORDER = 1;
    const TEXT_BOUNDS_MARGIN = 2;
    const TEXT_CARET_BUFFER = 8;
    const globalMeasureCtx = document.createElement('canvas').getContext('2d');
    let textMeasureProbe = null;
    let _measureFontKey = '';
    let _screenshotBoundsCache = null;
    let _screenshotBoundsKey = '';

    function invalidateScreenshotBoundsCache() {
        _screenshotBoundsCache = null;
        _screenshotBoundsKey = '';
    }
    window.invalidateScreenshotBoundsCache = invalidateScreenshotBoundsCache;

    function getTextMeasureProbe(sourceBox) {
        if (!textMeasureProbe) {
            textMeasureProbe = document.createElement('textarea');
            textMeasureProbe.setAttribute('aria-hidden', 'true');
            textMeasureProbe.tabIndex = -1;
            textMeasureProbe.style.position = 'fixed';
            textMeasureProbe.style.left = '-99999px';
            textMeasureProbe.style.top = '0';
            textMeasureProbe.style.visibility = 'hidden';
            textMeasureProbe.style.resize = 'none';
            textMeasureProbe.style.overflow = 'hidden';
            textMeasureProbe.style.boxSizing = 'border-box';
            textMeasureProbe.style.border = `${TEXT_BOX_BORDER}px solid transparent`;
            document.body.appendChild(textMeasureProbe);
        }
        textMeasureProbe.style.fontSize = sourceBox.style.fontSize;
        textMeasureProbe.style.lineHeight = sourceBox.style.lineHeight;
        textMeasureProbe.style.fontFamily = sourceBox.style.fontFamily;
        textMeasureProbe.style.fontWeight = sourceBox.style.fontWeight;
        textMeasureProbe.style.padding = sourceBox.style.padding;
        textMeasureProbe.style.whiteSpace = 'pre';
        textMeasureProbe.style.overflowWrap = 'normal';
        textMeasureProbe.style.wordBreak = 'normal';
        return textMeasureProbe;
    }

    function measureTextAreaScrollHeight(box, text, widthPx) {
        const probe = getTextMeasureProbe(box);
        probe.style.width = Math.max(20, Math.round(widthPx)) + 'px';
        probe.style.height = '1px';
        probe.value = text || '';
        return probe.scrollHeight;
    }

    function getTextBoxContentOffset() {
        return TEXT_BOX_BORDER + TEXT_BOX_PADDING;
    }

    /** Границы рамки скриншота (выделение / canvas) в client-координатах. */
    function getTextEditClientBounds() {
        const m = TEXT_BOUNDS_MARGIN;
        const key = [
            typeof uiX !== 'undefined' ? uiX : 0,
            typeof uiY !== 'undefined' ? uiY : 0,
            typeof uiW !== 'undefined' ? uiW : 0,
            typeof uiH !== 'undefined' ? uiH : 0,
            window.innerWidth,
            window.innerHeight,
            document.body.classList.contains('float-edit') ? 1 : 0,
            window.drawCanvas ? window.drawCanvas.getBoundingClientRect().left : 0,
            window.drawCanvas ? window.drawCanvas.getBoundingClientRect().top : 0
        ].join('|');
        if (key === _screenshotBoundsKey && _screenshotBoundsCache) {
            return _screenshotBoundsCache;
        }

        const hasUiRect = typeof uiW !== 'undefined' && uiW > 0 && uiH > 0;
        let bounds;
        if (hasUiRect) {
            bounds = {
                left: uiX + m,
                top: uiY + m,
                right: uiX + uiW - m,
                bottom: uiY + uiH - m,
                width: Math.max(20, uiW - 2 * m),
                height: Math.max(20, uiH - 2 * m)
            };
        } else {
            const canvas = window.drawCanvas;
            if (canvas) {
                const r = canvas.getBoundingClientRect();
                bounds = {
                    left: r.left + m,
                    top: r.top + m,
                    right: r.right - m,
                    bottom: r.bottom - m,
                    width: Math.max(20, r.width - 2 * m),
                    height: Math.max(20, r.height - 2 * m)
                };
            } else {
                bounds = {
                    left: m,
                    top: m,
                    right: window.innerWidth - m,
                    bottom: window.innerHeight - m,
                    width: Math.max(20, window.innerWidth - 2 * m),
                    height: Math.max(20, window.innerHeight - 2 * m)
                };
            }
        }

        _screenshotBoundsKey = key;
        _screenshotBoundsCache = bounds;
        return bounds;
    }

    /** @deprecated alias */
    function getScreenshotClientBounds() {
        return getTextEditClientBounds();
    }

    function getTextBoxChromeWidth() {
        return TEXT_BOX_PADDING * 2 + TEXT_BOX_BORDER * 2;
    }

    function getTextBoxContentWidth(widthPx) {
        return Math.max(8, widthPx - getTextBoxChromeWidth());
    }

    function measureTextLine(text, fontWeight, fontSizePx) {
        const fontKey = `${fontWeight}|${fontSizePx}`;
        if (_measureFontKey !== fontKey) {
            globalMeasureCtx.font = `${fontWeight} ${fontSizePx}px ${TEXT_INPUT_FONT_FAMILY}`;
            _measureFontKey = fontKey;
        }
        return globalMeasureCtx.measureText(text || ' ').width;
    }

    /** Разбить текст на строки с переносом по ширине contentWidth (px). */
    function expandWrappedLines(text, contentWidth, measureLine) {
        if (contentWidth < 4) return [''];
        const result = [];
        String(text || '').split('\n').forEach((paragraph) => {
            if (!paragraph) {
                result.push('');
                return;
            }
            let line = '';
            for (const ch of paragraph) {
                const test = line + ch;
                if (line && measureLine(test) > contentWidth) {
                    result.push(line);
                    line = ch;
                } else {
                    line = test;
                }
            }
            if (line) result.push(line);
        });
        return result.length ? result : [''];
    }

    function getTextCanvasOriginFromBox(box) {
        const ratio = scaleRatio || 1;
        const rect = box.getBoundingClientRect();
        const offset = getTextBoxContentOffset();
        const canvas = window.drawCanvas;
        const canvasRect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
        return {
            x: (rect.left + offset - canvasRect.left) * ratio,
            y: (rect.top + offset - box.scrollTop - canvasRect.top) * ratio
        };
    }

    function getTextMeasureContext(box) {
        const lineH = parseFloat(box.dataset.lineH) || getToolTextSize() * 1.18;
        const fontSizePx = parseFloat(box.style.fontSize);
        const fontWeight = box.style.fontWeight || 'bold';
        const measureLine = (line) => measureTextLine(line, fontWeight, fontSizePx);
        return { lineH, fontSizePx, fontWeight, measureLine };
    }

    function isFloatEditMode() {
        return document.body.classList.contains('float-edit');
    }

    /** В float — обрезка по рамке скриншота; в обычном режиме текст за рамкой виден. */
    function syncTextBoxClipToFrame(box) {
        if (!box) return;
        if (!isFloatEditMode()) {
            box.style.clipPath = '';
            return;
        }
        const bounds = getTextEditClientBounds();
        const r = box.getBoundingClientRect();
        const top = Math.max(0, Math.round(bounds.top - r.top));
        const left = Math.max(0, Math.round(bounds.left - r.left));
        const right = Math.max(0, Math.round(r.right - bounds.right));
        const bottom = Math.max(0, Math.round(r.bottom - bounds.bottom));
        if (top > 0 || left > 0 || right > 0 || bottom > 0) {
            box.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
        } else {
            box.style.clipPath = '';
        }
    }

    /** Геометрия поля: растёт с текстом; за рамкой скриншота — только clip, без переноса вниз. */
    function measureTextBoxLayout(box, text) {
        const { measureLine, lineH } = getTextMeasureContext(box);
        const anchorX = parseFloat(box.dataset.anchorX);
        const anchorY = parseFloat(box.dataset.anchorY);
        const chromeW = getTextBoxChromeWidth() + TEXT_CARET_BUFFER;
        const minLineW = Math.max(8, measureLine(' '));
        const minW = Math.max(getTextBoxChromeWidth() + minLineW, chromeW + minLineW);
        const minH = lineH + TEXT_BOX_PADDING * 2 + TEXT_BOX_BORDER * 2;

        const hardLines = String(text || '').split('\n');
        let longest = minLineW;
        hardLines.forEach((line) => { longest = Math.max(longest, measureLine(line || ' ')); });

        const left = anchorX;
        const width = Math.max(minW, longest + chromeW);
        const contentWidth = getTextBoxContentWidth(width);
        const wrappedLines = expandWrappedLines(text, contentWidth, measureLine);
        const scrollH = Math.max(minH, measureTextAreaScrollHeight(box, text, width));

        return {
            left,
            top: anchorY,
            width,
            height: scrollH,
            contentWidth,
            wrappedLines,
            maxLines: wrappedLines.length
        };
    }

    /** Расположить поле; обрезка за рамкой — только в float. */
    function layoutTextBox(box) {
        const layout = measureTextBoxLayout(box, box.value);
        const leftPx = Math.round(layout.left) + 'px';
        const topPx = Math.round(layout.top) + 'px';
        const widthPx = Math.round(layout.width) + 'px';
        const heightPx = Math.round(layout.height) + 'px';
        if (box.style.left !== leftPx) box.style.left = leftPx;
        if (box.style.top !== topPx) box.style.top = topPx;
        if (box.style.width !== widthPx) box.style.width = widthPx;
        if (box.style.height !== heightPx) box.style.height = heightPx;
        if (box.scrollTop !== 0) box.scrollTop = 0;
        syncTextBoxClipToFrame(box);
    }

    function scheduleLayoutTextBox(box) {
        if (!box || box._layoutRaf) return;
        box._layoutRaf = requestAnimationFrame(() => {
            box._layoutRaf = 0;
            if (window.activeTextBox === box && document.body.contains(box)) {
                layoutTextBox(box);
            }
        });
    }

    function attachTextBoxAutoLayout(box) {
        box.addEventListener('input', () => scheduleLayoutTextBox(box));
        box.addEventListener('compositionend', () => scheduleLayoutTextBox(box));
    }

    function openTextBox(canvasX, canvasY, clientX, clientY) {
        if (window.activeTextBox) return;
        const bounds = getTextEditClientBounds();
        const padding = TEXT_BOX_PADDING;
        const fontSize = getToolTextSize();
        const lineH = fontSize * 1.18;
        const minH = lineH + padding * 2 + TEXT_BOX_BORDER * 2;

        const anchorX = Math.max(bounds.left, Math.min(clientX, bounds.right - 24));
        const anchorY = Math.max(bounds.top, Math.min(clientY, bounds.bottom - minH));

        const box = document.createElement('textarea');
        box.className = 'text-input-box';
        box.placeholder = '';
        box.style.fontSize = fontSize + 'px';
        box.style.lineHeight = lineH + 'px';
        box.style.fontFamily = TEXT_INPUT_FONT_FAMILY;
        box.style.fontWeight = 'bold';
        box.style.color = typeof getMainStrokeColor === 'function' ? getMainStrokeColor() : currentColor;
        box.style.padding = padding + 'px';
        box.style.margin = '0';
        box.style.boxSizing = 'border-box';
        box.style.resize = 'none';
        box.style.whiteSpace = 'pre';
        box.style.overflowWrap = 'normal';
        box.style.wordBreak = 'normal';
        box.dataset.fontSize = String(fontSize);
        box.dataset.lineH = String(lineH);
        box.dataset.anchorX = String(anchorX);
        box.dataset.anchorY = String(anchorY);
        box.rows = 1;

        box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitTextBox(box);
            } else if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                const start = box.selectionStart;
                const end = box.selectionEnd;
                const val = box.value;
                box.value = val.slice(0, start) + '\n' + val.slice(end);
                box.selectionStart = box.selectionEnd = start + 1;
                layoutTextBox(box);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelTextBox(box);
            }
        });
        box.addEventListener('blur', () => {
            clearTimeout(box._blurTimer);
            box._blurTimer = setTimeout(() => {
                if (window.activeTextBox !== box || !document.body.contains(box)) return;
                if (currentTool !== 'text') {
                    cancelTextBox(box);
                } else {
                    commitTextBox(box);
                }
            }, 120);
        });
        box.addEventListener('mousedown', (e) => e.stopPropagation());
        box.addEventListener('click', (e) => e.stopPropagation());
        box.addEventListener('pointerdown', (e) => e.stopPropagation());

        attachTextBoxAutoLayout(box);

        document.body.appendChild(box);
        window.activeTextBox = box;
        drawCanvas.style.pointerEvents = 'none';
        layoutTextBox(box);
        requestAnimationFrame(() => box.focus());
    }

    function removeTextBoxDom(box) {
        if (!box) return;
        clearTimeout(box._blurTimer);
        if (box._layoutRaf) {
            cancelAnimationFrame(box._layoutRaf);
            box._layoutRaf = 0;
        }
        if (box.parentNode) box.remove();
    }

    function commitTextBox(box) {
        if (!box || !box.parentNode) return;
        layoutTextBox(box);
        const text = box.value || '';
        const trimmed = text.trim();
        const fontSize = parseFloat(box.dataset.fontSize) || getToolTextSize();
        const lineH = parseFloat(box.dataset.lineH) || getToolTextSize() * 1.18;

        try {
            if (trimmed) {
                const ratio = window.scaleRatio || 1;
                const canvasFontSize = fontSize * ratio;
                const canvasLineH = lineH * ratio;
                const layout = measureTextBoxLayout(box, text);
                const lines = layout.wrappedLines;
                const textPad = 8 * ratio;
                const boxRect = box.getBoundingClientRect();
                const canvasRect = drawCanvas.getBoundingClientRect();
                const offset = getTextBoxContentOffset();
                const canvasX = (boxRect.left + offset - canvasRect.left) * ratio;
                const textBounds = {
                    x: canvasX - textPad,
                    y: (boxRect.top + offset - box.scrollTop - canvasRect.top) * ratio - textPad,
                    w: layout.contentWidth * ratio + textPad * 2,
                    h: lines.length * canvasLineH + textPad * 2
                };

                pushUndoState('text', canvasX, textBounds.y + textPad, textBounds);

                ctxDraw.save();
                ctxDraw.beginPath();
                ctxDraw.rect(0, 0, drawCanvas.width, drawCanvas.height);
                ctxDraw.clip();
                ctxDraw.globalAlpha = 1;
                ctxDraw.font = `bold ${canvasFontSize}px ${TEXT_INPUT_FONT_FAMILY}`;
                ctxDraw.textAlign = 'left';
                ctxDraw.textBaseline = 'middle';

                const platformTweak = 1.5 * ratio;

                lines.forEach((line, i) => {
                    const lineTopClient = boxRect.top + offset - box.scrollTop + i * lineH;
                    const ty = (lineTopClient - canvasRect.top) * ratio + (canvasLineH / 2) + platformTweak;
                    paintTextLineWithHalo(ctxDraw, line, canvasX, ty, ratio);
                });

                ctxDraw.restore();
            }
        } finally {
            removeTextBoxDom(box);
            window.activeTextBox = null;
            drawCanvas.style.pointerEvents = '';
        }
    }

    function cancelTextBox(box) {
        if (!box || !box.parentNode) return;
        removeTextBoxDom(box);
        window.activeTextBox = null;
        drawCanvas.style.pointerEvents = '';
    }
