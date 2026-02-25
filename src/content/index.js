import { contentState } from './state.js';
import { updateHighlight } from './overlay.js';
import { ensureHighlightOverlay, removeHighlightOverlay } from './overlay.js';
import { enableTestIdHighlight, disableTestIdHighlight } from './testid-dots.js';
import { showActionHighlight, hideActionHighlight } from './action-highlight.js';
import './events.js';

chrome.storage.local.get('captureAllClicks', (r) => { contentState.captureAllClicks = !!r.captureAllClicks; });

document.addEventListener('mousemove', function (e) {
  contentState.lastMousePos.x = e.clientX;
  contentState.lastMousePos.y = e.clientY;
  updateHighlight(e);
}, { passive: true });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureAllClicks) contentState.captureAllClicks = !!changes.captureAllClicks.newValue;
});

chrome.runtime.onMessage.addListener(function (message) {
  if (message.type === 'START_RECORDING') {
    contentState.recording = true;
    window.postMessage({ type: 'START_RECORDING', startUrl: message.startUrl || null }, '*');
    console.log('[Playwright Recorder] Recording started', message.startUrl);
  } else if (message.type === 'STOP_RECORDING') {
    contentState.recording = false;
    contentState.highlightEnabled = false;
    removeHighlightOverlay();
    window.postMessage({ type: 'STOP_RECORDING' }, '*');
    console.log('[Playwright Recorder] Recording stopped');
  } else if (message.type === 'HIGHLIGHT_ON') {
    contentState.highlightEnabled = true;
    if (contentState.recording) ensureHighlightOverlay();
  } else if (message.type === 'HIGHLIGHT_OFF') {
    contentState.highlightEnabled = false;
    removeHighlightOverlay();
  } else if (message.type === 'TOGGLE_TESTID_HIGHLIGHT') {
    if (message.enabled) enableTestIdHighlight();
    else disableTestIdHighlight();
  } else if (message.type === 'HIGHLIGHT_ACTION_ELEMENT') {
    showActionHighlight(message.locatorInfo, message.innerLocatorInfo);
  } else if (message.type === 'UNHIGHLIGHT_ACTION_ELEMENT') {
    hideActionHighlight();
  }
});

chrome.runtime.sendMessage({ type: 'GET_STATE' }, function (state) {
  if (chrome.runtime.lastError) return;
  if (state && state.recording) {
    contentState.recording = true;
    window.postMessage({
      type: 'START_RECORDING',
      startUrl: state.startUrl || null,
    }, '*');
    console.log('[Playwright Recorder] Recording resumed after page load', state.startUrl);
    chrome.runtime.sendMessage({ type: 'REQUEST_HIGHLIGHT_STATE' }).catch(e => console.warn('[PW Recorder]', e));
  }
});

window.addEventListener(
  'message',
  function (e) {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'REQUEST_CAPTURED_PAGE') {
      chrome.runtime.sendMessage({ type: 'REQUEST_CAPTURED', data: e.data.data }).catch(e => console.warn('[PW Recorder]', e));
    } else if (e.data.type === 'SPA_NAVIGATION' && contentState.recording) {
      chrome.runtime.sendMessage({ type: 'SPA_NAVIGATION', url: e.data.url }).catch(e => console.warn('[PW Recorder]', e));
    }
  },
  false
);
