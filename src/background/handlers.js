import { state } from './state.js';
import {
  generateMockFilename,
  isStaticUrl,
  broadcastToTabs,
  notifyPanel,
  sendHighlightState,
} from './utils.js';

export function handleStartRecording(message, sender, sendResponse) {
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
  state._skipNextNavigation = !!tabId;
  if (tabId) {
    chrome.tabs.reload(tabId);
    setTimeout(() => sendHighlightState(tabId), 500);
  } else {
    broadcastToTabs({ type: 'START_RECORDING', startUrl });
  }
  sendResponse({ success: true });
  return true;
}

export function handleStopRecording(message, sender, sendResponse) {
  state.recording = false;
  const tabId = message.tabId ?? state._lastTabId;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' }).catch(e => console.warn('[PW Recorder]', e));
    sendHighlightState(tabId);
  } else {
    broadcastToTabs({ type: 'STOP_RECORDING' });
  }
  sendResponse({ success: true });
  return true;
}

export function handleRequestCaptured(message, sender, sendResponse) {
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
  state.mocks.set(mockData.method + '|' + url, mockData);
  if (!success) {
    state.failedRequests.push({ url, method: request?.method || 'GET', ts: Date.now() });
    notifyPanel({ type: 'REQUEST_FAILED' });
  }
  state.lastRequestTs = Date.now();
  state.actions.push({ type: 'route', url, method: mockData.method, failed: !success, ts: Date.now() });
  notifyPanel({ type: 'MOCK_ADDED', mock: mockData });

  sendResponse({ received: true });
  return true;
}

export function handleAddAction(message, sender, sendResponse) {
  if (state.recording && message.data) {
    const action = { ...message.data, ts: Date.now() };
    state.actions.push(action);
    notifyPanel({ type: 'ACTION_ADDED', action });
  }
  sendResponse({ added: true });
  return true;
}

export function handleInsertExpectRequest(message, sender, sendResponse) {
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

export function handleRemoveAction(message, sender, sendResponse) {
  const index = message.index;
  if (typeof index === 'number' && index >= 0 && index < state.actions.length) {
    state.actions.splice(index, 1);
    notifyPanel({ type: 'ACTION_ADDED' });
  }
  sendResponse({ ok: true });
  return true;
}

export function handleAddExpect(message, sender, sendResponse) {
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

export function handleRemoveExpect(message, sender, sendResponse) {
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

export function handleAddToTest(message, sender, sendResponse) {
  state.testSteps.push(...state.actions);
  state.actions = [];
  sendResponse({ ok: true });
  return true;
}

export function handleGetState(message, sender, sendResponse) {
  const mocksArray = Array.from(state.mocks.values()).map(data => ({ ...data }));
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

export function handleUpdateMock(message, sender, sendResponse) {
  const { url, method, newBody, newStatus } = message.data || {};
  const key = (method || 'GET') + '|' + url;
  if (url && state.mocks.has(key)) {
    const mock = state.mocks.get(key);
    if (newBody !== undefined) {
      mock.body = typeof newBody === 'string' ? newBody : JSON.stringify(newBody);
    }
    if (newStatus !== undefined) {
      mock.status = newStatus;
    }
    state.mocks.set(key, mock);
    notifyPanel({ type: 'MOCK_UPDATED', mock });
  }
  sendResponse({ updated: true });
  return true;
}

export function handleToggleTestidHighlight(message, sender, sendResponse) {
  const tabId = message.tabId || state._lastTabId;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'TOGGLE_TESTID_HIGHLIGHT',
      enabled: !!message.enabled,
    }).catch(e => console.warn('[PW Recorder]', e));
  }
  sendResponse({ ok: true });
  return true;
}

export function handleHighlightActionElement(message, sender, sendResponse) {
  const tabId = state._lastTabId;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'HIGHLIGHT_ACTION_ELEMENT',
      locatorInfo: message.locatorInfo,
      innerLocatorInfo: message.innerLocatorInfo,
    }).catch(e => console.warn('[PW Recorder]', e));
  }
  sendResponse({ ok: true });
  return true;
}

export function handleUnhighlightActionElement(message, sender, sendResponse) {
  const tabId = state._lastTabId;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'UNHIGHLIGHT_ACTION_ELEMENT' }).catch(e => console.warn('[PW Recorder]', e));
  }
  sendResponse({ ok: true });
  return true;
}

export function handleRequestHighlightState(message, sender, sendResponse) {
  const tabId = sender?.tab?.id ?? state._lastTabId;
  if (tabId) {
    setTimeout(() => sendHighlightState(tabId), 100);
  }
  sendResponse({ ok: true });
  return true;
}

export function handleClearAll(message, sender, sendResponse) {
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
