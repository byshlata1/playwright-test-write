import { state } from './state.js';

export const STATIC_REGEX = /\.(css|js|png|jpg|woff|svg|ico|gif)(\?|$)/i;

export const panelPorts = new Map();
export const panelVisible = new Map();

export function generateMockFilename(url) {
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

export function tryParseJSON(str) {
  if (str == null || typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function isStaticUrl(url) {
  try {
    return STATIC_REGEX.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

export function broadcastToTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(e => console.warn('[PW Recorder]', e));
      }
    });
  });
}

export function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(e => console.warn('[PW Recorder]', e));
}

export function sendHighlightState(tabId) {
  const visible = panelVisible.get(tabId) === true;
  const show = state.recording && visible && state._lastTabId === tabId;
  chrome.tabs.sendMessage(tabId, { type: show ? 'HIGHLIGHT_ON' : 'HIGHLIGHT_OFF' }).catch(e => console.warn('[PW Recorder]', e));
}
