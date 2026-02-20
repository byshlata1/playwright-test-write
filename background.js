// Service worker — хранилище состояния записи

const STATIC_REGEX = /\.(css|js|png|jpg|woff|svg|ico|gif)(\?|$)/i;

const state = {
  recording: false,
  startUrl: null,
  actions: [],
  testSteps: [],
  mocks: new Map(),
  failedRequests: [],
  lastRequestTs: null,
  recordingStartedTs: null,
};

function generateMockFilename(url) {
  try {
    const u = new URL(url);
    let path = u.pathname || '/';
    path = path.replace(/\//g, '_').replace(/^_|_$/g, '') || 'index';
    const query = u.search ? encodeURIComponent(u.search.slice(1)) : '';
    const safe = path.replace(/[^a-zA-Z0-9_-]/g, '_');
    return query ? `${safe}_${query.slice(0, 20)}` : safe;
  } catch {
    return 'mock_' + Date.now();
  }
}

function tryParseJSON(str) {
  if (str == null || typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function isStaticUrl(url) {
  try {
    return STATIC_REGEX.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

function broadcastToTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  });
}

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // only main frame
  if (!state.recording || state._lastTabId !== details.tabId) return;
  if (state._skipNextNavigation) {
    state._skipNextNavigation = false;
    setTimeout(() => sendHighlightState(details.tabId), 300);
    return;
  }
  const url = details.url;
  if (!url || url.startsWith('chrome') || url.startsWith('edge') || url.startsWith('about:')) return;
  const gotoAction = { type: 'goto', url, ts: Date.now() };
  state.actions.push(gotoAction);
  notifyPanel({ type: 'ACTION_ADDED', action: gotoAction });
  setTimeout(() => sendHighlightState(details.tabId), 300);
});

// --- Трекинг видимости панели DevTools ---
const panelPorts = new Map(); // tabId → port
const panelVisible = new Map(); // tabId → boolean

function sendHighlightState(tabId) {
  const visible = panelVisible.get(tabId) === true;
  const show = state.recording && visible && state._lastTabId === tabId;
  chrome.tabs.sendMessage(tabId, { type: show ? 'HIGHLIGHT_ON' : 'HIGHLIGHT_OFF' }).catch(() => {});
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('devtools-panel-')) return;
  const tabId = parseInt(port.name.replace('devtools-panel-', ''), 10);
  if (isNaN(tabId)) return;
  panelPorts.set(tabId, port);

  port.onMessage.addListener((msg) => {
    if (msg.type === 'PANEL_SHOWN') {
      panelVisible.set(tabId, true);
      sendHighlightState(tabId);
    } else if (msg.type === 'PANEL_HIDDEN') {
      panelVisible.set(tabId, false);
      sendHighlightState(tabId);
    }
  });

  port.onDisconnect.addListener(() => {
    panelPorts.delete(tabId);
    panelVisible.delete(tabId);
    chrome.tabs.sendMessage(tabId, { type: 'HIGHLIGHT_OFF' }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Playwright Recorder] Message received:', message?.type, message);

  if (message.type === 'START_RECORDING') {
    const startUrl = message.startUrl ?? null;
    const tabId = message.tabId;
    state._lastTabId = tabId;
    state.recording = true;
    state.startUrl = startUrl;
    state.actions = [];
    state.mocks = new Map();
    state.failedRequests = [];
    state.lastRequestTs = null;
    state.recordingStartedTs = Date.now();
    state._skipNextNavigation = !!tabId; // skip reload-triggered onCommitted
    if (tabId) {
      chrome.tabs.reload(tabId);
      setTimeout(() => sendHighlightState(tabId), 500);
    } else {
      broadcastToTabs({ type: 'START_RECORDING', startUrl });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    state.recording = false;
    const tabId = message.tabId ?? state._lastTabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' }).catch(() => {});
      sendHighlightState(tabId);
    } else {
      broadcastToTabs({ type: 'STOP_RECORDING' });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'REQUEST_CAPTURED') {
    const { request, response, success } = message.data || {};
    const url = request?.url;

    if (!url || isStaticUrl(url)) {
      sendResponse({ received: true });
      return true;
    }

    const mockData = {
      url,
      method: request?.method || 'GET',
      status: success && response ? (response.status ?? 200) : 500,
      headers: (success && response?.headers) ? response.headers : {},
      body: (success && response?.body != null) ? response.body : '{}',
      filename: generateMockFilename(url),
      failed: !success,
    };
    state.mocks.set(url, mockData);
    state.lastRequestTs = Date.now();
    state.actions.push({ type: 'route', url, method: mockData.method, failed: !success, ts: Date.now() });
    notifyPanel({ type: 'MOCK_ADDED', mock: mockData });

    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'ADD_ACTION') {
    if (state.recording && message.data) {
      const action = { ...message.data, ts: Date.now() };
      state.actions.push(action);
      notifyPanel({ type: 'ACTION_ADDED', action });
    }
    sendResponse({ added: true });
    return true;
  }

  if (message.type === 'INSERT_EXPECT_REQUEST') {
    const { index, url, method } = message;
    if (typeof index !== 'number' || index < 0 || index >= state.actions.length) {
      sendResponse({ ok: false, error: 'Invalid index' });
      return true;
    }
    const expectAction = {
      type: 'expectRequest',
      url: url || '',
      method: method || 'GET',
      ts: Date.now(),
    };
    state.actions.splice(index + 1, 0, expectAction);
    notifyPanel({ type: 'ACTION_ADDED' });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'REMOVE_ACTION') {
    const index = message.index;
    if (typeof index === 'number' && index >= 0 && index < state.actions.length) {
      state.actions.splice(index, 1);
      notifyPanel({ type: 'ACTION_ADDED' });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'ADD_EXPECT') {
    const { actionIndex, expects } = message;
    if (typeof actionIndex !== 'number' || actionIndex < 0 || actionIndex >= state.actions.length) {
      sendResponse({ ok: false, error: 'Invalid action index' });
      return true;
    }
    const action = state.actions[actionIndex];
    if (!action.expects) action.expects = [];
    action.expects.push(...(Array.isArray(expects) ? expects : [expects]));
    notifyPanel({ type: 'ACTION_ADDED' });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'REMOVE_EXPECT') {
    const { actionIndex, expectIndex } = message;
    if (typeof actionIndex !== 'number' || actionIndex < 0 || actionIndex >= state.actions.length) {
      sendResponse({ ok: false });
      return true;
    }
    const action = state.actions[actionIndex];
    if (action.expects && typeof expectIndex === 'number' && expectIndex >= 0 && expectIndex < action.expects.length) {
      action.expects.splice(expectIndex, 1);
      notifyPanel({ type: 'ACTION_ADDED' });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'ADD_TO_TEST') {
    state.testSteps.push(...state.actions);
    state.actions = [];
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_STATE') {
    const mocksArray = Array.from(state.mocks.entries()).map(([url, data]) => ({
      url,
      ...data,
    }));
    const now = Date.now();
    const noRequestsLongEnough = state.lastRequestTs != null && (now - state.lastRequestTs) > 3000;
    const recordingLongEnoughNoRequests =
      state.recordingStartedTs != null &&
      state.lastRequestTs == null &&
      (now - state.recordingStartedTs) > 5000;
    const requestsSettled = noRequestsLongEnough || recordingLongEnoughNoRequests;
    sendResponse({
      recording: state.recording,
      startUrl: state.startUrl,
      actions: [...state.actions],
      testSteps: [...state.testSteps],
      mocks: mocksArray,
      failedRequests: [...state.failedRequests],
      waitingForRequests: state.recording && !requestsSettled,
    });
    return true;
  }

  if (message.type === 'UPDATE_MOCK') {
    const { url, newBody, newStatus } = message.data || {};
    if (url && state.mocks.has(url)) {
      const mock = state.mocks.get(url);
      if (newBody !== undefined) {
        mock.body = typeof newBody === 'string' ? newBody : JSON.stringify(newBody);
      }
      if (newStatus !== undefined) {
        mock.status = newStatus;
      }
      state.mocks.set(url, mock);
      notifyPanel({ type: 'MOCK_UPDATED', mock });
    }
    sendResponse({ updated: true });
    return true;
  }

  if (message.type === 'HIGHLIGHT_ACTION_ELEMENT') {
    const tabId = state._lastTabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'HIGHLIGHT_ACTION_ELEMENT',
        locatorInfo: message.locatorInfo,
        innerLocatorInfo: message.innerLocatorInfo,
      }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'UNHIGHLIGHT_ACTION_ELEMENT') {
    const tabId = state._lastTabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'UNHIGHLIGHT_ACTION_ELEMENT' }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'REQUEST_HIGHLIGHT_STATE') {
    const tabId = sender?.tab?.id ?? state._lastTabId;
    if (tabId) {
      setTimeout(() => sendHighlightState(tabId), 100);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'CLEAR_ALL') {
    state.recording = false;
    state.startUrl = null;
    state.actions = [];
    state.testSteps = [];
    state.mocks = new Map();
    state.failedRequests = [];
    state._skipNextNavigation = false;
    sendResponse({ cleared: true });
    return true;
  }

  return false;
});
