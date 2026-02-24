import { currentState, editState, sendToBackground, refreshState, escapeHtml, truncate, showToast } from './state.js';

// Все Locator Assertions из Playwright, порядок по частоте использования
export const EXPECT_ASSERTIONS = [
  { id: 'toBeVisible', label: 'toBeVisible' },
  { id: 'toHaveText', label: 'toHaveText', needsValue: true, valuePlaceholder: "e.g. 'Success'" },
  { id: 'toContainText', label: 'toContainText', needsValue: true, valuePlaceholder: "text or /regex/" },
  { id: 'toHaveAttribute', label: 'toHaveAttribute', needsValue: true, valuePlaceholder: "attr, 'value'" },
  { id: 'toHaveValue', label: 'toHaveValue', needsValue: true, valuePlaceholder: "input value" },
  { id: 'toBeDisabled', label: 'toBeDisabled' },
  { id: 'toBeEnabled', label: 'toBeEnabled' },
  { id: 'toBeChecked', label: 'toBeChecked' },
  { id: 'toBeHidden', label: 'toBeHidden' },
  { id: 'toBeEmpty', label: 'toBeEmpty' },
  { id: 'toHaveClass', label: 'toHaveClass', needsValue: true, valuePlaceholder: "className" },
  { id: 'toContainClass', label: 'toContainClass', needsValue: true, valuePlaceholder: "className" },
  { id: 'toHaveCount', label: 'toHaveCount', needsValue: true, valuePlaceholder: "number" },
  { id: 'toBeInViewport', label: 'toBeInViewport' },
  { id: 'toBeEditable', label: 'toBeEditable' },
  { id: 'toBeFocused', label: 'toBeFocused' },
  { id: 'toHaveId', label: 'toHaveId', needsValue: true, valuePlaceholder: "element-id" },
  { id: 'toHaveValues', label: 'toHaveValues', needsValue: true, valuePlaceholder: "['opt1','opt2']" },
  { id: 'toHaveCSS', label: 'toHaveCSS', needsValue: true, valuePlaceholder: "property, 'value'" },
  { id: 'toHaveAccessibleName', label: 'toHaveAccessibleName', needsValue: true, valuePlaceholder: "name" },
  { id: 'toHaveAccessibleDescription', label: 'toHaveAccessibleDescription', needsValue: true, valuePlaceholder: "desc" },
  { id: 'toHaveRole', label: 'toHaveRole', needsValue: true, valuePlaceholder: "role" },
  { id: 'toHaveJSProperty', label: 'toHaveJSProperty', needsValue: true, valuePlaceholder: "prop, value" },
  { id: 'toBeAttached', label: 'toBeAttached' },
];

export function openEditModal(url, method) {
  const mock = currentState.mocks.find((m) => m.url === url && m.method === (method || 'GET'));
  if (!mock) return;

  editState.editingMockUrl = url;
  editState.editingMockMethod = method || mock.method || 'GET';
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

export function closeEditModal() {
  document.getElementById('modal-edit').classList.add('hidden');
  editState.editingMockUrl = null;
  editState.editingMockMethod = null;
}

export function saveMockEdit() {
  if (!editState.editingMockUrl) return;

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
    data: { url: editState.editingMockUrl, method: editState.editingMockMethod, newBody, newStatus: status },
  })
    .then(() => {
      closeEditModal();
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

export function openExpectModal(actionIndex, mode) {
  const action = currentState.actions[actionIndex];
  if (!action) return;
  editState.editingExpectActionIndex = actionIndex;
  editState.editingExpectMode = mode;
  if (mode === 'expect') {
    editState.editingExpectRows = [{ type: 'assertion', assertion: 'toBeVisible', value: '', not: false }];
  } else {
    editState.editingExpectRows = [{ type: 'custom', custom: '', not: false }];
  }
  renderExpectModalBody();
  document.getElementById('modal-expect-title').textContent = mode === 'expect' ? 'Add Expect (from locator)' : 'Add Expect (custom + from list)';
  document.getElementById('modal-expect').classList.remove('hidden');
}

export function closeExpectModal() {
  document.getElementById('modal-expect').classList.add('hidden');
  editState.editingExpectActionIndex = null;
  editState.editingExpectMode = null;
  editState.editingExpectRows = [];
}

export function assertionNeedsValue(id) {
  const opt = EXPECT_ASSERTIONS.find((o) => o.id === id);
  return opt && opt.needsValue;
}

export function getAssertionPlaceholder(id) {
  const opt = EXPECT_ASSERTIONS.find((o) => o.id === id);
  return (opt && opt.valuePlaceholder) || 'value';
}

export function renderExpectModalBody() {
  const body = document.getElementById('modal-expect-body');
  body.innerHTML = editState.editingExpectRows
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
      if (editState.editingExpectRows[idx]) editState.editingExpectRows[idx].not = !!cb.checked;
    });
  });
  body.querySelectorAll('.expect-assertion-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.row, 10);
      const needsValue = assertionNeedsValue(sel.value);
      editState.editingExpectRows[idx] = {
        type: 'assertion',
        assertion: sel.value,
        value: needsValue ? (editState.editingExpectRows[idx].value || '') : '',
        not: editState.editingExpectRows[idx].not || false,
      };
      renderExpectModalBody();
    });
  });
  body.querySelectorAll('.expect-value-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.row, 10);
      if (editState.editingExpectRows[idx]) editState.editingExpectRows[idx].value = inp.value;
    });
  });
  body.querySelectorAll('.expect-custom-input').forEach((ta) => {
    ta.addEventListener('input', () => {
      const row = ta.closest('.expect-row');
      if (row) {
        const idx = parseInt(row.dataset.row, 10);
        if (editState.editingExpectRows[idx]) editState.editingExpectRows[idx] = { type: 'custom', custom: ta.value };
      }
    });
  });
  body.querySelectorAll('.btn-remove-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.row, 10);
      editState.editingExpectRows.splice(idx, 1);
      if (editState.editingExpectRows.length === 0) closeExpectModal();
      else renderExpectModalBody();
    });
  });
}

export function updateExpectRowFromModal() {
  document.getElementById('modal-expect-body').querySelectorAll('.expect-row').forEach((row) => {
    const idx = parseInt(row.dataset.row, 10);
    const ta = row.querySelector('.expect-custom-input');
    const sel = row.querySelector('.expect-assertion-select');
    const valInp = row.querySelector('.expect-value-input');
    const notCb = row.querySelector('.expect-not-checkbox');
    const not = notCb ? !!notCb.checked : !!editState.editingExpectRows[idx].not;
    if (ta) {
      editState.editingExpectRows[idx] = { type: 'custom', custom: ta.value, not };
    } else if (sel) {
      editState.editingExpectRows[idx] = {
        type: 'assertion',
        assertion: sel.value,
        value: valInp ? valInp.value : '',
        not,
      };
    }
  });
}

export function addExpectRow(rowType) {
  updateExpectRowFromModal();
  if (rowType === 'assertion') {
    editState.editingExpectRows.push({ type: 'assertion', assertion: 'toBeVisible', value: '', not: false });
  } else {
    editState.editingExpectRows.push({ type: 'custom', custom: '', not: false });
  }
  renderExpectModalBody();
}

export function saveExpectModal() {
  updateExpectRowFromModal();
  if (editState.editingExpectActionIndex == null) return;
  const expects = editState.editingExpectRows
    .filter((r) => (r.type === 'custom' || r.custom != null ? (r.custom || '').trim() : r.assertion))
    .map((r) => {
      if (r.type === 'custom' || r.custom != null) return { custom: (r.custom || '').trim(), not: !!r.not };
      return { assertion: r.assertion, value: r.value ? r.value.trim() : undefined, not: !!r.not };
    });
  if (expects.length === 0) {
    showToast('Add at least one expect');
    return;
  }
  sendToBackground({ type: 'ADD_EXPECT', actionIndex: editState.editingExpectActionIndex, expects })
    .then(() => {
      closeExpectModal();
      refreshState();
      showToast('Expect added');
    })
    .catch((e) => showToast(e?.message || 'Error'));
}
