import { state } from './state.js';
import { sendHighlightState, panelPorts, panelVisible, notifyPanel } from './utils.js';
import {
  handleStartRecording,
  handleStopRecording,
  handleRequestCaptured,
  handleAddAction,
  handleInsertExpectRequest,
  handleRemoveAction,
  handleAddExpect,
  handleRemoveExpect,
  handleAddToTest,
  handleGetState,
  handleUpdateMock,
  handleToggleTestidHighlight,
  handleHighlightActionElement,
  handleUnhighlightActionElement,
  handleRequestHighlightState,
  handleClearAll,
} from './handlers.js';

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
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
    chrome.tabs.sendMessage(tabId, { type: 'HIGHLIGHT_OFF' }).catch(e => console.warn('[PW Recorder]', e));
  });
});

const messageHandlers = {
  START_RECORDING: handleStartRecording,
  STOP_RECORDING: handleStopRecording,
  REQUEST_CAPTURED: handleRequestCaptured,
  ADD_ACTION: handleAddAction,
  INSERT_EXPECT_REQUEST: handleInsertExpectRequest,
  REMOVE_ACTION: handleRemoveAction,
  ADD_EXPECT: handleAddExpect,
  REMOVE_EXPECT: handleRemoveExpect,
  ADD_TO_TEST: handleAddToTest,
  GET_STATE: handleGetState,
  UPDATE_MOCK: handleUpdateMock,
  TOGGLE_TESTID_HIGHLIGHT: handleToggleTestidHighlight,
  HIGHLIGHT_ACTION_ELEMENT: handleHighlightActionElement,
  UNHIGHLIGHT_ACTION_ELEMENT: handleUnhighlightActionElement,
  REQUEST_HIGHLIGHT_STATE: handleRequestHighlightState,
  CLEAR_ALL: handleClearAll,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Playwright Recorder] Message received:', message?.type, message);

  const handler = messageHandlers[message.type];
  if (handler) {
    return handler(message, sender, sendResponse);
  }

  return false;
});
