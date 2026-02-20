// Content script — инъекция в веб-страницы, перехват fetch/XHR, запись действий

// Локальное состояние (content script)
let recording = false;
let captureAllClicks = false;
let highlightEnabled = false;
let lastMousePos = { x: 0, y: 0 };
let dragSource = null;

chrome.storage.local.get('captureAllClicks', (r) => { captureAllClicks = !!r.captureAllClicks; });

document.addEventListener('mousemove', function (e) {
  lastMousePos.x = e.clientX;
  lastMousePos.y = e.clientY;
  updateHighlight(e);
}, { passive: true });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureAllClicks) captureAllClicks = !!changes.captureAllClicks.newValue;
});

// inject.js загружается через manifest (world: MAIN) — без executeScript, обходит CSP

// --- Приоритет локаторов: 1) getByRole 2) getByLabel 3) getByTestId 4) getByText 5) CSS fallback ---

function escapeSelectorAttr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getAccessibleName(el) {
  const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  const tag = (el.tagName && el.tagName.toLowerCase()) || '';
  if (tag === 'img') {
    const alt = el.getAttribute && el.getAttribute('alt');
    if (alt != null) return alt.trim();
  }
  const text = (el.textContent && el.textContent.trim()) || '';
  if (text && text.length < 200) return text;
  return null;
}

function getImplicitRole(el) {
  const tag = (el.tagName && el.tagName.toLowerCase()) || '';
  const type = (el.type && el.type.toLowerCase()) || '';
  const role = el.getAttribute && el.getAttribute('role');
  if (role) return role.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && (el.href || el.getAttribute('href'))) return 'link';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button' || type === 'image') return 'button';
    if (type === 'search') return 'searchbox';
    if (type === 'email' || type === 'password' || type === 'tel' || type === 'url' || type === 'text' || !type) return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'img') return 'img';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'summary') return 'button';
  if (tag === 'nav') return 'navigation';
  if (tag === 'main') return 'main';
  if (tag === 'header') return 'banner';
  if (tag === 'footer') return 'contentinfo';
  if (tag === 'table') return 'table';
  if (tag === 'ul' || tag === 'ol') return 'list';
  return null;
}

function getHeadingLevel(tag) {
  const m = (tag || '').match(/^h([1-6])$/i);
  return m ? parseInt(m[1], 10) : null;
}

function getLabelForFormControl(el) {
  if (!el || !el.getAttribute) return null;
  const tag = (el.tagName && el.tagName.toLowerCase()) || '';
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return null;
  const id = el.id;
  if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
    const label = document.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
    if (label && label.textContent) return label.textContent.trim().replace(/\s+/g, ' ').slice(0, 100);
  }
  let parent = el.parentElement;
  while (parent && parent.nodeType === 1) {
    if (parent.tagName && parent.tagName.toLowerCase() === 'label') {
      return (parent.textContent && parent.textContent.trim().replace(/\s+/g, ' ').slice(0, 100)) || null;
    }
    parent = parent.parentElement;
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  if (tag === 'input' || tag === 'textarea') {
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
  }
  return null;
}

function isTextUnique(text) {
  if (!text || text.length > 150) return false;
  const all = document.querySelectorAll('*:not(script):not(style)');
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const t = el.textContent && el.textContent.trim().replace(/\s+/g, ' ');
    if (t !== text) continue;
    let ownedByChild = false;
    for (let j = 0; j < el.children.length; j++) {
      const ct = el.children[j].textContent && el.children[j].textContent.trim().replace(/\s+/g, ' ');
      if (ct === text) { ownedByChild = true; break; }
    }
    if (!ownedByChild) count++;
    if (count > 1) return false;
  }
  return count === 1;
}

// Макс. сегментов — длинный путь ломается при малейшем изменении DOM
var _cssFallbackMaxDepth = 8;
function generateCssFallback(element) {
  var el = element;
  var id = el.getAttribute && el.getAttribute('id');
  if (id && /^[a-zA-Z_-][\w-]*$/.test(id)) return '#' + id;

  var path = [];
  var depth = 0;
  while (el && el.nodeType === 1 && depth < _cssFallbackMaxDepth) {
    var part = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\s+/).filter(function (c) {
        if (!c || /^\d/.test(c)) return false;
        if (/_[a-z0-9]{4,}$/i.test(c)) return false;
        return true;
      });
      if (classes.length) part += '.' + classes.slice(0, 2).join('.');
    }
    if (el.parentElement) {
      var siblings = Array.from(el.parentElement.children).filter(function (c) {
        return c.tagName === el.tagName;
      });
      if (siblings.length > 1) {
        var idx = siblings.indexOf(el) + 1;
        part += ':nth-of-type(' + idx + ')';
      }
    }
    path.unshift(part);
    el = el.parentElement;
    depth++;
    if (el && (el.tagName === 'BODY' || el.tagName === 'HTML')) break;
  }
  return path.length ? path.join(' > ') : element.tagName.toLowerCase();
}

/** Ищем родителя с массивом похожих детей (таблица, список, контейнер). Возвращает { container, childTag, index } */
function getNthChildContext(el) {
  var row = el;
  while (row && row.nodeType === 1) {
    var parent = row.parentElement;
    if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
    var tag = (row.tagName && row.tagName.toLowerCase()) || '';
    var sameTagSiblings = Array.from(parent.children).filter(function (c) { return (c.tagName && c.tagName.toLowerCase()) === tag; });
    if (sameTagSiblings.length >= 2) {
      var idx = sameTagSiblings.indexOf(row);
      if (idx >= 0) {
        var containerTag = (parent.tagName && parent.tagName.toLowerCase()) || '';
        var hasTestId = function (n) { return n && n.getAttribute && (n.getAttribute('data-testid') || n.getAttribute('data-test-id')); };
        var useNth =
          (tag === 'tr' && (containerTag === 'tbody' || containerTag === 'thead' || containerTag === 'tfoot' || containerTag === 'table')) ||
          (tag === 'li' && (containerTag === 'ul' || containerTag === 'ol')) ||
          (tag === 'option' && containerTag === 'select') ||
          (tag === 'dt' || tag === 'dd') ||
          hasTestId(parent) ||
          hasTestId(row) ||
          ((tag === 'div' || tag === 'section' || tag === 'article') && sameTagSiblings.length >= 2);
        if (useNth) return { container: parent, childTag: tag, index: idx };
      }
    }
    row = parent;
  }
  return null;
}

/** Если элемент (или его предок с testId) среди siblings с тем же testId — возвращает { index, testId, attr } */
function getNthAmongSiblings(el) {
  var check = el;
  while (check && check.nodeType === 1) {
    var tid = check.getAttribute && (check.getAttribute('data-testid') || check.getAttribute('data-test-id'));
    if (tid) {
      var parent = check.parentElement;
      if (!parent) return null;
      var siblings = Array.from(parent.children).filter(function (c) {
        var ct = c.getAttribute && (c.getAttribute('data-testid') || c.getAttribute('data-test-id'));
        return ct === tid;
      });
      if (siblings.length > 1) {
        var idx = siblings.indexOf(check);
        if (idx >= 0) return { index: idx, testId: tid, attr: check.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid' };
      }
    }
    check = check.parentElement;
    if (check && (check.tagName === 'BODY' || check.tagName === 'HTML')) break;
  }
  return null;
}

/** Возвращает { locatorInfo, selector }. locatorInfo — приоритетный метод для Playwright */
function generateLocatorInfo(element) {
  if (!element || !element.tagName) return { locatorInfo: null, selector: null };

  let cssFallback = generateCssFallback(element);

  const testId =
    (element.getAttribute && element.getAttribute('data-testid')) ||
    (element.getAttribute && element.getAttribute('data-test-id'));

  const tag = element.tagName.toLowerCase();
  const role = getImplicitRole(element);
  const name = getAccessibleName(element);
  const label = getLabelForFormControl(element);
  const text = (element.textContent && element.textContent.trim().replace(/\s+/g, ' ')) || '';

  let locatorInfo = null;
  var nthInfo = getNthAmongSiblings(element);

  // 1. testId — явный контракт от разработчиков, всегда приоритет
  if (testId) {
    const attr = element.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid';
    locatorInfo = { method: 'testId', value: testId, attr: attr };
    if (nthInfo && nthInfo.testId === testId) locatorInfo.nthIndex = nthInfo.index;
  }

  // 2. getByRole — accessibility, только если name короткий и читаемый
  if (!locatorInfo && role && (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio' || role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'heading' || role === 'menuitem' || role === 'tab' || role === 'option' || role === 'img' || role === 'table' || role === 'list')) {
    const headingLevel = getHeadingLevel(tag);
    if (role === 'heading' && headingLevel) {
      if (name && name.length <= 60) locatorInfo = { method: 'role', role: role, name: name, level: headingLevel };
      else locatorInfo = { method: 'role', role: role, level: headingLevel };
    } else if (name && name.length <= 60) {
      locatorInfo = { method: 'role', role: role, name: name };
    } else if (role === 'table' || role === 'list') {
      locatorInfo = { method: 'role', role: role, name: name || undefined };
    } else if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      locatorInfo = { method: 'role', role: role, name: label || undefined };
    }
  }

  // 3. getByLabel — семантика форм
  if (!locatorInfo && label && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
    locatorInfo = { method: 'label', label: label };
  }

  // 4. getByText — уникальный короткий текст
  if (!locatorInfo && text && text.length <= 60 && isTextUnique(text)) {
    locatorInfo = { method: 'text', text: text };
  }

  // 5. CSS fallback — но сначала пробуем родителя (SVG/иконка внутри button → используем button)
  if (!locatorInfo) {
    var ancestor = getClickTarget(element);
    if (ancestor && ancestor !== element) {
      var ancInfo = generateLocatorInfo(ancestor);
      if (ancInfo.locatorInfo && ancInfo.locatorInfo.method !== 'css') {
        locatorInfo = ancInfo.locatorInfo;
        if (ancInfo.selector) {
          cssFallback = ancInfo.selector;
        }
      }
    }
    if (!locatorInfo) {
      locatorInfo = { method: 'css', selector: cssFallback };
    }
  }

  const selector = testId
    ? '[' + (element.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid') + '="' + escapeSelectorAttr(testId) + '"]'
    : cssFallback;

  return { locatorInfo, selector };
}

function generateSelector(element) {
  const r = generateLocatorInfo(element);
  return r.selector;
}

// --- Highlight overlay ---
function locatorInfoToText(info) {
  if (!info || !info.method) return '';
  var nthSuffix = (typeof info.nthIndex === 'number' && info.nthIndex >= 0) ? '.nth(' + info.nthIndex + ')' : '';
  if (info.method === 'nthChild') {
    var base = ".locator('" + (info.childSelector || '> *') + "')" + (typeof info.nthIndex === 'number' ? '.nth(' + info.nthIndex + ')' : '');
    return base + (info.inner ? '.' + locatorInfoToText(info.inner) : '');
  }
  switch (info.method) {
    case 'role': {
      const opts = [];
      if (info.name) opts.push("name: '" + info.name + "'");
      if (info.level != null) opts.push('level: ' + info.level);
      const optStr = opts.length ? ', { ' + opts.join(', ') + ' }' : '';
      return "getByRole('" + info.role + "'" + optStr + ')' + nthSuffix;
    }
    case 'label':
      return "getByLabel('" + info.label + "')" + nthSuffix;
    case 'testId':
      return "getByTestId('" + info.value + "')" + nthSuffix;
    case 'text':
      return "getByText('" + (info.text.length > 40 ? info.text.slice(0, 37) + '...' : info.text) + "')" + nthSuffix;
    case 'css':
      return "locator('" + (info.selector.length > 50 ? info.selector.slice(0, 47) + '...' : info.selector) + "')" + nthSuffix;
    case 'rowCell':
      return (info.rowText ? "getByText('" + (info.rowText.length > 35 ? info.rowText.slice(0, 32) + '...' : info.rowText) + "')" : '') + (info.cellText ? ".getByText('" + (info.cellText.length > 35 ? info.cellText.slice(0, 32) + '...' : info.cellText) + "')" : (info.dataIndex ? ".locator('[data-index=\"" + info.dataIndex + "\"]')" : ''));
    default:
      return '';
  }
}

var _highlightGlass = null;
var _highlightBox = null;
var _highlightTooltip = null;
var _highlightedEl = null;

var _scrollbarOverlayStyle = null;

function injectScrollbarFix() {
  if (_scrollbarOverlayStyle) return;
  _scrollbarOverlayStyle = document.createElement('style');
  _scrollbarOverlayStyle.id = '__pw-rec-scrollbar-fix';
  _scrollbarOverlayStyle.textContent = '[class*="scrollbar__placeholder"]{pointer-events:none!important}';
  (document.head || document.documentElement).appendChild(_scrollbarOverlayStyle);
}

function removeScrollbarFix() {
  if (_scrollbarOverlayStyle && _scrollbarOverlayStyle.parentNode) {
    _scrollbarOverlayStyle.parentNode.removeChild(_scrollbarOverlayStyle);
  }
  _scrollbarOverlayStyle = null;
}

function getElementUnderPoint(x, y) {
  var el = document.elementFromPoint(x, y);
  if (el && _highlightGlass && _highlightGlass.contains(el)) return null;
  return el;
}

function ensureHighlightOverlay() {
  injectScrollbarFix();
  if (_highlightGlass) return;
  _highlightGlass = document.createElement('div');
  _highlightGlass.id = '__pw-rec-glass';
  var gs = _highlightGlass.style;
  gs.position = 'fixed';
  gs.top = '0'; gs.left = '0'; gs.width = '100%'; gs.height = '100%';
  gs.pointerEvents = 'none';
  gs.zIndex = '2147483647';

  _highlightBox = document.createElement('div');
  _highlightBox.id = '__pw-rec-highlight';
  var bs = _highlightBox.style;
  bs.position = 'absolute';
  bs.border = '2px solid #6fa8dc';
  bs.backgroundColor = 'rgba(111, 168, 220, 0.15)';
  bs.borderRadius = '3px';
  bs.transition = 'all 0.05s ease-out';
  bs.display = 'none';
  bs.pointerEvents = 'none';

  _highlightTooltip = document.createElement('div');
  _highlightTooltip.id = '__pw-rec-tooltip';
  var ts = _highlightTooltip.style;
  ts.position = 'absolute';
  ts.background = '#fff';
  ts.color = '#333';
  ts.fontFamily = "Monaco, Menlo, 'Courier New', monospace";
  ts.fontSize = '12px';
  ts.lineHeight = '1.4';
  ts.padding = '5px 10px';
  ts.borderRadius = '6px';
  ts.boxShadow = '0 2px 12px rgba(0,0,0,0.25)';
  ts.whiteSpace = 'nowrap';
  ts.maxWidth = '500px';
  ts.overflow = 'hidden';
  ts.textOverflow = 'ellipsis';
  ts.display = 'none';
  ts.pointerEvents = 'none';
  ts.zIndex = '2147483647';
  ts.backdropFilter = 'blur(4px)';

  _highlightGlass.appendChild(_highlightBox);
  _highlightGlass.appendChild(_highlightTooltip);
  document.documentElement.appendChild(_highlightGlass);
}

function removeHighlightOverlay() {
  removeScrollbarFix();
  if (_highlightGlass && _highlightGlass.parentNode) {
    _highlightGlass.parentNode.removeChild(_highlightGlass);
  }
  _highlightGlass = null;
  _highlightBox = null;
  _highlightTooltip = null;
  _highlightedEl = null;
}

// --- Action highlight overlay (red, triggered from DevTools panel) ---
var _actionHighlightBox = null;

function findElementByLocatorInfo(info, root) {
  if (!info || !info.method) return null;
  var searchRoot = root || document.body;

  switch (info.method) {
    case 'testId': {
      var attr = info.attr || 'data-testid';
      var nodes = searchRoot.querySelectorAll('[' + attr + '="' + escapeSelectorAttr(info.value) + '"]');
      if (typeof info.nthIndex === 'number' && info.nthIndex >= 0 && info.nthIndex < nodes.length) return nodes[info.nthIndex];
      return nodes[0] || null;
    }
    case 'text': {
      if (!info.text) return null;
      var all = searchRoot.querySelectorAll('*:not(script):not(style)');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var t = el.textContent && el.textContent.trim().replace(/\s+/g, ' ');
        if (t !== info.text) continue;
        var leaf = true;
        for (var j = 0; j < el.children.length; j++) {
          var ct = el.children[j].textContent && el.children[j].textContent.trim().replace(/\s+/g, ' ');
          if (ct === info.text) { leaf = false; break; }
        }
        if (leaf) return el;
      }
      return null;
    }
    case 'role': {
      var all = searchRoot.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (getImplicitRole(el) !== info.role) continue;
        if (info.name) {
          var elName = getAccessibleName(el);
          if (!elName || elName !== info.name) continue;
        }
        if (info.level != null) {
          var tag = el.tagName && el.tagName.toLowerCase();
          if (getHeadingLevel(tag) !== info.level) continue;
        }
        return el;
      }
      return null;
    }
    case 'label': {
      var controls = searchRoot.querySelectorAll('input, select, textarea');
      for (var i = 0; i < controls.length; i++) {
        if (getLabelForFormControl(controls[i]) === info.label) return controls[i];
      }
      return null;
    }
    case 'css': {
      try { return searchRoot.querySelector(info.selector); } catch (_) { return null; }
    }
    case 'nthChild': {
      var sel = (info.childSelector || '> *').trim();
      var parts = sel.split(/\s*>\s*/).map(function (p) { return p.trim().toLowerCase(); });
      var root = searchRoot;
      if (parts.length >= 2 && parts[0] !== '') {
        var first = root.querySelector(parts[0]);
        if (first) root = first;
      }
      var tag = parts.length >= 2 ? parts[parts.length - 1] : parts[0].replace(/^>\s*/, '') || '*';
      var direct = Array.from(root.children).filter(function (c) {
        var ct = (c.tagName && c.tagName.toLowerCase()) || '';
        return tag === '*' || ct === tag;
      });
      var idx = typeof info.nthIndex === 'number' && info.nthIndex >= 0 ? info.nthIndex : 0;
      var row = direct[idx];
      if (!row) return null;
      if (info.inner) return findElementByLocatorInfo(info.inner, row);
      return row;
    }
    case 'rowCell': {
      if (!info.rowText) return null;
      var rowEl = findElementByLocatorInfo({ method: 'text', text: info.rowText }, searchRoot);
      if (!rowEl) return null;
      var row = rowEl;
      while (row && row.parentElement && row.parentElement !== searchRoot) {
        if (row.children && row.children.length > 1) break;
        row = row.parentElement;
      }
      if (!row) return null;
      var withinRow = row;
      if (info.cellText) {
        var cells = withinRow.querySelectorAll('*');
        for (var i = 0; i < cells.length; i++) {
          var t = cells[i].textContent && cells[i].textContent.trim().replace(/\s+/g, ' ');
          if (t === info.cellText) return cells[i];
        }
      } else if (info.dataIndex) {
        var cell = withinRow.querySelector('[data-index="' + escapeSelectorAttr(info.dataIndex) + '"]');
        if (cell) return cell;
      }
      return null;
    }
    default:
      return null;
  }
}

function showActionHighlight(locatorInfo, innerLocatorInfo) {
  var el = null;
  if (locatorInfo) {
    var scope = findElementByLocatorInfo(locatorInfo, document.body);
    if (scope && innerLocatorInfo) {
      el = findElementByLocatorInfo(innerLocatorInfo, scope);
    } else {
      el = scope;
    }
  }
  if (!el) return;

  if (!_actionHighlightBox) {
    _actionHighlightBox = document.createElement('div');
    _actionHighlightBox.id = '__pw-rec-action-highlight';
    var s = _actionHighlightBox.style;
    s.position = 'fixed';
    s.border = '2px solid rgba(255, 0, 0, 0.5)';
    s.backgroundColor = 'rgba(255, 0, 0, 0.15)';
    s.borderRadius = '3px';
    s.pointerEvents = 'none';
    s.zIndex = '2147483646';
    s.transition = 'all 0.08s ease-out';
    document.documentElement.appendChild(_actionHighlightBox);
  }

  var rect = el.getBoundingClientRect();
  var s = _actionHighlightBox.style;
  s.left = rect.left + 'px';
  s.top = rect.top + 'px';
  s.width = rect.width + 'px';
  s.height = rect.height + 'px';
  s.display = 'block';
}

function hideActionHighlight() {
  if (_actionHighlightBox) {
    _actionHighlightBox.style.display = 'none';
  }
}

// Scope: ближайший предок с testId, button/a, или контейнер (table, tbody, ul, ol)
function findScope(el) {
  var check = el.parentElement;
  while (check && check.nodeType === 1) {
    if (check.tagName === 'BODY' || check.tagName === 'HTML') return null;
    var tid = check.getAttribute && (check.getAttribute('data-testid') || check.getAttribute('data-test-id'));
    var tag = (check.tagName && check.tagName.toLowerCase()) || '';
    if (tid || tag === 'button' || tag === 'a') return check;
    if (tag === 'table' || tag === 'tbody' || tag === 'ul' || tag === 'ol' || tag === 'select') return check;
    check = check.parentElement;
  }
  return null;
}

// Возвращает { target (для рамки), text (для tooltip), method (для badge) }
// Любой элемент на любой глубине — всегда возвращаем результат. Выбираем лучший селектор.
function getHighlightInfo(el) {
  while (el && el instanceof SVGElement) el = el.parentElement;
  if (!el || el.tagName === 'HTML' || el.tagName === 'BODY') return null;

  var elInfo = generateLocatorInfo(el);
  if (!elInfo || !elInfo.locatorInfo) {
    var fb = generateCssFallback(el);
    return { target: el, text: "locator('" + (fb || el.tagName.toLowerCase()) + "')", method: 'css', locatorInfo: { method: 'css', selector: fb }, innerLocatorInfo: null, selector: fb };
  }

  var scope = findScope(el);
  var nthCtx = getNthChildContext(el);

  if (scope) {
    var scopeInfo = generateLocatorInfo(scope);
    if (scopeInfo && scopeInfo.locatorInfo) {
      var scopeText = locatorInfoToText(scopeInfo.locatorInfo);
      if (scopeText) {
        if (nthCtx && scope.contains(nthCtx.container)) {
          var containerScope = nthCtx.container;
          var childSelector = '> ' + nthCtx.childTag;
          if (containerScope.tagName && containerScope.tagName.toLowerCase() === 'tbody') {
            containerScope = containerScope.parentElement || containerScope;
            if (containerScope.tagName && containerScope.tagName.toLowerCase() === 'table') childSelector = 'tbody > ' + nthCtx.childTag;
          }
          var containerInfo = generateLocatorInfo(containerScope);
          if (containerInfo && containerInfo.locatorInfo && containerInfo.locatorInfo.method !== 'css') {
            var nthChildInner = { method: 'nthChild', childSelector: childSelector, nthIndex: nthCtx.index };
            var sameTag = Array.from(nthCtx.container.children).filter(function (c) { return (c.tagName && c.tagName.toLowerCase()) === nthCtx.childTag; });
            var rowEl = sameTag[nthCtx.index];
            if (el === rowEl || (rowEl && rowEl.contains(el))) {
              var innerLoc = nthChildInner;
              if (el !== rowEl) {
                var elInRowInfo = generateLocatorInfo(el);
                if (elInRowInfo && elInRowInfo.locatorInfo && elInRowInfo.locatorInfo.method !== 'css') {
                  innerLoc = { method: 'nthChild', childSelector: nthChildInner.childSelector, nthIndex: nthChildInner.nthIndex, inner: elInRowInfo.locatorInfo };
                }
              }
              var displayText = locatorInfoToText(containerInfo.locatorInfo) + '.' + locatorInfoToText(innerLoc);
              return { target: el, text: displayText, method: 'nthChild', locatorInfo: containerInfo.locatorInfo, innerLocatorInfo: innerLoc, selector: containerInfo.selector };
            }
          }
        }
        if (el.children && el.children.length > 1 && scopeInfo.locatorInfo.method !== 'css') {
          var childLocator = findBestChildLocator(el);
          if (childLocator && !(childLocator.method === 'testId' && scopeInfo.locatorInfo.method === 'testId' && childLocator.value === scopeInfo.locatorInfo.value)) {
            var innerText = locatorInfoToText(childLocator);
            if (innerText) return { target: el, text: scopeText + '.' + innerText, method: childLocator.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: childLocator, selector: scopeInfo.selector };
          }
        }
        if (elInfo.locatorInfo.method !== 'css') {
          var dup = elInfo.locatorInfo.method === 'testId' && scopeInfo.locatorInfo.method === 'testId' && elInfo.locatorInfo.value === scopeInfo.locatorInfo.value;
          if (!dup) {
            var innerText = locatorInfoToText(elInfo.locatorInfo);
            if (innerText) return { target: el, text: scopeText + '.' + innerText, method: elInfo.locatorInfo.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: elInfo.locatorInfo, selector: scopeInfo.selector };
          }
        }
        var rowCellLoc = findRowCellLocator(el, scope);
        if (rowCellLoc) {
          var rcText = locatorInfoToText(rowCellLoc);
          if (rcText) return { target: el, text: scopeText + '.' + rcText, method: 'rowCell', locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: rowCellLoc, selector: scopeInfo.selector };
        }
        if (elInfo.locatorInfo && elInfo.locatorInfo.method === 'css' && scope.contains(el) && el !== scope) {
          var cssText = locatorInfoToText(elInfo.locatorInfo);
          if (cssText) return { target: el, text: scopeText + '.' + cssText, method: 'css', locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: elInfo.locatorInfo, selector: scopeInfo.selector };
        }
        var row = el.parentElement;
        while (row && row.tagName !== 'BODY' && row.tagName !== 'HTML' && scope.contains(row) && row !== scope) {
          if (row.children && row.children.length > 1) {
            var rowChild = findBestChildLocator(row);
            if (rowChild && !(rowChild.method === 'testId' && scopeInfo.locatorInfo.method === 'testId' && rowChild.value === scopeInfo.locatorInfo.value)) {
              var rowText = locatorInfoToText(rowChild);
              if (rowText) return { target: row, text: scopeText + '.' + rowText, method: rowChild.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: rowChild, selector: scopeInfo.selector };
            }
          }
          row = row.parentElement;
        }
        return { target: el, text: scopeText, method: scopeInfo.locatorInfo.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: null, selector: scopeInfo.selector };
      }
    }
  }

  var text = locatorInfoToText(elInfo.locatorInfo);
  if (text) return { target: el, text: text, method: elInfo.locatorInfo.method, locatorInfo: elInfo.locatorInfo, innerLocatorInfo: null, selector: elInfo.selector };
  var fb = elInfo.selector || generateCssFallback(el);
  return { target: el, text: "locator('" + (fb || el.tagName.toLowerCase()) + "')", method: 'css', locatorInfo: { method: 'css', selector: fb }, innerLocatorInfo: null, selector: fb };
}

var METHOD_COLORS = {
  role: '#2e7d32', label: '#1565c0', testId: '#6a1b9a', text: '#e65100', css: '#757575', rowCell: '#e65100'
};
var METHOD_BADGES = {
  role: 'ROLE', label: 'LABEL', testId: 'TEST-ID', text: 'TEXT', css: 'CSS', rowCell: 'TEXT'
};

function updateHighlight(event) {
  if (!recording || !highlightEnabled) {
    if (_highlightGlass) removeHighlightOverlay();
    return;
  }
  ensureHighlightOverlay();
  var x = event.clientX;
  var y = event.clientY;
  var el = getElementUnderPoint(x, y);
  if (!el) {
    var path = event.composedPath ? event.composedPath() : [event.target];
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      if (p && p.nodeType === 1 && p.tagName !== 'HTML' && p.tagName !== 'BODY') {
        el = p;
        break;
      }
    }
  }
  if (!el) {
    _highlightBox.style.display = 'none';
    _highlightTooltip.style.display = 'none';
    _highlightedEl = null;
    return;
  }

  var info = getHighlightInfo(el);
  if (!info || !info.text) {
    _highlightBox.style.display = 'none';
    _highlightTooltip.style.display = 'none';
    _highlightedEl = null;
    return;
  }

  if (info.target === _highlightedEl) return;
  _highlightedEl = info.target;

  console.log('[Playwright Recorder] HIGHLIGHT:', info.text, '| target:', info.target.tagName, info.target.id || '', info.target);

  var rect = info.target.getBoundingClientRect();
  _highlightBox.style.left = rect.left + 'px';
  _highlightBox.style.top = rect.top + 'px';
  _highlightBox.style.width = rect.width + 'px';
  _highlightBox.style.height = rect.height + 'px';
  _highlightBox.style.display = 'block';

  var badge = METHOD_BADGES[info.method] || 'CSS';
  var badgeColor = METHOD_COLORS[info.method] || '#757575';
  _highlightTooltip.innerHTML = '<span style="display:inline-block;background:' + badgeColor + ';color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-right:6px;vertical-align:middle;letter-spacing:0.5px">' + badge + '</span><span style="vertical-align:middle">' + info.text.replace(/</g, '&lt;') + '</span>';
  _highlightTooltip.style.display = 'block';

  var tooltipLeft = Math.max(4, rect.left);
  var tooltipTop = rect.bottom + 6;
  if (tooltipTop + 30 > window.innerHeight) {
    tooltipTop = Math.max(0, rect.top - 32);
  }
  if (tooltipLeft + _highlightTooltip.offsetWidth > window.innerWidth - 4) {
    tooltipLeft = Math.max(4, window.innerWidth - _highlightTooltip.offsetWidth - 4);
  }
  _highlightTooltip.style.left = tooltipLeft + 'px';
  _highlightTooltip.style.top = tooltipTop + 'px';
}

// --- Отправка действия в background ---
function sendAction(data) {
  var locatorStr = '';
  if (data.locatorInfo) {
    locatorStr = locatorInfoToText(data.locatorInfo);
    if (data.innerLocatorInfo) locatorStr += '.' + locatorInfoToText(data.innerLocatorInfo);
  } else if (data.selector) locatorStr = data.selector;
  console.log('[Playwright Recorder] ACTION:', data.type || '?', '|', locatorStr || '[raw]', '| target:', data.tagName);
  chrome.runtime.sendMessage({ type: 'ADD_ACTION', data: data }).catch(function () {});
}

// --- Слушатель сообщений от background ---
chrome.runtime.onMessage.addListener(function (message) {
  if (message.type === 'START_RECORDING') {
    recording = true;
    window.postMessage({ type: 'START_RECORDING', startUrl: message.startUrl || null }, '*');
    console.log('[Playwright Recorder] Recording started', message.startUrl);
  } else if (message.type === 'STOP_RECORDING') {
    recording = false;
    highlightEnabled = false;
    removeHighlightOverlay();
    window.postMessage({ type: 'STOP_RECORDING' }, '*');
    console.log('[Playwright Recorder] Recording stopped');
  } else if (message.type === 'HIGHLIGHT_ON') {
    highlightEnabled = true;
    if (recording) ensureHighlightOverlay();
  } else if (message.type === 'HIGHLIGHT_OFF') {
    highlightEnabled = false;
    removeHighlightOverlay();
  } else if (message.type === 'HIGHLIGHT_ACTION_ELEMENT') {
    showActionHighlight(message.locatorInfo, message.innerLocatorInfo);
  } else if (message.type === 'UNHIGHLIGHT_ACTION_ELEMENT') {
    hideActionHighlight();
  }
});

// При загрузке страницы проверяем: если запись уже идёт (напр. после refresh), включаем её
chrome.runtime.sendMessage({ type: 'GET_STATE' }, function (state) {
  if (chrome.runtime.lastError) return;
  if (state && state.recording) {
    recording = true;
    window.postMessage({
      type: 'START_RECORDING',
      startUrl: state.startUrl || null,
    }, '*');
    console.log('[Playwright Recorder] Recording resumed after page load', state.startUrl);
    // Запрашиваем подсветку — background отправит HIGHLIGHT_ON если панель видима
    chrome.runtime.sendMessage({ type: 'REQUEST_HIGHLIGHT_STATE' }).catch(function () {});
  }
});

// --- Пересылка REQUEST_CAPTURED в background ---
window.addEventListener(
  'message',
  function (e) {
    if (e.source !== window || e.data?.type !== 'REQUEST_CAPTURED_PAGE') return;
    chrome.runtime.sendMessage({ type: 'REQUEST_CAPTURED', data: e.data.data }).catch(function () {});
  },
  false
);

// --- Ищем control для label (checkbox/radio внутри label → возвращаем input) ---
function getLabelControl(labelEl) {
  if (!labelEl || labelEl.tagName.toLowerCase() !== 'label') return null;
  const forId = labelEl.getAttribute && labelEl.getAttribute('for');
  if (forId) {
    const control = document.getElementById(forId);
    if (control && control.tagName && control.tagName.toLowerCase() === 'input' && (control.type === 'checkbox' || control.type === 'radio')) return control;
    return null;
  }
  const input = labelEl.querySelector && labelEl.querySelector('input[type="checkbox"], input[type="radio"]');
  return input || null;
}

// --- Ищем ближайший интерактивный элемент (клик по span внутри button → записываем button) ---
// Семантические элементы (button, a, input, role=button, testId) всегда приоритетнее.
// Label с checkbox/radio внутри → возвращаем input (записываем check/uncheck, не click+fill).
function getClickTarget(element) {
  if (!element || !element.tagName) return null;
  let el = element;
  let classCandidate = null;
  while (el && el.nodeType === 1) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute && el.getAttribute('role');
    const hasTestId = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));

    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea') return el;
    if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'option') return el;
    if (tag === 'label' || tag === 'summary') {
      const control = getLabelControl(el);
      if (control) return control;
      return el;
    }
    if (el.hasAttribute && (el.hasAttribute('onclick') || el.hasAttribute('tabindex'))) return el;
    if (hasTestId && !/^(tbody|thead|table|main|section|article)$/.test(tag)) return el;
    if (!classCandidate) {
      const cls = (el.className && typeof el.className === 'string' ? el.className : '') || '';
      if ((tag === 'div' || tag === 'span') && /btn|button|cta|action/.test(cls.toLowerCase())) {
        classCandidate = el;
      }
    }
    el = el.parentElement;
    if (el && (el.tagName === 'BODY' || el.tagName === 'HTML')) break;
  }
  return classCandidate;
}

function findRowCellLocator(el, scope) {
  var row = el.parentElement;
  while (row && row.tagName !== 'BODY' && row.tagName !== 'HTML') {
    if (scope && scope.contains(row) && row !== scope && row.children && row.children.length > 1) {
      var rowChild = findBestChildLocator(row);
      if (rowChild && rowChild.method === 'text' && rowChild.text) {
        var cell = el;
        while (cell && cell.parentElement && cell.parentElement !== row) cell = cell.parentElement;
        var cellText = (cell && cell.textContent) ? cell.textContent.trim().replace(/\s+/g, ' ') : '';
        var dataIndex = (cell && cell.getAttribute) ? cell.getAttribute('data-index') : null;
        if (cellText || dataIndex) return { method: 'rowCell', rowText: rowChild.text, cellText: cellText || undefined, dataIndex: dataIndex || undefined };
      }
    }
    row = row.parentElement;
  }
  return null;
}

/** For container elements (table rows, cards, list items), find a child with unique short text */
function findBestChildLocator(el) {
  if (!el || !el.children) return null;
  function search(parent, maxDepth) {
    for (var i = 0; i < parent.children.length; i++) {
      var child = parent.children[i];
      var tid = child.getAttribute && (child.getAttribute('data-testid') || child.getAttribute('data-test-id'));
      if (tid) {
        return { method: 'testId', value: tid, attr: child.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid' };
      }
      var text = child.textContent && child.textContent.trim().replace(/\s+/g, ' ');
      if (text && text.length > 0 && text.length <= 60 && isTextUnique(text)) {
        return { method: 'text', text: text };
      }
      if (maxDepth > 0 && child.children && child.children.length > 0) {
        var found = search(child, maxDepth - 1);
        if (found) return found;
      }
    }
    return null;
  }
  return search(el, 2);
}

// --- Отслеживание действий (capture: true) ---
var clickDebounceTimer;
document.addEventListener(
  'click',
  function (e) {
    if (!recording) return;

    var under = getElementUnderPoint(e.clientX, e.clientY);
    const clickedEl = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);
    const target = getClickTarget(clickedEl) || clickedEl;

    if (!captureAllClicks) {
      // Используем clickedEl для локатора — это тот же элемент, что подсвечивается при hover.
      // target нужен только для типа экшена (check/uncheck vs click).
      var info = getHighlightInfo(clickedEl);
      if (info && info.locatorInfo) {
        var payload = {
          selector: info.selector,
          locatorInfo: info.locatorInfo,
          innerLocatorInfo: info.innerLocatorInfo || null,
          tagName: (target.matches && target.matches('input[type="checkbox"]') ? target : info.target).tagName.toLowerCase(),
          timestamp: Date.now(),
        };
        if (target.matches && target.matches('input[type="checkbox"]')) {
          clearTimeout(clickDebounceTimer);
          setTimeout(function () {
            sendAction({ ...payload, type: target.checked ? 'check' : 'uncheck' });
          }, 0);
        } else {
          clearTimeout(clickDebounceTimer);
          clickDebounceTimer = setTimeout(function () {
            sendAction({ ...payload, type: 'click' });
          }, 250);
        }
        return;
      }
    }

    if (!target) return;
    if (target.matches && target.matches('select')) return;

    const { locatorInfo, selector } = generateLocatorInfo(target);
    if (!selector) return;

    const tagName = target.tagName.toLowerCase();
    const fallbackPayload = { selector, locatorInfo, tagName, timestamp: Date.now() };
    if (target.matches && target.matches('input[type="checkbox"]')) {
      clearTimeout(clickDebounceTimer);
      setTimeout(function () {
        sendAction({ ...fallbackPayload, type: target.checked ? 'check' : 'uncheck' });
      }, 0);
      return;
    }
    clearTimeout(clickDebounceTimer);
    clickDebounceTimer = setTimeout(function () {
      sendAction({ ...fallbackPayload, type: 'click' });
    }, 250);
  },
  true
);

document.addEventListener(
  'dblclick',
  function (e) {
    if (!recording) return;
    clearTimeout(clickDebounceTimer);
    var under = getElementUnderPoint(e.clientX, e.clientY);
    const clickedEl = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);

    if (!captureAllClicks) {
      var info = getHighlightInfo(clickedEl);
      if (info && info.locatorInfo) {
        sendAction({
          selector: info.selector,
          locatorInfo: info.locatorInfo,
          innerLocatorInfo: info.innerLocatorInfo || null,
          tagName: info.target.tagName.toLowerCase(),
          type: 'doubleClick',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const target = clickedEl;
    if (!target) return;
    if (target.matches && (target.matches('input[type="file"]') || target.matches('select'))) return;
    const { locatorInfo, selector } = generateLocatorInfo(target);
    if (!selector) return;
    sendAction({ type: 'doubleClick', selector, locatorInfo, tagName: target.tagName.toLowerCase(), timestamp: Date.now() });
  },
  true
);

document.addEventListener('mousedown', function (e) {
  if (!recording || e.button !== 0) return;
  var under = getElementUnderPoint(e.clientX, e.clientY);
  var el = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);
  var target = el;
  if (!target || target.matches('input[type="file"]') || target.tagName === 'BODY' || target.tagName === 'HTML') return;
  var r = generateLocatorInfo(target);
  if (r.selector) dragSource = { element: target, selector: r.selector, locatorInfo: r.locatorInfo };
}, true);

document.addEventListener('mouseup', function (e) {
  if (!recording || e.button !== 0 || !dragSource) return;
  var el = getElementUnderPoint(e.clientX, e.clientY);
  if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') { dragSource = null; return; }
  var dropTarget = el;
  if (dropTarget === dragSource.element) { dragSource = null; return; }
  var drop = generateLocatorInfo(dropTarget);
  if (!drop.selector) { dragSource = null; return; }
  sendAction({ type: 'dragTo', selector: dragSource.selector, locatorInfo: dragSource.locatorInfo, targetSelector: drop.selector, targetLocatorInfo: drop.locatorInfo, timestamp: Date.now() });
  dragSource = null;
}, true);

document.addEventListener('mouseleave', function () { dragSource = null; }, true);

document.addEventListener(
  'contextmenu',
  function (e) {
    if (!recording) return;
    var under = getElementUnderPoint(e.clientX, e.clientY);
    const clickedEl = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);

    if (!captureAllClicks) {
      var info = getHighlightInfo(clickedEl);
      if (info && info.locatorInfo) {
        sendAction({
          selector: info.selector,
          locatorInfo: info.locatorInfo,
          innerLocatorInfo: info.innerLocatorInfo || null,
          tagName: info.target.tagName.toLowerCase(),
          type: 'rightClick',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const target = clickedEl;
    if (!target) return;
    if (target.matches && (target.matches('input[type="file"]') || target.matches('select'))) return;
    const { locatorInfo, selector } = generateLocatorInfo(target);
    if (!selector) return;
    sendAction({ type: 'rightClick', selector, locatorInfo, tagName: target.tagName.toLowerCase(), timestamp: Date.now() });
  },
  true
);

var fillDebounce;
document.addEventListener(
  'input',
  function (e) {
    if (!recording) return;
    const el = e.target;
    if (!el || !(el.matches && (el.matches('input') || el.matches('textarea')))) return;
    if (el.type === 'file') return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    clearTimeout(fillDebounce);
    fillDebounce = setTimeout(function () {
      const { locatorInfo, selector } = generateLocatorInfo(el);
      if (!selector) return;
      sendAction({
        type: 'fill',
        selector,
        locatorInfo,
        value: el.value,
        inputType: el.type || 'text',
        timestamp: Date.now(),
      });
    }, 300);
  },
  true
);

document.addEventListener(
  'change',
  function (e) {
    if (!recording) return;

    const el = e.target;
    if (!el) return;
    if (el.matches && el.matches('input[type="checkbox"]')) return;

    if (el.matches && el.matches('input[type="file"]')) {
      var r = generateLocatorInfo(el);
      if (!r.selector) return;
      var files = el.files;
      var names = [];
      if (files && files.length) for (var i = 0; i < files.length; i++) names.push(files[i].name);
      sendAction({ type: 'setInputFiles', selector: r.selector, locatorInfo: r.locatorInfo, files: names, timestamp: Date.now() });
      return;
    }

    if (el.tagName && el.tagName.toLowerCase() === 'select') {
      const { locatorInfo, selector } = generateLocatorInfo(el);
      if (!selector) return;
      const opt = el.options && el.options[el.selectedIndex];
      const value = opt ? (opt.value !== undefined ? opt.value : opt.text) : '';
      const text = opt ? opt.text : '';
      sendAction({
        type: 'selectOption',
        selector,
        locatorInfo,
        value: value,
        optionText: text,
        timestamp: Date.now(),
      });
    }
  },
  true
);

document.addEventListener(
  'keydown',
  function (e) {
    if (!recording) return;

    if (e.shiftKey && (e.key === '1' || e.code === 'Digit1')) {
      e.preventDefault();
      var el = getElementUnderPoint(lastMousePos.x, lastMousePos.y);
      if (!el || !el.tagName || el.tagName === 'BODY' || el.tagName === 'HTML') return;
      var r = generateLocatorInfo(el);
      if (!r.selector) return;
      sendAction({ type: 'hover', selector: r.selector, locatorInfo: r.locatorInfo, tagName: el.tagName.toLowerCase(), timestamp: Date.now() });
      console.log('[Playwright Recorder] Hover recorded:', r.selector);
      return;
    }
    if (e.shiftKey && (e.key === '2' || e.code === 'Digit2')) {
      e.preventDefault();
      var el = getElementUnderPoint(lastMousePos.x, lastMousePos.y);
      if (!el || !el.tagName || el.tagName === 'BODY' || el.tagName === 'HTML') return;
      var r = generateLocatorInfo(el);
      if (!r.selector) return;
      sendAction({ type: 'scroll', selector: r.selector, locatorInfo: r.locatorInfo, tagName: el.tagName.toLowerCase(), timestamp: Date.now() });
      console.log('[Playwright Recorder] Scroll recorded:', r.selector);
      return;
    }

    // Record Enter and other special keys (Tab, Escape, F-keys, Ctrl+C etc.)
    var recordableKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
    var hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    var isSpecialKey = recordableKeys.indexOf(e.key) >= 0;
    if (!hasModifier && !isSpecialKey) return;
    var inInput = e.target && (e.target.matches && (e.target.matches('input') || e.target.matches('textarea')));
    if (inInput && !hasModifier && e.key !== 'Tab' && e.key !== 'Escape') return;
    if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('textarea')) return;
    var keyParts = [];
    if (e.ctrlKey) keyParts.push('Control');
    if (e.metaKey) keyParts.push('Meta');
    if (e.altKey) keyParts.push('Alt');
    if (e.shiftKey) keyParts.push('Shift');
    var keyName = (e.key.length === 1 ? e.key : e.key);
    if (keyParts.indexOf(keyName) < 0) keyParts.push(keyName);
    var keyStr = keyParts.join('+');
    var target = e.target;
    var r = target && target !== document.body ? generateLocatorInfo(target) : { selector: 'body', locatorInfo: { method: 'css', selector: 'body' } };
    if (!r.selector) return;
    sendAction({ type: 'press', selector: r.selector, locatorInfo: r.locatorInfo, key: keyStr, timestamp: Date.now() });
  },
  true
);
