import { escapeHtml, truncate } from './state.js';
import { generateTestCode, locatorMethodStr } from './code-generator.js';

export function updateUI(state) {
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

export function renderMocks(mocks) {
  const ul = document.getElementById('list-mocks');
  if (!mocks || mocks.length === 0) {
    ul.innerHTML = '<li class="empty">No mocks captured yet</li>';
    return;
  }
  ul.innerHTML = mocks
    .map(
      (m, i) => {
        const status = m.status || (m.failed ? 500 : 200);
        const statusClass = status >= 500 ? 'status-5xx' : status >= 400 ? 'status-4xx' : 'status-2xx';
        const failedBadge = m.failed ? '<span class="failed-badge" title="Failed request">⚠</span>' : '';
        return `
    <li class="mock-item ${m.failed ? 'mock-failed' : ''}">
      <span class="method">${escapeHtml(m.method || 'GET')}</span>
      <span class="status-code ${statusClass}">${escapeHtml(String(status))}</span>
      <span class="filename" title="${escapeHtml(m.url)}">${escapeHtml(truncate(m.filename || m.url, 40))}</span>
      ${failedBadge}
      <button class="btn btn-small btn-edit-mock" data-mock-index="${i}">Edit</button>
    </li>
  `;
      }
    )
    .join('');
}

export function actionCanHaveExpect(a) {
  return a && (a.locatorInfo || a.selector) && a.type !== 'route' && a.type !== 'expectRequest' && a.type !== 'goto';
}

export function getActionLocatorDisplay(a) {
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

export function renderActions(actions) {
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

  if (actions.length > 0 && actions.length > renderActions._prevCount) {
    const lastItem = ul.lastElementChild;
    if (lastItem) lastItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  renderActions._prevCount = actions.length;
}

export function renderFailed(failed) {
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
