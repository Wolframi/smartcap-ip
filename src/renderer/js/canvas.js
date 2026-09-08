
// --- ФУНКЦИЯ ПОЛУЧЕНИЯ КАРТИНКИ (BASE64), переиспользуемый canvas ---
    let _cropCanvas = null;
    const CAPTURE_PROCESS_TIMEOUT_MS = 30000;

    function capIpc() {
        return window.ipcRenderer || window.smartCap;
    }

    function waitAnimationFrames(count) {
        return new Promise(resolve => {
            let left = count;
            const step = () => {
                if (left-- <= 0) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            setTimeout(resolve, 50);
        });
    }

    /** Лёгкий прогрев кисти без аллокации гигантских scratch-canvas. */
    async function warmupRendererAfterCapture() {
        const bg = window.bgCanvas;
        const ctxDraw = window.ctxDraw;
        if (!bg || !ctxDraw) return;
        const cw = bg.width;
        const ch = bg.height;
        if (!cw || !ch) return;

        ctxDraw.save();
        ctxDraw.globalAlpha = 0.01;
        ctxDraw.strokeStyle = '#000';
        ctxDraw.lineWidth = Math.max(2, getStrokeWidth());
        ctxDraw.lineCap = 'round';
        ctxDraw.beginPath();
        ctxDraw.moveTo(0, 0);
        ctxDraw.lineTo(3, 3);
        ctxDraw.stroke();
        ctxDraw.restore();
        ctxDraw.clearRect(0, 0, 4, 4);

        if (typeof clearPenPreviewLayer === 'function') clearPenPreviewLayer();

        await waitAnimationFrames(2);
    }

    function notifyCropperReady() {
        capIpc().send('cropper-ready');
    }

    function abortCaptureUi() {
        if (!captureAborted) {
            if (typeof closeCropper === 'function') closeCropper();
            else capIpc().send('close-cropper');
        }
    }

    function getCropRect() {
        if (!selW || !selH || selW < 1 || selH < 1) return null;
        const bg = window.bgCanvas;
        if (!bg || !bg.width || !bg.height) return null;
        const realX = Math.max(0, Math.round(selX));
        const realY = Math.max(0, Math.round(selY));
        const realW = Math.min(Math.round(selW), bg.width - realX);
        const realH = Math.min(Math.round(selH), bg.height - realY);
        if (realW < 1 || realH < 1) return null;
        return { realX, realY, realW, realH };
    }

    function ensureCropCanvas(realW, realH) {
        if (!_cropCanvas || _cropCanvas.width !== realW || _cropCanvas.height !== realH) {
            if (_cropCanvas) {
                _cropCanvas.width = 0;
                _cropCanvas.height = 0;
            }
            _cropCanvas = document.createElement('canvas');
            _cropCanvas.width = realW;
            _cropCanvas.height = realH;
        }
        return _cropCanvas.getContext('2d');
    }

    function loadImageFromPngBytes(bytes) {
        return new Promise((resolve, reject) => {
            if (!bytes || !bytes.byteLength) {
                reject(new Error('image-read-error'));
                return;
            }
            const blob = new Blob([bytes], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('image-load-error'));
            };
            img.src = url;
        });
    }

    function canvasRegionToPngBytes(sourceCanvas, realX, realY, realW, realH) {
        if (!sourceCanvas || sourceCanvas.width < 1 || sourceCanvas.height < 1) return null;
        const fCtx = ensureCropCanvas(realW, realH);
        fCtx.clearRect(0, 0, realW, realH);
        fCtx.drawImage(sourceCanvas, realX, realY, realW, realH, 0, 0, realW, realH);
        return new Promise((resolve) => {
            _cropCanvas.toBlob(async (blob) => {
                if (!blob) return resolve(null);
                resolve(new Uint8Array(await blob.arrayBuffer()));
            }, 'image/png');
        });
    }

    /** @deprecated internal — use canvasRegionToPngBytes */
    function canvasRegionToDataUrl(sourceCanvas, realX, realY, realW, realH) {
        if (!sourceCanvas || sourceCanvas.width < 1 || sourceCanvas.height < 1) return null;
        const fCtx = ensureCropCanvas(realW, realH);
        fCtx.clearRect(0, 0, realW, realH);
        fCtx.drawImage(sourceCanvas, realX, realY, realW, realH, 0, 0, realW, realH);
        try {
            return _cropCanvas.toDataURL('image/png');
        } catch (e) {
            return null;
        }
    }

    function cropCanvasToDataUrlAsync() {
        return new Promise((resolve) => {
            _cropCanvas.toBlob((blob) => {
                if (!blob) return resolve(null);
                const reader = new FileReader();
                reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            }, 'image/png');
        });
    }

    async function getCroppedBase64Async() {
        const rect = getCropRect();
        if (!rect) return null;
        const { realX, realY, realW, realH } = rect;
        const bg = window.bgCanvas;
        const draw = window.drawCanvas;
        if (!bg || !draw) return null;

        const fCtx = ensureCropCanvas(realW, realH);
        fCtx.clearRect(0, 0, realW, realH);
        fCtx.drawImage(bg, realX, realY, realW, realH, 0, 0, realW, realH);
        if (window.blurCanvas && window.blurCanvas.width > 1 && window.blurCanvas.height > 1) {
            fCtx.drawImage(window.blurCanvas, realX, realY, realW, realH, 0, 0, realW, realH);
        }
        fCtx.drawImage(draw, realX, realY, realW, realH, 0, 0, realW, realH);

        try {
            return await cropCanvasToDataUrlAsync();
        } catch (e) {
            return null;
        }
    }

    /** Отдельные слои bg/blur/draw для плавающего окна (размытие остаётся под рисунками). */
    async function getCroppedLayersAsync() {
        const rect = getCropRect();
        if (!rect) return null;
        const { realX, realY, realW, realH } = rect;
        const bg = await canvasRegionToPngBytes(window.bgCanvas, realX, realY, realW, realH);
        if (!bg) return null;
        const blur = (window.blurCanvas && window.blurCanvas.width > 1 && window.blurCanvas.height > 1)
            ? await canvasRegionToPngBytes(window.blurCanvas, realX, realY, realW, realH)
            : null;
        const draw = await canvasRegionToPngBytes(window.drawCanvas, realX, realY, realW, realH);
        if (!draw) return null;
        return { bg, blur, draw };
    }
    window.getCroppedBase64Async = getCroppedBase64Async;
    window.getCroppedLayersAsync = getCroppedLayersAsync;

    let captureAborted = false;
    let lastCaptureGeneration = -1;

    window.ipcRenderer.on('capture-aborted', () => {
        captureAborted = true;
    });

    // --- ЗАХВАТ ЭКРАНА (файлы temp + чтение через IPC) ---
    async function handleCaptureScreenImages(payload) {
        captureAborted = false;
        const generation = payload && payload.generation;
        if (generation != null) {
            if (generation <= lastCaptureGeneration) return;
            lastCaptureGeneration = generation;
        }

        const captures = payload && Array.isArray(payload.captures) ? payload.captures : [];
        if (!captures.length) {
            window.resetAll();
            abortCaptureUi();
            return;
        }
        window.resetAll();

        if (typeof window.initSessionCreateSelectionForCapture === 'function') {
            await window.initSessionCreateSelectionForCapture();
        }

        window.virtualBounds = payload.virtualBounds || window.virtualBounds;
        window.primaryBounds = payload.primaryBounds || window.primaryBounds;

        const pathsToCleanup = [];
        const ipc = capIpc();

        const processCapture = async () => {
            const loaded = [];
            for (const part of captures) {
                let pngBytes = part.bytes || null;
                if (part.filePath) {
                    pathsToCleanup.push(part.filePath);
                    pngBytes = await ipc.invoke('read-capture-png', part.filePath);
                }
                if (!pngBytes || !pngBytes.byteLength) throw new Error('image-read-error');
                const img = await loadImageFromPngBytes(pngBytes);
                loaded.push({ img, bounds: part.bounds });
            }

            const vb = window.virtualBounds;
            const realW = vb.width || window.innerWidth;
            const realH = vb.height || window.innerHeight;
            window.scaleRatio = realW / window.innerWidth;

            [window.bgCanvas, window.dimCanvas, window.drawCanvas, window.penPreviewCanvas].forEach(c => {
                if (!c) return;
                c.width = realW;
                c.height = realH;
                c.style.width = '100%';
                c.style.height = '100%';
            });
            if (typeof clearPenPreviewLayer === 'function') clearPenPreviewLayer();

            window.blurCanvas.width = 1;
            window.blurCanvas.height = 1;
            window.ctxBlur.clearRect(0, 0, 1, 1);
            window.blurMaskCanvas.width = 1;
            window.blurMaskCanvas.height = 1;
            window.ctxBlurMask.clearRect(0, 0, 1, 1);

            window.ctxBg.clearRect(0, 0, realW, realH);
            loaded.forEach((part) => {
                const drawX = part.bounds.x - vb.x;
                const drawY = part.bounds.y - vb.y;
                window.ctxBg.drawImage(part.img, drawX, drawY, part.bounds.width, part.bounds.height);
            });

            window.setInitialAreaSelection();

            await warmupRendererAfterCapture();

            if (!captureAborted) notifyCropperReady();

            ipc.invoke('get-author-name').then(name => {
                window.currentAuthor = (name && String(name).trim()) ? String(name).trim() : '';
            }).catch(() => { window.currentAuthor = ''; });
            const boardForUsers = typeof currentBoardId !== 'undefined' ? currentBoardId : '';
            ipc.invoke('get-user-list', boardForUsers || null).then(names => { window.formUserList = names || []; });
        };

        try {
            await Promise.race([
                processCapture(),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('capture-process-timeout')),
                    CAPTURE_PROCESS_TIMEOUT_MS
                ))
            ]);
        } catch (e) {
            abortCaptureUi();
        } finally {
            if (pathsToCleanup.length) {
                ipc.invoke('cleanup-capture-files', pathsToCleanup).catch(() => {});
            }
        }
    }

    if (window.smartCap && window.smartCap.on) {
        window.smartCap.on('deliver-capture', async (_event, payload) => {
            await handleCaptureScreenImages(payload);
        });
    }

    /**
     * Инициализация плавающего окна-редактора: окно == размеру картинки (DIP),
     * картинка кладётся в натуральных пикселях, всё изображение — это «выделение».
     */
    async function seedFloatEditImage(layerPathsOrDataUrl, layout) {
        const loadImageFromSrc = (src) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image-load-error'));
            img.src = src;
        });
        const loadFromPath = async (filePath) => {
            const bytes = await capIpc().invoke('read-float-layer', filePath);
            if (!bytes || !bytes.byteLength) throw new Error('layer-read-fail');
            return loadImageFromPngBytes(bytes);
        };

        window.resetAll();

        if (typeof window.initSessionCreateSelectionForCapture === 'function') {
            await window.initSessionCreateSelectionForCapture();
        }

        let bgImg;
        let blurPath = null;
        let drawPath = null;
        if (typeof layerPathsOrDataUrl === 'string') {
            bgImg = await loadImageFromSrc(layerPathsOrDataUrl);
        } else {
            const lp = layerPathsOrDataUrl;
            if (!lp || !lp.bg) throw new Error('no-bg-layer');
            bgImg = await loadFromPath(lp.bg);
            blurPath = lp.blur || null;
            drawPath = lp.draw || null;
        }

        const natW = bgImg.naturalWidth || bgImg.width || 1;
        const natH = bgImg.naturalHeight || bgImg.height || 1;

        [window.bgCanvas, window.dimCanvas, window.drawCanvas, window.penPreviewCanvas].forEach(c => {
            if (!c) return;
            c.width = natW;
            c.height = natH;
            c.style.width = '100%';
            c.style.height = '100%';
        });
        if (typeof clearPenPreviewLayer === 'function') clearPenPreviewLayer();

        window.ctxBg.clearRect(0, 0, natW, natH);
        window.ctxBg.drawImage(bgImg, 0, 0, natW, natH);

        if (blurPath) {
            window.blurCanvas.width = natW;
            window.blurCanvas.height = natH;
            window.blurMaskCanvas.width = natW;
            window.blurMaskCanvas.height = natH;
            window.ctxBlurMask.clearRect(0, 0, natW, natH);
            const blurImg = await loadFromPath(blurPath);
            window.ctxBlur.clearRect(0, 0, natW, natH);
            window.ctxBlur.drawImage(blurImg, 0, 0, natW, natH);
        } else {
            window.blurCanvas.width = 1;
            window.blurCanvas.height = 1;
            window.ctxBlur.clearRect(0, 0, 1, 1);
            window.blurMaskCanvas.width = 1;
            window.blurMaskCanvas.height = 1;
            window.ctxBlurMask.clearRect(0, 0, 1, 1);
        }

        if (drawPath) {
            const drawImg = await loadFromPath(drawPath);
            window.ctxDraw.clearRect(0, 0, natW, natH);
            window.ctxDraw.drawImage(drawImg, 0, 0, natW, natH);
        }

        window.virtualBounds = { x: 0, y: 0, width: natW, height: natH };
        window.primaryBounds = { x: 0, y: 0, width: natW, height: natH };

        if (layout && layout.imgW > 0 && layout.imgH > 0) {
            window.floatEditLayout = layout;
            window.scaleRatio = natW / layout.imgW;

            window.selectionMode = 'full';
            window.toolbarLayoutMode = 'selection';
            window.state = 'editing';
            window.selX = 0;
            window.selY = 0;
            window.selW = natW;
            window.selH = natH;
            window.uiX = layout.wrapX || 0;
            window.uiY = layout.wrapY || 0;
            window.uiW = layout.imgW;
            window.uiH = layout.imgH;

            const wrapper = document.getElementById('canvas-wrapper');
            if (wrapper) {
                wrapper.style.position = 'fixed';
                wrapper.style.left = (layout.wrapX || 0) + 'px';
                wrapper.style.top = (layout.wrapY || 0) + 'px';
                wrapper.style.width = layout.imgW + 'px';
                wrapper.style.height = layout.imgH + 'px';
                wrapper.style.overflow = 'hidden';
            }
            if (window.drawBar) document.body.appendChild(window.drawBar);
            if (window.sideBar) document.body.appendChild(window.sideBar);
            [window.taskForm, window.updateForm, window.settingsForm].forEach((form) => {
                if (form && form.parentNode !== document.body) document.body.appendChild(form);
            });
            if (window.drawBar) window.drawBar.style.display = 'flex';
            if (window.sideBar) window.sideBar.style.display = 'flex';
            if (typeof window.applyFloatEditToolbarLayout === 'function') {
                window.applyFloatEditToolbarLayout(layout);
            }
            if (typeof updateSelectAreaButton === 'function') updateSelectAreaButton();
        } else {
            window.floatEditLayout = null;
            window.floatOffX = 0;
            window.floatOffY = 0;
            window.scaleRatio = natW / (window.innerWidth || natW);
            window.setInitialFullSelection();
        }

        await warmupRendererAfterCapture();
    }

    window.seedFloatEditImage = seedFloatEditImage;
