import { getClickTarget } from './events.js';

export function escapeSelectorAttr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function getAccessibleName(el) {
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

export function getImplicitRole(el) {
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

export function getHeadingLevel(tag) {
  const m = (tag || '').match(/^h([1-6])$/i);
  return m ? parseInt(m[1], 10) : null;
}

export function getLabelForFormControl(el) {
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

const _textUniqueCache = new Map();
const _textCacheObserver = new MutationObserver(() => { _textUniqueCache.clear(); });
_textCacheObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

function isTextUnique(text) {
  if (!text || text.length > 150) return false;
  const cached = _textUniqueCache.get(text);
  if (cached !== undefined) return cached;
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
    if (count > 1) { _textUniqueCache.set(text, false); return false; }
  }
  const result = count === 1;
  _textUniqueCache.set(text, result);
  return result;
}

const _cssFallbackMaxDepth = 8;
function generateCssFallback(element) {
  let el = element;
  const id = el.getAttribute && el.getAttribute('id');
  if (id && /^[a-zA-Z_-][\w-]*$/.test(id)) return '#' + id;

  const path = [];
  let depth = 0;
  while (el && el.nodeType === 1 && depth < _cssFallbackMaxDepth) {
    let part = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(function (c) {
        if (!c || /^\d/.test(c)) return false;
        if (/_[a-z0-9]{4,}$/i.test(c)) return false;
        if (/^css-[a-z0-9]+$/i.test(c)) return false;
        if (/^sc-[a-zA-Z]/.test(c)) return false;
        if (/--[a-z0-9]{5,}$/i.test(c)) return false;
        return true;
      });
      if (classes.length) part += '.' + classes.slice(0, 2).join('.');
    }
    if (el.parentElement) {
      const siblings = Array.from(el.parentElement.children).filter(function (c) {
        return c.tagName === el.tagName;
      });
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
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

function getNthChildContext(el) {
  let row = el;
  while (row && row.nodeType === 1) {
    const parent = row.parentElement;
    if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
    const tag = (row.tagName && row.tagName.toLowerCase()) || '';
    const sameTagSiblings = Array.from(parent.children).filter(function (c) { return (c.tagName && c.tagName.toLowerCase()) === tag; });
    if (sameTagSiblings.length >= 2) {
      const idx = sameTagSiblings.indexOf(row);
      if (idx >= 0) {
        const containerTag = (parent.tagName && parent.tagName.toLowerCase()) || '';
        const hasTestId = function (n) { return n && n.getAttribute && (n.getAttribute('data-testid') || n.getAttribute('data-test-id')); };
        const useNth =
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

function getNthAmongSiblings(el) {
  let check = el;
  while (check && check.nodeType === 1) {
    const tid = check.getAttribute && (check.getAttribute('data-testid') || check.getAttribute('data-test-id'));
    if (tid) {
      const parent = check.parentElement;
      if (!parent) return null;
      const siblings = Array.from(parent.children).filter(function (c) {
        const ct = c.getAttribute && (c.getAttribute('data-testid') || c.getAttribute('data-test-id'));
        return ct === tid;
      });
      if (siblings.length > 1) {
        const idx = siblings.indexOf(check);
        if (idx >= 0) return { index: idx, testId: tid, attr: check.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid' };
      }
    }
    check = check.parentElement;
    if (check && (check.tagName === 'BODY' || check.tagName === 'HTML')) break;
  }
  return null;
}

export function generateLocatorInfo(element) {
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
  const nthInfo = getNthAmongSiblings(element);

  if (testId) {
    const attr = element.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid';
    locatorInfo = { method: 'testId', value: testId, attr: attr };
    if (nthInfo && nthInfo.testId === testId) locatorInfo.nthIndex = nthInfo.index;
  }

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

  if (!locatorInfo && label && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
    locatorInfo = { method: 'label', label: label };
  }

  if (!locatorInfo && text && text.length <= 60 && isTextUnique(text)) {
    locatorInfo = { method: 'text', text: text };
  }

  if (!locatorInfo) {
    const ancestor = getClickTarget(element);
    if (ancestor && ancestor !== element) {
      const ancInfo = generateLocatorInfo(ancestor);
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

export function generateSelector(element) {
  const r = generateLocatorInfo(element);
  return r.selector;
}

export function locatorInfoToText(info) {
  if (!info || !info.method) return '';
  const nthSuffix = (typeof info.nthIndex === 'number' && info.nthIndex >= 0) ? '.nth(' + info.nthIndex + ')' : '';
  if (info.method === 'nthChild') {
    const base = ".locator('" + (info.childSelector || '> *') + "')" + (typeof info.nthIndex === 'number' ? '.nth(' + info.nthIndex + ')' : '');
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
      return "getByText('" + info.text + "', { exact: true })" + nthSuffix;
    case 'css':
      return "locator('" + info.selector + "')" + nthSuffix;
    case 'rowCell':
      return (info.rowText ? "getByText('" + info.rowText + "', { exact: true })" : '') + (info.cellText ? ".getByText('" + info.cellText + "', { exact: true })" : (info.dataIndex ? ".locator('[data-index=\"" + info.dataIndex + "\"]')" : ''));
    default:
      return '';
  }
}

function findScope(el) {
  let check = el.parentElement;
  while (check && check.nodeType === 1) {
    if (check.tagName === 'BODY' || check.tagName === 'HTML') return null;
    const tid = check.getAttribute && (check.getAttribute('data-testid') || check.getAttribute('data-test-id'));
    const tag = (check.tagName && check.tagName.toLowerCase()) || '';
    if (tid || tag === 'button' || tag === 'a') return check;
    if (tag === 'table' || tag === 'tbody' || tag === 'ul' || tag === 'ol' || tag === 'select') return check;
    check = check.parentElement;
  }
  return null;
}

export function findBestChildLocator(el) {
  if (!el || !el.children) return null;
  function search(parent, maxDepth) {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      const tid = child.getAttribute && (child.getAttribute('data-testid') || child.getAttribute('data-test-id'));
      if (tid) {
        return { method: 'testId', value: tid, attr: child.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid' };
      }
      const text = child.textContent && child.textContent.trim().replace(/\s+/g, ' ');
      if (text && text.length > 0 && text.length <= 60 && isTextUnique(text)) {
        return { method: 'text', text: text };
      }
      if (maxDepth > 0 && child.children && child.children.length > 0) {
        const found = search(child, maxDepth - 1);
        if (found) return found;
      }
    }
    return null;
  }
  return search(el, 2);
}

function findRowCellLocator(el, scope) {
  let row = el.parentElement;
  while (row && row.tagName !== 'BODY' && row.tagName !== 'HTML') {
    if (scope && scope.contains(row) && row !== scope && row.children && row.children.length > 1) {
      const rowChild = findBestChildLocator(row);
      if (rowChild && rowChild.method === 'text' && rowChild.text) {
        let cell = el;
        while (cell && cell.parentElement && cell.parentElement !== row) cell = cell.parentElement;
        const cellText = (cell && cell.textContent) ? cell.textContent.trim().replace(/\s+/g, ' ') : '';
        const dataIndex = (cell && cell.getAttribute) ? cell.getAttribute('data-index') : null;
        if (cellText || dataIndex) return { method: 'rowCell', rowText: rowChild.text, cellText: cellText || undefined, dataIndex: dataIndex || undefined };
      }
    }
    row = row.parentElement;
  }
  return null;
}

export function getHighlightInfo(el) {
  while (el && el instanceof SVGElement) el = el.parentElement;
  if (!el || el.tagName === 'HTML' || el.tagName === 'BODY') return null;

  const elInfo = generateLocatorInfo(el);
  if (!elInfo || !elInfo.locatorInfo) {
    const fb = generateCssFallback(el);
    return { target: el, text: "locator('" + (fb || el.tagName.toLowerCase()) + "')", method: 'css', locatorInfo: { method: 'css', selector: fb }, innerLocatorInfo: null, selector: fb };
  }

  if (elInfo.locatorInfo.method === 'testId') {
    const elOwnTestId = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    if (elOwnTestId) {
      const tag = (el.tagName || '').toLowerCase();
      const isInteractive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea';
      if (!isInteractive) {
        let parent = el.parentElement;
        while (parent && parent.nodeType === 1 && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
          const ptid = parent.getAttribute && (parent.getAttribute('data-testid') || parent.getAttribute('data-test-id'));
          if (ptid) {
            const parentInfo = generateLocatorInfo(parent);
            if (parentInfo && parentInfo.locatorInfo && parentInfo.locatorInfo.method === 'testId') {
              const pText = locatorInfoToText(parentInfo.locatorInfo);
              if (pText) return { target: parent, text: pText, method: 'testId', locatorInfo: parentInfo.locatorInfo, innerLocatorInfo: null, selector: parentInfo.selector };
            }
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    const tidText = locatorInfoToText(elInfo.locatorInfo);
    if (tidText) return { target: el, text: tidText, method: 'testId', locatorInfo: elInfo.locatorInfo, innerLocatorInfo: null, selector: elInfo.selector };
  }

  const scope = findScope(el);
  const nthCtx = getNthChildContext(el);

  if (scope) {
    const scopeInfo = generateLocatorInfo(scope);
    if (scopeInfo && scopeInfo.locatorInfo) {
      const scopeText = locatorInfoToText(scopeInfo.locatorInfo);
      if (scopeText) {
        if (nthCtx && scope.contains(nthCtx.container)) {
          let containerScope = nthCtx.container;
          let childSelector = '> ' + nthCtx.childTag;
          if (containerScope.tagName && containerScope.tagName.toLowerCase() === 'tbody') {
            containerScope = containerScope.parentElement || containerScope;
            if (containerScope.tagName && containerScope.tagName.toLowerCase() === 'table') childSelector = 'tbody > ' + nthCtx.childTag;
          }
          const containerInfo = generateLocatorInfo(containerScope);
          if (containerInfo && containerInfo.locatorInfo && containerInfo.locatorInfo.method !== 'css') {
            const nthChildInner = { method: 'nthChild', childSelector: childSelector, nthIndex: nthCtx.index };
            const sameTag = Array.from(nthCtx.container.children).filter(function (c) { return (c.tagName && c.tagName.toLowerCase()) === nthCtx.childTag; });
            const rowEl = sameTag[nthCtx.index];
            if (el === rowEl || (rowEl && rowEl.contains(el))) {
              let innerLoc = nthChildInner;
              if (el !== rowEl) {
                const elInRowInfo = generateLocatorInfo(el);
                if (elInRowInfo && elInRowInfo.locatorInfo && elInRowInfo.locatorInfo.method !== 'css') {
                  innerLoc = { method: 'nthChild', childSelector: nthChildInner.childSelector, nthIndex: nthChildInner.nthIndex, inner: elInRowInfo.locatorInfo };
                }
              }
              const displayText = locatorInfoToText(containerInfo.locatorInfo) + '.' + locatorInfoToText(innerLoc);
              return { target: el, text: displayText, method: 'nthChild', locatorInfo: containerInfo.locatorInfo, innerLocatorInfo: innerLoc, selector: containerInfo.selector };
            }
          }
        }
        if (el.children && el.children.length > 1 && scopeInfo.locatorInfo.method !== 'css') {
          const childLocator = findBestChildLocator(el);
          if (childLocator && !(childLocator.method === 'testId' && scopeInfo.locatorInfo.method === 'testId' && childLocator.value === scopeInfo.locatorInfo.value)) {
            const innerText = locatorInfoToText(childLocator);
            if (innerText) return { target: el, text: scopeText + '.' + innerText, method: childLocator.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: childLocator, selector: scopeInfo.selector };
          }
        }
        if (elInfo.locatorInfo.method !== 'css') {
          const dup = elInfo.locatorInfo.method === 'testId' && scopeInfo.locatorInfo.method === 'testId' && elInfo.locatorInfo.value === scopeInfo.locatorInfo.value;
          if (!dup) {
            const innerText = locatorInfoToText(elInfo.locatorInfo);
            if (innerText) return { target: el, text: scopeText + '.' + innerText, method: elInfo.locatorInfo.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: elInfo.locatorInfo, selector: scopeInfo.selector };
          }
        }
        const rowCellLoc = findRowCellLocator(el, scope);
        if (rowCellLoc) {
          const rcText = locatorInfoToText(rowCellLoc);
          if (rcText) return { target: el, text: scopeText + '.' + rcText, method: 'rowCell', locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: rowCellLoc, selector: scopeInfo.selector };
        }
        if (elInfo.locatorInfo && elInfo.locatorInfo.method === 'css' && scope.contains(el) && el !== scope) {
          const cssText = locatorInfoToText(elInfo.locatorInfo);
          if (cssText) return { target: el, text: scopeText + '.' + cssText, method: 'css', locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: elInfo.locatorInfo, selector: scopeInfo.selector };
        }
        let row = el.parentElement;
        while (row && row.tagName !== 'BODY' && row.tagName !== 'HTML' && scope.contains(row) && row !== scope) {
          if (row.children && row.children.length > 1) {
            const rowChild = findBestChildLocator(row);
            if (rowChild && !(rowChild.method === 'testId' && scopeInfo.locatorInfo.method === 'testId' && rowChild.value === scopeInfo.locatorInfo.value)) {
              const rowText = locatorInfoToText(rowChild);
              if (rowText) return { target: row, text: scopeText + '.' + rowText, method: rowChild.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: rowChild, selector: scopeInfo.selector };
            }
          }
          row = row.parentElement;
        }
        return { target: el, text: scopeText, method: scopeInfo.locatorInfo.method, locatorInfo: scopeInfo.locatorInfo, innerLocatorInfo: null, selector: scopeInfo.selector };
      }
    }
  }

  const text = locatorInfoToText(elInfo.locatorInfo);
  if (text) return { target: el, text: text, method: elInfo.locatorInfo.method, locatorInfo: elInfo.locatorInfo, innerLocatorInfo: null, selector: elInfo.selector };
  const fb = elInfo.selector || generateCssFallback(el);
  return { target: el, text: "locator('" + (fb || el.tagName.toLowerCase()) + "')", method: 'css', locatorInfo: { method: 'css', selector: fb }, innerLocatorInfo: null, selector: fb };
}

export const METHOD_COLORS = {
  role: '#2e7d32', label: '#1565c0', testId: '#6a1b9a', text: '#e65100', css: '#757575', rowCell: '#e65100'
};
export const METHOD_BADGES = {
  role: 'ROLE', label: 'LABEL', testId: 'TEST-ID', text: 'TEXT', css: 'CSS', rowCell: 'TEXT'
};
