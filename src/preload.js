const { contextBridge, ipcRenderer, clipboard, nativeImage } = require('electron');

const ALLOWED_INVOKE = new Set([
    'get-server-url',
    'peek-board-base-url',
    'set-board-server-url',
    'sync-board-reachability',
    'get-selected-board-id',
    'get-last-form-selection',
    'save-last-form-selection',
    'get-cropper-settings',
    'save-cropper-settings',
    'set-selected-board-id',
    'get-board-list',
    'get-user-list',
    'get-author-name',
    'is-capture-in-flight',
    'read-capture-png',
    'read-float-layer',
    'cleanup-capture-files',
    'clipboard-write-png-base64',
    'clipboard-read-image-dataurl',
    'get-screenshot-hotkey',
    'save-screenshot-hotkey',
    'get-delayed-screenshot-hotkey',
    'save-delayed-screenshot-hotkey',
    'get-create-defaults',
    'set-create-defaults',
    'read-create-form-snapshot',
    'get-float-image',
    'float-window-ensure-width',
    'float-window-ensure-bounds'
]);

const ALLOWED_SEND = new Set([
    'smartboard-request-failed',
    'show-cropper',
    'cropper-ready',
    'close-cropper',
    'save-direct-file',
    'create-float-window',
    'float-window-close',
    'float-window-minimize',
    'start-window-drag',
    'stop-window-drag',
    'start-custom-drag',
    'stop-custom-drag',
    'create-form-snapshot-response',
    'set-ignore-mouse-events'
]);

const ALLOWED_ON = new Set([
    'board-available',
    'board-unavailable',
    'capture-aborted',
    'save-cancelled',
    'save-complete',
    'deliver-capture',
    'trigger-paste-clipboard',
    'collect-create-form-snapshot'
]);

contextBridge.exposeInMainWorld('smartCap', {
    invoke(channel, ...args) {
        if (!ALLOWED_INVOKE.has(channel)) return Promise.reject(new Error(`IPC invoke not allowed: ${channel}`));
        return ipcRenderer.invoke(channel, ...args);
    },
    send(channel, ...args) {
        if (!ALLOWED_SEND.has(channel)) return;
        ipcRenderer.send(channel, ...args);
    },
    on(channel, listener) {
        if (!ALLOWED_ON.has(channel) || typeof listener !== 'function') return () => {};
        const wrapped = (_event, ...args) => listener(_event, ...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },
    clipboardWriteImageFromDataUrl(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return false;
        try {
            const comma = dataUrl.indexOf(',');
            const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
            let img = null;
            if (b64) {
                const buf = Buffer.from(b64, 'base64');
                if (buf.length) img = nativeImage.createFromBuffer(buf);
            }
            if (!img || img.isEmpty()) img = nativeImage.createFromDataURL(dataUrl);
            if (!img || img.isEmpty()) return false;
            clipboard.writeImage(img);
            return true;
        } catch (e) {
            return false;
        }
    },
    clipboardReadImageAsDataUrl() {
        return ipcRenderer.invoke('clipboard-read-image-dataurl');
    }
});
