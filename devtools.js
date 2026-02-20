// Создание панели DevTools
const tabId = chrome.devtools.inspectedWindow.tabId;

const port = chrome.runtime.connect({ name: 'devtools-panel-' + tabId });

chrome.devtools.panels.create(
  'Playwright Recorder',
  '',
  'panel.html',
  (panel) => {
    console.log('Panel created');

    // Панель создана и отображается — сразу включаем подсветку
    port.postMessage({ type: 'PANEL_SHOWN', tabId });

    panel.onShown.addListener(() => {
      port.postMessage({ type: 'PANEL_SHOWN', tabId });
    });

    panel.onHidden.addListener(() => {
      port.postMessage({ type: 'PANEL_HIDDEN', tabId });
    });
  }
);
