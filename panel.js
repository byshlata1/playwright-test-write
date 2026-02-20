// Логика UI панели DevTools

let currentState = {
  recording: false,
  startUrl: null,
  actions: [],
  testSteps: [],
  mocks: [],
  failedRequests: [],
  waitingForRequests: false,
};

let editingMockUrl = null;
let editingExpectActionIndex = null;
let editingExpectMode = null; // 'expect' | 'custom'
let editingExpectRows = []; // { assertion, value?, custom? }

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    try {
      if (!chrome?.runtime?.id) {
        reject(new Error('Extension context invalidated. Reload DevTools.'));
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Extension context invalidated'));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, max) {
  if (str == null) return '';
  const s = String(str);
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function showToast(message) {
  try {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2000);
  } catch (_) {}
}

function setupEventListeners() {
  document.getElementById('btn-start').addEventListener('click', startRecording);
  document.getElementById('btn-stop').addEventListener('click', stopRecording);
  document.getElementById('btn-clear').addEventListener('click', clearAll);
  document.getElementById('btn-add-to-test').addEventListener('click', addToTest);
  document.getElementById('checkbox-capture-all').addEventListener('change', onCaptureAllChange);
  chrome.storage.local.get('captureAllClicks', (r) => {
    const cb = document.getElementById('checkbox-capture-all');
    if (cb) cb.checked = !!r.captureAllClicks;
  });
  document.getElementById('btn-generate').addEventListener('click', generateCode);
  document.getElementById('btn-save').addEventListener('click', saveToFolder);
  document.getElementById('btn-save-mock').addEventListener('click', saveMockEdit);
  document.getElementById('btn-cancel-edit').addEventListener('click', closeEditModal);
  document.getElementById('btn-expect-save').addEventListener('click', saveExpectModal);
  document.getElementById('btn-expect-cancel').addEventListener('click', closeExpectModal);
  document.getElementById('btn-expect-add-assertion').addEventListener('click', () => addExpectRow('assertion'));
  document.getElementById('btn-expect-add-custom').addEventListener('click', () => addExpectRow('custom'));
}

function startRecording() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.tabs.get(tabId, (tab) => {
    const startUrl = tab?.url || null;
    sendToBackground({ type: 'START_RECORDING', startUrl, tabId })
      .then(() => {
        currentState.recording = true;
        currentState.startUrl = startUrl;
        updateUI(currentState);
      })
      .catch((e) => showToast(e?.message || 'Error'));
  });
}

function stopRecording() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  sendToBackground({ type: 'STOP_RECORDING', tabId })
    .then(() => {
      currentState.recording = false;
      updateUI(currentState);
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

function onCaptureAllChange() {
  const checked = document.getElementById('checkbox-capture-all').checked;
  chrome.storage.local.set({ captureAllClicks: checked });
}

function addToTest() {
  sendToBackground({ type: 'ADD_TO_TEST' })
    .then(() => {
      showToast('Actions added to test');
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

function clearAll() {
  sendToBackground({ type: 'CLEAR_ALL' })
    .then(() => {
      document.getElementById('code-preview').textContent = '';
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

function refreshState() {
  sendToBackground({ type: 'GET_STATE' })
    .then((state) => {
      if (!state) return;
      currentState = {
        recording: state.recording ?? false,
        startUrl: state.startUrl ?? null,
        actions: state.actions ?? [],
        testSteps: state.testSteps ?? [],
        mocks: state.mocks ?? [],
        failedRequests: state.failedRequests ?? [],
        waitingForRequests: state.waitingForRequests ?? false,
      };
      updateUI(currentState);
    })
    .catch(() => {});
}

function updateUI(state) {
  const statusEl = document.getElementById('status');
  if (state.waitingForRequests) {
    statusEl.textContent = 'Waiting for requests...';
  } else {
    statusEl.textContent = state.recording ? 'Recording...' : 'Ready';
  }
  statusEl.classList.toggle('recording', state.recording);

  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnAddToTest = document.getElementById('btn-add-to-test');
  btnStart.disabled = state.recording;
  btnStop.disabled = !state.recording;
  btnAddToTest.disabled = !state.recording || state.actions.length === 0;

  document.getElementById('count-actions').textContent = state.actions.length;
  document.getElementById('count-mocks').textContent = state.mocks.length;
  document.getElementById('count-failed').textContent = (state.mocks || []).filter((m) => m.failed).length;

  renderMocks(state.mocks);
  renderActions(state.actions);
  renderFailed(state.failedRequests);

  if (state.recording) {
    const testName = document.getElementById('input-testname')?.value || 'recorded-test';
    const code = generateTestCode(testName, state.mocks, state.testSteps, state.startUrl);
    const preview = document.getElementById('code-preview');
    if (preview) preview.textContent = code;
  }
}

function renderMocks(mocks) {
  const ul = document.getElementById('list-mocks');
  if (!mocks || mocks.length === 0) {
    ul.innerHTML = '<li class="empty">No mocks captured yet</li>';
    return;
  }
  ul.innerHTML = mocks
    .map(
      (m) => {
        const status = m.status || (m.failed ? 500 : 200);
        const statusClass = status >= 500 ? 'status-5xx' : status >= 400 ? 'status-4xx' : 'status-2xx';
        const failedBadge = m.failed ? '<span class="failed-badge" title="Failed request">⚠</span>' : '';
        return `
    <li class="mock-item ${m.failed ? 'mock-failed' : ''}">
      <span class="method">${escapeHtml(m.method || 'GET')}</span>
      <span class="status-code ${statusClass}">${escapeHtml(String(status))}</span>
      <span class="filename" title="${escapeHtml(m.url)}">${escapeHtml(truncate(m.filename || m.url, 40))}</span>
      ${failedBadge}
      <button class="btn btn-small btn-edit-mock" data-url="${escapeHtml(m.url)}">Edit</button>
    </li>
  `;
      }
    )
    .join('');

  ul.querySelectorAll('.btn-edit-mock').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.url));
  });
}

function actionCanHaveExpect(a) {
  return a && (a.locatorInfo || a.selector) && a.type !== 'route' && a.type !== 'expectRequest' && a.type !== 'goto';
}

function getActionLocatorDisplay(a) {
  const method = locatorMethodStr(a.locatorInfo);
  if (method) {
    let result = method;
    if (a.innerLocatorInfo) {
      const inner = locatorMethodStr(a.innerLocatorInfo);
      if (inner) result += '.' + inner;
    }
    return result;
  }
  return a.selector || '';
}

function renderActions(actions) {
  const ul = document.getElementById('list-actions');
  if (!actions || actions.length === 0) {
    ul.innerHTML = '<li class="empty">No actions recorded</li>';
    return;
  }
  const items = [];
  actions.forEach((a, i) => {
    items.push({ type: 'action', action: a, index: i });
    (a.expects || []).forEach((ex, exIdx) => {
      items.push({ type: 'expect', action: a, actionIndex: i, expect: ex, expectIndex: exIdx });
    });
  });
  ul.innerHTML = items
    .map((item) => {
      if (item.type === 'expect') {
        const ex = item.expect;
        const label = ex.custom != null
          ? (ex.not ? 'not. ' : '') + truncate(ex.custom, 50)
          : (ex.not ? 'not.' : '') + ex.assertion + (ex.value != null ? "('" + truncate(String(ex.value), 25) + "')" : '');
        return `
    <li class="action-item action-expect-element" data-action-index="${item.actionIndex}" data-expect-index="${item.expectIndex}">
      <span class="expect-indent">└</span>
      <span class="action-type expect-badge">expect</span>
      <span class="action-selector" title="${escapeHtml(ex.custom || ex.assertion + (ex.value || ''))}">${escapeHtml(label)}</span>
      <button class="btn btn-small btn-delete-expect" data-action-index="${item.actionIndex}" data-expect-index="${item.expectIndex}" title="Delete">✕</button>
    </li>
  `;
      }
      const a = item.action;
      const i = item.index;
      const expectButtons = actionCanHaveExpect(a)
        ? `<button class="btn btn-small btn-add-expect" data-index="${i}" data-mode="expect" title="Add expect from this locator">+ Expect</button>
       <button class="btn btn-small btn-add-expect" data-index="${i}" data-mode="custom" title="Add custom expect">+ Expect custom</button>`
        : '';
      if (a.type === 'route') {
        const label = (a.method || 'GET') + ' ' + truncate(a.url || '', 45) + (a.failed ? ' (failed)' : '');
        const hasExpect = actions[i + 1]?.type === 'expectRequest' && actions[i + 1]?.url === a.url;
        const btn = hasExpect
          ? ''
          : `<button class="btn btn-small btn-expect" data-index="${i}" data-url="${escapeHtml(a.url)}" data-method="${escapeHtml(a.method || 'GET')}">Create expect waiting request</button>`;
        return `
    <li class="action-item action-route">
      <span class="action-type">route</span>
      <span class="action-selector" title="${escapeHtml(a.url)}">${escapeHtml(label)}</span>
      <span class="action-buttons">${btn}<button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button></span>
    </li>
  `;
      }
      if (a.type === 'expectRequest') {
        const label = 'expect: ' + truncate(a.url || '', 40);
        return `
    <li class="action-item action-expect">
      <span class="action-type">expect</span>
      <span class="action-selector" title="${escapeHtml(a.url)}">${escapeHtml(label)}</span>
      <button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button>
    </li>
  `;
      }
      if (a.type === 'goto') {
        const label = truncate(a.url || '', 50);
        return `
    <li class="action-item action-goto">
      <span class="action-type">goto</span>
      <span class="action-selector" title="${escapeHtml(a.url)}">${escapeHtml(label)}</span>
      <button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button>
    </li>
  `;
      }
      if (a.type === 'scroll') {
        const locDisplay = getActionLocatorDisplay(a);
        return `
    <li class="action-item action-scroll" data-action-index="${i}">
      <span class="action-type">scroll</span>
      <span class="action-selector" title="${escapeHtml(locDisplay)}">${escapeHtml(truncate(locDisplay, 50))}</span>
      <span class="action-buttons">${expectButtons}<button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button></span>
    </li>
  `;
      }
      if (a.type === 'dragTo') {
        const srcDisplay = getActionLocatorDisplay(a);
        const tgtDisplay = getActionLocatorDisplay({ locatorInfo: a.targetLocatorInfo, selector: a.targetSelector });
        return `
    <li class="action-item action-drag" data-action-index="${i}">
      <span class="action-type">dragTo</span>
      <span class="action-selector" title="${escapeHtml(srcDisplay)}">${escapeHtml(truncate(srcDisplay, 30))}</span>
      <span class="action-arrow">→</span>
      <span class="action-selector" title="${escapeHtml(tgtDisplay)}">${escapeHtml(truncate(tgtDisplay, 30))}</span>
      <span class="action-buttons">${expectButtons}<button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button></span>
    </li>
  `;
      }
      if (a.type === 'setInputFiles') {
        const label = (a.files && a.files.length) ? a.files.join(', ') : 'file';
        const locDisplay = getActionLocatorDisplay(a);
        return `
    <li class="action-item action-file" data-action-index="${i}">
      <span class="action-type">setInputFiles</span>
      <span class="action-selector" title="${escapeHtml(locDisplay)}">${escapeHtml(truncate(locDisplay, 30))}</span>
      <span class="action-value">${escapeHtml(truncate(label, 40))}</span>
      <span class="action-buttons">${expectButtons}<button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button></span>
    </li>
  `;
      }
      const locDisplay = getActionLocatorDisplay(a);
      return `
    <li class="action-item" data-action-index="${i}">
      <span class="action-type">${escapeHtml(a.type)}</span>
      <span class="action-selector" title="${escapeHtml(locDisplay)}">${escapeHtml(truncate(locDisplay, 50))}</span>
      ${a.value != null ? `<span class="action-value">${escapeHtml(truncate(String(a.value), 30))}</span>` : ''}
      <span class="action-buttons">${expectButtons}<button class="btn btn-small btn-delete" data-index="${i}" title="Delete">✕</button></span>
    </li>
  `;
    })
    .join('');

  ul.querySelectorAll('.btn-expect').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      sendToBackground({ type: 'INSERT_EXPECT_REQUEST', index, url: btn.dataset.url, method: btn.dataset.method })
        .then(() => refreshState())
        .catch((e) => showToast(e?.message || 'Error'));
    });
  });
  ul.querySelectorAll('.btn-add-expect').forEach((btn) => {
    btn.addEventListener('click', () => {
      openExpectModal(parseInt(btn.dataset.index, 10), btn.dataset.mode);
    });
  });
  ul.querySelectorAll('.btn-delete-expect').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendToBackground({
        type: 'REMOVE_EXPECT',
        actionIndex: parseInt(btn.dataset.actionIndex, 10),
        expectIndex: parseInt(btn.dataset.expectIndex, 10),
      })
        .then(() => refreshState())
        .catch((e) => showToast(e?.message || 'Error'));
    });
  });
  ul.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      sendToBackground({ type: 'REMOVE_ACTION', index })
        .then(() => refreshState())
        .catch((e) => showToast(e?.message || 'Error'));
    });
  });

  ul.querySelectorAll('.action-item[data-action-index]').forEach((li) => {
    li.addEventListener('mouseenter', () => {
      var idx = parseInt(li.dataset.actionIndex, 10);
      var action = actions[idx];
      if (action && action.locatorInfo) {
        sendToBackground({
          type: 'HIGHLIGHT_ACTION_ELEMENT',
          locatorInfo: action.locatorInfo,
          innerLocatorInfo: action.innerLocatorInfo || null,
        }).catch(() => {});
      }
    });
    li.addEventListener('mouseleave', () => {
      sendToBackground({ type: 'UNHIGHLIGHT_ACTION_ELEMENT' }).catch(() => {});
    });
  });

  if (actions.length > 0 && actions.length > renderActions._prevCount) {
    var lastItem = ul.lastElementChild;
    if (lastItem) lastItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  renderActions._prevCount = actions.length;
}

function renderFailed(failed) {
  const section = document.getElementById('section-failed');
  const ul = document.getElementById('list-failed');
  if (!failed || failed.length === 0) {
    section.classList.add('hidden');
    ul.innerHTML = '';
    return;
  }
  section.classList.remove('hidden');
  ul.innerHTML = failed
    .map(
      (f) => `
    <li class="failed-item">
      <span class="failed-url" title="${escapeHtml(f.url)}">${escapeHtml(truncate(f.url, 60))}</span>
      <span class="failed-error">${escapeHtml(f.method || '')} — error</span>
    </li>
  `
    )
    .join('');
}

function openEditModal(url) {
  const mock = currentState.mocks.find((m) => m.url === url);
  if (!mock) return;

  editingMockUrl = url;
  document.getElementById('edit-url').textContent = url;
  document.getElementById('edit-url').title = url;
  document.getElementById('edit-status').value = String(mock.status || 200);

  let bodyStr = '';
  if (mock.body != null) {
    bodyStr = typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body, null, 2);
  }
  document.getElementById('edit-body').value = bodyStr;

  document.getElementById('modal-edit').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('modal-edit').classList.add('hidden');
  editingMockUrl = null;
}

// --- Expect modal --- (все Locator Assertions из Playwright, порядок по частоте использования)
const EXPECT_ASSERTIONS = [
  // Топ по использованию: видимость и текст
  { id: 'toBeVisible', label: 'toBeVisible' },
  { id: 'toHaveText', label: 'toHaveText', needsValue: true, valuePlaceholder: "e.g. 'Success'" },
  { id: 'toContainText', label: 'toContainText', needsValue: true, valuePlaceholder: "text or /regex/" },
  { id: 'toHaveAttribute', label: 'toHaveAttribute', needsValue: true, valuePlaceholder: "attr, 'value'" },
  { id: 'toHaveValue', label: 'toHaveValue', needsValue: true, valuePlaceholder: "input value" },
  // Состояние элементов и форм
  { id: 'toBeDisabled', label: 'toBeDisabled' },
  { id: 'toBeEnabled', label: 'toBeEnabled' },
  { id: 'toBeChecked', label: 'toBeChecked' },
  { id: 'toBeHidden', label: 'toBeHidden' },
  { id: 'toBeEmpty', label: 'toBeEmpty' },
  // Классы и структура
  { id: 'toHaveClass', label: 'toHaveClass', needsValue: true, valuePlaceholder: "className" },
  { id: 'toContainClass', label: 'toContainClass', needsValue: true, valuePlaceholder: "className" },
  { id: 'toHaveCount', label: 'toHaveCount', needsValue: true, valuePlaceholder: "number" },
  // Viewport, focus, редактирование
  { id: 'toBeInViewport', label: 'toBeInViewport' },
  { id: 'toBeEditable', label: 'toBeEditable' },
  { id: 'toBeFocused', label: 'toBeFocused' },
  { id: 'toHaveId', label: 'toHaveId', needsValue: true, valuePlaceholder: "element-id" },
  { id: 'toHaveValues', label: 'toHaveValues', needsValue: true, valuePlaceholder: "['opt1','opt2']" },
  { id: 'toHaveCSS', label: 'toHaveCSS', needsValue: true, valuePlaceholder: "property, 'value'" },
  // A11y и реже используемые
  { id: 'toHaveAccessibleName', label: 'toHaveAccessibleName', needsValue: true, valuePlaceholder: "name" },
  { id: 'toHaveAccessibleDescription', label: 'toHaveAccessibleDescription', needsValue: true, valuePlaceholder: "desc" },
  { id: 'toHaveRole', label: 'toHaveRole', needsValue: true, valuePlaceholder: "role" },
  { id: 'toHaveJSProperty', label: 'toHaveJSProperty', needsValue: true, valuePlaceholder: "prop, value" },
  { id: 'toBeAttached', label: 'toBeAttached' },
];

function openExpectModal(actionIndex, mode) {
  const action = currentState.actions[actionIndex];
  if (!action) return;
  editingExpectActionIndex = actionIndex;
  editingExpectMode = mode;
  if (mode === 'expect') {
    editingExpectRows = [{ type: 'assertion', assertion: 'toBeVisible', value: '', not: false }];
  } else {
    editingExpectRows = [{ type: 'custom', custom: '', not: false }];
  }
  renderExpectModalBody();
  document.getElementById('modal-expect-title').textContent = mode === 'expect' ? 'Add Expect (from locator)' : 'Add Expect (custom + from list)';
  document.getElementById('modal-expect').classList.remove('hidden');
}

function assertionNeedsValue(id) {
  const opt = EXPECT_ASSERTIONS.find((o) => o.id === id);
  return opt && opt.needsValue;
}

function getAssertionPlaceholder(id) {
  const opt = EXPECT_ASSERTIONS.find((o) => o.id === id);
  return (opt && opt.valuePlaceholder) || 'value';
}

function renderExpectModalBody() {
  const body = document.getElementById('modal-expect-body');
  body.innerHTML = editingExpectRows
    .map((row, idx) => {
      const isCustom = row.type === 'custom' || row.custom != null;
      if (isCustom) {
        return `
        <div class="expect-row expect-row-custom" data-row="${idx}">
          <div class="expect-row-header">
            <div class="expect-row-fields">
              <label class="expect-not-label">
                <input type="checkbox" class="expect-not-checkbox" data-row="${idx}" ${row.not ? 'checked' : ''} title="Negate">
                .not
              </label>
              <label>Custom ${idx + 1}</label>
            </div>
            <button type="button" class="btn btn-small btn-remove-row" data-row="${idx}" title="Remove">✕</button>
          </div>
          <textarea class="expect-custom-input" rows="2" placeholder="expect(page.getByRole('button')).toBeVisible()">${escapeHtml(row.custom || '')}</textarea>
        </div>
      `;
      }
      const needsVal = assertionNeedsValue(row.assertion);
      const valueInput = needsVal
        ? `<input type="text" class="expect-value-input" data-row="${idx}" placeholder="${escapeHtml(getAssertionPlaceholder(row.assertion))}" value="${escapeHtml(row.value || '')}">`
        : '';
      return `
        <div class="expect-row" data-row="${idx}">
          <div class="expect-row-header">
            <div class="expect-row-fields">
              <label class="expect-not-label">
                <input type="checkbox" class="expect-not-checkbox" data-row="${idx}" ${row.not ? 'checked' : ''} title="Negate assertion">
                .not
              </label>
              <select class="expect-assertion-select" data-row="${idx}">
                ${EXPECT_ASSERTIONS.map(
                  (opt) => `<option value="${opt.id}" ${row.assertion === opt.id ? 'selected' : ''}>${opt.label}</option>`
                ).join('')}
              </select>
              ${valueInput}
            </div>
            <button type="button" class="btn btn-small btn-remove-row" data-row="${idx}" title="Remove">✕</button>
          </div>
        </div>
      `;
    })
    .join('');
  body.querySelectorAll('.expect-not-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.row, 10);
      if (editingExpectRows[idx]) editingExpectRows[idx].not = !!cb.checked;
    });
  });
  body.querySelectorAll('.expect-assertion-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.row, 10);
      const needsValue = assertionNeedsValue(sel.value);
      editingExpectRows[idx] = {
        type: 'assertion',
        assertion: sel.value,
        value: needsValue ? (editingExpectRows[idx].value || '') : '',
        not: editingExpectRows[idx].not || false,
      };
      renderExpectModalBody();
    });
  });
  body.querySelectorAll('.expect-value-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.row, 10);
      if (editingExpectRows[idx]) editingExpectRows[idx].value = inp.value;
    });
  });
  body.querySelectorAll('.expect-custom-input').forEach((ta) => {
    ta.addEventListener('input', () => {
      const row = ta.closest('.expect-row');
      if (row) {
        const idx = parseInt(row.dataset.row, 10);
        if (editingExpectRows[idx]) editingExpectRows[idx] = { type: 'custom', custom: ta.value };
      }
    });
  });
  body.querySelectorAll('.btn-remove-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.row, 10);
      editingExpectRows.splice(idx, 1);
      if (editingExpectRows.length === 0) closeExpectModal();
      else renderExpectModalBody();
    });
  });
}

function updateExpectRowFromModal() {
  document.getElementById('modal-expect-body').querySelectorAll('.expect-row').forEach((row) => {
    const idx = parseInt(row.dataset.row, 10);
    const ta = row.querySelector('.expect-custom-input');
    const sel = row.querySelector('.expect-assertion-select');
    const valInp = row.querySelector('.expect-value-input');
    const notCb = row.querySelector('.expect-not-checkbox');
    const not = notCb ? !!notCb.checked : !!editingExpectRows[idx].not;
    if (ta) {
      editingExpectRows[idx] = { type: 'custom', custom: ta.value, not };
    } else if (sel) {
      editingExpectRows[idx] = {
        type: 'assertion',
        assertion: sel.value,
        value: valInp ? valInp.value : '',
        not,
      };
    }
  });
}

function addExpectRow(rowType) {
  updateExpectRowFromModal();
  if (rowType === 'assertion') {
    editingExpectRows.push({ type: 'assertion', assertion: 'toBeVisible', value: '', not: false });
  } else {
    editingExpectRows.push({ type: 'custom', custom: '', not: false });
  }
  renderExpectModalBody();
}

function closeExpectModal() {
  document.getElementById('modal-expect').classList.add('hidden');
  editingExpectActionIndex = null;
  editingExpectMode = null;
  editingExpectRows = [];
}

function saveExpectModal() {
  updateExpectRowFromModal();
  if (editingExpectActionIndex == null) return;
  const expects = editingExpectRows
    .filter((r) => (r.type === 'custom' || r.custom != null ? (r.custom || '').trim() : r.assertion))
    .map((r) => {
      if (r.type === 'custom' || r.custom != null) return { custom: (r.custom || '').trim(), not: !!r.not };
      return { assertion: r.assertion, value: r.value ? r.value.trim() : undefined, not: !!r.not };
    });
  if (expects.length === 0) {
    showToast('Add at least one expect');
    return;
  }
  sendToBackground({ type: 'ADD_EXPECT', actionIndex: editingExpectActionIndex, expects })
    .then(() => {
      closeExpectModal();
      refreshState();
      showToast('Expect added');
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

function saveMockEdit() {
  if (!editingMockUrl) return;

  const status = parseInt(document.getElementById('edit-status').value, 10) || 200;
  const bodyRaw = document.getElementById('edit-body').value.trim();

  let newBody = bodyRaw;
  try {
    if (bodyRaw) {
      JSON.parse(bodyRaw);
      newBody = bodyRaw;
    }
  } catch {
    showToast('Invalid JSON in body');
    return;
  }

  sendToBackground({
    type: 'UPDATE_MOCK',
    data: { url: editingMockUrl, newBody, newStatus: status },
  })
    .then(() => {
      closeEditModal();
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

function generateCode() {
  const testName = document.getElementById('input-testname').value || 'recorded-test';
  const code = generateTestCode(testName, currentState.mocks, currentState.testSteps, currentState.startUrl);
  document.getElementById('code-preview').textContent = code;
  showToast('Select code and Ctrl+C to copy');
}

async function saveToFolder() {
  const testName = document.getElementById('input-testname').value || 'recorded-test';
  const code = generateTestCode(testName, currentState.mocks, currentState.testSteps, currentState.startUrl);
  const mocks = currentState.mocks || [];

  await chrome.storage.session.set({
    savePayload: { testName, code, mocks },
  });
  chrome.tabs.create({ url: chrome.runtime.getURL('picker.html') });
  showToast('New tab opened — select folder there');
}

function generateTestCode(name, mocks, testSteps, startUrl) {
  const lines = [];

  lines.push("const { test, expect } = require('@playwright/test');");
  lines.push("const path = require('path');");
  lines.push("const fs = require('fs');");
  lines.push('');

  lines.push(`test('${name.replace(/'/g, "\\'")}', async ({ page }) => {`);

  const hasSteps = testSteps && testSteps.length > 0;
  if (hasSteps) {
    if (mocks && mocks.length > 0) {
      mocks.forEach((m, i) => {
        const filename = m.filename || `mock_${i}`;
        const mockPath = `path.join(__dirname, 'mocks', '${filename}.json')`;
        lines.push(`  await page.route('*${getUrlGlob(m.url)}*', async (route) => {`);
        lines.push(`    const body = fs.readFileSync(${mockPath}, 'utf-8');`);
        lines.push(`    await route.fulfill({ status: ${m.status || 200}, body });`);
        lines.push(`  });`);
        lines.push('');
      });
    }

    lines.push(`  await page.goto('${(startUrl || 'https://example.com').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');`);
    lines.push('');

    testSteps.forEach((a) => {
      const line = actionToCode(a);
      if (line) lines.push('  ' + line);
      (a.expects || []).forEach((ex) => {
        const expectLine = expectToCode(ex, a);
        if (expectLine) lines.push('  ' + expectLine);
      });
    });
  }

  lines.push('});');
  return lines.join('\n');
}

function getUrlGlob(url) {
  try {
    const u = new URL(url);
    const path = u.pathname || '/';
    return path + (u.search ? '*' : '');
  } catch {
    return '/*';
  }
}

function escapeForPlaywright(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function locatorMethodStr(info) {
  if (!info || !info.method) return '';
  var suffix = '';
  if (info.method === 'nthChild') {
    var sel = info.childSelector || '> *';
    var n = typeof info.nthIndex === 'number' ? `.nth(${info.nthIndex})` : '';
    var inner = info.inner ? '.' + locatorMethodStr(info.inner) : '';
    return `locator('${escapeForPlaywright(sel)}')` + n + inner;
  }
  if (typeof info.nthIndex === 'number' && info.nthIndex >= 0) suffix = `.nth(${info.nthIndex})`;
  switch (info.method) {
    case 'role':
      if (info.role) {
        const opts = [];
        if (info.name) opts.push(`name: '${escapeForPlaywright(info.name)}'`);
        if (info.level != null) opts.push(`level: ${info.level}`);
        const optStr = opts.length ? `, { ${opts.join(', ')} }` : '';
        return `getByRole('${escapeForPlaywright(info.role)}'${optStr})` + suffix;
      }
      return '';
    case 'label':
      return info.label ? `getByLabel('${escapeForPlaywright(info.label)}')` + suffix : '';
    case 'testId':
      return info.value ? `getByTestId('${escapeForPlaywright(info.value)}')` + suffix : '';
    case 'text':
      return info.text ? `getByText('${escapeForPlaywright(info.text)}')` + suffix : '';
    case 'css':
      return info.selector ? `locator('${escapeForPlaywright(info.selector)}')` + suffix : '';
    case 'rowCell': {
      if (!info.rowText) return '';
      let chain = `getByText('${escapeForPlaywright(info.rowText)}')`;
      if (info.cellText) chain += `.getByText('${escapeForPlaywright(info.cellText)}')`;
      else if (info.dataIndex) chain += `.locator('[data-index="${escapeForPlaywright(info.dataIndex)}"]')`;
      return chain + suffix;
    }
    default:
      return '';
  }
}

function getLocatorStr(selector, locatorInfo, innerLocatorInfo) {
  let base = '';
  const method = locatorMethodStr(locatorInfo);
  if (method) {
    base = 'page.' + method;
  } else {
    base = `page.locator('${escapeForPlaywright(selector || '')}')`;
  }
  if (innerLocatorInfo) {
    const inner = locatorMethodStr(innerLocatorInfo);
    if (inner) base += '.' + inner;
  }
  return base;
}

function expectQuote(s) {
  if (!s) return "''";
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function expectToCode(ex, parentAction) {
  if (ex.custom) {
    let s = ex.custom.trim();
    if (ex.not && !s.includes('.not')) {
      const start = s.indexOf('expect(');
      if (start >= 0) {
        let depth = 0;
        let j = start + 6;
        while (j < s.length) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') {
            depth--;
            if (depth === 0) {
              s = s.slice(0, j + 1) + '.not' + s.slice(j + 1);
              break;
            }
          }
          j++;
        }
      }
    }
    return (s.endsWith(';') ? s : s + ';');
  }
  const loc = getLocatorStr(parentAction.selector || '', parentAction.locatorInfo, parentAction.innerLocatorInfo);
  const v = ex.value || '';
  const notPart = ex.not ? '.not' : '';
  switch (ex.assertion) {
    case 'toBeAttached':
    case 'toBeVisible':
    case 'toBeHidden':
    case 'toBeEnabled':
    case 'toBeDisabled':
    case 'toBeEditable':
    case 'toBeFocused':
    case 'toBeInViewport':
    case 'toBeChecked':
    case 'toBeEmpty':
      return `await expect(${loc})${notPart}.${ex.assertion}();`;
    case 'toHaveText':
    case 'toContainText':
      return `await expect(${loc})${notPart}.${ex.assertion}(${expectQuote(v)});`;
    case 'toHaveAttribute': {
      const parts = v.split(',').map((p) => p.trim());
      const attr = expectQuote(parts[0] || 'href');
      const val = expectQuote(parts[1] != null ? parts[1] : '');
      return `await expect(${loc})${notPart}.toHaveAttribute(${attr}, ${val});`;
    }
    case 'toHaveValue':
      return `await expect(${loc})${notPart}.toHaveValue(${expectQuote(v)});`;
    case 'toHaveValues': {
      let arrVal = '[]';
      if (v.trim()) {
        if (v.trim().startsWith('[')) arrVal = v;
        else arrVal = '[' + v.split(',').map((x) => expectQuote(x.trim())).join(', ') + ']';
      }
      return `await expect(${loc})${notPart}.toHaveValues(${arrVal});`;
    }
    case 'toHaveClass':
    case 'toContainClass':
      return `await expect(${loc})${notPart}.${ex.assertion}(${expectQuote(v)});`;
    case 'toHaveId':
      return `await expect(${loc})${notPart}.toHaveId(${expectQuote(v)});`;
    case 'toHaveCount':
      const num = parseInt(v, 10);
      return `await expect(${loc})${notPart}.toHaveCount(${isNaN(num) ? 0 : num});`;
    case 'toHaveCSS': {
      const parts = v.split(',').map((p) => p.trim());
      const prop = expectQuote(parts[0] || 'color');
      const val2 = expectQuote(parts[1] != null ? parts[1] : '');
      return `await expect(${loc})${notPart}.toHaveCSS(${prop}, ${val2});`;
    }
    case 'toHaveAccessibleName':
    case 'toHaveAccessibleDescription':
      return `await expect(${loc})${notPart}.${ex.assertion}(${expectQuote(v)});`;
    case 'toHaveRole':
      return `await expect(${loc})${notPart}.toHaveRole(${expectQuote(v)});`;
    case 'toHaveJSProperty': {
      const parts = v.split(',').map((p) => p.trim());
      const prop = expectQuote(parts[0] || 'value');
      const val3 = parts[1] != null ? (parts[1] === 'true' ? 'true' : parts[1] === 'false' ? 'false' : expectQuote(parts[1])) : 'undefined';
      return `await expect(${loc})${notPart}.toHaveJSProperty(${prop}, ${val3});`;
    }
    default:
      return `await expect(${loc})${notPart}.toBeVisible();`;
  }
}

function actionToCode(a) {
  if (a.type === 'route') return null;
  const loc = getLocatorStr(a.selector || '', a.locatorInfo, a.innerLocatorInfo);
  if (a.type === 'expectRequest') {
    const method = (a.method || 'GET').toUpperCase();
    let pathPart = '';
    try {
      const u = new URL(a.url || '', 'https://x');
      pathPart = u.pathname || u.href.split('?')[0] || '/';
    } catch {
      pathPart = (a.url || '').split('?')[0] || '/*';
    }
    const escaped = pathPart.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `await page.waitForResponse(res => res.url().includes('${escaped}') && res.request().method() === '${method}');`;
  }
  switch (a.type) {
    case 'click':
      return `await ${loc}.click();`;
    case 'doubleClick':
      return `await ${loc}.dblclick();`;
    case 'rightClick':
      return `await ${loc}.click({ button: 'right' });`;
    case 'fill':
      const val = String(a.value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await ${loc}.fill('${val}');`;
    case 'selectOption':
      const optVal = String(a.value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await ${loc}.selectOption('${optVal}');`;
    case 'check':
      return `await ${loc}.check();`;
    case 'uncheck':
      return `await ${loc}.uncheck();`;
    case 'press':
      const key = String(a.key ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await ${loc}.press('${key}');`;
    case 'hover':
      return `await ${loc}.hover();`;
    case 'scroll':
      return `await ${loc}.scrollIntoViewIfNeeded();`;
    case 'goto':
      const gotoUrl = String(a.url ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await page.goto('${gotoUrl}');`;
    case 'dragTo': {
      const targetLoc = getLocatorStr(a.targetSelector || '', a.targetLocatorInfo);
      return `await ${loc}.dragTo(${targetLoc});`;
    }
    case 'setInputFiles': {
      const files = a.files && a.files.length ? a.files.map(function (f) { return "'./fixtures/" + String(f).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }) : ["'./path/to/file'"];
      return `await ${loc}.setInputFiles([${files.join(', ')}]);`;
    }
    default:
      return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshState();
  setupEventListeners();

  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.type === 'MOCK_ADDED' ||
      message.type === 'MOCK_UPDATED' ||
      message.type === 'REQUEST_FAILED' ||
      message.type === 'ACTION_ADDED'
    ) {
      refreshState();
    }
  });

  // Обновление в реальном времени при записи
  setInterval(() => {
    if (currentState.recording) {
      refreshState();
    }
  }, 400);
});
