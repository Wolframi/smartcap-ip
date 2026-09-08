    // 1. API через preload (contextBridge) — без nodeIntegration в renderer
    // Все общие ссылки — на window: иначе const/let из этого файла не видны другим <script>.
    window.ipcRenderer = window.smartCap;
    window.smartCapApi = window.smartCap;
    window.API_URL = 'http://localhost:3000/api';

    // 2. ИНИЦИАЛИЗАЦИЯ CANVAS (привязка к window)
    window.bgCanvas = document.getElementById('bg-layer');
    window.blurCanvas = document.getElementById('blur-layer');
    window.dimCanvas = document.getElementById('dim-layer');
    window.drawCanvas = document.getElementById('draw-layer');
    window.penPreviewCanvas = document.getElementById('pen-preview-layer');

    // UI элементы
    window.drawBar = document.getElementById('draw-bar');
    window.sideBar = document.getElementById('side-bar');
    window.taskForm = document.getElementById('task-form');
    window.updateForm = document.getElementById('update-form');
    window.settingsForm = document.getElementById('settings-form');
    window.selectionHandles = document.getElementById('selection-handles');
    window.pickerWrap = document.getElementById('color-picker-wrap');
    window.pickerThumb = document.getElementById('color-thumb');

    // Контексты
    window.ctxBg = window.bgCanvas.getContext('2d');
    window.ctxBlur = window.blurCanvas.getContext('2d');
    window.ctxDim = window.dimCanvas.getContext('2d');
    window.ctxDraw = window.drawCanvas.getContext('2d');
    window.ctxPenPreview = window.penPreviewCanvas ? window.penPreviewCanvas.getContext('2d') : null;

    // Состояние (window — доступно из ui.js, selection.js, canvas.js и executeJavaScript)
    window.state = 'idle';
    window.startX = 0;
    window.startY = 0;
    window.selX = 0;
    window.selY = 0;
    window.selW = 0;
    window.selH = 0;
    window.uiStartX = 0;
    window.uiStartY = 0;
    window.uiX = 0;
    window.uiY = 0;
    window.uiW = 0;
    window.uiH = 0;
    window.shapeStartX = 0;
    window.shapeStartY = 0;
    window.isDrawing = false;
    window.undoStack = [];
    window.redoStack = [];
    window.currentTool = 'pen';
    window.currentColor = '#ff0000';
    window.BLUR_STRENGTH = 20; // визуальная сила (CSS px), в canvas масштабируется через scaleRatio
    window.blurMaskCanvas = document.createElement('canvas');
    window.ctxBlurMask = window.blurMaskCanvas.getContext('2d');
    window.stepCounter = 1;
    window.isDraggingColor = false;
    window.TOOL_SIZE_MIN = 2;
    window.TOOL_SIZE_MAX = 20;
    window.TOOL_SIZE_DEFAULT = 10;
    window.currentToolSize = window.TOOL_SIZE_DEFAULT;
    window.currentOpacity = 1;
    /** Базовая «тень» вокруг штриха */
    const STROKE_HALO_BASE_PX = 3;
    const STROKE_HALO_SIZE_SCALE = 0.85;
    /** Прозрачность цвета тени (не основного штриха) */
    const STROKE_HALO_COLOR_ALPHA_LIGHT = 0.28;
    const STROKE_HALO_COLOR_ALPHA_DARK = 0.26;
    const STROKE_HALO_PASS_ALPHA = 0.55;

    function getStrokeWidth() {
        return Math.round(window.currentToolSize * (window.scaleRatio || 1));
    }

    /** Смещение координат на полпикселя для чётких штрихов нечётной толщины. */
    function snapCoord(coord) {
        const lineWidth = getStrokeWidth();
        return (lineWidth % 2 !== 0) ? Math.floor(coord) + 0.5 : Math.round(coord);
    }

    /** 0 для тонких штрихов, 1 для толстых — чтобы halo не «замыливал» мелкие размеры. */
    function getStrokeHaloStrength() {
        const w = getStrokeWidth();
        if (w <= 2) return 0;
        if (w >= 8) return 1;
        return (w - 2) / 6;
    }

    function getStrokeHaloExtraPx() {
        const strength = getStrokeHaloStrength();
        if (strength <= 0) return 0;
        const w = getStrokeWidth();
        return (STROKE_HALO_BASE_PX + w * 0.28) * STROKE_HALO_SIZE_SCALE * strength;
    }

    function getStrokeHaloBlurPx() {
        const strength = getStrokeHaloStrength();
        if (strength <= 0) return 0;
        const w = getStrokeWidth();
        return (getStrokeHaloExtraPx() * 1.35 + w * 0.15) * strength;
    }
    function getBlurPreviewStrokeWidth() {
        return Math.max(2, Math.round(1.5 * (window.scaleRatio || 1)));
    }
    function getArrowHeadLength() {
        return Math.max(24, window.currentToolSize * 2.5) * (window.scaleRatio || 1);
    }
    /** При размере 20 — высота ~5 строк (×4 давало ~6–7) */
    const TOOL_TEXT_SIZE_FACTOR = 2.95;
    function getToolTextSize() { return Math.round(currentToolSize * TOOL_TEXT_SIZE_FACTOR); }

    function hslToRgb(h, s, l) {
        const hh = ((h % 360) + 360) % 360;
        const ss = Math.max(0, Math.min(100, s)) / 100;
        const ll = Math.max(0, Math.min(100, l)) / 100;
        const c = (1 - Math.abs(2 * ll - 1)) * ss;
        const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
        const m = ll - c / 2;
        let r = 0;
        let g = 0;
        let b = 0;
        if (hh < 60) { r = c; g = x; }
        else if (hh < 120) { r = x; g = c; }
        else if (hh < 180) { g = c; b = x; }
        else if (hh < 240) { g = x; b = c; }
        else if (hh < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
    }

    function parseColorChannels(color) {
        const c = (color || '').trim();
        const hsl = c.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
        if (hsl) return { ...hslToRgb(+hsl[1], +hsl[2], +hsl[3]), a: 1 };
        const rgba = c.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
        if (rgba) {
            return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: +rgba[4] };
        }
        const rgb = c.match(/^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
        if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: 1 };
        let hex = c.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
        if (/^[0-9a-f]{6}$/i.test(hex)) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: 1
            };
        }
        return { r: 255, g: 0, b: 0, a: 1 };
    }

    function colorWithAlpha(color, alpha) {
        const ch = parseColorChannels(color);
        const a = Math.max(0, Math.min(1, alpha)) * Math.max(0, Math.min(1, ch.a));
        return `rgba(${ch.r}, ${ch.g}, ${ch.b}, ${a})`;
    }

    function getColorLuminance(color) {
        const ch = parseColorChannels(color);
        return (0.299 * ch.r + 0.587 * ch.g + 0.114 * ch.b) / 255;
    }

    /** Тёмная тень для цветных штрихов; светлая только почти для чёрного (синий #00f не попадает). */
    function getStrokeHaloColor() {
        const lum = getColorLuminance(currentColor);
        if (lum < 0.06) return `rgba(255, 255, 255, ${STROKE_HALO_COLOR_ALPHA_LIGHT})`;
        return `rgba(0, 0, 0, ${STROKE_HALO_COLOR_ALPHA_DARK})`;
    }

    function getStrokeHaloPassOpacity() {
        return currentOpacity * STROKE_HALO_PASS_ALPHA;
    }

    /** Цвет штриха без прозрачности — opacity задаётся через ctx.globalAlpha. */
    function getMainStrokeColor() {
        return colorWithAlpha(currentColor, 1);
    }

    function getStrokeHaloWidth() {
        return getStrokeWidth() + getStrokeHaloExtraPx();
    }

    /** Радиус отступа для перерисовки (halo отключён — только половина толщины штриха). */
    function getStrokeHaloExtentPx() {
        return Math.ceil(getStrokeWidth() / 2) + 2;
    }

    function paintTextLineWithHalo(ctx, line, x, y, scale) {
        const prevAlpha = ctx.globalAlpha;
        ctx.save();
        applyMainStrokeStyle(ctx);
        ctx.fillText(line, x, y);
        ctx.restore();
        ctx.globalAlpha = prevAlpha;
    }

    function applyMainStrokeStyle(ctx, opacity) {
        const a = opacity == null ? currentOpacity : opacity;
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.strokeStyle = getMainStrokeColor();
        ctx.fillStyle = getMainStrokeColor();
        ctx.lineWidth = getStrokeWidth();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
    }

    /** То же свечение, что и у финального штриха (при рисовании в движении). */
    function strokeWithHaloPreview(ctx) {
        strokeWithHalo(ctx);
    }

    /** Лёгкая тень для контраста на фоне (после applyMainStrokeStyle). */
    const STROKE_HALO_SHADOW = 'rgba(0, 0, 0, 0.22)';
    const STROKE_HALO_BLUR = 2;
    const STROKE_HALO_OFFSET_Y = 0.5;

    function strokeWithHalo(ctx) {
        ctx.save();
        applyMainStrokeStyle(ctx);
        ctx.shadowColor = STROKE_HALO_SHADOW;
        ctx.shadowBlur = STROKE_HALO_BLUR;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = STROKE_HALO_OFFSET_Y;
        ctx.stroke();
        ctx.restore();
    }

    function fillCircleWithHaloPreview(ctx, x, y, radius, forceOpaque) {
        fillCircleWithHalo(ctx, x, y, radius, forceOpaque);
    }

    function fillCircleWithHalo(ctx, x, y, radius, forceOpaque) {
        const r = Math.max(1, radius);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        applyMainStrokeStyle(ctx, forceOpaque ? 1 : currentOpacity);
        ctx.shadowColor = STROKE_HALO_SHADOW;
        ctx.shadowBlur = STROKE_HALO_BLUR;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = STROKE_HALO_OFFSET_Y;
        ctx.fill();
        ctx.restore();
    }

    function fillCircleWithHaloOpaque(ctx, x, y, radius) {
        fillCircleWithHalo(ctx, x, y, radius, true);
    }

    window.getStrokeWidth = getStrokeWidth;
    window.snapCoord = snapCoord;
    window.getMainStrokeColor = getMainStrokeColor;
    window.applyMainStrokeStyle = applyMainStrokeStyle;
    window.strokeWithHalo = strokeWithHalo;
    window.strokeWithHaloPreview = strokeWithHaloPreview;
    window.fillCircleWithHalo = fillCircleWithHalo;
    window.fillCircleWithHaloPreview = fillCircleWithHaloPreview;
    window.fillCircleWithHaloOpaque = fillCircleWithHaloOpaque;

    window.allCardsCache = [];
    window.allCardsCacheTs = 0;
    window.allCardsCacheBoardId = '';
    window.COLUMNS_CACHE_MS = 25000;
    window.scaleRatio = 1;
    window.currentAuthor = '';
    window.formParticipants = [];
    window.formUserList = [];
    window.boardServerUrl = null;
    window.currentBoardId = '';
    window.sessionCreateSelection = null;
    window.sessionUpdateSelection = null;
    window.createFormUsedThisSession = false;
    window.updateFormUsedThisSession = false;
    window.boardOptions = [];
    window.pendingFormAction = null;
    window.virtualBounds = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    window.primaryBounds = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    window.toolbarLayoutMode = 'selection';
    window.selectionMode = 'area';
    /** Вставка Ctrl+V: рамка без ручек, без изменения размера */
    window.selectionResizeLocked = false;
    window.CLIPBOARD_IMAGE_MAX_SCREEN_SCALE = 0.78;
    window.CLIPBOARD_IMAGE_DIM_ALPHA = 0.62;
    window.activeTextBox = null;
