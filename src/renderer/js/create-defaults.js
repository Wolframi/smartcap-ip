/** Снимок и сессия форм «Создать новую» и «Добавить к существующей». */
let persistLastFormTimer = null;
let persistDefaultsTimer = null;

function formSelectionApi() {
    return window.smartCap || window.ipcRenderer;
}

function schedulePersistLastFormSelection() {
    clearTimeout(persistLastFormTimer);
    persistLastFormTimer = setTimeout(() => {
        persistLastFormTimer = null;
        void flushLastFormSelection();
    }, 400);
}

function isCreateFormOpen() {
    const el = document.getElementById('task-form');
    return !!(el && el.style.display === 'block');
}

function isUpdateFormOpen() {
    const el = document.getElementById('update-form');
    return !!(el && el.style.display === 'block');
}

function optionTextForValue(selectId, value) {
    if (!value) return '';
    const el = document.getElementById(selectId);
    if (!el) return '';
    const id = String(value).trim();
    const match = Array.from(el.options).find((o) => {
        if (!o.value || o.disabled) return false;
        if (o.value === id) return true;
        const rel = o.getAttribute('data-relpath') || '';
        return rel && rel === id;
    });
    return match ? String(match.text || '').trim() : '';
}

function fillPinnedPair(payload, idKey, nameKey, idValue, nameValue) {
    const id = idValue == null ? '' : String(idValue).trim();
    const name = nameValue == null ? '' : String(nameValue).trim();
    if (!id) return;
    if (!payload[idKey]) {
        payload[idKey] = id;
        if (name) payload[nameKey] = name;
    } else if (payload[idKey] === id && name && !payload[nameKey]) {
        payload[nameKey] = name;
    }
}

function enrichPinnedDefaultsPayload(payload) {
    if (!payload) return payload;
    const create = captureCreateFormSelection();
    if (payload.boardId === create.boardId) {
        if (payload.columnId === create.columnId && create.columnName && !payload.columnName) {
            payload.columnName = create.columnName;
        }
    }
    const update = captureUpdateFormSelection();
    if (payload.updateBoardId === update.boardId) {
        if (payload.updateColumnId === update.columnId && update.columnName && !payload.updateColumnName) {
            payload.updateColumnName = update.columnName;
        }
        if (payload.updateCardId === update.cardId && update.cardName && !payload.updateCardName) {
            payload.updateCardName = update.cardName;
        }
    }
    if (payload.columnId && !payload.columnName) {
        payload.columnName = optionTextForValue('inp-column', payload.columnId)
            || optionTextForValue('inp-upd-col', payload.columnId);
    }
    if (payload.updateColumnId && !payload.updateColumnName) {
        payload.updateColumnName = optionTextForValue('inp-upd-col', payload.updateColumnId);
        if (!payload.updateColumnName && payload.boardId === payload.updateBoardId
            && payload.columnId === payload.updateColumnId && payload.columnName) {
            payload.updateColumnName = payload.columnName;
        }
    }
    if (payload.updateCardId && !payload.updateCardName) {
        payload.updateCardName = optionTextForValue('inp-target-card', payload.updateCardId);
    }
    return payload;
}

async function buildPersistDefaultsPayload() {
    const api = formSelectionApi();
    const existing = (api && typeof api.invoke === 'function')
        ? await api.invoke('get-create-defaults').catch(() => null)
        : null;

    if (!existing || !existing.remember) return null;

    const payload = { remember: true, merge: false };

    payload.boardId = existing.boardId || '';
    payload.columnId = existing.columnId || '';
    payload.boardName = existing.boardName || '';
    payload.columnName = existing.columnName || '';
    payload.updateBoardId = existing.updateBoardId || '';
    payload.updateColumnId = existing.updateColumnId || '';
    payload.updateCardId = existing.updateCardId || '';
    payload.updateBoardName = existing.updateBoardName || '';
    payload.updateColumnName = existing.updateColumnName || '';
    payload.updateCardName = existing.updateCardName || '';

    const createOpen = isCreateFormOpen();
    const updateOpen = isUpdateFormOpen();

    if (createOpen) {
        const sel = captureCreateFormSelection();
        fillPinnedPair(payload, 'boardId', 'boardName', sel.boardId, sel.boardName);
        if (sel.columnId && payload.boardId === sel.boardId) {
            fillPinnedPair(payload, 'columnId', 'columnName', sel.columnId, sel.columnName);
        }
    }

    if (updateOpen) {
        const sel = captureUpdateFormSelection();
        fillPinnedPair(payload, 'updateBoardId', 'updateBoardName', sel.boardId, sel.boardName);
        if (sel.columnId && payload.updateBoardId === sel.boardId) {
            fillPinnedPair(payload, 'updateColumnId', 'updateColumnName', sel.columnId, sel.columnName);
        }
        if (sel.cardId && payload.updateBoardId === sel.boardId &&
            payload.updateColumnId === sel.columnId) {
            fillPinnedPair(payload, 'updateCardId', 'updateCardName', sel.cardId, sel.cardName);
        }
    }

    if (!createOpen && !updateOpen) {
        const createSess = window.sessionCreateSelection || {};
        const updateSess = window.sessionUpdateSelection || {};
        const createSnap = window.createFormToggleSnapshot || {};
        const updateSnap = window.updateFormToggleSnapshot || {};

        if (window.createFormUsedThisSession && createSess.boardId) {
            fillPinnedPair(payload, 'boardId', 'boardName', createSess.boardId, createSnap.boardName);
            if (createSess.columnId && payload.boardId === createSess.boardId) {
                fillPinnedPair(payload, 'columnId', 'columnName', createSess.columnId, createSnap.columnName);
            }
        }
        if (window.updateFormUsedThisSession && updateSess.boardId) {
            fillPinnedPair(payload, 'updateBoardId', 'updateBoardName', updateSess.boardId, updateSnap.boardName);
            if (updateSess.columnId && payload.updateBoardId === updateSess.boardId) {
                fillPinnedPair(payload, 'updateColumnId', 'updateColumnName', updateSess.columnId, updateSnap.columnName);
            }
            if (updateSess.cardId && payload.updateBoardId === updateSess.boardId &&
                payload.updateColumnId === updateSess.columnId) {
                fillPinnedPair(payload, 'updateCardId', 'updateCardName', updateSess.cardId, updateSnap.cardName);
            }
        }
    }

    enrichPinnedDefaultsPayload(payload);

    if (!payload.boardId && !payload.columnId && !payload.updateBoardId &&
        !payload.updateColumnId && !payload.updateCardId) {
        return null;
    }
    return payload;
}

async function persistCreateDefaultsIfRemember() {
    const api = formSelectionApi();
    if (!api || typeof api.invoke !== 'function') return;
    const defs = await api.invoke('get-create-defaults').catch(() => null);
    if (!defs || !defs.remember) return;
    const payload = await buildPersistDefaultsPayload();
    if (!payload) return;
    await api.invoke('set-create-defaults', payload).catch(() => {});
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm && settingsForm.style.display === 'block' &&
        typeof window.refreshCropperSettingsPanel === 'function') {
        void window.refreshCropperSettingsPanel();
    }
}

async function flushPersistCreateDefaultsIfRemember() {
    clearTimeout(persistDefaultsTimer);
    persistDefaultsTimer = null;
    await persistCreateDefaultsIfRemember();
}

function schedulePersistCreateDefaultsIfRemember() {
    clearTimeout(persistDefaultsTimer);
    persistDefaultsTimer = setTimeout(() => {
        persistDefaultsTimer = null;
        void persistCreateDefaultsIfRemember();
    }, 400);
}

async function flushLastFormSelection() {
    clearTimeout(persistLastFormTimer);
    persistLastFormTimer = null;
    const api = formSelectionApi();
    if (!api || typeof api.invoke !== 'function') return;
    const create = window.sessionCreateSelection || {};
    const update = window.sessionUpdateSelection || {};
    const payload = {};
    if (create.columnId != null) payload.createColumnId = create.columnId || '';
    if (update.columnId != null) payload.updateColumnId = update.columnId || '';
    if (update.cardId != null) payload.updateCardId = update.cardId || '';
    if (!Object.keys(payload).length) return;
    await api.invoke('save-last-form-selection', payload).catch(() => {});
}

function captureCreateFormSelection() {
    const boardEl = document.getElementById('inp-board-create');
    const colEl = document.getElementById('inp-column');
    const boardId = boardEl && boardEl.value ? String(boardEl.value).trim() : '';
    let columnId = '';
    if (colEl && colEl.value) {
        const opt = colEl.options[colEl.selectedIndex];
        if (opt && !opt.disabled && colEl.value.trim()) {
            columnId = String(colEl.value).trim();
        }
    }
    let boardName = '';
    let columnName = '';
    if (boardEl && boardEl.selectedIndex >= 0 && boardId) {
        boardName = boardEl.options[boardEl.selectedIndex].text || '';
    }
    if (colEl && colEl.selectedIndex >= 0 && columnId) {
        columnName = colEl.options[colEl.selectedIndex].text || '';
    }
    return { boardId, columnId, boardName, columnName };
}

function captureUpdateFormSelection() {
    const boardEl = document.getElementById('inp-board-update');
    const colEl = document.getElementById('inp-upd-col');
    const cardEl = document.getElementById('inp-target-card');
    const boardId = boardEl && boardEl.value ? String(boardEl.value).trim() : '';
    let columnId = '';
    if (colEl && colEl.value && !colEl.disabled) {
        const opt = colEl.options[colEl.selectedIndex];
        if (opt && !opt.disabled && colEl.value.trim()) {
            columnId = String(colEl.value).trim();
        }
    }
    let cardId = '';
    let cardName = '';
    if (cardEl && cardEl.value && !cardEl.disabled && cardEl.selectedIndex > 0) {
        const opt = cardEl.options[cardEl.selectedIndex];
        if (opt && !opt.disabled) {
            cardId = String(cardEl.value).trim();
            cardName = opt.text || '';
        }
    }
    let boardName = '';
    let columnName = '';
    if (boardEl && boardEl.selectedIndex >= 0 && boardId) {
        boardName = boardEl.options[boardEl.selectedIndex].text || '';
    }
    if (colEl && colEl.selectedIndex >= 0 && columnId) {
        columnName = colEl.options[colEl.selectedIndex].text || '';
    }
    return { boardId, columnId, cardId, boardName, columnName, cardName };
}

function saveSessionCreateSelection() {
    if (!isCreateFormOpen()) return;
    const sel = captureCreateFormSelection();
    if (!sel.boardId) {
        window.sessionCreateSelection = { boardId: '', columnId: '' };
        window.createFormToggleSnapshot = null;
        window.createFormRestoreColumnId = null;
        schedulePersistLastFormSelection();
        void flushPersistCreateDefaultsIfRemember();
        return;
    }
    const boardId = sel.boardId;
    let columnId = sel.columnId || '';
    if (!columnId) {
        columnId = window.createFormRestoreColumnId
            || (window.sessionCreateSelection && window.sessionCreateSelection.columnId)
            || '';
    }
    const prevSnap = window.createFormToggleSnapshot || {};
    window.sessionCreateSelection = { boardId, columnId };
    window.createFormToggleSnapshot = {
        boardId,
        columnId,
        boardName: sel.boardName || (prevSnap.boardId === boardId ? prevSnap.boardName : '') || '',
        columnName: sel.columnName || (prevSnap.columnId === columnId ? prevSnap.columnName : '') || ''
    };
    schedulePersistLastFormSelection();
    void flushPersistCreateDefaultsIfRemember();
}

function saveSessionUpdateSelection() {
    if (!isUpdateFormOpen()) return;
    const sel = captureUpdateFormSelection();
    if (!sel.boardId) {
        window.sessionUpdateSelection = { boardId: '', columnId: '', cardId: '' };
        window.updateFormToggleSnapshot = null;
        window.updateFormRestoreColumnId = null;
        window.updateFormRestoreCardId = null;
        schedulePersistLastFormSelection();
        void flushPersistCreateDefaultsIfRemember();
        return;
    }
    const prev = window.sessionUpdateSelection || {};
    const boardChanged = prev.boardId && prev.boardId !== sel.boardId;
    const columnChanged = !!(prev.columnId && sel.columnId && prev.columnId !== sel.columnId);

    let columnId = sel.columnId || (boardChanged ? '' : (prev.columnId || ''));
    let cardId = sel.cardId;
    if (!cardId) {
        cardId = (boardChanged || columnChanged) ? '' : (prev.cardId || '');
    }

    window.sessionUpdateSelection = {
        boardId: sel.boardId,
        columnId,
        cardId
    };
    window.updateFormRestoreColumnId = columnId || null;
    window.updateFormRestoreCardId = cardId || null;
    let columnName = sel.columnName || '';
    let cardName = sel.cardName || '';
    if (!columnName && columnId) columnName = optionTextForValue('inp-upd-col', columnId);
    if (!cardName && cardId) cardName = optionTextForValue('inp-target-card', cardId);
    window.updateFormToggleSnapshot = { ...sel, columnId, cardId, columnName, cardName };
    schedulePersistLastFormSelection();
    void flushPersistCreateDefaultsIfRemember();
}

function findColumnOption(selectEl, columnId, columnName) {
    if (!selectEl) return null;
    const id = columnId == null ? '' : String(columnId).trim();
    const name = columnName == null ? '' : String(columnName).trim();
    if (!id && !name) return null;
    return Array.from(selectEl.options).find((o) => {
        if (!o.value || o.disabled) return false;
        if (id && o.value === id) return true;
        if (id && (o.text || '').trim() === id) return true;
        const folder = o.getAttribute('data-folder');
        if (id && folder && folder === id) return true;
        if (name && (o.text || '').trim() === name) return true;
        return false;
    });
}

function boardIdInList(boardId, boardOptions) {
    const id = boardId == null ? '' : String(boardId).trim();
    if (!id || !Array.isArray(boardOptions)) return false;
    return boardOptions.some((board) => board.id === id);
}

function resolveCreateBoardId(session, defs, rememberOn, savedId, boardOptions) {
    const pinnedId = defs && defs.boardId ? defs.boardId : '';
    if (session && session.boardId && boardIdInList(session.boardId, boardOptions)) {
        return session.boardId;
    }
    if (rememberOn && pinnedId && boardIdInList(pinnedId, boardOptions)) {
        return pinnedId;
    }
    if (rememberOn && savedId && boardIdInList(savedId, boardOptions)) {
        return savedId;
    }
    if (session && session.boardId) return '';
    return '';
}

function resolveUpdateBoardId(session, defs, rememberOn, savedId, boardOptions) {
    const pinnedId = defs && defs.updateBoardId ? defs.updateBoardId : '';
    if (session && session.boardId && boardIdInList(session.boardId, boardOptions)) {
        return session.boardId;
    }
    if (rememberOn && pinnedId && boardIdInList(pinnedId, boardOptions)) {
        return pinnedId;
    }
    if (rememberOn && savedId && boardIdInList(savedId, boardOptions)) {
        return savedId;
    }
    if (session && session.boardId) return '';
    return '';
}

function rememberPinnedCreateDefaults(defs) {
    if (defs && defs.remember) {
        window.pinnedCreateDefaults = defs;
    }
}

function ensureSessionFromPinnedDefaults(defs) {
    if (!defs || !defs.remember) return;
    rememberPinnedCreateDefaults(defs);
    if (defs.boardId) {
        const cur = window.sessionCreateSelection;
        const userClearedBoard = cur && cur.boardId === '';
        if (!userClearedBoard) {
            if (!cur || !cur.boardId) {
                window.sessionCreateSelection = {
                    boardId: defs.boardId,
                    columnId: defs.columnId || ''
                };
            } else if (!cur.columnId && defs.columnId) {
                window.sessionCreateSelection = { ...cur, columnId: defs.columnId };
            }
        }
        if (defs.columnId) {
            window.createFormRestoreColumnId = defs.columnId;
            window.createFormRestoreColumnName = defs.columnName || '';
        }
    }
    if (defs.updateBoardId) {
        const cur = window.sessionUpdateSelection;
        const userClearedBoard = cur && cur.boardId === '';
        if (!userClearedBoard) {
            if (!cur || !cur.boardId) {
                window.sessionUpdateSelection = {
                    boardId: defs.updateBoardId,
                    columnId: defs.updateColumnId || '',
                    cardId: defs.updateCardId || ''
                };
            } else {
                const next = { ...cur };
                if (!next.columnId && defs.updateColumnId) next.columnId = defs.updateColumnId;
                if (!next.cardId && defs.updateCardId) next.cardId = defs.updateCardId;
                window.sessionUpdateSelection = next;
            }
        }
        if (defs.updateColumnId) {
            window.updateFormRestoreColumnId = defs.updateColumnId;
            window.updateFormRestoreColumnName = defs.updateColumnName || '';
        }
        if (defs.updateCardId) window.updateFormRestoreCardId = defs.updateCardId;
    }
}

function getCreateColumnRestoreMeta(session, defs) {
    const columnId = (session && session.columnId)
        || window.createFormRestoreColumnId
        || (defs && defs.remember && defs.columnId)
        || '';
    const columnName = window.createFormRestoreColumnName
        || (defs && defs.remember && defs.columnName)
        || '';
    return { columnId, columnName };
}

function getUpdateColumnRestoreMeta(session, defs) {
    const columnId = (session && session.columnId)
        || window.updateFormRestoreColumnId
        || (defs && defs.remember && defs.updateColumnId)
        || '';
    const columnName = window.updateFormRestoreColumnName
        || (defs && defs.remember && defs.updateColumnName)
        || '';
    return { columnId, columnName };
}

function applyCreateFormPinnedToDom(defs) {
    if (!defs || !defs.remember) return false;
    const boardEl = document.getElementById('inp-board-create');
    const colEl = document.getElementById('inp-column');
    let restored = false;
    const boardId = (window.sessionCreateSelection && window.sessionCreateSelection.boardId)
        || defs.boardId
        || window.currentBoardId
        || '';
    if (boardEl && boardId) {
        const boardOpt = Array.from(boardEl.options).find((o) => o.value === boardId);
        if (boardOpt) {
            boardEl.value = boardId;
            window.currentBoardId = boardId;
            restored = true;
        }
    }
    const { columnId, columnName } = getCreateColumnRestoreMeta(window.sessionCreateSelection, defs);
    if (colEl && columnId) {
        const colOpt = findColumnOption(colEl, columnId, columnName);
        if (colOpt) {
            colEl.value = colOpt.value;
            window.createFormRestoreColumnId = colOpt.value;
            restored = true;
        }
    }
    if (boardId || columnId) {
        window.sessionCreateSelection = {
            boardId: boardId || '',
            columnId: (colEl && colEl.value) || columnId || ''
        };
    }
    return restored;
}

function applyUpdateFormPinnedToDom(defs) {
    if (!defs || !defs.remember) return false;
    const boardEl = document.getElementById('inp-board-update');
    const colEl = document.getElementById('inp-upd-col');
    let restored = false;
    const boardId = (window.sessionUpdateSelection && window.sessionUpdateSelection.boardId)
        || defs.updateBoardId
        || window.currentBoardId
        || '';
    if (boardEl && boardId) {
        const boardOpt = Array.from(boardEl.options).find((o) => o.value === boardId);
        if (boardOpt) {
            boardEl.value = boardId;
            window.currentBoardId = boardId;
            restored = true;
        }
    }
    const { columnId, columnName } = getUpdateColumnRestoreMeta(window.sessionUpdateSelection, defs);
    if (colEl && columnId && !colEl.disabled) {
        const colOpt = findColumnOption(colEl, columnId, columnName);
        if (colOpt) {
            colEl.value = colOpt.value;
            window.updateFormRestoreColumnId = colOpt.value;
            if (typeof window.onUpdateColumnChanged === 'function') window.onUpdateColumnChanged();
            restored = true;
        }
    }
    const cardId = (window.sessionUpdateSelection && window.sessionUpdateSelection.cardId)
        || window.updateFormRestoreCardId
        || (defs.updateCardId || '');
    const cardEl = document.getElementById('inp-target-card');
    if (cardEl && cardId && !cardEl.disabled) {
        const cardOpt = findUpdateCardOption(cardEl, cardId);
        if (cardOpt) {
            cardEl.value = cardOpt.value;
            restored = true;
        }
    }
    if (boardId || columnId || cardId) {
        window.sessionUpdateSelection = {
            boardId: boardId || '',
            columnId: (colEl && colEl.value) || columnId || '',
            cardId: (cardEl && cardEl.value) || cardId || ''
        };
    }
    return restored;
}

function resolveCreateColumnRestoreId(session, defs) {
    if (session && session.columnId) return session.columnId;
    if (defs && defs.remember && defs.columnId) return defs.columnId;
    return null;
}

function resolveUpdateColumnRestoreId(session, defs) {
    if (session && session.columnId) return session.columnId;
    if (defs && defs.remember && defs.updateColumnId) return defs.updateColumnId;
    return null;
}

function findUpdateCardOption(cardSel, cardId) {
    if (!cardSel || !cardId) return null;
    return Array.from(cardSel.options).find((o) => {
        if (!o.value || o.disabled) return false;
        const relPath = o.getAttribute('data-relpath') || '';
        return o.value === cardId || relPath === cardId;
    });
}

window.resolveCreateBoardId = resolveCreateBoardId;
window.resolveUpdateBoardId = resolveUpdateBoardId;
window.findColumnOption = findColumnOption;
window.ensureSessionFromPinnedDefaults = ensureSessionFromPinnedDefaults;
window.resolveCreateColumnRestoreId = resolveCreateColumnRestoreId;
window.resolveUpdateColumnRestoreId = resolveUpdateColumnRestoreId;
window.findUpdateCardOption = findUpdateCardOption;
window.rememberPinnedCreateDefaults = rememberPinnedCreateDefaults;
window.applyCreateFormPinnedToDom = applyCreateFormPinnedToDom;
window.applyUpdateFormPinnedToDom = applyUpdateFormPinnedToDom;
window.getCreateColumnRestoreMeta = getCreateColumnRestoreMeta;
window.getUpdateColumnRestoreMeta = getUpdateColumnRestoreMeta;

function readFormDefaultsSnapshot() {
    const cachedCreate = window.createFormToggleSnapshot;
    const cachedUpdate = window.updateFormToggleSnapshot;
    const sessCreate = window.sessionCreateSelection || {};
    const sessUpdate = window.sessionUpdateSelection || {};
    const liveCreate = captureCreateFormSelection();
    const liveUpdate = captureUpdateFormSelection();
    const createOpen = isCreateFormOpen();
    const updateOpen = isUpdateFormOpen();

    const boardId = createOpen
        ? (liveCreate.boardId || '')
        : (sessCreate.boardId || (cachedCreate && cachedCreate.boardId) || '');
    const columnId = createOpen
        ? (liveCreate.columnId || '')
        : (sessCreate.columnId || (cachedCreate && cachedCreate.columnId) || '');
    const boardName = createOpen
        ? (liveCreate.boardName || (cachedCreate && cachedCreate.boardName) || '')
        : ((cachedCreate && cachedCreate.boardName) || liveCreate.boardName || '');
    const columnName = createOpen
        ? (liveCreate.columnName || (cachedCreate && cachedCreate.columnName) || '')
        : ((cachedCreate && cachedCreate.columnName) || liveCreate.columnName || '');

    const updateBoardId = updateOpen
        ? (liveUpdate.boardId || '')
        : (sessUpdate.boardId || (cachedUpdate && cachedUpdate.boardId) || '');
    const updateColumnId = updateOpen
        ? (liveUpdate.columnId || '')
        : (sessUpdate.columnId || (cachedUpdate && cachedUpdate.columnId) || '');
    const updateBoardName = updateOpen
        ? (liveUpdate.boardName || (cachedUpdate && cachedUpdate.boardName) || '')
        : ((cachedUpdate && cachedUpdate.boardName) || liveUpdate.boardName || '');
    const updateColumnName = updateOpen
        ? (liveUpdate.columnName || (cachedUpdate && cachedUpdate.columnName) || '')
        : ((cachedUpdate && cachedUpdate.columnName) || liveUpdate.columnName || '');
    const updateCardId = updateOpen
        ? (liveUpdate.cardId || sessUpdate.cardId || (cachedUpdate && cachedUpdate.cardId) || '')
        : (sessUpdate.cardId || (cachedUpdate && cachedUpdate.cardId) || liveUpdate.cardId || '');
    const updateCardName = updateOpen
        ? (liveUpdate.cardName || (cachedUpdate && cachedUpdate.cardName) || '')
        : ((cachedUpdate && cachedUpdate.cardName) || liveUpdate.cardName || '');

    let resolvedColumnName = columnName;
    let resolvedUpdateColumnName = updateColumnName;
    let resolvedUpdateCardName = updateCardName;
    if (!resolvedColumnName && columnId) {
        resolvedColumnName = optionTextForValue('inp-column', columnId)
            || optionTextForValue('inp-upd-col', columnId);
    }
    if (!resolvedUpdateColumnName && updateColumnId) {
        resolvedUpdateColumnName = optionTextForValue('inp-upd-col', updateColumnId);
    }
    if (!resolvedUpdateCardName && updateCardId) {
        resolvedUpdateCardName = optionTextForValue('inp-target-card', updateCardId);
    }
    if (!resolvedUpdateColumnName && updateColumnId && boardId === updateBoardId
        && columnId === updateColumnId && resolvedColumnName) {
        resolvedUpdateColumnName = resolvedColumnName;
    }

    if (!boardId && !updateBoardId && !columnId && !updateColumnId && !updateCardId) {
        return {
            ok: false,
            error: 'Сначала выберите доску или колонку в «Создать новую» или «Добавить к существующей».'
        };
    }
    return {
        ok: true,
        boardId: boardId || '',
        columnId: columnId || '',
        boardName,
        columnName: resolvedColumnName,
        updateBoardId: updateBoardId || '',
        updateColumnId: updateColumnId || '',
        updateCardId: updateCardId || '',
        updateBoardName,
        updateColumnName: resolvedUpdateColumnName,
        updateCardName: resolvedUpdateCardName
    };
}

function readCreateFormSnapshot() {
    return readFormDefaultsSnapshot();
}

async function initSessionCreateSelectionForCapture() {
    const api = formSelectionApi();
    await flushPersistCreateDefaultsIfRemember();
    await flushLastFormSelection();

    window.sessionCreateSelection = null;
    window.sessionUpdateSelection = null;
    window.createFormUsedThisSession = false;
    window.updateFormUsedThisSession = false;
    window.createFormRestoreColumnId = null;
    window.updateFormRestoreColumnId = null;
    window.updateFormRestoreCardId = null;
    window.createFormToggleSnapshot = null;
    window.updateFormToggleSnapshot = null;

    if (!api || typeof api.invoke !== 'function') return;

    const [defs, last] = await Promise.all([
        api.invoke('get-create-defaults').catch(() => null),
        api.invoke('get-last-form-selection').catch(() => null)
    ]);

    function applyLastUsedSelection(boardId) {
        if (!boardId) return;
        window.sessionCreateSelection = {
            boardId,
            columnId: (last && last.createColumnId) || ''
        };
        window.createFormRestoreColumnId = (last && last.createColumnId) || null;
        window.currentBoardId = boardId;
        void api.invoke('set-selected-board-id', boardId).catch(() => {});

        window.sessionUpdateSelection = {
            boardId,
            columnId: (last && last.updateColumnId) || '',
            cardId: (last && last.updateCardId) || ''
        };
        window.updateFormRestoreColumnId = (last && last.updateColumnId) || null;
        window.updateFormRestoreCardId = (last && last.updateCardId) || null;
    }

    // Чекбокс включён — в каждом новом скриншоте подставляются закреплённые значения.
    if (defs && defs.remember) {
        rememberPinnedCreateDefaults(defs);
        if (defs.boardId || defs.updateBoardId) {
            if (defs.boardId) {
                window.sessionCreateSelection = {
                    boardId: defs.boardId,
                    columnId: defs.columnId || ''
                };
                window.createFormRestoreColumnId = defs.columnId || null;
                window.createFormRestoreColumnName = defs.columnName || '';
                window.currentBoardId = defs.boardId;
                await api.invoke('set-selected-board-id', defs.boardId).catch(() => {});
            }
            if (defs.updateBoardId) {
                window.sessionUpdateSelection = {
                    boardId: defs.updateBoardId,
                    columnId: defs.updateColumnId || '',
                    cardId: defs.updateCardId || ''
                };
                window.updateFormRestoreColumnId = defs.updateColumnId || null;
                window.updateFormRestoreColumnName = defs.updateColumnName || '';
                window.updateFormRestoreCardId = defs.updateCardId || null;
                if (!window.sessionCreateSelection) {
                    window.currentBoardId = defs.updateBoardId;
                    await api.invoke('set-selected-board-id', defs.updateBoardId).catch(() => {});
                }
            }
        } else if (last && last.boardId) {
            applyLastUsedSelection(last.boardId);
        }
    }
    // Галочка выключена — сессию не заполняем: только выбор внутри текущего скриншота.
}

function restoreCreateFormSelectionFromSession() {
    const session = window.sessionCreateSelection;
    const boardId = (session && session.boardId) || window.currentBoardId || '';
    if (!boardId) return false;
    const boardEl = document.getElementById('inp-board-create');
    const colEl = document.getElementById('inp-column');
    let restored = false;
    if (boardEl) {
        const boardOpt = Array.from(boardEl.options).find((o) => o.value === boardId);
        if (boardOpt) {
            boardEl.value = boardId;
            window.currentBoardId = boardId;
            restored = true;
        }
    }
    const pinned = window.pinnedCreateDefaults;
    const colMeta = getCreateColumnRestoreMeta(session, pinned);
    const colId = colMeta.columnId;
    if (colEl && colId) {
        const colOpt = findColumnOption(colEl, colId, colMeta.columnName);
        if (colOpt) {
            colEl.value = colOpt.value;
            restored = true;
        }
    }
    return restored;
}

function restoreUpdateFormSelectionFromSession() {
    const session = window.sessionUpdateSelection;
    if (!session || !session.boardId) return false;
    const boardEl = document.getElementById('inp-board-update');
    const colEl = document.getElementById('inp-upd-col');
    let restored = false;
    if (boardEl) {
        const boardOpt = Array.from(boardEl.options).find((o) => o.value === session.boardId);
        if (boardOpt) {
            boardEl.value = session.boardId;
            window.currentBoardId = session.boardId;
            restored = true;
        }
    }
    const pinned = window.pinnedCreateDefaults;
    const colMeta = getUpdateColumnRestoreMeta(session, pinned);
    const colId = colMeta.columnId;
    if (colEl && colId && !colEl.disabled) {
        const colOpt = findColumnOption(colEl, colId, colMeta.columnName);
        if (colOpt) {
            colEl.value = colOpt.value;
            if (typeof window.onUpdateColumnChanged === 'function') window.onUpdateColumnChanged();
            restored = true;
        }
    }
    const cardId = session.cardId || window.updateFormRestoreCardId || '';
    const cardEl = document.getElementById('inp-target-card');
    if (cardEl && cardId && !cardEl.disabled) {
        const cardOpt = typeof findUpdateCardOption === 'function'
            ? findUpdateCardOption(cardEl, cardId)
            : Array.from(cardEl.options).find((o) => o.value === cardId);
        if (cardOpt) {
            cardEl.value = cardOpt.value;
            restored = true;
        }
    }
    return restored;
}

window.captureCreateFormSelection = captureCreateFormSelection;
window.captureUpdateFormSelection = captureUpdateFormSelection;
window.saveSessionCreateSelection = saveSessionCreateSelection;
window.saveSessionUpdateSelection = saveSessionUpdateSelection;
window.flushLastFormSelection = flushLastFormSelection;
window.flushPersistCreateDefaultsIfRemember = flushPersistCreateDefaultsIfRemember;
window.enrichPinnedDefaultsPayload = enrichPinnedDefaultsPayload;
window.readFormDefaultsSnapshot = readFormDefaultsSnapshot;
window.readCreateFormSnapshot = readCreateFormSnapshot;
window.initSessionCreateSelectionForCapture = initSessionCreateSelectionForCapture;
window.restoreCreateFormSelectionFromSession = restoreCreateFormSelectionFromSession;
window.restoreUpdateFormSelectionFromSession = restoreUpdateFormSelectionFromSession;

if (window.smartCap && window.smartCap.on) {
    window.smartCap.on('collect-create-form-snapshot', (_event, requestId) => {
        window.smartCap.send('create-form-snapshot-response', requestId, readFormDefaultsSnapshot());
    });
}
