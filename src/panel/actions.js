import { currentState, sendToBackground, refreshState, showToast } from './state.js';
import { updateUI } from './render.js';
import { generateTestCode } from './code-generator.js';

export function startRecording() {
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

export function stopRecording() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  sendToBackground({ type: 'STOP_RECORDING', tabId })
    .then(() => {
      currentState.recording = false;
      updateUI(currentState);
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

export function onCaptureAllChange() {
  const checked = document.getElementById('checkbox-capture-all').checked;
  chrome.storage.local.set({ captureAllClicks: checked });
}

export function onTestIdHighlightChange() {
  const checked = document.getElementById('checkbox-testid-highlight').checked;
  const tabId = chrome.devtools.inspectedWindow.tabId;
  sendToBackground({ type: 'TOGGLE_TESTID_HIGHLIGHT', enabled: checked, tabId })
    .catch((e) => showToast(e?.message || 'Error'));
}

export function addToTest() {
  sendToBackground({ type: 'ADD_TO_TEST' })
    .then(() => {
      showToast('Actions added to test');
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

export function clearAll() {
  sendToBackground({ type: 'CLEAR_ALL' })
    .then(() => {
      document.getElementById('code-preview').textContent = '';
      refreshState();
    })
    .catch((e) => showToast(e?.message || 'Error'));
}

export async function copyCode() {
  const testName = document.getElementById('input-testname').value || 'recorded-test';
  const code = generateTestCode(testName, currentState.mocks, currentState.testSteps, currentState.startUrl);
  document.getElementById('code-preview').textContent = code;
  try {
    await navigator.clipboard.writeText(code);
    showToast('Code copied');
  } catch (e) {
    showToast(e?.message || 'Copy failed');
  }
}

export async function saveToFolder() {
  const testName = document.getElementById('input-testname').value || 'recorded-test';
  const code = generateTestCode(testName, currentState.mocks, currentState.testSteps, currentState.startUrl);
  const mocks = currentState.mocks || [];

  await chrome.storage.session.set({
    savePayload: { testName, code, mocks },
  });
  chrome.tabs.create({ url: chrome.runtime.getURL('picker.html') });
  showToast('New tab opened — select folder there');
}
