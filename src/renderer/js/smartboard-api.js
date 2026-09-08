
    /** Как на сайте: ФИО только из GET /api/me (User.csv по IP запроса). Всегда перезаписывает currentAuthor. */
    async function refreshAuthorFromServer() {
        const name = await ipcRenderer.invoke('get-author-name').catch(() => '');
        currentAuthor = (name && String(name).trim()) ? String(name).trim() : '';
    }

    function applyPeekBoardUrl(peek) {
        if (peek) {
            boardServerUrl = peek;
            API_URL = peek.replace(/\/?$/, '') + '/api';
        }
    }

    /** Мгновенно: кэш URL из main, без HTTP. */
    async function refreshBoardServerStateQuick() {
        const peek = await ipcRenderer.invoke('peek-board-base-url').catch(() => null);
        applyPeekBoardUrl(peek);
        if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();
    }

    /** HTTP sync и списки досок — в фоне, не блокирует UI. */
    function refreshBoardServerStateInBackground() {
        void (async () => {
            const peek = boardServerUrl;
            const url = await ipcRenderer.invoke('sync-board-reachability').catch(() => null);
            if (url) {
                boardServerUrl = url;
                API_URL = url.replace(/\/?$/, '') + '/api';
            } else if (!peek) {
                boardServerUrl = null;
                API_URL = 'http://localhost:3000/api';
            }
            if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();
            await loadBoardOptions().catch(() => {});
            await refreshAuthorFromServer().catch(() => {});
        })();
    }

    /** Полное обновление (формы): peek + ожидание HTTP. */
    async function refreshBoardServerStateFromMain() {
        await refreshBoardServerStateQuick();

        const url = await ipcRenderer.invoke('sync-board-reachability').catch(() => null);
        if (url) {
            boardServerUrl = url;
            API_URL = url.replace(/\/?$/, '') + '/api';
        } else if (!boardServerUrl) {
            API_URL = 'http://localhost:3000/api';
        }

        if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();

        await Promise.all([
            loadBoardOptions().catch(() => {}),
            refreshAuthorFromServer()
        ]);
    }

    let cropperNoticeTimer = null;
    function isSmartBoardNetworkFailure(err) {
        return err instanceof TypeError || /Failed to fetch|NetworkError|network error|ECONNREFUSED/i.test(String(err && err.message));
    }
    function notifyMainSmartBoardUnreachable() {
        try { ipcRenderer.send('smartboard-request-failed'); } catch (_) {}
    }
    function showCropperNotice(text, ms = 5000) {
        const el = document.getElementById('cropper-notice');
        if (!el) return;
        el.textContent = text;
        el.style.display = 'block';
        clearTimeout(cropperNoticeTimer);
        cropperNoticeTimer = setTimeout(() => { el.style.display = 'none'; el.textContent = ''; }, ms);
        void ipcRenderer.invoke('is-capture-in-flight').then(inFlight => {
            if (!inFlight) {
                try { ipcRenderer.send('show-cropper'); } catch (e) {}
            }
        }).catch(() => {});
    }

    function getBoardApiUrl(path) {
        const suffix = currentBoardId ? `${path.includes('?') ? '&' : '?'}boardId=${encodeURIComponent(currentBoardId)}` : '';
        return `${API_URL}${path}${suffix}`;
    }

    function isPrivateBoardSelected(selectEl) {
        if (!selectEl || !selectEl.value) return false;
        const opt = selectEl.options[selectEl.selectedIndex];
        return !!(opt && opt.getAttribute('data-private') === '1');
    }

    function updateBoardPrivateLock(selectEl) {
        if (!selectEl) return;
        const lockEl = selectEl.closest('.board-select-wrap')?.querySelector('.board-private-lock');
        if (!lockEl) return;
        const isPrivate = isPrivateBoardSelected(selectEl);
        lockEl.hidden = !isPrivate;
        lockEl.title = isPrivate ? 'Приватная доска' : '';
    }

    function updateAllBoardPrivateLocks() {
        updateBoardPrivateLock(document.getElementById('inp-board-create'));
        updateBoardPrivateLock(document.getElementById('inp-board-update'));
    }

    async function loadFormUserList(boardId) {
        const id = boardId !== undefined && boardId !== null ? String(boardId).trim() : (currentBoardId || '');
        formUserList = await ipcRenderer.invoke('get-user-list', id || null).catch(() => []);
        const allowed = new Set((formUserList || []).map((n) => String(n).trim()).filter(Boolean));
        if (currentAuthor) allowed.add(currentAuthor);
        if (Array.isArray(formParticipants) && formParticipants.length) {
            formParticipants = formParticipants.filter((name) => allowed.has(name));
        }
        if (typeof renderFormParticipants === 'function' && state === 'form') renderFormParticipants();
        return formUserList;
    }

    async function loadBoardOptions(opts = {}) {
        const forCreate = opts.forCreateForm === true;
        const forUpdate = opts.forUpdateForm === true;
        const needDefaults = forCreate || forUpdate;
        const [boards, formDefaults, savedId] = await Promise.all([
            ipcRenderer.invoke('get-board-list').catch(() => []),
            needDefaults ? ipcRenderer.invoke('get-create-defaults').catch(() => null) : Promise.resolve(null),
            ipcRenderer.invoke('get-selected-board-id').catch(() => '')
        ]);
        boardOptions = Array.isArray(boards) ? boards : [];
        const createSelect = document.getElementById('inp-board-create');
        const updateSelect = document.getElementById('inp-board-update');
        const optionsHtml = boardOptions.length
            ? ('<option value="">-- Выберите доску --</option>' +
                boardOptions.map(board => {
                    const name = board.name || board.id;
                    const label = board.visibility === 'private'
                        ? `${name} (приватная)`
                        : name;
                    const privAttr = board.visibility === 'private' ? ' data-private="1"' : '';
                    return `<option value="${escapeHtmlCropper(board.id)}"${privAttr}>${escapeHtmlCropper(label)}</option>`;
                }).join(''))
            : '<option value="" disabled selected>Нет досок</option>';
        if (createSelect) createSelect.innerHTML = optionsHtml;
        if (updateSelect) updateSelect.innerHTML = optionsHtml;

        let nextBoardId = '';
        const rememberOn = !!(formDefaults && formDefaults.remember);
        if (forCreate) {
            const session = opts.useSession !== false ? window.sessionCreateSelection : null;
            nextBoardId = typeof window.resolveCreateBoardId === 'function'
                ? window.resolveCreateBoardId(session, formDefaults, rememberOn, savedId, boardOptions)
                : '';
        } else if (forUpdate) {
            const session = opts.useSession !== false ? window.sessionUpdateSelection : null;
            nextBoardId = typeof window.resolveUpdateBoardId === 'function'
                ? window.resolveUpdateBoardId(session, formDefaults, rememberOn, savedId, boardOptions)
                : '';
        } else {
            nextBoardId = (savedId && boardOptions.some((board) => board.id === savedId))
                ? savedId
                : (boardOptions[0] ? boardOptions[0].id : '');
        }

        currentBoardId = nextBoardId;
        if (createSelect) createSelect.value = currentBoardId;
        if (updateSelect) updateSelect.value = currentBoardId;
        if (forCreate) {
            const sess = opts.useSession !== false ? window.sessionCreateSelection : null;
            const meta = typeof window.getCreateColumnRestoreMeta === 'function'
                ? window.getCreateColumnRestoreMeta(sess, formDefaults)
                : { columnId: '', columnName: '' };
            if (sess && !sess.boardId) {
                window.createFormRestoreColumnId = null;
                window.createFormRestoreColumnName = '';
            } else if (meta.columnId) {
                window.createFormRestoreColumnId = meta.columnId;
                window.createFormRestoreColumnName = meta.columnName || '';
            }
        }
        if (forUpdate) {
            const sess = opts.useSession !== false ? window.sessionUpdateSelection : null;
            const meta = typeof window.getUpdateColumnRestoreMeta === 'function'
                ? window.getUpdateColumnRestoreMeta(sess, formDefaults)
                : { columnId: '', columnName: '' };
            if (sess && !sess.boardId) {
                window.updateFormRestoreColumnId = null;
                window.updateFormRestoreColumnName = '';
                window.updateFormRestoreCardId = null;
            } else if (meta.columnId) {
                window.updateFormRestoreColumnId = meta.columnId;
                window.updateFormRestoreColumnName = meta.columnName || '';
            }
            if (sess && !sess.boardId) {
                window.updateFormRestoreCardId = null;
            } else if (sess && sess.cardId) {
                window.updateFormRestoreCardId = sess.cardId;
            } else if (rememberOn && formDefaults && formDefaults.updateCardId) {
                window.updateFormRestoreCardId = formDefaults.updateCardId;
            }
        }
        updateAllBoardPrivateLocks();
        if (!forCreate && !forUpdate && currentBoardId) {
            await ipcRenderer.invoke('set-selected-board-id', currentBoardId).catch(() => {});
        }
        allCardsCache = [];
        allCardsCacheTs = 0;
        window.allCardsCacheBoardId = '';
        if (currentBoardId) await loadFormUserList(currentBoardId).catch(() => {});
        return currentBoardId;
    }

    // Когда доска запустилась — показываем кнопки и обновляем URL
    ipcRenderer.on('board-available', (event, url) => {
        if (!url) return;
        const urlChanged = boardServerUrl !== url;
        boardServerUrl = url;
        API_URL = url.replace(/\/?$/, '') + '/api';
        allCardsCache = [];
        allCardsCacheTs = 0;
        window.allCardsCacheBoardId = '';
        ipcRenderer.invoke('get-author-name').then(name => {
            currentAuthor = (name && String(name).trim()) ? String(name).trim() : '';
        }).catch(() => { currentAuthor = ''; });
        loadBoardOptions().then(() => {
            if (typeof loadFormUserList === 'function' && currentBoardId) loadFormUserList(currentBoardId);
            if (typeof loadColumns === 'function' && currentBoardId) {
                loadColumns().then(() => {
                    if (taskForm && taskForm.style.display === 'block') {
                        if (typeof window.applyCreateFormPinnedToDom === 'function') {
                            window.applyCreateFormPinnedToDom(window.pinnedCreateDefaults);
                        } else if (typeof window.restoreCreateFormSelectionFromSession === 'function') {
                            window.restoreCreateFormSelectionFromSession();
                        }
                    }
                    if (updateForm && updateForm.style.display === 'block') {
                        if (typeof window.applyUpdateFormPinnedToDom === 'function') {
                            window.applyUpdateFormPinnedToDom(window.pinnedCreateDefaults);
                        } else if (typeof window.restoreUpdateFormSelectionFromSession === 'function') {
                            window.restoreUpdateFormSelectionFromSession();
                        }
                    }
                });
            }
        }).catch(() => {
            if (typeof loadColumns === 'function' && currentBoardId) loadColumns();
        });
        if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();
        if (state === 'editing' || state === 'form') {
            showToolbars().catch(() => {});
        }
        if (!urlChanged && !currentBoardId) loadBoardOptions().catch(() => {});
    });

    // Когда доска остановлена — сбрасываем URL (кнопки «Новая» / «К старой» не скрываем)
    ipcRenderer.on('board-unavailable', () => {
        boardServerUrl = null;
        currentBoardId = '';
        currentAuthor = '';
        API_URL = 'http://localhost:3000/api';
        if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();
        if (state === 'editing' || state === 'form') {
            showToolbars().catch(() => {});
        }
    });
    function bindBoardSelectors() {
        const selectors = ['inp-board-create', 'inp-board-update']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        selectors.forEach(selectEl => {
            selectEl.addEventListener('change', async () => {
                currentBoardId = selectEl.value || '';
                selectors.forEach(other => { if (other !== selectEl) other.value = currentBoardId; });
                updateAllBoardPrivateLocks();
                allCardsCache = [];
                allCardsCacheTs = 0;
                window.allCardsCacheBoardId = '';
                await ipcRenderer.invoke('set-selected-board-id', currentBoardId).catch(() => {});
                if (typeof loadFormUserList === 'function') await loadFormUserList(currentBoardId).catch(() => {});
                if (state === 'form') {
                    if (taskForm.style.display === 'block') {
                        if (!currentBoardId) {
                            window.sessionCreateSelection = { boardId: '', columnId: '' };
                            window.createFormToggleSnapshot = null;
                            window.createFormRestoreColumnId = null;
                        } else {
                            window.sessionCreateSelection = {
                                boardId: currentBoardId,
                                columnId: ''
                            };
                        }
                        loadColumns().then(() => {
                            if (typeof saveSessionCreateSelection === 'function') saveSessionCreateSelection();
                        });
                    }
                    if (updateForm.style.display === 'block') {
                        if (!currentBoardId) {
                            window.sessionUpdateSelection = { boardId: '', columnId: '', cardId: '' };
                            window.updateFormToggleSnapshot = null;
                            window.updateFormRestoreColumnId = null;
                            window.updateFormRestoreCardId = null;
                        } else {
                            window.sessionUpdateSelection = {
                                boardId: currentBoardId,
                                columnId: '',
                                cardId: ''
                            };
                        }
                        populateUpdateSelect().then(() => {
                            if (typeof saveSessionUpdateSelection === 'function') saveSessionUpdateSelection();
                        });
                    }
                }
            });
        });
    }
    bindBoardSelectors();

    function showFioOverlay() {
        const el = document.getElementById('fio-overlay');
        if (!el) return;
        state = 'form';
        el.style.display = 'block';
        if (typeof window.positionFormNearSideBar === 'function') {
            window.positionFormNearSideBar(el);
        } else {
            positionFioForm(el);
        }
        const nameEl = document.getElementById('fio-overlay-input');
        if (nameEl) {
            nameEl.value = (currentAuthor && String(currentAuthor).trim()) ? String(currentAuthor).trim() : '';
            nameEl.focus();
        }
    }
    function hideFioOverlay(clearPending = true) {
        const el = document.getElementById('fio-overlay');
        if (el) el.style.display = 'none';
        if (state === 'form') state = 'editing';
        if (clearPending) pendingFormAction = null;
    }
    window.hideFioOverlay = hideFioOverlay;

    let _sidebarLayoutCache = null;
    let _sidebarLayoutCacheTime = 0;
    const SIDEBAR_LAYOUT_CACHE_MS = 400;

    function invalidateSidebarLayoutCache() {
        _sidebarLayoutCache = null;
    }

    function readSidebarLayoutMetrics() {
        const now = performance.now();
        if (_sidebarLayoutCache && (now - _sidebarLayoutCacheTime) < SIDEBAR_LAYOUT_CACHE_MS) {
            return _sidebarLayoutCache;
        }
        const sbRect = sideBar.getBoundingClientRect();
        _sidebarLayoutCache = {
            sbRect,
            screenW: window.innerWidth,
            screenH: window.innerHeight
        };
        _sidebarLayoutCacheTime = now;
        return _sidebarLayoutCache;
    }

    window.addEventListener('resize', invalidateSidebarLayoutCache);

    function positionFioForm(form) {
        const { sbRect, screenW, screenH } = readSidebarLayoutMetrics();
        const formW = form.offsetWidth || 320;
        const formH = form.offsetHeight || 200;
        const gap = 10;
        const layout = window.floatEditLayout;
        const inFloat = document.body.classList.contains('float-edit') && layout;

        let fLeft;
        const spaceRight = screenW - sbRect.right;
        const preferRight = inFloat
            ? layout.formPreferRight !== false
            : spaceRight >= formW + gap;

        if (preferRight && spaceRight >= formW + gap) {
            fLeft = sbRect.right + gap;
        } else {
            fLeft = sbRect.left - formW - gap;
        }
        if (fLeft < gap) fLeft = gap;
        if (fLeft + formW > screenW - gap) fLeft = screenW - formW - gap;

        let fTop = sbRect.top;
        if (fTop + formH > screenH - gap) {
            fTop = screenH - formH - gap;
        }
        if (fTop < gap) fTop = gap;

        form.style.left = Math.round(fLeft) + 'px';
        form.style.top = Math.round(fTop) + 'px';
    }
    function initDateInputs() {
        const d = new Date();
        const localISO = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        document.querySelectorAll('input[type="date"]').forEach(input => {
            input.setAttribute('min', localISO);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDateInputs);
    } else {
        initDateInputs();
    }
    document.getElementById('fio-overlay-ok').addEventListener('click', async () => {
        const input = document.getElementById('fio-overlay-input');
        const v = (input && input.value) ? input.value.trim() : '';
        const err = validateFioCropper(v);
        if (err) { showCropperNotice(err, 6000); return; }

        const okBtn = document.getElementById('fio-overlay-ok');
        if (okBtn) okBtn.disabled = true;
        try {
            const connected = await ipcRenderer.invoke('set-board-server-url', '');
            if (!connected || !connected.ok || !connected.url) {
                showCropperNotice((connected && connected.error) || 'Не удалось подключиться к доске.', 7000);
                return;
            }
            boardServerUrl = connected.url;
            API_URL = connected.url.replace(/\/?$/, '') + '/api';
            if (typeof updateSmartBoardButtonsState === 'function') updateSmartBoardButtonsState();

            const r = await fetch(`${API_URL}/register-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: v })
            });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                showCropperNotice(d.error || 'Ошибка регистрации', 6000);
                return;
            }
        } catch (e) {
            if (isSmartBoardNetworkFailure(e)) notifyMainSmartBoardUnreachable();
            showCropperNotice('Ошибка сети. Проверьте, что доска доступна.', 6000);
            return;
        } finally {
            if (okBtn) okBtn.disabled = false;
        }

        currentAuthor = v;
        const nextAction = pendingFormAction;
        hideFioOverlay(false);
        pendingFormAction = null;

        await loadBoardOptions({ forCreateForm: nextAction === 'create', forUpdateForm: nextAction === 'update', useSession: true }).catch(() => {});
        if (nextAction === 'create') {
            await openCreateForm();
        } else if (nextAction === 'update') {
            await openUpdateForm();
        }
    });
    const fioCancelBtn = document.getElementById('fio-overlay-cancel');
    if (fioCancelBtn) {
        fioCancelBtn.addEventListener('click', () => hideFioOverlay());
    }
    const fioInput = document.getElementById('fio-overlay-input');
    if (fioInput) {
        fioInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('fio-overlay-ok').click();
            }
        });
    }
