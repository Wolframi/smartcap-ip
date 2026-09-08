/**
 * Electron main process — cropper (скриншотер).
 * Запускает сервер, создаёт окно кроппера, трей, IPC.
 */
const { app, BrowserWindow, globalShortcut, Tray, Menu, shell, ipcMain, screen, dialog, nativeImage, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const dgram = require('dgram');
const http = require('http');
const https = require('https');

app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disk-cache-size', '1');
if (process.platform === 'win32') {
    app.setAppUserModelId('com.smartcap.app');
}

/** Пишет строку в лог SmartCap (очередь — без гонок appendFile). */
const CAPTURE_LOG_MAX_BYTES = 512 * 1024;
let captureLogChain = Promise.resolve();

function logMainError(tag, e) {
    try {
        const msg = e && e.stack ? e.stack : (e && e.message) || String(e);
        if (tag.startsWith('writeCaptureLog')) {
            console.error(`[SmartCap] ${tag}:`, msg);
            return;
        }
        writeCaptureLog(`${tag}: ${msg}`);
    } catch (_) {}
}

function writeCaptureLog(line) {
    try {
        const logPath = path.join(app.getPath('userData'), 'capture-log.txt');
        const ts = new Date().toISOString();
        const chunk = `[${ts}] ${line}\n`;
        captureLogChain = captureLogChain.then(async () => {
            try {
                const st = await fsPromises.stat(logPath);
                if (st.size + Buffer.byteLength(chunk, 'utf8') > CAPTURE_LOG_MAX_BYTES) {
                    const data = await fsPromises.readFile(logPath, 'utf8');
                    const keep = Math.floor(CAPTURE_LOG_MAX_BYTES / 2);
                    await fsPromises.writeFile(logPath, data.slice(-keep), 'utf8');
                }
            } catch (e) {
                if (e && e.code !== 'ENOENT') logMainError('writeCaptureLog-rotate', e);
            }
            await fsPromises.appendFile(logPath, chunk, 'utf8');
        }).catch((e) => logMainError('writeCaptureLog', e));
    } catch (e) {
        logMainError('writeCaptureLog-init', e);
    }
}

const STARTUP_GRACE_MS = 20000;
const processStartedAt = Date.now();
let mainProcessReady = false;

const DISCOVERY_PORT = 39452;
const DISCOVERY_MAGIC_WHO = 'SMARTBOARD_WHO';
const DISCOVERY_MAGIC_OK = 'SMARTBOARD_OK|';
const SMARTCAP_STOP_PORT = 39453;
const DISCOVERY_MAGIC_STOP = 'SMARTBOARD_STOP';
const DISCOVERY_MAGIC_START = 'SMARTBOARD_START|';
const DISCOVERY_TIMEOUT_MS = 6000;
const DISCOVERY_RETRIES = 8;
const DISCOVERY_RETRY_INTERVAL_MS = 300;

function isIpv4Interface(iface) {
    return iface && (iface.family === 'IPv4' || iface.family === 4);
}

/** Не путать с vEthernet (Wi-Fi) — это мост к реальной сети на Windows/Hyper-V. */
function isLikelyVirtualIface(name) {
    const lower = String(name || '').trim().toLowerCase();
    if (!lower) return false;
    if (/^(lo|loopback)/.test(lower)) return true;
    if (/docker|vmware|virtualbox|vboxnet|npcap|zerotier|tailscale|hamachi|happ-tun/.test(lower)) return true;
    if (/\bwsl\b/.test(lower)) return true;
    if (/hyper-v/.test(lower)) return true;
    if (/vethernet/.test(lower) && /(default switch|wsl)/.test(lower)) return true;
    return false;
}

const DISCOVERY_PROBE_MS = 3500;

async function pickReachableBoardUrl(advertisedUrl, replyFromIp) {
    const advertised = normalizeBaseUrl(advertisedUrl);
    if (advertised && await probeBoardHealth(advertised, DISCOVERY_PROBE_MS)) return advertised;
    if (replyFromIp && replyFromIp !== '127.0.0.1') {
        const viaReply = normalizeBaseUrl(`http://${replyFromIp}:3000`);
        if (viaReply && viaReply !== advertised && await probeBoardHealth(viaReply, DISCOVERY_PROBE_MS)) {
            writeCaptureLog(`URL из UDP ${advertised || '(пусто)'} недоступен, используем ${viaReply}`);
            return viaReply;
        }
    }
    return null;
}
// Не задаём userData вручную — используем %AppData%\SmartCap, иначе при установке в Program Files приложение не запустится на другом ПК

// Один экземпляр на ПК — встроенный Electron lock
writeCaptureLog(`Запуск pid=${process.pid} exe=${process.execPath}`);
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    writeCaptureLog(`Выход: уже работает другой экземпляр (electron-lock) pid=${process.pid}`);
    app.quit();
    return;
}
app.on('second-instance', (_event, argv) => {
    const args = Array.isArray(argv) ? argv : [];
    writeCaptureLog(`second-instance pid=${process.pid} argv=${args.join(' ')}`);
    if (!mainProcessReady) return;
    // Дубль автозапуска при входе в Windows часто приходит в первые секунды — не открываем настройки.
    if (Date.now() - processStartedAt < STARTUP_GRACE_MS) return;
    showSettingsWindow();
});

/** URL доски, по которому недавно успешно ответил /api/boards (трей, кроппер, get-server-url). */
let cachedServerUrl = null;
const CACHE_TTL_MS = 120000; // 2 мин — только для UDP-кэша кандидата, не «доска жива»
let discoveryUrlCache = null;
let discoveryUrlCacheTime = 0;
const DEFAULT_CROPPER_SETTINGS = {
    tool: 'pen',
    toolSize: 10,
    color: '#ff0000',
    opacity: 1,
    pickerHue: 0
};
const DEFAULT_SCREENSHOT_HOTKEY = 'Control+Alt+S';
const DEFAULT_SCREENSHOT_HOTKEY_DELAY_MS = 3000;
/** Предпочтительный SmartBoard (пробуется до UDP; UDP остаётся как запасной поиск). */
const PREFERRED_BOARD_SERVER_URL = 'http://193.233.247.171:3000';
const LEGACY_PREFERRED_BOARD_SERVER_URL = 'http://192.168.99.107:3000';

function getPreferredBoardServerUrl() {
    return normalizeBaseUrl(PREFERRED_BOARD_SERVER_URL);
}

let appSettings = {
    selectedBoardId: '',
    boardServerUrl: getPreferredBoardServerUrl(),
    cropper: { ...DEFAULT_CROPPER_SETTINGS },
    screenshotHotkey: DEFAULT_SCREENSHOT_HOTKEY,
    screenshotHotkeyDelayed: '',
    screenshotHotkeyDelayMs: DEFAULT_SCREENSHOT_HOTKEY_DELAY_MS,
    rememberCreateDefaults: true,
    defaultBoardId: '',
    defaultColumnId: '',
    defaultBoardName: '',
    defaultColumnName: '',
    defaultUpdateBoardId: '',
    defaultUpdateColumnId: '',
    defaultUpdateCardId: '',
    defaultUpdateBoardName: '',
    defaultUpdateColumnName: '',
    defaultUpdateCardName: '',
    lastCreateColumnId: '',
    lastUpdateColumnId: '',
    lastUpdateCardId: ''
};

function normalizeCropperSettings(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const tools = new Set(['pen', 'line', 'arrow', 'step', 'rect', 'oval', 'blur', 'text']);
    let toolSize = Math.round(Number(o.toolSize));
    if (!Number.isFinite(toolSize)) toolSize = DEFAULT_CROPPER_SETTINGS.toolSize;
    toolSize = Math.max(2, Math.min(20, toolSize));
    let opacity = Number(o.opacity);
    if (!Number.isFinite(opacity) && Number.isFinite(Number(o.transparency))) {
        opacity = 1 - Number(o.transparency);
    }
    if (!Number.isFinite(opacity)) opacity = DEFAULT_CROPPER_SETTINGS.opacity;
    if (opacity < 0.05) opacity = DEFAULT_CROPPER_SETTINGS.opacity;
    opacity = Math.max(0.05, Math.min(1, Math.round(opacity * 10) / 10));
    let pickerHue = Number(o.pickerHue);
    if (!Number.isFinite(pickerHue)) pickerHue = DEFAULT_CROPPER_SETTINGS.pickerHue;
    pickerHue = Math.max(0, Math.min(100, pickerHue));
    const color = typeof o.color === 'string' && o.color.trim() ? o.color.trim() : DEFAULT_CROPPER_SETTINGS.color;
    const tool = typeof o.tool === 'string' && tools.has(o.tool) ? o.tool : DEFAULT_CROPPER_SETTINGS.tool;
    return { tool, toolSize, color, opacity, pickerHue };
}

function getCropperSettings() {
    return normalizeCropperSettings(appSettings.cropper);
}

function setCropperSettings(prefs) {
    appSettings.cropper = normalizeCropperSettings({ ...getCropperSettings(), ...(prefs || {}) });
    saveSettings();
}

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
    try {
        const settingsPath = getSettingsPath();
        if (fs.existsSync(settingsPath)) {
            const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            appSettings = {
                selectedBoardId: typeof parsed.selectedBoardId === 'string' ? parsed.selectedBoardId : '',
                boardServerUrl: (function pickSavedBoardUrl() {
                    const saved = (typeof parsed.boardServerUrl === 'string' && parsed.boardServerUrl.trim())
                        ? normalizeBaseUrl(parsed.boardServerUrl)
                        : '';
                    if (!saved || saved === normalizeBaseUrl(LEGACY_PREFERRED_BOARD_SERVER_URL)) {
                        return getPreferredBoardServerUrl();
                    }
                    return saved;
                })(),
                cropper: normalizeCropperSettings(parsed.cropper),
                screenshotHotkey: normalizeScreenshotHotkey(parsed.screenshotHotkey),
                screenshotHotkeyDelayed: normalizeDelayedScreenshotHotkey(parsed.screenshotHotkeyDelayed),
                screenshotHotkeyDelayMs: normalizeScreenshotHotkeyDelayMs(parsed.screenshotHotkeyDelayMs),
                rememberCreateDefaults: typeof parsed.rememberCreateDefaults === 'boolean'
                    ? parsed.rememberCreateDefaults
                    : true,
                defaultBoardId: typeof parsed.defaultBoardId === 'string' ? parsed.defaultBoardId : '',
                defaultColumnId: typeof parsed.defaultColumnId === 'string' ? parsed.defaultColumnId : '',
                defaultBoardName: typeof parsed.defaultBoardName === 'string' ? parsed.defaultBoardName : '',
                defaultColumnName: typeof parsed.defaultColumnName === 'string' ? parsed.defaultColumnName : '',
                defaultUpdateBoardId: typeof parsed.defaultUpdateBoardId === 'string' ? parsed.defaultUpdateBoardId : '',
                defaultUpdateColumnId: typeof parsed.defaultUpdateColumnId === 'string' ? parsed.defaultUpdateColumnId : '',
                defaultUpdateCardId: typeof parsed.defaultUpdateCardId === 'string' ? parsed.defaultUpdateCardId : '',
                defaultUpdateBoardName: typeof parsed.defaultUpdateBoardName === 'string' ? parsed.defaultUpdateBoardName : '',
                defaultUpdateColumnName: typeof parsed.defaultUpdateColumnName === 'string' ? parsed.defaultUpdateColumnName : '',
                defaultUpdateCardName: typeof parsed.defaultUpdateCardName === 'string' ? parsed.defaultUpdateCardName : '',
                lastCreateColumnId: typeof parsed.lastCreateColumnId === 'string' ? parsed.lastCreateColumnId : '',
                lastUpdateColumnId: typeof parsed.lastUpdateColumnId === 'string' ? parsed.lastUpdateColumnId : '',
                lastUpdateCardId: typeof parsed.lastUpdateCardId === 'string' ? parsed.lastUpdateCardId : ''
            };
        }
    } catch (e) {
        logMainError('loadSettings', e);
    }
}

let saveSettingsDebounceTimer = null;
let saveSettingsChain = Promise.resolve();

async function saveSettingsNow() {
    try {
        await fsPromises.writeFile(getSettingsPath(), JSON.stringify(appSettings, null, 2), 'utf8');
    } catch (e) {
        logMainError('saveSettings', e);
    }
}

function saveSettings() {
    clearTimeout(saveSettingsDebounceTimer);
    saveSettingsDebounceTimer = setTimeout(() => {
        saveSettingsDebounceTimer = null;
        saveSettingsChain = saveSettingsChain.then(saveSettingsNow);
    }, 120);
}

function flushSaveSettingsSync() {
    clearTimeout(saveSettingsDebounceTimer);
    saveSettingsDebounceTimer = null;
    try {
        fs.writeFileSync(getSettingsPath(), JSON.stringify(appSettings, null, 2), 'utf8');
    } catch (e) {
        logMainError('flushSaveSettingsSync', e);
    }
}
function getSelectedBoardId() {
    return appSettings.selectedBoardId || '';
}
function setSelectedBoardId(boardId) {
    appSettings.selectedBoardId = (boardId && String(boardId).trim()) ? String(boardId).trim() : '';
    saveSettings();
}

function getLastFormSelection() {
    return {
        boardId: appSettings.selectedBoardId || '',
        createColumnId: appSettings.lastCreateColumnId || '',
        updateColumnId: appSettings.lastUpdateColumnId || '',
        updateCardId: appSettings.lastUpdateCardId || ''
    };
}

function setLastFormSelection(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.createColumnId != null) {
        appSettings.lastCreateColumnId = String(p.createColumnId).trim();
    }
    if (p.updateColumnId != null) {
        appSettings.lastUpdateColumnId = String(p.updateColumnId).trim();
    }
    if (p.updateCardId != null) {
        appSettings.lastUpdateCardId = String(p.updateCardId).trim();
    }
    saveSettings();
    return getLastFormSelection();
}

const CLIPBOARD_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff']);

function isClipboardImageFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const ext = path.extname(filePath).toLowerCase();
    return CLIPBOARD_IMAGE_EXT.has(ext);
}

function dataUrlFromImagePath(filePath) {
    try {
        if (!filePath || typeof filePath !== 'string') return null;
        const normalized = path.normalize(String(filePath).trim());
        if (!normalized || !fs.existsSync(normalized)) return null;
        let img = nativeImage.createFromPath(normalized);
        if (img && !img.isEmpty()) return img.toDataURL();
        const buf = fs.readFileSync(normalized);
        if (buf && buf.length) {
            img = nativeImage.createFromBuffer(buf);
            if (img && !img.isEmpty()) return img.toDataURL();
        }
    } catch (e) {}
    return null;
}

function decodeFileNameWBuffer(buf) {
    if (!buf || buf.length < 2) return [];
    const text = buf.toString('utf16le').replace(/\0+$/, '');
    return text.split('\0').map((p) => p.trim()).filter(Boolean);
}

function parseCFHDropPaths(buf) {
    if (!buf || buf.length < 20) return [];
    try {
        const offset = buf.readUInt32LE(0);
        if (offset < 0 || offset >= buf.length) return [];
        const paths = [];
        let i = offset;
        while (i + 1 < buf.length) {
            const start = i;
            while (i + 1 < buf.length) {
                if (buf.readUInt16LE(i) === 0) break;
                i += 2;
            }
            if (i > start) {
                paths.push(buf.toString('utf16le', start, i));
            }
            i += 2;
            if (i >= buf.length - 1) break;
            if (buf.readUInt16LE(i) === 0) break;
        }
        return paths;
    } catch (e) {
        return [];
    }
}

function parseUriList(text) {
    if (!text || typeof text !== 'string') return [];
    const paths = [];
    text.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        if (/^file:\/\//i.test(trimmed)) {
            try {
                const { fileURLToPath } = require('url');
                paths.push(fileURLToPath(trimmed));
            } catch (e) {
                paths.push(trimmed.replace(/^file:\/*/i, '').replace(/\//g, path.sep));
            }
        } else if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
            paths.push(trimmed);
        }
    });
    return paths;
}

function parseClipboardFilePaths() {
    const paths = [];
    const addPath = (raw) => {
        const p = String(raw || '').trim().replace(/^["']|["']$/g, '');
        if (p && !paths.includes(p)) paths.push(p);
    };

    let formats = [];
    try {
        formats = clipboard.availableFormats() || [];
    } catch (e) {}

    for (const fmt of formats) {
        const fmtLower = String(fmt).toLowerCase();
        if (fmtLower.includes('filename')) {
            try {
                decodeFileNameWBuffer(clipboard.readBuffer(fmt)).forEach(addPath);
            } catch (e) {}
        }
        if (fmtLower === 'cf_hdrop' || fmtLower.includes('hdrop')) {
            try {
                parseCFHDropPaths(clipboard.readBuffer(fmt)).forEach(addPath);
            } catch (e) {}
        }
        if (fmtLower.includes('uri-list') || fmtLower.includes('uniformresourcelocator')) {
            try {
                const text = clipboard.read(fmt) || clipboard.readText(fmt);
                parseUriList(text).forEach(addPath);
            } catch (e) {}
        }
    }

    try {
        decodeFileNameWBuffer(clipboard.readBuffer('FileNameW')).forEach(addPath);
    } catch (e) {}

    try {
        parseCFHDropPaths(clipboard.readBuffer('CF_HDROP')).forEach(addPath);
    } catch (e) {}

    try {
        parseUriList(clipboard.readText('text/uri-list')).forEach(addPath);
    } catch (e) {}

    try {
        parseUriList(clipboard.readText('text/plain')).forEach(addPath);
    } catch (e) {}

    return paths;
}

function readClipboardImageFromFilePaths() {
    for (const filePath of parseClipboardFilePaths()) {
        if (!isClipboardImageFilePath(filePath)) continue;
        const url = dataUrlFromImagePath(filePath);
        if (url) return url;
    }
    return null;
}

function getCreateDefaults() {
    return {
        remember: appSettings.rememberCreateDefaults === true,
        boardId: appSettings.defaultBoardId || '',
        columnId: appSettings.defaultColumnId || '',
        boardName: appSettings.defaultBoardName || '',
        columnName: appSettings.defaultColumnName || '',
        updateBoardId: appSettings.defaultUpdateBoardId || '',
        updateColumnId: appSettings.defaultUpdateColumnId || '',
        updateCardId: appSettings.defaultUpdateCardId || '',
        updateBoardName: appSettings.defaultUpdateBoardName || '',
        updateColumnName: appSettings.defaultUpdateColumnName || '',
        updateCardName: appSettings.defaultUpdateCardName || ''
    };
}

function getSavedBoardServerUrl() {
    return normalizeBaseUrl(appSettings.boardServerUrl || '') || getPreferredBoardServerUrl();
}

function setSavedBoardServerUrl(url) {
    const normalized = normalizeBaseUrl(url);
    if (!normalized || appSettings.boardServerUrl === normalized) return;
    appSettings.boardServerUrl = normalized;
    saveSettings();
    writeCaptureLog(`Сохранён адрес SmartBoard: ${normalized}`);
}
function getBoardExternalUrl() {
    if (!cachedServerUrl) return '';
    const boardId = getSelectedBoardId();
    if (!boardId) return cachedServerUrl;
    return cachedServerUrl.replace(/\/?$/, '') + '/?board=' + encodeURIComponent(boardId);
}

function normalizeBaseUrl(url) {
    const s = String(url == null ? '' : url).trim().replace(/\/?$/, '');
    return s || '';
}

/** Разбор IP/хоста из поля ввода: 192.168.1.10, 192.168.1.10:3000 или полный URL. */
function parseUserBoardHost(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    s = s.replace(/\\/g, '/');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try {
        const u = new URL(s);
        const host = String(u.hostname || '').trim();
        if (!host) return '';
        const port = u.port || '3000';
        const proto = (u.protocol === 'https:') ? 'https' : 'http';
        return normalizeBaseUrl(`${proto}://${host}:${port}`);
    } catch (e) {
        return '';
    }
}

function formatBoardHostForInput(url) {
    const base = normalizeBaseUrl(url);
    if (!base) return '';
    try {
        const u = new URL(base);
        const host = String(u.hostname || '').trim();
        if (!host) return base.replace(/^https?:\/\//i, '');
        const port = u.port || '';
        return port ? `${host}:${port}` : host;
    } catch (e) {
        return base.replace(/^https?:\/\//i, '');
    }
}

/** IP/хост из поля ввода → http(s)://host:port (порт по умолчанию 3000). */
function parseUserBoardHost(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    s = s.replace(/\\/g, '/');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try {
        const u = new URL(s);
        const host = String(u.hostname || '').trim();
        if (!host) return '';
        const port = u.port || '3000';
        const proto = (u.protocol === 'https:') ? 'https' : 'http';
        return normalizeBaseUrl(`${proto}://${host}:${port}`);
    } catch (e) {
        return '';
    }
}

function isJsonContentType(headers) {
    const ct = headers && (headers['content-type'] || headers['Content-Type']);
    return typeof ct === 'string' && ct.toLowerCase().includes('application/json');
}

function safeSendToCropper(channel, ...args) {
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    const wc = cropperWindow.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
        wc.send(channel, ...args);
    } catch (e) {}
}

function getBoardRendererWindows() {
    const wins = [];
    if (cropperWindow && !cropperWindow.isDestroyed()) wins.push(cropperWindow);
    for (const win of floatWindows) {
        if (win && !win.isDestroyed()) wins.push(win);
    }
    return wins;
}

function broadcastToBoardRenderers(channel, ...args) {
    for (const win of getBoardRendererWindows()) {
        try {
            const wc = win.webContents;
            if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
        } catch (e) {}
    }
}

/** Чтение изображения из буфера (Windows часто отдаёт не только readImage). */
function readClipboardImageDataUrl() {
    try {
        const img = clipboard.readImage();
        if (img && !img.isEmpty()) return img.toDataURL();
    } catch (e) {}

    let formats = [];
    try {
        formats = clipboard.availableFormats() || [];
    } catch (e) {}

    const tryBuffer = (fmt) => {
        try {
            const buf = clipboard.readBuffer(fmt);
            if (!buf || buf.length < 8) return null;
            const ni = nativeImage.createFromBuffer(buf);
            if (ni && !ni.isEmpty()) return ni.toDataURL();
        } catch (e) {}
        return null;
    };

    const preferred = [
        'image/png', 'image/x-png', 'PNG', 'image/jpeg', 'image/jpg', 'JFIF',
        'image/bmp', 'image/tiff', 'image/webp', 'image/gif', 'Bitmap'
    ];
    for (const fmt of preferred) {
        const url = tryBuffer(fmt);
        if (url) return url;
    }
    for (const fmt of formats) {
        if (!/png|jpe?g|bmp|tif|webp|gif|image|bitmap|dib/i.test(fmt)) continue;
        const url = tryBuffer(fmt);
        if (url) return url;
    }
    return readClipboardImageFromFilePaths();
}

function registerCropperKeyboardShortcuts(wc) {
    if (!wc || wc.isDestroyed()) return;
    wc.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const ctrl = !!(input.control || input.meta);
        if (!ctrl || input.alt) return;
        const key = String(input.key || '').toLowerCase();
        if (key === 'v') {
            event.preventDefault();
            safeSendToCropper('trigger-paste-clipboard');
        }
    });
}

/** GET /api/boards: true если SmartBoard реально отвечает (2xx–4xx от приложения). */
function probeBoardHealth(baseUrl, reqTimeoutMs = 4500) {
    const base = normalizeBaseUrl(baseUrl);
    if (!base) return Promise.resolve(false);
    return new Promise((resolve) => {
        const lib = base.startsWith('https') ? https : http;
        let settled = false;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };
        let req;
        try {
            req = lib.get(`${base}/api/boards`, (res) => {
                const ok = res.statusCode >= 200 && res.statusCode < 500;
                res.resume();
                res.on('end', () => finish(ok));
                res.on('error', () => finish(false));
            });
        } catch (e) {
            finish(false);
            return;
        }
        req.on('error', () => finish(false));
        req.setTimeout(reqTimeoutMs, () => {
            try { req.destroy(); } catch (e) {}
            finish(false);
        });
    });
}

/** @param {number} [reqTimeoutMs] таймаут HTTP (короче — перед UI/треем). */
function runBoardHealthProbe(reqTimeoutMs = 4500) {
    const saved = getSavedBoardServerUrl();
    const target = cachedServerUrl || discoveryUrlCache || saved || getPreferredBoardServerUrl();
    const tryActivate = (url, timeoutMs = reqTimeoutMs) => probeBoardHealth(url, timeoutMs).then((ok) => {
        if (ok) {
            setBoardAvailable(url);
            return true;
        }
        return false;
    });

    if (target) {
        const probeMs = (saved && target === saved && !cachedServerUrl) ? Math.min(reqTimeoutMs, 1500) : reqTimeoutMs;
        return tryActivate(target, probeMs).then((ok) => {
            if (ok) return;
            cachedServerUrl = null;
            discoveryUrlCache = null;
            discoveryUrlCacheTime = 0;
            return getServerUrl(true).then((url) => {
                if (!url) {
                    setBoardUnavailable();
                    return;
                }
                return tryActivate(url).then((ok2) => {
                    if (!ok2) setBoardUnavailable();
                });
            });
        });
    }
    return getServerUrl().then((url) => {
        if (!url) return undefined;
        return tryActivate(url);
    }).catch(() => {});
}

/** По адресу и маске подсети возвращает broadcast-адрес. */
function subnetBroadcast(addr, netmask) {
    const toInt = (s) => s.split('.').reduce((n, o) => (n << 8) + parseInt(o, 10), 0) >>> 0;
    const toStr = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    const ipNum = toInt(addr);
    const maskNum = toInt(netmask);
    const broadcastNum = (ipNum & maskNum) | ((~maskNum) >>> 0);
    return toStr(broadcastNum);
}

/** Список адресов для WHO: global broadcast, subnet broadcast и unicast по своим IPv4 (Docker/host). */
function getDiscoveryTargets() {
    const targets = new Set(['255.255.255.255', '127.0.0.1']);
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces || {})) {
        if (isLikelyVirtualIface(name)) continue;
        for (const iface of ifaces[name] || []) {
            if (!isIpv4Interface(iface) || iface.internal || !iface.address) continue;
            targets.add(iface.address);
            if (iface.netmask) targets.add(subnetBroadcast(iface.address, iface.netmask));
        }
    }
    return Array.from(targets);
}

/** HTTP fallback на случай, если UDP broadcast заблокирован firewall/сетью. */
function getHttpFallbackCandidates() {
    const candidates = new Set();
    const preferred = getPreferredBoardServerUrl();
    if (preferred) candidates.add(preferred);
    const explicitUrl = normalizeBaseUrl(process.env.SMARTBOARD_URL || process.env.SMARTBOARD_PUBLIC_URL || '');
    if (explicitUrl) candidates.add(explicitUrl);
    candidates.add('http://localhost:3000');
    candidates.add('http://127.0.0.1:3000');

    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces || {})) {
        if (isLikelyVirtualIface(name)) continue;
        for (const iface of ifaces[name] || []) {
            if (isIpv4Interface(iface) && !iface.internal && iface.address) {
                candidates.add(`http://${iface.address}:3000`);
            }
        }
    }
    return Array.from(candidates).filter(Boolean);
}

/** Хосты :3000 в локальных подсетях /24 (сервер на другом ПК в LAN, напр. .146). */
function getLanSubnetHttpCandidates() {
    const hosts = new Set();
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces || {})) {
        if (isLikelyVirtualIface(name)) continue;
        for (const iface of ifaces[name] || []) {
            if (!isIpv4Interface(iface) || iface.internal || !iface.address || !iface.netmask) continue;
            if (iface.netmask !== '255.255.255.0') continue;
            const parts = iface.address.split('.').map((x) => parseInt(x, 10));
            if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) continue;
            const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
            for (let host = 1; host <= 254; host++) {
                hosts.add(`http://${prefix}${host}:3000`);
            }
        }
    }
    return Array.from(hosts);
}

async function discoverBoardServerByHttpFallback() {
    const primary = getHttpFallbackCandidates();
    for (const candidate of primary) {
        if (await probeBoardHealth(candidate, 2000)) {
            writeCaptureLog(`HTTP fallback нашёл SmartBoard: ${candidate}`);
            return candidate;
        }
    }

    const subnet = getLanSubnetHttpCandidates().filter((u) => !primary.includes(u));
    if (!subnet.length) return null;

    writeCaptureLog(`HTTP fallback: сканирование LAN /24 (${subnet.length} адресов)...`);
    const batchSize = 12;
    for (let i = 0; i < subnet.length; i += batchSize) {
        const batch = subnet.slice(i, i + batchSize);
        const hits = await Promise.all(batch.map(async (candidate) => (
            (await probeBoardHealth(candidate, 700)) ? candidate : null
        )));
        const found = hits.find(Boolean);
        if (found) {
            writeCaptureLog(`HTTP fallback (LAN scan) нашёл SmartBoard: ${found}`);
            return found;
        }
    }
    return null;
}

/** Обнаружение сервера SmartBoard в LAN по UDP (broadcast + unicast, с HTTP-проверкой ответа). */
function discoverBoardServer() {
    return new Promise((resolve) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        let resolved = false;
        let timeoutId = null;
        let retryIntervalId = null;
        const done = (url) => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            if (retryIntervalId) clearInterval(retryIntervalId);
            try { socket.close(); } catch (e) {}
            resolve(url || null);
        };
        socket.on('message', (msg, rinfo) => {
            const str = (msg.toString() || '').trim();
            if (!str.startsWith(DISCOVERY_MAGIC_OK) || resolved) return;
            const advertised = str.slice(DISCOVERY_MAGIC_OK.length).trim();
            void pickReachableBoardUrl(advertised, rinfo && rinfo.address).then((url) => {
                if (!url || resolved) return;
                writeCaptureLog(`UDP WHO→ответ от ${rinfo.address}:${rinfo.port} url=${url}`);
                done(url);
            });
        });
        socket.on('error', () => done(null));
        socket.bind({ address: '0.0.0.0', port: 0 }, () => {
            socket.setBroadcast(true);
            const buf = Buffer.from(DISCOVERY_MAGIC_WHO, 'utf8');
            const targets = getDiscoveryTargets();
            const send = () => {
                for (const ip of targets) {
                    try { socket.send(buf, 0, buf.length, DISCOVERY_PORT, ip); } catch (e) {}
                }
            };
            send();
            let attempts = 1;
            retryIntervalId = setInterval(() => {
                if (resolved || attempts >= DISCOVERY_RETRIES) {
                    if (retryIntervalId) clearInterval(retryIntervalId);
                    return;
                }
                send();
                attempts++;
            }, DISCOVERY_RETRY_INTERVAL_MS);
        });
        timeoutId = setTimeout(() => done(null), DISCOVERY_TIMEOUT_MS);
    });
}

let discoveryInFlight = null;

function cacheDiscoveredUrl(url) {
    const n = normalizeBaseUrl(url || '');
    if (!n) return null;
    discoveryUrlCache = n;
    discoveryUrlCacheTime = Date.now();
    return n;
}

/** Первый поиск: предпочтительный адрес, затем UDP и HTTP/LAN параллельно. */
async function discoverServerUrlParallel() {
    const preferred = getPreferredBoardServerUrl();
    if (preferred && await probeBoardHealth(preferred, 1500)) {
        writeCaptureLog(`SmartBoard по предпочтительному адресу: ${preferred}`);
        return cacheDiscoveredUrl(preferred);
    }
    return new Promise((resolve) => {
        let settled = false;
        const finish = (url) => {
            if (settled) return;
            const n = cacheDiscoveredUrl(url);
            if (!n) return;
            settled = true;
            resolve(n);
        };
        const udpP = discoverBoardServer();
        const httpP = discoverBoardServerByHttpFallback();
        udpP.then((url) => finish(url));
        httpP.then((url) => finish(url));
        Promise.all([udpP, httpP]).then(([udpUrl, httpUrl]) => {
            if (settled) return;
            settled = true;
            const n = cacheDiscoveredUrl(udpUrl || httpUrl || '');
            if (n) {
                resolve(n);
                return;
            }
            discoveryUrlCache = null;
            writeCaptureLog('SmartBoard не найден: UDP без ответа, HTTP fallback пуст');
            resolve(null);
        });
    });
}

/** Повторный поиск, если сохранённый адрес не отвечает: сначала UDP, затем HTTP. */
async function discoverServerUrlAfterSavedFailed() {
    const udpUrl = await discoverBoardServer();
    const fromUdp = cacheDiscoveredUrl(udpUrl || '');
    if (fromUdp) return fromUdp;
    const httpUrl = await discoverBoardServerByHttpFallback();
    const fromHttp = cacheDiscoveredUrl(httpUrl || '');
    if (fromHttp) return fromHttp;
    discoveryUrlCache = null;
    writeCaptureLog('SmartBoard не найден: сохранённый адрес недоступен, UDP и HTTP пусты');
    return null;
}

/**
 * Базовый URL для HTTP-запросов к API (кандидат из UDP WHO / кэш).
 * Не подменяет «доступность» доски — её держит только успешный probe + setBoardAvailable.
 * @param {boolean} [forceRediscover] — игнорировать сохранённый адрес и кэш сессии.
 */
function getServerUrl(forceRediscover = false) {
    if (discoveryInFlight) return discoveryInFlight;

    const saved = getSavedBoardServerUrl();
    if (!forceRediscover && saved) {
        discoveryInFlight = probeBoardHealth(saved, 1500).then((ok) => {
            if (ok) {
                writeCaptureLog(`SmartBoard из сохранённого адреса: ${saved}`);
                return cacheDiscoveredUrl(saved);
            }
            writeCaptureLog(`Сохранённый адрес не отвечает (${saved}), поиск по UDP...`);
            return discoverServerUrlAfterSavedFailed();
        }).finally(() => {
            discoveryInFlight = null;
        });
        return discoveryInFlight;
    }

    const now = Date.now();
    if (!forceRediscover && discoveryUrlCache && (now - discoveryUrlCacheTime) < CACHE_TTL_MS) {
        return Promise.resolve(discoveryUrlCache);
    }

    discoveryInFlight = discoverServerUrlParallel().finally(() => {
        discoveryInFlight = null;
    });
    return discoveryInFlight;
}

/**
 * Базовый HTTP-URL SmartBoard для запросов из main.
 * getServerUrl() при UDP берёт первый ответ WHO; после успешного probe предпочитаем cachedServerUrl.
 */
function resolveSmartBoardApiBase() {
    if (cachedServerUrl) return Promise.resolve(cachedServerUrl);
    const saved = getSavedBoardServerUrl();
    if (saved) {
        return probeBoardHealth(saved, 1500).then((ok) => {
            if (ok) return cacheDiscoveredUrl(saved);
            return getServerUrl(true);
        });
    }
    return getServerUrl();
}

/** Вызвать при обнаружении доски: обновить кэш «живой» доски и уведомить кроппер (без дублей). */
function setBoardAvailable(url) {
    if (!url) return;
    const normalized = normalizeBaseUrl(url);
    if (!normalized) return;
    const prev = cachedServerUrl;
    cachedServerUrl = normalized;
    discoveryUrlCache = normalized;
    discoveryUrlCacheTime = Date.now();
    setSavedBoardServerUrl(normalized);
    if (prev === normalized) return;
    broadcastToBoardRenderers('board-available', normalized);
}

/** Вызвать при остановке доски: сбросить кэш и уведомить кроппер (только если до этого считали доску доступной). */
function setBoardUnavailable() {
    const had = !!cachedServerUrl;
    cachedServerUrl = null;
    discoveryUrlCache = null;
    discoveryUrlCacheTime = 0;
    if (had) broadcastToBoardRenderers('board-unavailable');
    // Пункт «Открыть Agile Доску» исчезнет при следующем открытии меню (меню строится при каждом клике)
}

// --- ELECTRON CROPPER ---
let cropperWindow, tray;
/** Пока идёт захват / открыт кроппер — повторный хоткей открывает настройки. */
let captureSessionActive = false;
/** Независимые плавающие окна-редакторы (галочка). */
const floatWindows = new Set();
/** Временное хранилище слоёв для инициализации плавающего окна: id -> { layout, layerPaths }. */
const floatImageStore = new Map();
const floatWindowIds = new Map();
let floatWindowSeq = 0;

/** IPC-перетаскивание float-окна за скриншот (native drag не работает на transparent). */
const floatWindowDragIntervals = new Map();
/** @type {Map<number, (event: Electron.Event, input: Electron.InputEvent) => void>} */
const floatWindowDragInputHandlers = new Map();

function stopFloatWindowDrag(win) {
    if (!win || win.isDestroyed()) return;
    const id = win.id;
    const interval = floatWindowDragIntervals.get(id);
    if (interval) {
        clearInterval(interval);
        floatWindowDragIntervals.delete(id);
    }
    const wc = win.webContents;
    const onInput = floatWindowDragInputHandlers.get(id);
    if (wc && !wc.isDestroyed() && onInput) {
        wc.removeListener('input-event', onInput);
        floatWindowDragInputHandlers.delete(id);
    }
}

function startFloatWindowDragFromEvent(event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !floatWindows.has(win)) return;

    stopFloatWindowDrag(win);

    const startPos = win.getPosition();
    const startCursor = screen.getCursorScreenPoint();

    const interval = setInterval(() => {
        if (win.isDestroyed()) {
            stopFloatWindowDrag(win);
            return;
        }
        const currentCursor = screen.getCursorScreenPoint();
        win.setPosition(
            startPos[0] + currentCursor.x - startCursor.x,
            startPos[1] + currentCursor.y - startCursor.y
        );
    }, 10);

    floatWindowDragIntervals.set(win.id, interval);
}

ipcMain.on('start-window-drag', startFloatWindowDragFromEvent);
ipcMain.on('start-custom-drag', startFloatWindowDragFromEvent);

ipcMain.on('stop-window-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) stopFloatWindowDrag(win);
});

ipcMain.on('stop-custom-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) stopFloatWindowDrag(win);
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !floatWindows.has(win)) return;
    try {
        win.setIgnoreMouseEvents(!!ignore, options && typeof options === 'object' ? options : {});
    } catch (e) { /* ignore */ }
});

function getFloatDir(id) {
    return path.join(app.getPath('temp'), 'smartcap-float', String(id));
}

function isPathInFloatDir(filePath) {
    const floatDir = path.resolve(path.join(app.getPath('temp'), 'smartcap-float'));
    const resolved = path.resolve(filePath);
    const rel = path.relative(floatDir, resolved);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function writeFloatLayerFiles(id, layers) {
    const dir = getFloatDir(id);
    await fsPromises.mkdir(dir, { recursive: true });
    const layerPaths = {};
    const writeLayer = async (name, data) => {
        if (data == null) return;
        let buf = null;
        if (Buffer.isBuffer(data)) buf = data;
        else if (data instanceof Uint8Array) buf = Buffer.from(data);
        else if (typeof data === 'string') {
            const pure = data.includes(',') ? data.split(',')[1] : data;
            buf = Buffer.from(pure, 'base64');
        }
        if (!buf || !buf.length) return;
        const p = path.join(dir, name + '.png');
        await fsPromises.writeFile(p, buf);
        layerPaths[name] = p;
    };
    await writeLayer('bg', layers.bg);
    if (layers.blur) await writeLayer('blur', layers.blur);
    await writeLayer('draw', layers.draw);
    return layerPaths;
}

async function cleanupFloatDir(id) {
    try {
        await fsPromises.rm(getFloatDir(id), { recursive: true, force: true });
    } catch (e) {}
}
let settingsWindow = null;
let registeredScreenshotHotkey = null;
let registeredDelayedScreenshotHotkey = null;
let delayedCaptureTimer = null;

function formatHotkeyDisplay(accelerator) {
    return String(accelerator || DEFAULT_SCREENSHOT_HOTKEY)
        .replace(/CommandOrControl/gi, 'Ctrl')
        .replace(/Control/gi, 'Ctrl');
}

function normalizeScreenshotHotkey(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || !s.includes('+')) return DEFAULT_SCREENSHOT_HOTKEY;
    return s.split('+').map(part => part.trim()).filter(Boolean).join('+');
}

function normalizeDelayedScreenshotHotkey(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || !s.includes('+')) return '';
    return s.split('+').map(part => part.trim()).filter(Boolean).join('+');
}

function normalizeScreenshotHotkeyDelayMs(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_SCREENSHOT_HOTKEY_DELAY_MS;
    return Math.max(0, Math.min(60000, Math.round(n)));
}

function getScreenshotHotkey() {
    return normalizeScreenshotHotkey(appSettings.screenshotHotkey);
}

function getDelayedScreenshotHotkey() {
    return normalizeDelayedScreenshotHotkey(appSettings.screenshotHotkeyDelayed);
}

function getScreenshotHotkeyDelayMs() {
    return normalizeScreenshotHotkeyDelayMs(appSettings.screenshotHotkeyDelayMs);
}

function screenshotHotkeysAreEqual(a, b) {
    if (!a || !b) return false;
    return normalizeScreenshotHotkey(a) === normalizeScreenshotHotkey(b);
}

function probeScreenshotHotkeyRegistration(accelerator) {
    const probeOk = globalShortcut.register(accelerator, () => {});
    if (!probeOk) return false;
    globalShortcut.unregister(accelerator);
    return true;
}

function unregisterScreenshotHotkey() {
    if (!registeredScreenshotHotkey) return;
    try {
        globalShortcut.unregister(registeredScreenshotHotkey);
    } catch (e) {}
    registeredScreenshotHotkey = null;
}

function unregisterDelayedScreenshotHotkey() {
    if (!registeredDelayedScreenshotHotkey) return;
    try {
        globalShortcut.unregister(registeredDelayedScreenshotHotkey);
    } catch (e) {}
    registeredDelayedScreenshotHotkey = null;
}

function unregisterScreenshotHotkeys() {
    if (delayedCaptureTimer) {
        clearTimeout(delayedCaptureTimer);
        delayedCaptureTimer = null;
    }
    unregisterScreenshotHotkey();
    unregisterDelayedScreenshotHotkey();
}

function onScreenshotHotkeyPressed() {
    minimizeAllFloatWindows();
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    if (captureInFlight) return;
    if (captureSessionActive) return;
    captureAndSend();
}

function onDelayedScreenshotHotkeyPressed() {
    minimizeAllFloatWindows();
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    if (captureInFlight) return;
    if (captureSessionActive) return;
    if (delayedCaptureTimer) {
        clearTimeout(delayedCaptureTimer);
        delayedCaptureTimer = null;
    }
    const delayMs = getScreenshotHotkeyDelayMs();
    if (delayMs <= 0) {
        captureAndSend();
        return;
    }
    delayedCaptureTimer = setTimeout(() => {
        delayedCaptureTimer = null;
        if (!cropperWindow || cropperWindow.isDestroyed()) return;
        if (captureInFlight || captureSessionActive) return;
        captureAndSend();
    }, delayMs);
}

function registerScreenshotHotkey() {
    unregisterScreenshotHotkeys();
    const accel = getScreenshotHotkey();
    const ok = globalShortcut.register(accel, onScreenshotHotkeyPressed);
    if (ok) registeredScreenshotHotkey = accel;

    const delayedAccel = getDelayedScreenshotHotkey();
    if (delayedAccel && !screenshotHotkeysAreEqual(delayedAccel, accel)) {
        const delayedOk = globalShortcut.register(delayedAccel, onDelayedScreenshotHotkeyPressed);
        if (delayedOk) registeredDelayedScreenshotHotkey = delayedAccel;
    }

    if (tray) {
        const delayedLabel = registeredDelayedScreenshotHotkey
            ? `, ${formatHotkeyDisplay(registeredDelayedScreenshotHotkey)} с задержкой`
            : '';
        tray.setToolTip(`SmartCap — ${formatHotkeyDisplay(accel)} скриншот${delayedLabel}`);
    }
    return ok;
}

function resolveAppIconPath() {
    const candidates = app.isPackaged
        ? [
            path.join(process.resourcesPath, 'icon.ico'),
            path.join(app.getAppPath(), 'icon.ico'),
            path.join(app.getAppPath(), 'icon.png')
        ]
        : [path.join(__dirname, '..', 'icon.ico'), path.join(__dirname, '..', 'icon.png')];
    return candidates.find(p => fs.existsSync(p)) || null;
}

function showSettingsWindow() {
    const fromCropper = captureSessionActive && cropperWindow && !cropperWindow.isDestroyed();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        if (fromCropper) settingsWindow.setAlwaysOnTop(true);
        if (settingsWindow.isMinimized()) settingsWindow.restore();
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }
    unregisterScreenshotHotkeys();
    const appIcon = resolveAppIconPath();
    settingsWindow = new BrowserWindow({
        width: 360,
        height: 340,
        resizable: true,
        minimizable: false,
        maximizable: false,
        title: 'Настройки SmartCap',
        autoHideMenuBar: true,
        alwaysOnTop: fromCropper,
        ...(appIcon ? { icon: appIcon } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'settings-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    settingsWindow.on('closed', () => {
        settingsWindow = null;
        registerScreenshotHotkey();
    });
    settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
}
/** Идёт асинхронный захват экрана (до отправки кадра в renderer). */
let captureInFlight = false;
let captureGeneration = 0;
let cropperReadyFallbackTimer = null;
/** Последние границы виртуального рабочего стола (для reveal после park off-screen). */
let cropperVirtualBounds = null;
const CAPTURE_TIMEOUT_MS = 8000;
const CROPPER_READY_FALLBACK_MS = 6000;

function safeReloadCropper() {
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    try {
        cropperWindow.reload();
    } catch (e) {}
}

function invalidateCapture() {
    if (cropperReadyFallbackTimer) {
        clearTimeout(cropperReadyFallbackTimer);
        cropperReadyFallbackTimer = null;
    }
    captureGeneration++;
    captureInFlight = false;
    safeSendToCropper('capture-aborted');
}

async function deliverCaptureToRenderer(payload) {
    parkCropperWindow('process');
    if (!cropperWindow || cropperWindow.isDestroyed()) throw new Error('no-window');

    const wc = cropperWindow.webContents;
    if (wc.isLoading()) {
        await new Promise((resolve) => {
            const onLoad = () => {
                wc.removeListener('did-finish-load', onLoad);
                resolve();
            };
            wc.on('did-finish-load', onLoad);
        });
    }

    await new Promise((r) => setTimeout(r, 80));
    wc.send('deliver-capture', payload);
}

function getVirtualDesktopBounds() {
    const displays = screen.getAllDisplays();
    if (!displays || displays.length === 0) return null;
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function syncCropperVirtualBounds() {
    const bounds = getVirtualDesktopBounds();
    if (!bounds) return;
    cropperVirtualBounds = bounds;
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    if (captureSessionActive) {
        applyCropperVirtualBounds();
    } else {
        parkCropperWindow('hide');
    }
}

/** Растянуть окно кроппера на весь виртуальный рабочий стол (все мониторы). */
function applyCropperVirtualBounds() {
    if (!cropperWindow || cropperWindow.isDestroyed() || !cropperVirtualBounds) return;
    // На Windows resizable:false обрезает высоту до workArea (без панели задач) — скриншот и UI не совпадают.
    try { cropperWindow.setResizable(true); } catch (e) {}
    cropperWindow.setBounds(cropperVirtualBounds);
}

/** hide — убрать с экрана (для нативного скриншота); process — невидимо, но renderer активен. */
function parkCropperWindow(mode = 'hide') {
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    cropperWindow.setOpacity(0);
    cropperWindow.setIgnoreMouseEvents(true, { forward: true });
    cropperWindow.setFocusable(false);
    cropperWindow.setAlwaysOnTop(false);

    if (mode === 'process') {
        applyCropperVirtualBounds();
        if (!cropperWindow.isVisible()) {
            cropperWindow.showInactive();
        }
        return;
    }

    cropperWindow.hide();
    try {
        cropperWindow.setPosition(-32000, -32000);
    } catch (e) {}
}

function revealCropperWindow() {
    if (!captureSessionActive) return;
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    if (cropperReadyFallbackTimer) {
        clearTimeout(cropperReadyFallbackTimer);
        cropperReadyFallbackTimer = null;
    }
    applyCropperVirtualBounds();
    cropperWindow.setAlwaysOnTop(true);
    cropperWindow.setFocusable(true);
    cropperWindow.show();
    // Повтор после show(): Windows иногда ужимает окно до workArea.
    applyCropperVirtualBounds();
    cropperWindow.setIgnoreMouseEvents(false);
    cropperWindow.setOpacity(1);
    cropperWindow.focus();
}

function resetCaptureSession() {
    captureSessionActive = false;
    captureInFlight = false;
    if (cropperReadyFallbackTimer) {
        clearTimeout(cropperReadyFallbackTimer);
        cropperReadyFallbackTimer = null;
    }
    invalidateCapture();
    parkCropperWindow('hide');
}

function scheduleCropperReadyFallback() {
    if (cropperReadyFallbackTimer) clearTimeout(cropperReadyFallbackTimer);
    cropperReadyFallbackTimer = setTimeout(() => {
        cropperReadyFallbackTimer = null;
        resetCaptureSession();
    }, CROPPER_READY_FALLBACK_MS);
}

/** Захват: node-screenshots (быстро, без прав админа). */
function captureScreenImage() {
    const withTimeout = (p) => Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CAPTURE_TIMEOUT_MS))
    ]);
    return withTimeout(captureWithNodeScreenshots());
}

/** Самый быстрый способ: нативная библиотека node-screenshots (Rust/XCap), без прав админа. */
async function captureWithNodeScreenshots() {
    const { Monitor } = require('node-screenshots');
    const displays = screen.getAllDisplays();
    if (!displays || displays.length === 0) throw new Error('Мониторы не найдены');

    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    const virtualBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const primaryBounds = screen.getPrimaryDisplay().bounds;

    const captureDir = path.join(app.getPath('temp'), 'smartcap-capture');
    await fsPromises.mkdir(captureDir, { recursive: true });
    const sessionId = `${Date.now()}-${process.pid}`;
    const allMonitors = Monitor.all();

    const capturePromises = displays.map(async (display, screenIndex) => {
        await new Promise((r) => setImmediate(r));
        const b = display.bounds;
        const centerX = b.x + Math.floor(b.width / 2);
        const centerY = b.y + Math.floor(b.height / 2);
        let monitor = Monitor.fromPoint(centerX, centerY);
        if (!monitor) {
            monitor = allMonitors.find(m => m.isPrimary()) || allMonitors[0];
        }
        if (!monitor) return null;
        const image = await monitor.captureImage();
        if (!image) return null;
        const png = await image.toPng(true);
        if (!png || png.length === 0) return null;
        const filePath = path.join(captureDir, `${sessionId}-${screenIndex}.png`);
        await fsPromises.writeFile(filePath, png);
        return { filePath, bounds: b };
    });

    const captures = (await Promise.all(capturePromises)).filter(Boolean);

    if (captures.length === 0) throw new Error('Пустой результат');
    return { captures, virtualBounds, primaryBounds };
}

function captureAndSend() {
    if (!cropperWindow || cropperWindow.isDestroyed()) return;
    if (captureInFlight) return;
    if (captureSessionActive) return;

    minimizeAllFloatWindows();
    captureSessionActive = true;
    captureInFlight = true;
    const myGeneration = ++captureGeneration;
    parkCropperWindow('hide');

    function restoreAndNotify(message) {
        const doHide = () => {
            captureSessionActive = false;
            invalidateCapture();
            parkCropperWindow();
        };
        if (message && typeof dialog !== 'undefined' && cropperWindow && !cropperWindow.isDestroyed()) {
            dialog.showMessageBox(cropperWindow, {
                type: 'warning',
                title: 'SmartCap',
                message: message
            }).then(doHide).catch(doHide);
        } else {
            doHide();
        }
    }

    void runBoardHealthProbe().catch(() => {});
    captureScreenImage()
        .then((result) => {
            if (myGeneration !== captureGeneration) return;
            if (!cropperWindow || cropperWindow.isDestroyed()) return;

            const captures = result && Array.isArray(result.captures) ? result.captures : [];
            const virtualBounds = result && result.virtualBounds ? result.virtualBounds : null;
            const primaryBounds = result && result.primaryBounds ? result.primaryBounds : null;
            if (virtualBounds) {
                cropperVirtualBounds = virtualBounds;
            }
            if (captures.length > 0) {
                const payload = captures.map((part) => ({
                    filePath: part.filePath,
                    bounds: part.bounds
                }));
                scheduleCropperReadyFallback();
                void deliverCaptureToRenderer({
                    generation: myGeneration,
                    captures: payload,
                    virtualBounds,
                    primaryBounds
                }).catch(() => {
                    restoreAndNotify('Скриншот не сделан. Попробуйте ещё раз.');
                });
            } else {
                restoreAndNotify('Скриншот не сделан. Попробуйте ещё раз.');
            }
        })
        .catch(() => {
            if (myGeneration !== captureGeneration) return;
            restoreAndNotify('Скриншот не сделан. Попробуйте ещё раз.');
        })
        .finally(() => {
            if (myGeneration !== captureGeneration) return;
            if (!captureSessionActive) captureInFlight = false;
        });
}

function createWindows() {
    if (cropperWindow && !cropperWindow.isDestroyed()) return;
    const bounds = getVirtualDesktopBounds();
    if (!bounds) return;
    const { x, y, width, height } = bounds;
    cropperVirtualBounds = bounds;
    cropperWindow = new BrowserWindow({
        x, y, width, height,
        show: false, frame: false, transparent: true, alwaysOnTop: true,
        skipTaskbar: true, hasShadow: false, fullscreen: false,
        // resizable:true ВАЖНО на Windows: с resizable:false система обрезает setBounds
        // до рабочей области (без панели задач), и оверлей перестаёт быть на весь экран.
        enableLargerThanScreen: true, resizable: true, minimizable: false, maximizable: false,
        focusable: false,
        paintWhenInitiallyHidden: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            zoomFactor: 1.0,
            backgroundThrottling: false
        }
    });
    cropperWindow.setOpacity(0);
    // При автозапуске Windows «process» (невидимое окно на весь экран) может блокировать ввод до готовности DWM.
    const parkOnLoad = () => parkCropperWindow('hide');
    cropperWindow.webContents.on('dom-ready', parkOnLoad);
    cropperWindow.webContents.on('did-finish-load', parkOnLoad);
    cropperWindow.loadFile(path.join(__dirname, 'renderer', 'cropper.html'));

    registerCropperKeyboardShortcuts(cropperWindow.webContents);

    cropperWindow.webContents.on('render-process-gone', () => {
        resetCaptureSession();
        safeReloadCropper();
    });
}

async function cleanupOldCapturesOnStartup() {
    try {
        const captureDir = path.join(app.getPath('temp'), 'smartcap-capture');
        await fsPromises.rm(captureDir, { recursive: true, force: true });
    } catch (e) {}
}

app.whenReady().then(async () => {
    await cleanupOldCapturesOnStartup();
    loadSettings();
    const savedBoardOnStart = getSavedBoardServerUrl();
    discoveryUrlCache = savedBoardOnStart;
    discoveryUrlCacheTime = Date.now();
    writeCaptureLog(`Адрес SmartBoard при старте: ${savedBoardOnStart}`);
    createWindows();

    screen.on('display-metrics-changed', syncCropperVirtualBounds);
    screen.on('display-added', syncCropperVirtualBounds);
    screen.on('display-removed', syncCropperVirtualBounds);

    const isRegistered = registerScreenshotHotkey();
    if (!isRegistered) {
        const hotkeyLabel = formatHotkeyDisplay(getScreenshotHotkey());
        writeCaptureLog(`ОШИБКА: Хоткей ${hotkeyLabel} занят другой программой.`);
        // Не блокируем рабочий стол сразу после автозапуска — диалог через несколько секунд.
        setTimeout(() => {
            if (app.isQuitting) return;
            dialog.showMessageBox({
                type: 'warning',
                title: 'Конфликт горячих клавиш',
                message: `Комбинация ${hotkeyLabel} уже используется другой программой в Windows.\n\nОткройте «Настройки» в трее и выберите другую комбинацию, либо создавайте скриншоты из меню трея.`
            }).catch(() => {});
        }, 10000);
    }

    const resolvedIcon = resolveAppIconPath();
    if (resolvedIcon && !tray) {
        try {
            const iconImg = nativeImage.createFromPath(resolvedIcon);
            tray = new Tray(iconImg.isEmpty() ? resolvedIcon : iconImg);
            tray.setToolTip(`SmartCap — ${formatHotkeyDisplay(getScreenshotHotkey())} скриншот`);
        } catch (e) {
            writeCaptureLog('Трей: ошибка создания иконки: ' + (e && e.message ? e.message : String(e)) + ' path=' + resolvedIcon);
        }
    } else {
        writeCaptureLog('Трей: иконка не найдена (icon.ico / icon.png).');
    }

    function getTrayMenuTemplate() {
        const items = [];
        if (cachedServerUrl) {
            items.push(
                { label: 'Открыть Agile Доску', click: () => shell.openExternal(getBoardExternalUrl() || cachedServerUrl) },
                { type: 'separator' }
            );
        }
        items.push(
            { label: 'Сделать скриншот', click: captureAndSend },
            { label: 'Настройки', click: () => showSettingsWindow() },
            { type: 'separator' },
            { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } }
        );
        return items;
    }

    function showTrayMenu() {
        if (!tray) return;
        tray.popUpContextMenu(Menu.buildFromTemplate(getTrayMenuTemplate()));
    }

    if (tray) {
        tray.on('click', () => { void showTrayMenu(); });
        tray.on('right-click', () => { void showTrayMenu(); });
    }

    // Слушаем broadcast от SmartBoard: START (URL при запуске), STOP (выход)
    try {
        const notifySocket = dgram.createSocket('udp4');
        notifySocket.on('message', (msg) => {
            const str = (msg.toString() || '').trim();
            if (str === DISCOVERY_MAGIC_STOP) {
                setBoardUnavailable();
                return;
            }
            if (str.startsWith(DISCOVERY_MAGIC_START)) {
                const url = str.slice(DISCOVERY_MAGIC_START.length).trim();
                const n = normalizeBaseUrl(url);
                if (n) {
                    // Пока идёт HTTP-probe, getServerUrl() уже указывает на URL из broadcast (не «первый попавшийся» UDP WHO).
                    discoveryUrlCache = n;
                    discoveryUrlCacheTime = Date.now();
                    void pickReachableBoardUrl(n, null).then((picked) => {
                        if (picked) setBoardAvailable(picked);
                    });
                }
            }
        });
        notifySocket.on('error', () => { try { notifySocket.close(); } catch (e) {} });
        notifySocket.bind({ port: SMARTCAP_STOP_PORT, address: '0.0.0.0', reuseAddr: true });
    } catch (e) {}

    // Периодическая проверка (Docker down не шлёт UDP в LAN — опора на HTTP)
    const HEALTH_PROBE_INTERVAL_MS = 30000;
    const HEALTH_PROBE_SLOW_MS = 120000;
    function loopHealthProbe() {
        const saved = getSavedBoardServerUrl();
        if (!saved) {
            setTimeout(loopHealthProbe, HEALTH_PROBE_SLOW_MS);
            return;
        }
        runBoardHealthProbe().catch(() => {}).finally(() => {
            const delay = cachedServerUrl ? HEALTH_PROBE_INTERVAL_MS : HEALTH_PROBE_SLOW_MS;
            setTimeout(loopHealthProbe, delay);
        });
    }
    loopHealthProbe();
    mainProcessReady = true;
    writeCaptureLog(`Готов pid=${process.pid}`);
});

/** Кроппер: отправка на SmartBoard не удалась (сеть / сервер выключен) — снять «доска доступна». */
ipcMain.on('smartboard-request-failed', () => {
    setBoardUnavailable();
});

/** Только подтверждённо живой URL (для кроппера). HTTP из main — resolveSmartBoardApiBase(). */
ipcMain.handle('get-server-url', () => Promise.resolve(cachedServerUrl));
/** Без HTTP: подтверждённый URL или кандидат из UDP (START/WHO), пока идёт probe. */
ipcMain.handle('peek-board-base-url', () => {
    const raw = cachedServerUrl || discoveryUrlCache || getSavedBoardServerUrl() || getPreferredBoardServerUrl();
    const b = raw ? normalizeBaseUrl(raw) : '';
    return Promise.resolve(b || null);
});
ipcMain.handle('set-board-server-url', async (_event, raw) => {
    const url = parseUserBoardHost(raw);
    if (!url) {
        return { ok: false, error: 'Введите IP доски, например 192.168.1.10 или 192.168.1.10:3000' };
    }
    const reachable = await probeBoardHealth(url, 4000);
    if (!reachable) {
        return { ok: false, error: 'Не удалось подключиться к доске по этому IP. Проверьте адрес и что SmartBoard запущен.' };
    }
    setBoardAvailable(url);
    return { ok: true, url, display: formatBoardHostForInput(url) };
});
/** HTTP-проверка /api/boards, затем URL (после docker compose down UDP из контейнера часто не доходит до SmartCap). */
ipcMain.handle('sync-board-reachability', () => runBoardHealthProbe(2200).then(() => cachedServerUrl || null));
ipcMain.handle('get-selected-board-id', () => getSelectedBoardId());
ipcMain.handle('get-cropper-settings', () => getCropperSettings());
ipcMain.handle('get-create-defaults', () => getCreateDefaults());
ipcMain.handle('set-create-defaults', (_event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.remember === false) {
        appSettings.rememberCreateDefaults = false;
        flushSaveSettingsSync();
        return { ok: true, ...getCreateDefaults() };
    }
    if (p.remember === true) {
        const merge = p.merge === true;
        appSettings.rememberCreateDefaults = true;

        const applyField = (key, value) => {
            const v = String(value == null ? '' : value).trim();
            if (v) {
                appSettings[key] = v;
            } else if (!merge) {
                appSettings[key] = '';
            }
        };

        applyField('defaultBoardId', p.boardId);
        applyField('defaultColumnId', p.columnId);
        applyField('defaultBoardName', p.boardName);
        applyField('defaultColumnName', p.columnName);
        applyField('defaultUpdateBoardId', p.updateBoardId);
        applyField('defaultUpdateColumnId', p.updateColumnId);
        applyField('defaultUpdateCardId', p.updateCardId);
        applyField('defaultUpdateBoardName', p.updateBoardName);
        applyField('defaultUpdateColumnName', p.updateColumnName);
        applyField('defaultUpdateCardName', p.updateCardName);

        if (!appSettings.defaultBoardId && !appSettings.defaultUpdateBoardId) {
            return {
                ok: false,
                error: 'Выберите доску в «Создать новую» или «Добавить к существующей».'
            };
        }
        if (appSettings.defaultBoardId) {
            appSettings.selectedBoardId = appSettings.defaultBoardId;
        }
        flushSaveSettingsSync();
        return { ok: true, ...getCreateDefaults() };
    }
    return { ok: false, error: 'Некорректный запрос.' };
});
let createFormSnapshotRequestId = 0;
const pendingCreateFormSnapshots = new Map();

ipcMain.handle('read-create-form-snapshot', async () => {
    if (!cropperWindow || cropperWindow.isDestroyed()) {
        return {
            ok: false,
            error: 'Откройте скриншот, выберите доску в «Создать новую» или «Добавить к существующей», затем включите запоминание.'
        };
    }
    const wc = cropperWindow.webContents;
    if (!wc || wc.isDestroyed()) {
        return { ok: false, error: 'Кроппер недоступен.' };
    }
    const requestId = ++createFormSnapshotRequestId;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingCreateFormSnapshots.delete(requestId);
            resolve({ ok: false, error: 'Не удалось прочитать форму «Создать новую».' });
        }, 5000);
        pendingCreateFormSnapshots.set(requestId, (result) => {
            clearTimeout(timer);
            pendingCreateFormSnapshots.delete(requestId);
            resolve(result && typeof result === 'object'
                ? result
                : { ok: false, error: 'Не удалось прочитать форму «Создать новую».' });
        });
        wc.send('collect-create-form-snapshot', requestId);
    });
});

ipcMain.on('create-form-snapshot-response', (_event, requestId, result) => {
    const done = pendingCreateFormSnapshots.get(requestId);
    if (done) done(result);
});
ipcMain.handle('save-cropper-settings', (event, prefs) => {
    setCropperSettings(prefs);
    return true;
});

ipcMain.handle('set-selected-board-id', (event, boardId) => {
    setSelectedBoardId(boardId);
    return { success: true, boardId: getSelectedBoardId() };
});
ipcMain.handle('get-last-form-selection', () => getLastFormSelection());
ipcMain.handle('save-last-form-selection', (_event, payload) => {
    setLastFormSelection(payload);
    return getLastFormSelection();
});
ipcMain.handle('get-board-list', () => {
    return resolveSmartBoardApiBase().then((serverUrl) => {
        if (!serverUrl) return [];
        return new Promise((resolve) => {
            const apiUrl = `${serverUrl}/api/boards`;
            const lib = apiUrl.startsWith('https') ? https : http;
            const req = lib.get(apiUrl, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    if (!(res.statusCode >= 200 && res.statusCode < 500)) {
                        setBoardUnavailable();
                        resolve([]);
                        return;
                    }
                    try {
                        const json = JSON.parse(data);
                        const boards = Array.isArray(json.boards) ? json.boards : [];
                        setBoardAvailable(normalizeBaseUrl(serverUrl));
                        resolve(boards);
                    } catch (e) {
                        resolve([]);
                    }
                });
            });
            req.on('error', () => {
                setBoardUnavailable();
                resolve([]);
            });
            req.setTimeout(5000, () => {
                try { req.destroy(); } catch (e) {}
                setBoardUnavailable();
                resolve([]);
            });
        });
    });
});

/** Список пользователей для выбора участников (User.csv; для приватной доски — только members). */
ipcMain.handle('get-user-list', (_event, boardId) => {
    const id = boardId == null ? '' : String(boardId).trim();
    return resolveSmartBoardApiBase().then((serverUrl) => {
        if (!serverUrl) return [];
        return new Promise((resolve) => {
            const apiUrl = id
                ? `${serverUrl}/api/user-list?boardId=${encodeURIComponent(id)}`
                : `${serverUrl}/api/user-list`;
            const lib = apiUrl.startsWith('https') ? https : http;
            const req = lib.get(apiUrl, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.names || []);
                    } catch (e) {
                        resolve([]);
                    }
                });
            });
            req.on('error', () => resolve([]));
            req.setTimeout(5000, () => { req.destroy(); resolve([]); });
        });
    });
});

/** Автор по IP: запрос к SmartBoard /api/me (User.csv: IP, Name). */
ipcMain.handle('get-author-name', () => {
    return resolveSmartBoardApiBase().then((serverUrl) => {
        if (!serverUrl) {
            writeCaptureLog('get-author-name: нет базового URL (UDP WHO / probe ещё не дали адрес)');
            return '';
        }
        return new Promise((resolve) => {
            const apiUrl = `${serverUrl}/api/me`;
            const lib = apiUrl.startsWith('https') ? https : http;
            const req = lib.get(apiUrl, (res) => {
                const status = res.statusCode;
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    if (!isJsonContentType(res.headers)) {
                        const ct = res.headers && (res.headers['content-type'] || res.headers['Content-Type']);
                        writeCaptureLog(`get-author-name: serverUrl=${serverUrl} http=${status} notJson contentType=${ct || '?'}`);
                        resolve('');
                        return;
                    }
                    try {
                        const json = JSON.parse(data);
                        const raw = json.name;
                        const name = (raw && String(raw).trim()) ? String(raw).trim() : '';
                        writeCaptureLog(`get-author-name: serverUrl=${serverUrl} http=${status} nameEmpty=${!name}`);
                        resolve(name);
                    } catch (e) {
                        writeCaptureLog(`get-author-name: serverUrl=${serverUrl} http=${status} jsonParseFail`);
                        resolve('');
                    }
                });
            });
            req.on('error', (err) => {
                writeCaptureLog(`get-author-name: serverUrl=${serverUrl} requestError=${err && err.message ? err.message : String(err)}`);
                resolve('');
            });
            req.setTimeout(5000, () => {
                try { req.destroy(); } catch (e) {}
                writeCaptureLog(`get-author-name: serverUrl=${serverUrl} timeout`);
                resolve('');
            });
        });
    });
});

function isPathInCaptureDir(filePath) {
    const captureDir = path.resolve(path.join(app.getPath('temp'), 'smartcap-capture'));
    const resolved = path.resolve(filePath);
    const rel = path.relative(captureDir, resolved);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

ipcMain.handle('read-capture-png', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    if (!isPathInCaptureDir(filePath)) {
        writeCaptureLog(`read-capture-png denied path=${filePath}`);
        return null;
    }
    const resolved = path.resolve(filePath);
    try {
        const data = await fsPromises.readFile(resolved);
        return data;
    } catch (e) {
        writeCaptureLog(`read-capture-png fail: ${e && e.message ? e.message : String(e)}`);
        return null;
    }
});

ipcMain.handle('read-float-layer', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    if (!isPathInFloatDir(filePath)) {
        writeCaptureLog(`read-float-layer denied path=${filePath}`);
        return null;
    }
    const resolved = path.resolve(filePath);
    try {
        const data = await fsPromises.readFile(resolved);
        return data;
    } catch (e) {
        writeCaptureLog(`read-float-layer fail: ${e && e.message ? e.message : String(e)}`);
        return null;
    }
});

ipcMain.handle('cleanup-capture-files', async (_event, paths) => {
    if (!Array.isArray(paths)) return;
    for (const p of paths) {
        if (!p || typeof p !== 'string') continue;
        if (!isPathInCaptureDir(p)) continue;
        try { await fsPromises.unlink(path.resolve(p)); } catch (e) {}
    }
});

ipcMain.on('cropper-ready', () => {
    captureInFlight = false;
    revealCropperWindow();
});
ipcMain.on('show-cropper', () => {
    if (!captureSessionActive || captureInFlight) return;
    revealCropperWindow();
});
ipcMain.handle('is-capture-in-flight', () => captureInFlight);
ipcMain.handle('clipboard-read-image-dataurl', () => readClipboardImageDataUrl());

ipcMain.handle('clipboard-write-png-base64', (_event, base64) => {
    try {
        if (!base64 || typeof base64 !== 'string') return false;
        const buf = Buffer.from(base64, 'base64');
        if (!buf.length) return false;
        const img = nativeImage.createFromBuffer(buf);
        if (!img || img.isEmpty()) return false;
        clipboard.writeImage(img);
        return true;
    } catch (e) {
        return false;
    }
});
ipcMain.handle('get-screenshot-hotkey', () => {
    const accelerator = getScreenshotHotkey();
    return { accelerator, display: formatHotkeyDisplay(accelerator) };
});

ipcMain.handle('save-screenshot-hotkey', (_event, hotkey) => {
    if (!hotkey || typeof hotkey !== 'string') {
        return { ok: false, error: 'Некорректная комбинация.' };
    }
    const normalized = normalizeScreenshotHotkey(hotkey);
    if (!normalized || !normalized.includes('+')) {
        return { ok: false, error: 'Нужны Ctrl, Alt или Shift + клавиша.' };
    }
    const delayed = getDelayedScreenshotHotkey();
    if (delayed && screenshotHotkeysAreEqual(normalized, delayed)) {
        return { ok: false, error: 'Комбинация совпадает с дополнительной горячей клавишей.' };
    }
    if (!probeScreenshotHotkeyRegistration(normalized)) {
        return { ok: false, error: 'Комбинация занята или недопустима для Windows.' };
    }

    const settingsOpen = settingsWindow && !settingsWindow.isDestroyed();
    appSettings.screenshotHotkey = normalized;
    saveSettings();

    if (!settingsOpen) {
        registerScreenshotHotkey();
    } else if (tray) {
        tray.setToolTip(`SmartCap — ${formatHotkeyDisplay(normalized)} скриншот`);
    }

    return { ok: true, display: formatHotkeyDisplay(normalized) };
});

ipcMain.handle('get-delayed-screenshot-hotkey', () => {
    const accelerator = getDelayedScreenshotHotkey();
    return {
        accelerator: accelerator || '',
        display: accelerator ? formatHotkeyDisplay(accelerator) : '',
        delayMs: getScreenshotHotkeyDelayMs()
    };
});

ipcMain.handle('save-delayed-screenshot-hotkey', (_event, payload) => {
    const hotkey = payload && payload.hotkey;
    const delayMs = payload && payload.delayMs;
    const settingsOpen = settingsWindow && !settingsWindow.isDestroyed();

    if (delayMs != null) {
        appSettings.screenshotHotkeyDelayMs = normalizeScreenshotHotkeyDelayMs(delayMs);
    }

    if (hotkey == null) {
        saveSettings();
        if (!settingsOpen) registerScreenshotHotkey();
        return {
            ok: true,
            display: getDelayedScreenshotHotkey() ? formatHotkeyDisplay(getDelayedScreenshotHotkey()) : '',
            delayMs: getScreenshotHotkeyDelayMs()
        };
    }

    if (typeof hotkey !== 'string') {
        return { ok: false, error: 'Некорректная комбинация.' };
    }

    const trimmed = hotkey.trim();
    if (!trimmed) {
        appSettings.screenshotHotkeyDelayed = '';
        saveSettings();
        if (!settingsOpen) registerScreenshotHotkey();
        return { ok: true, display: '', delayMs: getScreenshotHotkeyDelayMs() };
    }

    const normalized = normalizeDelayedScreenshotHotkey(hotkey);
    if (!normalized || !normalized.includes('+')) {
        return { ok: false, error: 'Нужны Ctrl, Alt или Shift + клавиша.' };
    }
    if (screenshotHotkeysAreEqual(normalized, getScreenshotHotkey())) {
        return { ok: false, error: 'Комбинация совпадает с основной горячей клавишей.' };
    }
    if (!probeScreenshotHotkeyRegistration(normalized)) {
        return { ok: false, error: 'Комбинация занята или недопустима для Windows.' };
    }

    appSettings.screenshotHotkeyDelayed = normalized;
    saveSettings();
    if (!settingsOpen) registerScreenshotHotkey();

    return {
        ok: true,
        display: formatHotkeyDisplay(normalized),
        delayMs: getScreenshotHotkeyDelayMs()
    };
});

ipcMain.on('close-settings-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
});

ipcMain.on('close-cropper', () => {
    captureSessionActive = false;
    invalidateCapture();
    parkCropperWindow();
});

/** Галочка: создать независимое плавающее окно-редактор из слоёв PNG и освободить кроппер. */
ipcMain.on('create-float-window', (_event, payload) => {
    if (!payload) return;
    const hasLayers = payload.layers && (payload.layers.bg != null);
    const hasDataUrl = typeof payload.dataUrl === 'string';
    if (!hasLayers && !hasDataUrl) return;
    const base = cropperVirtualBounds || getVirtualDesktopBounds();
    if (!base) return;
    const w = Math.max(1, Math.round(payload.w || 1));
    const h = Math.max(1, Math.round(payload.h || 1));
    const x = Math.round(base.x + (payload.x || 0));
    const y = Math.round(base.y + (payload.y || 0));

    const id = 'float-' + (++floatWindowSeq) + '-' + Date.now();

    void (async () => {
        let layerPaths = null;
        try {
            if (hasLayers) {
                layerPaths = await writeFloatLayerFiles(id, payload.layers);
            } else {
                layerPaths = await writeFloatLayerFiles(id, { bg: payload.dataUrl, blur: null, draw: null });
            }
            if (!layerPaths || !layerPaths.bg) throw new Error('no-bg-layer');
        } catch (e) {
            void cleanupFloatDir(id);
            return;
        }

        floatImageStore.set(id, { layout: payload.layout || null, layerPaths });

        const appIcon = resolveAppIconPath();
        let floatWin;
        try {
            floatWin = new BrowserWindow({
                x, y, width: w, height: h,
                show: false, frame: false, transparent: true,
                alwaysOnTop: true,
                skipTaskbar: false, minimizable: true, maximizable: false,
                resizable: true, movable: true, hasShadow: false, fullscreen: false,
                enableLargerThanScreen: true, focusable: true,
                ...(appIcon ? { icon: appIcon } : {}),
                webPreferences: {
                    preload: path.join(__dirname, 'preload.js'),
                    nodeIntegration: false,
                    contextIsolation: true,
                    zoomFactor: 1.0,
                    backgroundThrottling: false
                }
            });
        } catch (e) {
            floatImageStore.delete(id);
            void cleanupFloatDir(id);
            return;
        }

        floatWindows.add(floatWin);
        floatWindowIds.set(floatWin, id);
        floatWin.setAlwaysOnTop(true, 'screen-saver');
        floatWin.once('ready-to-show', () => {
            if (!floatWin.isDestroyed()) {
                floatWin.show();
                floatWin.focus();
            }
        });
        floatWin.on('closed', () => {
            stopFloatWindowDrag(floatWin);
            try {
                if (!floatWin.isDestroyed()) floatWin.setIgnoreMouseEvents(false);
            } catch (e) { /* ignore */ }
            floatWindows.delete(floatWin);
            floatWindowIds.delete(floatWin);
            floatImageStore.delete(id);
            void cleanupFloatDir(id);
        });
        floatWin.loadFile(path.join(__dirname, 'renderer', 'cropper.html'), { query: { floatedit: id } });
        registerCropperKeyboardShortcuts(floatWin.webContents);

        captureSessionActive = false;
        invalidateCapture();
        parkCropperWindow();
    })();
});

/** Свернуть все плавающие окна (перед новым захватом по хоткею). */
function minimizeAllFloatWindows() {
    for (const win of floatWindows) {
        try {
            if (win && !win.isDestroyed()) win.minimize();
        } catch (e) {}
    }
}

/** Плавающее окно запрашивает свои слои по id (одноразово). */
ipcMain.handle('get-float-image', (_event, id) => {
    if (!id || !floatImageStore.has(id)) return null;
    const entry = floatImageStore.get(id);
    floatImageStore.delete(id);
    return entry;
});

/** Закрыть конкретное плавающее окно (отправитель). */
ipcMain.on('float-window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
});

/** Свернуть конкретное плавающее окно (отправитель). */
ipcMain.on('float-window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) { try { win.minimize(); } catch (e) {} }
});

/** Расширить float-окно, чтобы меню SmartBoard справа от панели не обрезалось. */
ipcMain.handle('float-window-ensure-width', (event, minRightPx) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !floatWindows.has(win)) {
        return { width: 0 };
    }
    const pad = 12;
    const b = win.getBounds();
    const needW = Math.max(b.width, Math.ceil(Number(minRightPx) || 0) + pad);
    if (needW > b.width) {
        try {
            win.setBounds({ x: b.x, y: b.y, width: needW, height: b.height });
        } catch (e) { /* ignore */ }
    }
    return { width: win.getBounds().width };
});

/** Расширить float-окно по ширине и/или высоте, чтобы формы SmartBoard не обрезались. */
ipcMain.handle('float-window-ensure-bounds', (event, minRightPx, minBottomPx) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !floatWindows.has(win)) {
        return { width: 0, height: 0 };
    }
    const pad = 16;
    const b = win.getBounds();
    const needW = Math.max(b.width, Math.ceil(Number(minRightPx) || 0) + pad);
    const needH = Math.max(b.height, Math.ceil(Number(minBottomPx) || 0) + pad);
    if (needW > b.width || needH > b.height) {
        try {
            win.setBounds({ x: b.x, y: b.y, width: needW, height: needH });
        } catch (e) { /* ignore */ }
    }
    return { width: win.getBounds().width, height: win.getBounds().height };
});

ipcMain.on('save-direct-file', async (event, base64) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (!base64 || typeof base64 !== 'string') return;
    const isCropper = (win === cropperWindow);
    try {
        win.setAlwaysOnTop(false);
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: 'Сохранить скриншот',
            defaultPath: path.join(app.getPath('pictures'), `Screenshot_${Date.now()}.png`),
            filters: [{ name: 'Images', extensions: ['png'] }]
        });
        if (canceled) {
            if (!win.isDestroyed()) {
                win.setAlwaysOnTop(true, isCropper ? 'normal' : 'screen-saver');
                win.focus();
            }
            if (!event.sender.isDestroyed()) event.sender.send('save-cancelled');
            return;
        }
        const pureBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
        await fsPromises.writeFile(filePath, pureBase64, 'base64');
        if (isCropper) {
            captureSessionActive = false;
            invalidateCapture();
            parkCropperWindow();
        } else if (!win.isDestroyed()) {
            // Плавающее окно остаётся открытым после сохранения.
            win.setAlwaysOnTop(true, 'screen-saver');
            win.focus();
            if (!event.sender.isDestroyed()) {
                try { event.sender.send('save-complete'); } catch (err) {}
            }
        }
    } catch (e) {
        if (win && !win.isDestroyed()) {
            win.setAlwaysOnTop(true, isCropper ? 'normal' : 'screen-saver');
            win.focus();
        }
        if (!event.sender.isDestroyed()) {
            try {
                event.sender.send('save-cancelled');
            } catch (err) {}
        }
    }
});

app.on('window-all-closed', () => {});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    flushSaveSettingsSync();
    for (const win of floatWindows) {
        try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) {}
    }
    for (const id of floatWindowIds.values()) {
        void cleanupFloatDir(id);
    }
    floatWindows.clear();
    floatWindowIds.clear();
    floatImageStore.clear();
});

app.on('activate', () => {
    if (!cropperWindow || cropperWindow.isDestroyed()) {
        captureSessionActive = false;
        captureInFlight = false;
        createWindows();
    }
});
