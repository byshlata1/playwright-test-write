export const state = {
  recording: false,
  startUrl: null,
  actions: [],
  testSteps: [],
  mocks: new Map(),
  failedRequests: [],
  lastRequestTs: null,
  recordingStartedTs: null,
};

function serializeState() {
  const mocksArray = [];
  state.mocks.forEach(function (value, key) {
    mocksArray.push({ key, ...value });
  });
  return {
    recording: state.recording,
    startUrl: state.startUrl,
    actions: state.actions,
    testSteps: state.testSteps,
    mocks: mocksArray,
    failedRequests: state.failedRequests,
    lastRequestTs: state.lastRequestTs,
    recordingStartedTs: state.recordingStartedTs,
  };
}

function deserializeState(data) {
  if (!data) return;
  state.recording = !!data.recording;
  state.startUrl = data.startUrl ?? null;
  state.actions = Array.isArray(data.actions) ? data.actions : [];
  state.testSteps = Array.isArray(data.testSteps) ? data.testSteps : [];
  state.mocks = new Map();
  if (Array.isArray(data.mocks)) {
    data.mocks.forEach(function (entry) {
      const { key, ...value } = entry;
      if (key) state.mocks.set(key, value);
    });
  }
  state.failedRequests = Array.isArray(data.failedRequests) ? data.failedRequests : [];
  state.lastRequestTs = data.lastRequestTs ?? null;
  state.recordingStartedTs = data.recordingStartedTs ?? null;
}

let _persistTimer = null;
export function persistState() {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(function () {
    chrome.storage.session.set({ recorderState: serializeState() })
      .catch(function (e) { console.warn('[PW Recorder] persistState error:', e); });
  }, 100);
}

export function restoreState() {
  return chrome.storage.session.get('recorderState').then(function (result) {
    if (result && result.recorderState) {
      deserializeState(result.recorderState);
    }
  }).catch(function (e) {
    console.warn('[PW Recorder] restoreState error:', e);
  });
}
