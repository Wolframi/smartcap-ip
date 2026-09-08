(function () {
    const api = window.smartCapSettings;
    if (!api) return;

    const hotkeyBtn = document.getElementById('hotkey-btn');
    const delayedHotkeyBtn = document.getElementById('delayed-hotkey-btn');
    const delayInput = document.getElementById('delay-ms');
    const hint = document.getElementById('hint');
    const btnClose = document.getElementById('btn-close');

    let recordingTarget = null;
    let savedPrimaryAccelerator = null;
    let savedDelayedAccelerator = null;
    let savedDelayMs = 3000;

    function setHint(text, kind) {
        hint.textContent = text || '';
        hint.className = 'hint' + (kind ? ' ' + kind : '');
    }

    function formatDisplay(accel) {
        return String(accel || '')
            .replace(/CommandOrControl/gi, 'Ctrl')
            .replace(/Control/gi, 'Ctrl');
    }

    function formatDelayedButtonLabel(accel) {
        return accel ? formatDisplay(accel) : 'Не задана';
    }

    /** Electron ожидает физические коды клавиш (US layout), не символы раскладки. */
    function acceleratorFromKeyEvent(e) {
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;

        const mods = [];
        if (e.ctrlKey || e.metaKey) mods.push('Control');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (!mods.length) return null;

        const code = e.code || '';
        let key = null;
        if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
        else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
        else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
        else if (code === 'Space') key = 'Space';
        else if (code === 'Tab') key = 'Tab';
        else if (code === 'ArrowUp') key = 'Up';
        else if (code === 'ArrowDown') key = 'Down';
        else if (code === 'ArrowLeft') key = 'Left';
        else if (code === 'ArrowRight') key = 'Right';
        else if (code === 'NumpadAdd' || (code === 'Equal' && e.shiftKey)) key = 'Plus';
        else if (code === 'Minus') key = '-';
        else if (code === 'Equal') key = '=';

        if (!key) return null;
        return mods.join('+') + '+' + key;
    }

    function getHotkeyButton(target) {
        return target === 'delayed' ? delayedHotkeyBtn : hotkeyBtn;
    }

    function getSavedAccelerator(target) {
        return target === 'delayed' ? savedDelayedAccelerator : savedPrimaryAccelerator;
    }

    function stopRecording() {
        if (!recordingTarget) return;
        const btn = getHotkeyButton(recordingTarget);
        const saved = getSavedAccelerator(recordingTarget);
        btn.classList.remove('recording');
        btn.textContent = recordingTarget === 'delayed'
            ? formatDelayedButtonLabel(saved)
            : formatDisplay(saved);
        recordingTarget = null;
    }

    function startRecording(target) {
        if (recordingTarget && recordingTarget !== target) stopRecording();
        recordingTarget = target;
        const btn = getHotkeyButton(target);
        btn.classList.add('recording');
        btn.textContent = '…';
        setHint(target === 'delayed'
            ? 'Нажмите дополнительную комбинацию (Delete — сбросить)'
            : 'Нажмите новую комбинацию');
        btn.focus();
    }

    async function applyPrimaryHotkey(accel) {
        setHint('Сохранение…');
        try {
            const res = await api.saveScreenshotHotkey(accel);
            if (res && res.ok) {
                savedPrimaryAccelerator = accel;
                hotkeyBtn.textContent = res.display || formatDisplay(accel);
                setHint('Сохранено', 'ok');
                return true;
            }
            setHint((res && res.error) || 'Не удалось сохранить', 'error');
        } catch (err) {
            setHint('Ошибка сохранения', 'error');
        }
        return false;
    }

    async function applyDelayedHotkey(accel) {
        setHint('Сохранение…');
        try {
            const res = await api.saveDelayedScreenshotHotkey({
                hotkey: accel,
                delayMs: Number(delayInput.value)
            });
            if (res && res.ok) {
                savedDelayedAccelerator = accel || null;
                delayedHotkeyBtn.textContent = formatDelayedButtonLabel(savedDelayedAccelerator);
                if (Number.isFinite(res.delayMs)) {
                    savedDelayMs = res.delayMs;
                    delayInput.value = String(res.delayMs);
                }
                setHint('Сохранено', 'ok');
                return true;
            }
            setHint((res && res.error) || 'Не удалось сохранить', 'error');
        } catch (err) {
            setHint('Ошибка сохранения', 'error');
        }
        return false;
    }

    async function applyDelayMs() {
        const parsed = Number(delayInput.value);
        if (!Number.isFinite(parsed)) {
            delayInput.value = String(savedDelayMs);
            return;
        }
        const clamped = Math.max(0, Math.min(60000, Math.round(parsed)));
        delayInput.value = String(clamped);
        if (clamped === savedDelayMs) return;

        setHint('Сохранение…');
        try {
            const res = await api.saveDelayedScreenshotHotkey({ delayMs: clamped });
            if (res && res.ok) {
                savedDelayMs = res.delayMs;
                delayInput.value = String(res.delayMs);
                setHint('Сохранено', 'ok');
                return;
            }
            delayInput.value = String(savedDelayMs);
            setHint((res && res.error) || 'Не удалось сохранить', 'error');
        } catch (err) {
            delayInput.value = String(savedDelayMs);
            setHint('Ошибка сохранения', 'error');
        }
    }

    hotkeyBtn.addEventListener('click', () => {
        if (recordingTarget === 'primary') {
            stopRecording();
            setHint('');
        } else {
            startRecording('primary');
        }
    });

    delayedHotkeyBtn.addEventListener('click', () => {
        if (recordingTarget === 'delayed') {
            stopRecording();
            setHint('');
        } else {
            startRecording('delayed');
        }
    });

    delayInput.addEventListener('change', () => {
        void applyDelayMs();
    });

    delayInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            delayInput.blur();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (!recordingTarget) {
            if (e.key === 'Escape') api.close();
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
            stopRecording();
            setHint('');
            return;
        }

        if (recordingTarget === 'delayed' && e.key === 'Delete') {
            stopRecording();
            void applyDelayedHotkey('');
            return;
        }

        const accel = acceleratorFromKeyEvent(e);
        if (!accel) return;

        const target = recordingTarget;
        stopRecording();
        if (target === 'delayed') {
            void applyDelayedHotkey(accel);
        } else {
            void applyPrimaryHotkey(accel);
        }
    }, true);

    btnClose.addEventListener('click', () => api.close());

    const settingsRoot = document.querySelector('.settings');
    if (typeof initSettingsTabs === 'function') {
        initSettingsTabs(settingsRoot, '', 'board');
    }
    if (typeof bindRememberCreateDefaultsToggle === 'function') {
        const refreshBoardTab = bindRememberCreateDefaultsToggle({
            toggleEl: document.getElementById('remember-create-defaults'),
            labelEl: document.getElementById('remember-saved-label'),
            hintEl: document.getElementById('board-hint'),
            hintClass: 'hint',
            invoke: (channel, ...args) => {
                if (channel === 'get-create-defaults') return api.getCreateDefaults();
                if (channel === 'set-create-defaults') return api.setCreateDefaults(args[0]);
                if (channel === 'read-create-form-snapshot') return api.readCreateFormSnapshot();
                if (channel === 'get-board-list') return api.getBoardList();
                return Promise.reject(new Error('unknown'));
            }
        });
        if (refreshBoardTab) void refreshBoardTab();
    }

    void api.getScreenshotHotkey().then((data) => {
        if (!data) return;
        savedPrimaryAccelerator = data.accelerator;
        hotkeyBtn.textContent = data.display || formatDisplay(data.accelerator);
    });

    void api.getDelayedScreenshotHotkey().then((data) => {
        if (!data) return;
        savedDelayedAccelerator = data.accelerator || null;
        delayedHotkeyBtn.textContent = data.display || formatDelayedButtonLabel(savedDelayedAccelerator);
        if (Number.isFinite(data.delayMs)) {
            savedDelayMs = data.delayMs;
            delayInput.value = String(data.delayMs);
        }
    });
})();
