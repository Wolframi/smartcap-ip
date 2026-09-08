const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smartCapSettings', {
    getScreenshotHotkey: () => ipcRenderer.invoke('get-screenshot-hotkey'),
    saveScreenshotHotkey: (hotkey) => ipcRenderer.invoke('save-screenshot-hotkey', hotkey),
    getDelayedScreenshotHotkey: () => ipcRenderer.invoke('get-delayed-screenshot-hotkey'),
    saveDelayedScreenshotHotkey: (payload) => ipcRenderer.invoke('save-delayed-screenshot-hotkey', payload),
    getCreateDefaults: () => ipcRenderer.invoke('get-create-defaults'),
    setCreateDefaults: (payload) => ipcRenderer.invoke('set-create-defaults', payload),
    readCreateFormSnapshot: () => ipcRenderer.invoke('read-create-form-snapshot'),
    getBoardList: () => ipcRenderer.invoke('get-board-list'),
    close: () => ipcRenderer.send('close-settings-window')
});
