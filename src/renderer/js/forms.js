    let isLoadingColumnsData = false;

    async function openCreateForm() {
        if (typeof window.ensureFloatFormsOnBody === 'function') window.ensureFloatFormsOnBody();
        if (typeof window.enterFloatMoveMode === 'function') window.enterFloatMoveMode();
        const defs = await ipcRenderer.invoke('get-create-defaults').catch(() => null);
        if (typeof window.ensureSessionFromPinnedDefaults === 'function') {
            window.ensureSessionFromPinnedDefaults(defs);
        }
        const session = window.sessionCreateSelection;
        window.createFormRestoreColumnId = typeof window.resolveCreateColumnRestoreId === 'function'
            ? window.resolveCreateColumnRestoreId(session, defs)
            : ((session && session.columnId) || (defs && defs.remember && defs.columnId) || null);
        if (defs && defs.remember && defs.columnName) {
            window.createFormRestoreColumnName = defs.columnName;
        }
        window.createFormUsedThisSession = true;
        state = 'form';
        updateForm.style.display = 'none';
        taskForm.style.display = 'block';
        if (settingsForm) settingsForm.style.display = 'none';
        await loadBoardOptions({ forCreateForm: true, useSession: true }).catch(() => {});
        formParticipants = [];
        renderFormParticipants();
        if (typeof loadFormUserList === 'function') await loadFormUserList(currentBoardId).catch(() => {});
        else ipcRenderer.invoke('get-user-list', currentBoardId || null).then(names => { formUserList = names || []; renderFormParticipants(); });
        await loadColumns();
        if (typeof window.applyCreateFormPinnedToDom === 'function') {
            window.applyCreateFormPinnedToDom(defs || window.pinnedCreateDefaults);
        } else if (typeof window.restoreCreateFormSelectionFromSession === 'function') {
            window.restoreCreateFormSelectionFromSession();
        }
        positionForm(taskForm);
        if (!currentBoardId) {
            const sel = document.getElementById('inp-board-create');
            if (sel) setTimeout(() => { try { sel.focus(); } catch (e) {} }, 120);
        } else {
            document.getElementById('inp-title').focus();
        }
    }

    async function openUpdateForm() {
        if (typeof window.ensureFloatFormsOnBody === 'function') window.ensureFloatFormsOnBody();
        if (typeof window.enterFloatMoveMode === 'function') window.enterFloatMoveMode();
        const defs = await ipcRenderer.invoke('get-create-defaults').catch(() => null);
        if (typeof window.ensureSessionFromPinnedDefaults === 'function') {
            window.ensureSessionFromPinnedDefaults(defs);
        }
        const session = window.sessionUpdateSelection;
        window.updateFormRestoreColumnId = typeof window.resolveUpdateColumnRestoreId === 'function'
            ? window.resolveUpdateColumnRestoreId(session, defs)
            : ((session && session.columnId) || (defs && defs.remember && defs.updateColumnId) || null);
        if (session && session.cardId) {
            window.updateFormRestoreCardId = session.cardId;
        } else if (defs && defs.remember && defs.updateCardId) {
            window.updateFormRestoreCardId = defs.updateCardId;
        }
        if (defs && defs.remember && defs.updateColumnName) {
            window.updateFormRestoreColumnName = defs.updateColumnName;
        }
        window.updateFormUsedThisSession = true;
        state = 'form';
        taskForm.style.display = 'none';
        updateForm.style.display = 'block';
        if (settingsForm) settingsForm.style.display = 'none';
        await loadBoardOptions({ forUpdateForm: true, useSession: true }).catch(() => {});
        positionForm(updateForm);
        await populateUpdateSelect();
        if (typeof window.applyUpdateFormPinnedToDom === 'function') {
            window.applyUpdateFormPinnedToDom(defs || window.pinnedCreateDefaults);
        } else if (typeof window.restoreUpdateFormSelectionFromSession === 'function') {
            window.restoreUpdateFormSelectionFromSession();
        }
        if (!currentBoardId) {
            const sel = document.getElementById('inp-board-update');
            if (sel) setTimeout(() => { try { sel.focus(); } catch (e) {} }, 120);
        }
    }

    function openSettingsForm() {
        if (typeof window.ensureFloatFormsOnBody === 'function') window.ensureFloatFormsOnBody();
        if (typeof window.enterFloatMoveMode === 'function') window.enterFloatMoveMode();
        const createWasOpen = taskForm && taskForm.style.display === 'block';
        const updateWasOpen = updateForm && updateForm.style.display === 'block';
        if (createWasOpen && typeof saveSessionCreateSelection === 'function') saveSessionCreateSelection();
        if (updateWasOpen && typeof saveSessionUpdateSelection === 'function') saveSessionUpdateSelection();
        const openPanel = async () => {
            if (typeof flushPersistCreateDefaultsIfRemember === 'function') {
                await flushPersistCreateDefaultsIfRemember();
            }
            if (typeof refreshCropperSettingsPanel === 'function') {
                await refreshCropperSettingsPanel();
            }
            positionForm(settingsForm);
        };
        state = 'form';
        taskForm.style.display = 'none';
        updateForm.style.display = 'none';
        if (settingsForm) settingsForm.style.display = 'block';
        positionForm(settingsForm);
        if (typeof switchSettingsTab === 'function') {
            switchSettingsTab(settingsForm, 'board', settingsForm.id === 'settings-form' ? 'cropper-' : '');
        }
        void openPanel();
    }

    document.getElementById('btn-open-form').addEventListener('click', async (e) => {
        e.stopPropagation();
        await refreshBoardServerStateFromMain().catch(() => {});
        try {
            const name = await ipcRenderer.invoke('get-author-name').catch(() => '');
            currentAuthor = (name && name.trim()) ? name.trim() : '';
        } catch (e) {
            currentAuthor = '';
        }

        if (!boardServerUrl || !currentAuthor) {
            pendingFormAction = 'create';
            showFioOverlay();
            return;
        }
        await openCreateForm();
    });

    document.getElementById('btn-open-update').addEventListener('click', async (e) => {
        e.stopPropagation();
        await refreshBoardServerStateFromMain().catch(() => {});
        try {
            const name = await ipcRenderer.invoke('get-author-name').catch(() => '');
            currentAuthor = (name && name.trim()) ? name.trim() : '';
        } catch (e) {
            currentAuthor = '';
        }

        if (!boardServerUrl || !currentAuthor) {
            pendingFormAction = 'update';
            showFioOverlay();
            return;
        }
        await openUpdateForm();
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
        openSettingsForm();
    });

    function ensureFormsOnBody() {
        [taskForm, updateForm, settingsForm].forEach((form) => {
            if (!form || form.style.display === 'none') return;
            if (form.parentNode !== document.body) {
                document.body.appendChild(form);
            }
        });
    }

    function scheduleRepositionOpenForm() {
        if (state !== 'form') return;
        requestAnimationFrame(() => {
            if (typeof window.repositionOpenForm === 'function') {
                window.repositionOpenForm();
            }
        });
    }

    function measureFormHeight(form, inFloat) {
        if (!form) return inFloat ? 420 : 200;
        const measured = Math.max(form.scrollHeight, form.offsetHeight, form.getBoundingClientRect().height);
        const minH = inFloat ? 420 : 200;
        const maxH = Math.max(minH, window.innerHeight - 16);
        return Math.min(Math.max(measured, minH), maxH);
    }

    function measureFormWidth(form) {
        const fallback = form && form.id === 'settings-form' ? 320 : 300;
        return Math.max(form ? form.offsetWidth : 0, fallback);
    }

    function positionForm(form) {
        if (!form || !sideBar) return;
        ensureFormsOnBody();
        const inFloat = document.body.classList.contains('float-edit');

        if (inFloat && window.floatEditLayout) {
            if (typeof window.applyFloatEditToolbarLayout === 'function') {
                window.applyFloatEditToolbarLayout(window.floatEditLayout);
            }
        }

        const gap = 10;

        const apply = () => {
            const sbRect = sideBar.getBoundingClientRect();
            const formW = measureFormWidth(form);
            const formH = measureFormHeight(form, inFloat);
            const screenW = window.innerWidth;
            const screenH = window.innerHeight;

            let fLeft;
            if (inFloat) {
                fLeft = sbRect.right + gap;
            } else if (screenW - sbRect.right >= formW + gap) {
                fLeft = sbRect.right + gap;
            } else {
                fLeft = sbRect.left - formW - gap;
            }

            let fTop = sbRect.top;
            if (fTop + formH > screenH - gap) fTop = Math.max(gap, screenH - formH - gap);
            if (fTop < gap) fTop = gap;

            if (!inFloat) {
                if (fLeft < gap) fLeft = gap;
                if (fLeft + formW > screenW - gap) fLeft = screenW - formW - gap;
            }

            form.style.left = Math.round(fLeft) + 'px';
            form.style.top = Math.round(fTop) + 'px';
        };

        const finish = () => {
            if (inFloat && window.floatEditLayout) {
                if (typeof window.applyFloatEditToolbarLayout === 'function') {
                    window.applyFloatEditToolbarLayout(window.floatEditLayout);
                }
                if (typeof window.applyFloatEditChrome === 'function') {
                    window.applyFloatEditChrome(window.floatEditLayout);
                }
            }
            apply();
            requestAnimationFrame(() => {
                apply();
                if (inFloat && window.floatEditLayout && typeof window.applyFloatEditToolbarLayout === 'function') {
                    window.applyFloatEditToolbarLayout(window.floatEditLayout);
                }
            });
        };

        const measureFormBounds = () => {
            const sbRect = sideBar.getBoundingClientRect();
            const formW = measureFormWidth(form);
            const formH = measureFormHeight(form, true);
            const gapX = 16;
            const gapY = 40;
            return {
                neededRight: sbRect.right + gapX + formW + gapX,
                neededBottom: sbRect.top + formH + gapY
            };
        };

        const ensureFloatWindowFitsForm = () => new Promise((resolve) => {
            const tryExpand = (attempt) => {
                const { neededRight, neededBottom } = measureFormBounds();
                if (neededRight <= window.innerWidth + 2 && neededBottom <= window.innerHeight + 2) {
                    resolve();
                    return;
                }
                if (attempt >= 4) {
                    resolve();
                    return;
                }
                ipcRenderer.invoke('float-window-ensure-bounds', neededRight, neededBottom)
                    .then(() => {
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => tryExpand(attempt + 1));
                        });
                    })
                    .catch(() => resolve());
            };
            requestAnimationFrame(() => setTimeout(() => tryExpand(0), 30));
        });

        if (inFloat) {
            apply();
            void ensureFloatWindowFitsForm().then(finish);
            return;
        }
        finish();
    }

    window.ensureFloatFormsOnBody = ensureFormsOnBody;
    window.ensureFormsOnBody = ensureFormsOnBody;
    window.positionFormNearSideBar = positionForm;

    window.repositionOpenForm = function () {
        if (taskForm && taskForm.style.display !== 'none') positionForm(taskForm);
        else if (updateForm && updateForm.style.display !== 'none') positionForm(updateForm);
        else if (settingsForm && settingsForm.style.display !== 'none') positionForm(settingsForm);
    };

    function renderFormParticipants() {
        const list = document.getElementById('form-participants-list');
        if (!list) return;
        const chips = [];
        if (currentAuthor) chips.push('<span class="form-participant-chip form-participant-creator" title="Создатель">' + escapeHtmlCropper(currentAuthor) + '</span>');
        formParticipants.forEach(name => {
            chips.push('<span class="form-participant-chip">' + escapeHtmlCropper(name) + ' <button type="button" class="form-participant-remove" data-name="' + escapeHtmlCropper(name) + '" onclick="removeFormParticipant(this)">×</button></span>');
        });
        list.innerHTML = chips.length ? chips.join('') : '<span class="form-participants-empty">Вы (создатель) будете добавлены автоматически</span>';
        const sel = document.getElementById('form-participant-select');
        if (sel) {
            const existing = new Set([currentAuthor, ...formParticipants].filter(Boolean));
            sel.innerHTML = '<option value="">— Выберите —</option>' + (formUserList || []).filter(n => !existing.has(n)).map(n => '<option value="' + escapeHtmlCropper(n) + '">' + escapeHtmlCropper(n) + '</option>').join('');
        }
        scheduleRepositionOpenForm();
    }
    function escapeHtmlCropper(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function removeFormParticipant(btnEl) {
        const name = (btnEl.dataset && btnEl.dataset.name) ? btnEl.dataset.name : '';
        if (!name) return;
        formParticipants = formParticipants.filter(p => p !== name);
        renderFormParticipants();
    }
    window.removeFormParticipant = removeFormParticipant;

    (function initFormParticipantsUI() {
        const addBtn = document.getElementById('form-add-participant-btn');
        const sel = document.getElementById('form-participant-select');
        if (!addBtn || !sel) return;
        addBtn.addEventListener('click', () => {
            sel.style.display = sel.style.display === 'none' ? 'inline-block' : 'none';
            if (sel.style.display !== 'none' && formUserList.length === 0) {
                const loader = typeof loadFormUserList === 'function'
                    ? loadFormUserList(currentBoardId)
                    : ipcRenderer.invoke('get-user-list', currentBoardId || null).then(names => { formUserList = names || []; });
                loader.then(() => {
                    renderFormParticipants();
                    if (sel.style.display !== 'none') sel.focus();
                });
            } else {
                renderFormParticipants();
                if (sel.style.display !== 'none') sel.focus();
            }
            scheduleRepositionOpenForm();
        });
        sel.addEventListener('change', () => {
            const v = sel.value.trim();
            if (v && !formParticipants.includes(v) && v !== currentAuthor) {
                formParticipants.push(v);
                renderFormParticipants();
            }
            sel.value = '';
        });
    })();

    function validateFioCropper(v) {
        const t = (v || '').trim();
        if (t.length < 2) return 'Введите никнейм (не менее 2 символов).';
        return null;
    }
    // --- ОТПРАВКА НА СЕРВЕР ---
    document.getElementById('form-submit').addEventListener('click', async () => {
    const title = document.getElementById('inp-title').value;
    if (!title) { showCropperNotice('Введите название задачи.', 5000); return; }
    if (!currentBoardId) {
        showCropperNotice('Выберите доску в списке «Доска» или создайте доску в SmartBoard.', 7000);
        const b = document.getElementById('inp-board-create');
        if (b) setTimeout(() => { try { b.focus(); } catch (e) {} }, 80);
        return;
    }
    const colEl = document.getElementById('inp-column');
    const colOpt = colEl && colEl.selectedIndex >= 0 ? colEl.options[colEl.selectedIndex] : null;
    const columnVal = colEl ? colEl.value : '';
    if (!columnVal || (colOpt && colOpt.disabled)) {
        showCropperNotice('Выберите колонку или дождитесь загрузки списка колонок.', 6000);
        if (colEl) setTimeout(() => { try { colEl.focus(); } catch (e) {} }, 80);
        return;
    }
    const author = (currentAuthor && currentAuthor.trim()) ? currentAuthor.trim() : '';
    if (!author) { showCropperNotice('Зарегистрируйтесь: введите никнейм и IP доски.', 6000); return; }
    const err = validateFioCropper(author);
    if (err) { showCropperNotice(err, 6000); return; }
    const participants = [...new Set([author, ...formParticipants].filter(Boolean))];

    await sendData('/ticket', {
        title: title,
        column: columnVal,
        desc: document.getElementById('inp-desc').value,
        deadline: document.getElementById('inp-date').value,
        author: author,
        email: '',
        participants: participants
    }, 'form-submit');
});

    document.getElementById('form-update-submit').addEventListener('click', async () => {
        if (!currentBoardId) {
            showCropperNotice('Выберите доску в списке или создайте доску в SmartBoard.', 7000);
            const b = document.getElementById('inp-board-update');
            if (b) setTimeout(() => { try { b.focus(); } catch (e) {} }, 80);
            return;
        }
        const select = document.getElementById('inp-target-card');
        if(select.selectedIndex === 0 || select.disabled) return; 
        const option = select.options[select.selectedIndex];
        await sendData('/update-ticket', {
            relPath: option.getAttribute('data-relpath') || option.value,
        }, 'form-update-submit');
    });

    async function sendData(endpoint, extraData, btnId) {
        const base64 = await window.getCroppedBase64Async();
        if (!base64) return;

        const btn = document.getElementById(btnId);
        if (!btn || btn.disabled) return;
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Загрузка...';
        btn.disabled = true;
        btn.style.pointerEvents = 'none';

        try {
            const res = await fetch(`${API_URL}${endpoint}`, { 
                method: 'POST', headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ ...extraData, image: base64, boardId: currentBoardId }) 
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `Ошибка сервера: ${res.status}`);
            }
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.pointerEvents = 'auto';
            if (typeof closeCropper === 'function') closeCropper();
            else ipcRenderer.send('close-cropper');
        } catch(e) {
            console.error(e);
            if (isSmartBoardNetworkFailure(e)) notifyMainSmartBoardUnreachable();
            btn.innerHTML = 'Ошибка: ' + (e.message || '?');
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.pointerEvents = 'auto';
            }, 3000);
        }
    }

    function fillColumnSelectors(data) {
        const selCreate = document.getElementById('inp-column');
        const selUpdCol = document.getElementById('inp-upd-col');
        const cardSel = document.getElementById('inp-target-card');
        showUpdateFormLoading(false);
        if (!selCreate || !selUpdCol) return;
        // Сохраняем выбор пользователя (при обновлении данных не сбрасывать)
        const savedCol = selUpdCol.value;
        const savedCard = cardSel ? cardSel.value : '';
        const formVisible = updateForm.style.display === 'block';
        selCreate.innerHTML = '';
        selUpdCol.innerHTML = '<option value="">-- Выберите колонку --</option>';
        selUpdCol.disabled = false;
        selUpdCol.style.opacity = '1';
        if (!data || data.length === 0) {
            selCreate.innerHTML = '<option value="" disabled selected>Нет столбцов</option>';
        } else {
            data.forEach(c => {
                const colId = c.folder || c.name;
                const colDisplay = c.name;
                const o1 = document.createElement('option');
                o1.value = colId;
                o1.innerText = colDisplay;
                o1.setAttribute('data-folder', colId);
                selCreate.appendChild(o1);
                const o2 = document.createElement('option'); o2.value = colId; o2.innerText = colDisplay; o2.setAttribute('data-folder', colId); selUpdCol.appendChild(o2);
            });
        }
        // Восстанавливаем выбор из сессии или текущего DOM
        const session = window.sessionUpdateSelection;
        const restoreUpdateCol = (updateForm && updateForm.style.display === 'block' && session && session.columnId)
            ? session.columnId
            : window.updateFormRestoreColumnId;
        const restoreUpdateCard = (updateForm && updateForm.style.display === 'block' && session && session.cardId)
            ? session.cardId
            : window.updateFormRestoreCardId;
        const updateFormOpen = updateForm && updateForm.style.display === 'block';
        const findCard = typeof findUpdateCardOption === 'function'
            ? findUpdateCardOption
            : (cardSel, cardId) => Array.from(cardSel.options).find((o) => o.value === cardId);
        if (updateFormOpen && restoreUpdateCol) {
            const pinnedUpd = window.pinnedCreateDefaults;
            const updMeta = typeof window.getUpdateColumnRestoreMeta === 'function'
                ? window.getUpdateColumnRestoreMeta(session, pinnedUpd)
                : { columnId: restoreUpdateCol, columnName: window.updateFormRestoreColumnName || '' };
            const colOpt = typeof window.findColumnOption === 'function'
                ? window.findColumnOption(selUpdCol, updMeta.columnId || restoreUpdateCol, updMeta.columnName)
                : Array.from(selUpdCol.options).find((o) => o.value === restoreUpdateCol);
            if (colOpt) {
                selUpdCol.value = colOpt.value;
                onUpdateColumnChanged();
                if (restoreUpdateCard && cardSel) {
                    const cardOpt = findCard(cardSel, restoreUpdateCard);
                    if (cardOpt) cardSel.value = cardOpt.value;
                }
            }
        } else if (formVisible && savedCol) {
            const colOpt = Array.from(selUpdCol.options).find(o => o.value === savedCol);
            if (colOpt) {
                selUpdCol.value = savedCol;
                onUpdateColumnChanged();
                if (savedCard && cardSel) {
                    const cardOpt = findCard(cardSel, savedCard);
                    if (cardOpt) cardSel.value = cardOpt.value;
                }
            }
        }
        const createFormOpen = taskForm && taskForm.style.display === 'block';
        const pinned = window.pinnedCreateDefaults;
        const colMeta = typeof window.getCreateColumnRestoreMeta === 'function'
            ? window.getCreateColumnRestoreMeta(window.sessionCreateSelection, pinned)
            : {
                columnId: window.createFormRestoreColumnId
                    || (window.sessionCreateSelection && window.sessionCreateSelection.columnId)
                    || '',
                columnName: window.createFormRestoreColumnName || ''
            };
        const restoreCreateCol = createFormOpen ? (colMeta.columnId || null) : null;
        if (restoreCreateCol && createFormOpen) {
            const createColOpt = typeof window.findColumnOption === 'function'
                ? window.findColumnOption(selCreate, restoreCreateCol, colMeta.columnName)
                : Array.from(selCreate.options).find((o) => o.value === restoreCreateCol);
            if (createColOpt) {
                selCreate.value = createColOpt.value;
                if (typeof saveSessionCreateSelection === 'function') saveSessionCreateSelection();
            }
        }
    }

    (function bindCreateColumnSession() {
        const colEl = document.getElementById('inp-column');
        if (!colEl) return;
        colEl.addEventListener('change', () => {
            if (taskForm && taskForm.style.display === 'block' && typeof saveSessionCreateSelection === 'function') {
                saveSessionCreateSelection();
            }
        });
    })();

    (function bindUpdateFormSession() {
        const colEl = document.getElementById('inp-upd-col');
        const cardEl = document.getElementById('inp-target-card');
        const saveUpdate = () => {
            if (updateForm && updateForm.style.display === 'block' && typeof saveSessionUpdateSelection === 'function') {
                saveSessionUpdateSelection();
            }
        };
        if (colEl) colEl.addEventListener('change', saveUpdate);
        if (cardEl) cardEl.addEventListener('change', saveUpdate);
    })();

    async function loadColumns() {
        if (!currentBoardId) {
            const sel = document.getElementById('inp-column');
            const selUpdCol = document.getElementById('inp-upd-col');
            const unavailableText = 'Сначала выберите доску';
            if (sel) sel.innerHTML = `<option value="" disabled selected>${unavailableText}</option>`;
            if (selUpdCol) {
                selUpdCol.innerHTML = `<option value="" disabled selected>${unavailableText}</option>`;
                selUpdCol.disabled = true;
                selUpdCol.style.opacity = '0.75';
            }
            showUpdateFormLoading(false);
            return;
        }
        if (allCardsCache.length > 0 &&
            window.allCardsCacheBoardId === currentBoardId &&
            (Date.now() - allCardsCacheTs) < COLUMNS_CACHE_MS) {
            fillColumnSelectors(allCardsCache);
            return;
        }

        if (isLoadingColumnsData) return;
        isLoadingColumnsData = true;

        const reqBoardId = currentBoardId;

        const selUpdCol = document.getElementById('inp-upd-col');
        if (selUpdCol && updateForm.style.display === 'block') {
            selUpdCol.innerHTML = '<option value="">Загрузка колонок...</option>';
            selUpdCol.disabled = true;
            selUpdCol.style.opacity = '0.8';
            showUpdateFormLoading(true);
        }
        try {
            const res = await fetch(getBoardApiUrl('/board'));
            if (!res.ok) throw new Error('board-load-failed');
            const json = await res.json();
            if (currentBoardId !== reqBoardId) return;
            const data = Array.isArray(json) ? json : (json.columns || json.board || []);
            allCardsCache = data;
            allCardsCacheTs = Date.now();
            window.allCardsCacheBoardId = reqBoardId;
            fillColumnSelectors(data);
        } catch (e) {
            if (isSmartBoardNetworkFailure(e)) notifyMainSmartBoardUnreachable();
            showUpdateFormLoading(false);
            const sel = document.getElementById('inp-column');
            if (sel) sel.innerHTML = '<option disabled>Ошибка загрузки</option>';
            if (selUpdCol) {
                selUpdCol.innerHTML = '<option value="">Ошибка загрузки</option>';
                selUpdCol.disabled = false;
                selUpdCol.style.opacity = '1';
            }
        } finally {
            isLoadingColumnsData = false;
        }
    }

    function onUpdateColumnChanged() {
        const colId = document.getElementById('inp-upd-col').value;
        const cardSel = document.getElementById('inp-target-card');
        if (!cardSel) return;
        cardSel.innerHTML = '<option value="">-- Выберите карточку --</option>';
        cardSel.disabled = true; cardSel.style.opacity = "0.5";
        if (!colId) return;
        
        const columnData = allCardsCache.find(c => (c.folder || c.name) === colId);
        const tasks = columnData && Array.isArray(columnData.tasks) ? columnData.tasks : [];
        if (tasks.length > 0) {
            cardSel.disabled = false; cardSel.style.opacity = "1";
            tasks.forEach(t => {
                const opt = document.createElement('option'); 
                opt.value = t.relPath || (colId + '/' + (t.taskId || t.title)); 
                opt.innerText = t.title; 
                opt.setAttribute('data-relpath', t.relPath || ''); 
                cardSel.appendChild(opt);
            });
        } else { cardSel.innerHTML = '<option>Нет карточек</option>'; }
    }

    // Глобальная функция для HTML onchange
    window.onUpdateColumnChanged = onUpdateColumnChanged;

    function showUpdateFormLoading(show) {
        const el = document.getElementById('update-form-loading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    async function populateUpdateSelect() {
        const cardSel = document.getElementById('inp-target-card');
        const colSel = document.getElementById('inp-upd-col');
        const unavailableText = 'Сначала колонку...';
        if (cardSel) { cardSel.innerHTML = `<option>${unavailableText}</option>`; cardSel.disabled = true; cardSel.style.opacity = '0.5'; }
        if (colSel) { colSel.innerHTML = '<option value="">Загрузка колонок...</option>'; colSel.disabled = true; colSel.style.opacity = '0.8'; }
        showUpdateFormLoading(true);
        await loadColumns();
    }

    document.getElementById('btn-cancel').addEventListener('click', () => {
        if (typeof closeCropper === 'function') closeCropper();
        else ipcRenderer.send('close-cropper');
    });
