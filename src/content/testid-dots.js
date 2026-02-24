let _testIdDotsActive = false;
let _testIdDots = [];
let _testIdObserver = null;
let _testIdRefreshTimer = null;

export function enableTestIdHighlight() {
  if (_testIdDotsActive) return;
  _testIdDotsActive = true;
  _syncTestIdDots();
  window.addEventListener('scroll', _repositionTestIdDots, true);
  window.addEventListener('resize', _repositionTestIdDots);
  _startTestIdObserver();
}

export function disableTestIdHighlight() {
  _testIdDotsActive = false;
  _stopTestIdObserver();
  _removeTestIdDots();
  window.removeEventListener('scroll', _repositionTestIdDots, true);
  window.removeEventListener('resize', _repositionTestIdDots);
}

function _startTestIdObserver() {
  _stopTestIdObserver();
  _testIdObserver = new MutationObserver(function () {
    if (!_testIdDotsActive) return;
    clearTimeout(_testIdRefreshTimer);
    _testIdRefreshTimer = setTimeout(_syncTestIdDots, 200);
  });
  _testIdObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-testid', 'data-test-id', 'data-testId'],
  });
}

function _stopTestIdObserver() {
  if (_testIdObserver) {
    _testIdObserver.disconnect();
    _testIdObserver = null;
  }
  clearTimeout(_testIdRefreshTimer);
}

function _syncTestIdDots() {
  const currentEls = new Set(_testIdDots.map(function (item) { return item.el; }));
  const freshEls = new Set(document.querySelectorAll('[data-testid], [data-test-id], [data-testId]'));

  _testIdDots = _testIdDots.filter(function (item) {
    if (!freshEls.has(item.el) || !document.contains(item.el)) {
      if (item.dot.parentNode) item.dot.parentNode.removeChild(item.dot);
      return false;
    }
    return true;
  });

  freshEls.forEach(function (el) {
    if (currentEls.has(el)) return;
    const dot = document.createElement('div');
    dot.className = '__pw-rec-testid-dot';
    const s = dot.style;
    s.position = 'fixed';
    s.width = '12px';
    s.height = '12px';
    s.borderRadius = '50%';
    s.backgroundColor = 'rgba(76, 175, 80, 0.7)';
    s.border = '2px solid rgba(76, 175, 80, 1)';
    s.zIndex = '2147483646';
    s.pointerEvents = 'none';
    s.transition = 'top 0.1s, left 0.1s';
    const rect = el.getBoundingClientRect();
    s.top = (rect.top - 2) + 'px';
    s.left = (rect.left - 2) + 'px';
    document.documentElement.appendChild(dot);
    _testIdDots.push({ dot: dot, el: el });
  });

  _repositionTestIdDots();
}

function _removeTestIdDots() {
  _testIdDots.forEach(function (item) {
    if (item.dot.parentNode) item.dot.parentNode.removeChild(item.dot);
  });
  _testIdDots = [];
}

function _repositionTestIdDots() {
  _testIdDots.forEach(function (item) {
    if (!document.contains(item.el)) {
      item.dot.style.display = 'none';
      return;
    }
    const rect = item.el.getBoundingClientRect();
    item.dot.style.top = (rect.top - 2) + 'px';
    item.dot.style.left = (rect.left - 2) + 'px';
    item.dot.style.display = 'block';
  });
}
