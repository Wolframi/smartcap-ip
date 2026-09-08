    const CROPPER_TOOLS = new Set(['pen', 'line', 'arrow', 'step', 'rect', 'oval', 'blur', 'text']);
    let persistCropperTimer = null;

    function collectCropperSettings() {
        let pickerHue = 0;
        if (pickerWrap && pickerThumb) {
            const w = pickerWrap.offsetWidth || parseFloat(pickerWrap.getBoundingClientRect().width) || 82;
            const left = parseFloat(pickerThumb.style.left);
            if (Number.isFinite(left) && w > 0) pickerHue = Math.max(0, Math.min(100, (left / w) * 100));
        }
        const opacity = Math.max(0.05, Math.min(1, Math.round(currentOpacity * 10) / 10));
        return {
            tool: currentTool,
            toolSize: currentToolSize,
            color: currentColor,
            opacity,
            pickerHue
        };
    }

    function applyCropperSettings(settings) {
        if (!settings || typeof settings !== 'object') return;
        const tool = CROPPER_TOOLS.has(settings.tool) ? settings.tool : 'pen';
        let toolSize = Math.round(Number(settings.toolSize));
        if (!Number.isFinite(toolSize)) toolSize = TOOL_SIZE_DEFAULT;
        toolSize = Math.max(TOOL_SIZE_MIN, Math.min(TOOL_SIZE_MAX, toolSize));
        let opacity = Number(settings.opacity);
        if (!Number.isFinite(opacity) && Number.isFinite(Number(settings.transparency))) {
            opacity = 1 - Number(settings.transparency);
        }
        if (!Number.isFinite(opacity)) opacity = 1;
        if (opacity < 0.05) opacity = 1;

        setTool(tool);
        setToolSize(toolSize, true);
        if (typeof window.updateToolSizeSliderVisual === 'function') {
            window.updateToolSizeSliderVisual(toolSize, false);
        }
        setColor(typeof settings.color === 'string' ? settings.color : '#ff0000');
        setOpacity(opacity);

        if (pickerWrap && pickerThumb && Number.isFinite(Number(settings.pickerHue))) {
            const w = pickerWrap.offsetWidth || 82;
            const hue = Math.max(0, Math.min(100, Number(settings.pickerHue)));
            pickerThumb.style.left = (hue / 100) * w + 'px';
            pickerThumb.style.background = currentColor;
        }
    }

    function persistCropperSettingsNow() {
        return ipcRenderer.invoke('save-cropper-settings', collectCropperSettings()).catch(() => {});
    }

    function schedulePersistCropperSettings() {
        clearTimeout(persistCropperTimer);
        persistCropperTimer = setTimeout(() => {
            persistCropperTimer = null;
            void persistCropperSettingsNow();
        }, 350);
    }

    function closeCropper() {
        // Плавающее окно-редактор: закрываем именно это окно, а не общий кроппер.
        if (document.body.classList.contains('float-edit')) {
            ipcRenderer.send('float-window-close');
            return;
        }
        if (typeof saveSessionCreateSelection === 'function') saveSessionCreateSelection();
        if (typeof saveSessionUpdateSelection === 'function') saveSessionUpdateSelection();

        Promise.race([
            Promise.all([
                persistCropperSettingsNow(),
                typeof flushPersistCreateDefaultsIfRemember === 'function'
                    ? flushPersistCreateDefaultsIfRemember()
                    : Promise.resolve(),
                typeof flushLastFormSelection === 'function'
                    ? flushLastFormSelection()
                    : Promise.resolve()
            ]),
            new Promise(resolve => setTimeout(resolve, 500))
        ]).finally(() => {
            if (typeof window.resetAll === 'function') window.resetAll();
            ipcRenderer.send('close-cropper');
        });
    }

    window.closeCropper = closeCropper;
    window.schedulePersistCropperSettings = schedulePersistCropperSettings;
    window.persistCropperSettingsNow = persistCropperSettingsNow;
    window.applyCropperSettings = applyCropperSettings;
