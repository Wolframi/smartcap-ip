(function () {
    const api = window.smartCap || window.ipcRenderer;
    if (!api || typeof api.invoke !== 'function') return;

    const hotkeyBtn = document.getElementById('cropper-hotkey-btn');
    const delayedHotkeyBtn = document.getElementById('cropper-delayed-hotkey-btn');
    const delayInput = document.getElementById('cropper-delay-ms');
    const hint = document.getElementById('cropper-settings-hint');
    if (!hotkeyBtn || !delayedHotkeyBtn || !delayInput || !hint) return;

    let recordingTarget = null;
    let savedPrimaryAccelerator = null;
    let savedDelayedAccelerator = null;
    let savedDelayMs = 3000;
    let listenersBound = false;

    function setHint(text, kind) {
        hint.textContent = text || '';
        hint.className = 'settings-panel-hint' + (kind ? ' ' + kind : '');
    }

    function formatDisplay(accel) {
        return String(accel || '')
            .replace(/CommandOrControl/gi, 'Ctrl')
            .replace(/Control/gi, 'Ctrl');
    }

    function formatDelayedButtonLabel(accel) {
        return accel ? formatDisplay(accel) : 'Не задана';
    }

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

    window.stopCropperSettingsRecording = stopRecording;

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
            const res = await api.invoke('save-screenshot-hotkey', accel);
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
            const res = await api.invoke('save-delayed-screenshot-hotkey', {
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
            const res = await api.invoke('save-delayed-screenshot-hotkey', { delayMs: clamped });
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

    function onKeyDown(e) {
        const form = document.getElementById('settings-form');
        if (!form || form.style.display === 'none') return;

        if (!recordingTarget) {
            if (e.key === 'Escape' && typeof closeForms === 'function') {
                closeForms();
            }
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
    }

    function bindListenersOnce() {
        if (listenersBound) return;
        listenersBound = true;

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

        window.addEventListener('keydown', onKeyDown, true);
    }

    async function refreshCropperSettingsPanel() {
        bindListenersOnce();
        stopRecording();
        setHint('');

        const settingsForm = document.getElementById('settings-form');
        if (settingsForm && typeof initSettingsTabs === 'function') {
            initSettingsTabs(settingsForm, 'cropper-', 'board');
        }
        if (typeof bindRememberCreateDefaultsToggle === 'function') {
            const refreshBoard = bindRememberCreateDefaultsToggle({
                toggleEl: document.getElementById('cropper-remember-create-defaults'),
                labelEl: document.getElementById('cropper-remember-saved-label'),
                hintEl: document.getElementById('cropper-board-hint'),
                hintClass: 'settings-panel-hint',
                invoke: (channel, ...args) => api.invoke(channel, ...args),
                readSnapshot: () => Promise.resolve(
                    typeof readFormDefaultsSnapshot === 'function'
                        ? readFormDefaultsSnapshot()
                        : (typeof readCreateFormSnapshot === 'function'
                            ? readCreateFormSnapshot()
                            : { ok: false, error: 'Формы недоступны.' })
                )
            });
            if (refreshBoard) await refreshBoard();
        }

        try {
            const data = await api.invoke('get-screenshot-hotkey');
            if (data) {
                savedPrimaryAccelerator = data.accelerator;
                hotkeyBtn.textContent = data.display || formatDisplay(data.accelerator);
            }
        } catch (e) {}

        try {
            const data = await api.invoke('get-delayed-screenshot-hotkey');
            if (data) {
                savedDelayedAccelerator = data.accelerator || null;
                delayedHotkeyBtn.textContent = data.display || formatDelayedButtonLabel(savedDelayedAccelerator);
                if (Number.isFinite(data.delayMs)) {
                    savedDelayMs = data.delayMs;
                    delayInput.value = String(data.delayMs);
                }
            }
        } catch (e) {}
    }

    window.refreshCropperSettingsPanel = refreshCropperSettingsPanel;
})();
