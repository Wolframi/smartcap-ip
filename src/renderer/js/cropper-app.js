// SmartCap renderer entry point. Modules are loaded by cropper.html in dependency order.
void (async function initCropperApp() {
    const floatId = new URLSearchParams(location.search).get('floatedit');

    // Плавающее окно-редактор: своя картинка + те же кнопки SmartBoard.
    if (floatId) {
        document.body.classList.add('float-edit');
        document.documentElement.classList.add('float-edit');
        try {
            const saved = await ipcRenderer.invoke('get-cropper-settings');
            if (typeof applyCropperSettings === 'function') applyCropperSettings(saved);
        } catch (e) { /* defaults from state.js */ }
        try {
            const payload = await ipcRenderer.invoke('get-float-image', floatId);
            if (!payload || !payload.layerPaths || !payload.layerPaths.bg) {
                ipcRenderer.send('float-window-close');
                return;
            }
            if (typeof window.seedFloatEditImage === 'function') {
                await window.seedFloatEditImage(payload.layerPaths, payload.layout);
            }
            if (typeof window.initFloatEditControls === 'function') {
                window.initFloatEditControls();
            }
            if (typeof refreshBoardServerStateQuick === 'function') {
                await refreshBoardServerStateQuick();
            }
            if (typeof refreshBoardServerStateInBackground === 'function') {
                refreshBoardServerStateInBackground();
            }
            if (typeof updateSmartBoardButtonsState === 'function') {
                updateSmartBoardButtonsState();
            }
            if (typeof window.applyFloatEditToolbarLayout === 'function' && window.floatEditLayout) {
                window.applyFloatEditToolbarLayout(window.floatEditLayout);
            }
            if (typeof window.showToolbars === 'function') {
                void window.showToolbars().catch(() => {});
            }
        } catch (e) {
            ipcRenderer.send('float-window-close');
        }
        return;
    }

    try {
        const saved = await ipcRenderer.invoke('get-cropper-settings');
        if (typeof applyCropperSettings === 'function') applyCropperSettings(saved);
    } catch (e) { /* defaults from state.js */ }
    if (typeof refreshBoardServerStateQuick === 'function') {
        await refreshBoardServerStateQuick();
    }
    if (typeof refreshBoardServerStateInBackground === 'function') {
        refreshBoardServerStateInBackground();
    }
})();
