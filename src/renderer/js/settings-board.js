/** Вкладки и тумблер «Доска по умолчанию» (трей и кроппер). */
(function () {
    function switchSettingsTab(container, tabName, prefix) {
        if (!container || !tabName) return;
        const p = prefix || '';
        const tabs = container.querySelectorAll('.settings-tab');
        const panels = container.querySelectorAll('.settings-tab-panel');
        tabs.forEach((tab) => {
            const active = tab.getAttribute('data-tab') === tabName;
            tab.classList.toggle('active', active);
        });
        panels.forEach((panel) => {
            const match = panel.id === `${p}settings-tab-${tabName}`;
            panel.classList.toggle('active', match);
            panel.hidden = !match;
        });
    }

    function initSettingsTabs(container, prefix, defaultTab) {
        if (!container) return;
        const p = prefix || '';
        const firstTab = defaultTab || 'board';

        if (container.dataset.tabsBound !== '1') {
            container.dataset.tabsBound = '1';
            const tabs = container.querySelectorAll('.settings-tab');
            if (!tabs.length) return;

            tabs.forEach((tab) => {
                tab.addEventListener('click', () => {
                    switchSettingsTab(container, tab.getAttribute('data-tab'), p);
                });
            });
        }

        switchSettingsTab(container, firstTab, p);
    }

    function boardLabel(defs, boardOptions, boardId) {
        if (!boardId) return '';
        if (Array.isArray(boardOptions)) {
            const board = boardOptions.find((b) => b.id === boardId);
            if (board && board.name) return board.name;
        }
        return boardId;
    }

    function joinParts(parts) {
        return parts.filter(Boolean).join(' · ');
    }

    function looksLikeStoragePath(value) {
        const s = value == null ? '' : String(value).trim();
        return s.includes('/') || s.startsWith('boards');
    }

    function formatColumnDisplay(defs, columnId, columnName, forUpdate) {
        const name = (columnName || '').trim();
        if (name) return name;
        const id = (columnId || '').trim();
        if (!forUpdate && id) return id;
        if (forUpdate && defs.boardId === defs.updateBoardId && defs.columnId === id && defs.columnName) {
            return defs.columnName;
        }
        return id;
    }

    function formatCardDisplay(cardName, cardId) {
        const name = (cardName || '').trim();
        if (name && !looksLikeStoragePath(name)) return name;
        if (cardId && !looksLikeStoragePath(cardId)) return String(cardId).trim();
        return name && !looksLikeStoragePath(name) ? name : (cardId ? 'карточка' : '');
    }

    function formatSavedDefaultsLabel(defs, boardOptions) {
        if (!defs || !defs.remember) {
            return 'Режим последнего выбора: значения обновляются при каждом изменении в формах';
        }
        const lines = [];
        if (defs.boardId) {
            const board = boardLabel(defs, boardOptions, defs.boardId) || defs.boardName;
            const column = formatColumnDisplay(defs, defs.columnId, defs.columnName, false);
            lines.push('Создать новую: ' + joinParts([board, column]));
        }
        if (defs.updateBoardId) {
            const board = boardLabel(defs, boardOptions, defs.updateBoardId) || defs.updateBoardName;
            const column = formatColumnDisplay(defs, defs.updateColumnId, defs.updateColumnName, true);
            const card = formatCardDisplay(defs.updateCardName, defs.updateCardId);
            lines.push('Прикрепить: ' + joinParts([board, column, card]));
        }
        if (!lines.length) return 'Закреплено: значения подставляются в каждом новом скриншоте';
        return 'Закреплено:\n' + lines.join('\n');
    }

    function bindRememberToggle(opts) {
        const {
            toggleEl,
            labelEl,
            hintEl,
            hintClass = 'hint',
            invoke,
            readSnapshot
        } = opts;
        if (!toggleEl || !invoke) return null;

        let toggleBusy = false;

        function setHint(text, kind) {
            if (!hintEl) return;
            hintEl.textContent = text || '';
            hintEl.className = hintClass + (kind ? ' ' + kind : '');
        }

        async function refreshUi() {
            const defs = await invoke('get-create-defaults').catch(() => null);
            if (!defs) return;
            toggleEl.checked = !!defs.remember;
            if (labelEl) {
                const boards = await invoke('get-board-list').catch(() => []);
                labelEl.textContent = formatSavedDefaultsLabel(defs, boards);
            }
        }

        if (toggleEl.dataset.rememberBound !== '1') {
            toggleEl.dataset.rememberBound = '1';
            toggleEl.addEventListener('change', async () => {
                if (toggleBusy) return;
                const wantOn = toggleEl.checked;
                toggleBusy = true;
                toggleEl.disabled = true;
                try {
                    if (!wantOn) {
                        const res = await invoke('set-create-defaults', { remember: false }).catch(() => null);
                        if (!res || !res.ok) {
                            toggleEl.checked = true;
                            setHint('Не удалось выключить запоминание.', 'error');
                            return;
                        }
                        setHint('');
                        await refreshUi();
                        return;
                    }

                    const snap = readSnapshot
                        ? await Promise.resolve(readSnapshot())
                        : await invoke('read-create-form-snapshot').catch(() => ({ ok: false, error: 'Ошибка чтения формы.' }));
                    const payload = { remember: true, merge: false };

                    if (snap && snap.ok) {
                        if (snap.boardId) {
                            payload.boardId = snap.boardId;
                            payload.boardName = snap.boardName || '';
                            payload.columnId = snap.columnId || '';
                            payload.columnName = snap.columnName || '';
                        }
                        if (snap.updateBoardId) {
                            payload.updateBoardId = snap.updateBoardId;
                            payload.updateBoardName = snap.updateBoardName || '';
                            payload.updateColumnId = snap.updateColumnId || '';
                            payload.updateColumnName = snap.updateColumnName || '';
                            payload.updateCardId = snap.updateCardId || '';
                            payload.updateCardName = snap.updateCardName || '';
                        }
                    }

                    if (typeof window.enrichPinnedDefaultsPayload === 'function') {
                        window.enrichPinnedDefaultsPayload(payload);
                    }

                    const hasBoard = !!(payload.boardId || payload.updateBoardId);
                    if (!hasBoard) {
                        toggleEl.checked = false;
                        setHint((snap && snap.error) || 'Выберите доску в одной из форм.', 'error');
                        return;
                    }

                    const res = await invoke('set-create-defaults', payload).catch(() => null);
                    if (!res || !res.ok) {
                        toggleEl.checked = false;
                        setHint((res && res.error) || 'Не удалось сохранить.', 'error');
                        return;
                    }

                    setHint('Сохранено', 'ok');
                    await refreshUi();
                } finally {
                    toggleBusy = false;
                    toggleEl.disabled = false;
                }
            });
        }

        return refreshUi;
    }

    window.initSettingsTabs = initSettingsTabs;
    window.switchSettingsTab = switchSettingsTab;
    window.bindRememberCreateDefaultsToggle = bindRememberToggle;
    window.formatSavedCreateDefaultsLabel = formatSavedDefaultsLabel;
})();
