export let currentState = {
  recording: false,
  startUrl: null,
  actions: [],
  testSteps: [],
  mocks: [],
  failedRequests: [],
  waitingForRequests: false,
};

export const editState = {
  editingMockUrl: null,
  editingMockMethod: null,
  editingExpectActionIndex: null,
  editingExpectMode: null, // 'expect' | 'custom'
  editingExpectRows: [], // { assertion, value?, custom? }
};

let _updateUI = null;

export function setUIUpdater(fn) {
  _updateUI = fn;
}

export function sendToBackground(message) {
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

export function refreshState() {
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
      if (_updateUI) _updateUI(currentState);
    })
    .catch(e => console.warn('[PW Recorder]', e));
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function truncate(str, max) {
  if (str == null) return '';
  const s = String(str);
  return s.length <= max ? s : s.slice(0, max) + '…';
}

export function showToast(message) {
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
