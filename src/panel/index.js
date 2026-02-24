import { currentState, sendToBackground, refreshState, setUIUpdater, showToast } from './state.js';
import { updateUI } from './render.js';
import {
  startRecording, stopRecording, clearAll, addToTest,
  onCaptureAllChange, onTestIdHighlightChange, generateCode, saveToFolder,
} from './actions.js';
import { saveMockEdit, closeEditModal, saveExpectModal, closeExpectModal, addExpectRow, openExpectModal, openEditModal } from './modals.js';

setUIUpdater(updateUI);

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
  document.getElementById('checkbox-testid-highlight').addEventListener('change', onTestIdHighlightChange);
  document.getElementById('btn-generate').addEventListener('click', generateCode);
  document.getElementById('btn-save').addEventListener('click', saveToFolder);
  document.getElementById('btn-save-mock').addEventListener('click', saveMockEdit);
  document.getElementById('btn-cancel-edit').addEventListener('click', closeEditModal);
  document.getElementById('btn-expect-save').addEventListener('click', saveExpectModal);
  document.getElementById('btn-expect-cancel').addEventListener('click', closeExpectModal);
  document.getElementById('btn-expect-add-assertion').addEventListener('click', () => addExpectRow('assertion'));
  document.getElementById('btn-expect-add-custom').addEventListener('click', () => addExpectRow('custom'));

  const listActions = document.getElementById('list-actions');
  listActions.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete');
    if (deleteBtn) {
      const index = parseInt(deleteBtn.dataset.index, 10);
      sendToBackground({ type: 'REMOVE_ACTION', index })
        .then(() => refreshState())
        .catch((err) => showToast(err?.message || 'Error'));
      return;
    }
    const expectBtn = e.target.closest('.btn-expect');
    if (expectBtn) {
      const index = parseInt(expectBtn.dataset.index, 10);
      sendToBackground({ type: 'INSERT_EXPECT_REQUEST', index, url: expectBtn.dataset.url, method: expectBtn.dataset.method })
        .then(() => refreshState())
        .catch((err) => showToast(err?.message || 'Error'));
      return;
    }
    const addExpectBtn = e.target.closest('.btn-add-expect');
    if (addExpectBtn) {
      openExpectModal(parseInt(addExpectBtn.dataset.index, 10), addExpectBtn.dataset.mode);
      return;
    }
    const deleteExpectBtn = e.target.closest('.btn-delete-expect');
    if (deleteExpectBtn) {
      sendToBackground({
        type: 'REMOVE_EXPECT',
        actionIndex: parseInt(deleteExpectBtn.dataset.actionIndex, 10),
        expectIndex: parseInt(deleteExpectBtn.dataset.expectIndex, 10),
      })
        .then(() => refreshState())
        .catch((err) => showToast(err?.message || 'Error'));
      return;
    }
  });
  listActions.addEventListener('mouseover', (e) => {
    const li = e.target.closest('.action-item[data-action-index]');
    if (!li) return;
    const idx = parseInt(li.dataset.actionIndex, 10);
    const action = currentState.actions[idx];
    if (action && action.locatorInfo) {
      sendToBackground({
        type: 'HIGHLIGHT_ACTION_ELEMENT',
        locatorInfo: action.locatorInfo,
        innerLocatorInfo: action.innerLocatorInfo || null,
      }).catch((err) => console.warn('[PW Recorder]', err));
    }
  });
  listActions.addEventListener('mouseout', (e) => {
    const li = e.target.closest('.action-item[data-action-index]');
    if (!li) return;
    if (li.contains(e.relatedTarget)) return;
    sendToBackground({ type: 'UNHIGHLIGHT_ACTION_ELEMENT' }).catch((err) => console.warn('[PW Recorder]', err));
  });

  document.getElementById('list-mocks').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit-mock');
    if (editBtn) {
      const index = parseInt(editBtn.dataset.mockIndex, 10);
      const mock = currentState.mocks[index];
      if (mock) openEditModal(mock.url, mock.method);
    }
  });
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

  setInterval(() => {
    if (currentState.recording) {
      refreshState();
    }
  }, 3000);
});
