import { getClickTarget } from './events.js';

export function escapeSelectorAttr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function parentElementOrShadowHost(el) {
  if (!el) return null;
  if (el.parentElement) return el.parentElement;
  if (el.parentNode && el.parentNode.nodeType === 11) return el.parentNode.host || null;
  return null;
}

function isGuidLike(id) {
  if (!id || id.length < 4) return false;
  let lastType = '';
  let transitions = 0;
  for (let i = 0; i < id.length; i++) {
    const c = id[i];
    if (c === '-' || c === '_') continue;
    let type;
    if (c >= 'a' && c <= 'z') type = 'lower';
    else if (c >= 'A' && c <= 'Z') type = 'upper';
    else if (c >= '0' && c <= '9') type = 'digit';
    else type = 'other';
    if (type === 'lower' && lastType === 'upper') { lastType = type; continue; }
    if (lastType && lastType !== type) transitions++;
    lastType = type;
  }
  return transitions >= id.length / 4;
}

function trimWordBoundary(text, maxLength) {
  if (text.length <= maxLength) return text;
  text = text.substring(0, maxLength);
  const match = text.match(/^(.*)\b(.+?)$/);
  if (!match) return '';
  return match[1].trimEnd();
}

export function getAccessibleName(el) {
  const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const names = labelledBy.split(/\s+/).map(function (id) {
      const ref = document.getElementById(id);
      return ref ? (ref.textContent || '').trim() : '';
    }).filter(Boolean);
    if (names.length) return names.join(' ');
  }
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
const _matchCountCache = new Map();
const _domCacheObserver = new MutationObserver(() => { _textUniqueCache.clear(); _matchCountCache.clear(); });
_domCacheObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

function isTextUnique(text) {
  if (!text || text.length > 200) return false;
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

function isTextUniqueInScope(text, scope) {
  if (!text || !scope) return false;
  const all = scope.querySelectorAll('*:not(script):not(style)');
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const t = all[i].textContent && all[i].textContent.trim().replace(/\s+/g, ' ');
    if (t !== text) continue;
    let ownedByChild = false;
    for (let j = 0; j < all[i].children.length; j++) {
      const ct = all[i].children[j].textContent && all[i].children[j].textContent.trim().replace(/\s+/g, ' ');
      if (ct === text) { ownedByChild = true; break; }
    }
    if (!ownedByChild) count++;
    if (count > 1) return false;
  }
  return count === 1;
}

function suitableTextAlternatives(text) {
  if (!text) return [];
  const results = [];

  const leadMatch = text.match(/^[\d.,]+\s*/);
  if (leadMatch && leadMatch[0].length < text.length) {
    const alt = text.substring(leadMatch[0].length);
    if (alt.length >= 2 && alt.length <= 80) results.push(alt);
  }

  const trailMatch = text.match(/\s*[\d.,]+$/);
  if (trailMatch && trailMatch.index > 0) {
    const alt = text.substring(0, trailMatch.index);
    if (alt.length >= 2 && alt.length <= 80) results.push(alt);
  }

  if (text.length <= 80) {
    results.push(text);
  } else {
    const trimmed = trimWordBoundary(text, 80);
    if (trimmed && trimmed.length >= 2) results.push(trimmed);
  }

  const seen = new Set();
  return results.filter(function (r) {
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });
}

const _cssFallbackMaxDepth = 8;
function generateCssFallback(element) {
  let el = element;
  const id = el.getAttribute && el.getAttribute('id');
  if (id && /^[a-zA-Z_-][\w-]*$/.test(id) && !isGuidLike(id)) return '#' + id;

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
        if (isGuidLike(c)) return false;
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

const LOCATABLE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox',
  'heading', 'menuitem', 'tab', 'option', 'img', 'table', 'list'
]);

function getRoleCSSHint(role) {
  switch (role) {
    case 'button': return 'button,[role="button"],input[type="submit"],input[type="button"],input[type="image"],summary';
    case 'link': return 'a[href],[role="link"]';
    case 'checkbox': return 'input[type="checkbox"],[role="checkbox"]';
    case 'radio': return 'input[type="radio"],[role="radio"]';
    case 'textbox': return 'input:not([type]),input[type="text"],input[type="email"],input[type="password"],input[type="tel"],input[type="url"],textarea,[role="textbox"]';
    case 'searchbox': return 'input[type="search"],[role="searchbox"]';
    case 'combobox': return 'select,[role="combobox"]';
    case 'heading': return 'h1,h2,h3,h4,h5,h6,[role="heading"]';
    case 'menuitem': return '[role="menuitem"]';
    case 'tab': return '[role="tab"]';
    case 'option': return 'option,[role="option"]';
    case 'img': return 'img,[role="img"]';
    case 'table': return 'table,[role="table"]';
    case 'list': return 'ul,ol,[role="list"]';
    default: return '[role="' + role + '"]';
  }
}

function _matchCacheKey(info) {
  switch (info.method) {
    case 'testId': return 'tid|' + info.value;
    case 'role': return 'role|' + info.role + '|' + (info.name || '') + '|' + (info.level != null ? info.level : '');
    case 'label': return 'label|' + info.label;
    case 'placeholder': return 'ph|' + info.placeholder;
    case 'alt': return 'alt|' + info.alt;
    case 'title': return 'title|' + info.title;
    default: return '';
  }
}

function countLocatorMatches(info) {
  const cacheKey = _matchCacheKey(info);
  if (cacheKey) {
    const cached = _matchCountCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }
  let result;
  switch (info.method) {
    case 'testId': {
      const attr = info.attr || 'data-testid';
      result = document.querySelectorAll('[' + attr + '="' + escapeSelectorAttr(info.value) + '"]').length;
      break;
    }
    case 'role': {
      const hint = getRoleCSSHint(info.role);
      let candidates;
      try { candidates = document.querySelectorAll(hint); } catch (_) { candidates = document.querySelectorAll('*'); }
      let count = 0;
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (getImplicitRole(el) !== info.role) continue;
        if (info.name && getAccessibleName(el) !== info.name) continue;
        if (info.level != null && getHeadingLevel((el.tagName || '').toLowerCase()) !== info.level) continue;
        count++;
        if (count > 1) break;
      }
      result = count;
      break;
    }
    case 'label': {
      const controls = document.querySelectorAll('input,select,textarea');
      let count = 0;
      for (let i = 0; i < controls.length; i++) {
        if (getLabelForFormControl(controls[i]) === info.label) {
          count++;
          if (count > 1) break;
        }
      }
      result = count;
      break;
    }
    case 'placeholder': {
      const sel = 'input[placeholder="' + escapeSelectorAttr(info.placeholder) + '"],textarea[placeholder="' + escapeSelectorAttr(info.placeholder) + '"]';
      try { result = document.querySelectorAll(sel).length; } catch (_) { result = 0; }
      break;
    }
    case 'alt': {
      try { result = document.querySelectorAll('[alt="' + escapeSelectorAttr(info.alt) + '"]').length; } catch (_) { result = 0; }
      break;
    }
    case 'title': {
      try { result = document.querySelectorAll('[title="' + escapeSelectorAttr(info.title) + '"]').length; } catch (_) { result = 0; }
      break;
    }
    default:
      result = 1;
  }
  if (cacheKey) _matchCountCache.set(cacheKey, result);
  return result;
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

  const candidates = [];
  const nthInfo = getNthAmongSiblings(element);

  if (testId) {
    const attr = element.hasAttribute('data-test-id') ? 'data-test-id' : 'data-testid';
    const info = { method: 'testId', value: testId, attr: attr };
    if (nthInfo && nthInfo.testId === testId) info.nthIndex = nthInfo.index;
    candidates.push(info);
  }

  let roleHasName = false;
  if (role && LOCATABLE_ROLES.has(role)) {
    const headingLevel = getHeadingLevel(tag);
    if (role === 'heading' && headingLevel) {
      if (name && name.length <= 80) { candidates.push({ method: 'role', role: role, name: name, level: headingLevel }); roleHasName = true; }
      else candidates.push({ method: 'role', role: role, level: headingLevel });
    } else if (name && name.length <= 80) {
      candidates.push({ method: 'role', role: role, name: name });
      roleHasName = true;
    } else if (role === 'table' || role === 'list') {
      candidates.push({ method: 'role', role: role, name: name || undefined });
      if (name) roleHasName = true;
    } else if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      candidates.push({ method: 'role', role: role, name: label || undefined });
      if (label) roleHasName = true;
    } else {
      candidates.push({ method: 'role', role: role });
    }
  }

  if (label && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
    if (!roleHasName || label !== name) {
      candidates.push({ method: 'label', label: label });
    }
  }

  if (tag === 'input' || tag === 'textarea') {
    const ph = element.getAttribute && element.getAttribute('placeholder');
    if (ph && ph.trim()) candidates.push({ method: 'placeholder', placeholder: ph.trim() });
  }

  if (tag === 'img' || (tag === 'input' && (element.type || '').toLowerCase() === 'image')) {
    const alt = element.getAttribute && element.getAttribute('alt');
    if (alt && alt.trim()) candidates.push({ method: 'alt', alt: alt.trim() });
  }

  {
    const titleAttr = element.getAttribute && element.getAttribute('title');
    if (titleAttr && titleAttr.trim() && titleAttr.trim().length <= 80) {
      candidates.push({ method: 'title', title: titleAttr.trim() });
    }
  }

  if (text && !isGuidLike(text)) {
    const alts = suitableTextAlternatives(text);
    for (let i = 0; i < alts.length; i++) {
      if (!isGuidLike(alts[i]) && isTextUnique(alts[i])) {
        candidates.push({ method: 'text', text: alts[i] });
        break;
      }
    }
  }

  let locatorInfo = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.method === 'text') continue;
    if (candidate.method === 'testId') {
      const matchCount = countLocatorMatches(candidate);
      if (matchCount > 1 && typeof candidate.nthIndex !== 'number') {
        const attr = candidate.attr || 'data-testid';
        try {
          const all = document.querySelectorAll('[' + attr + '="' + escapeSelectorAttr(candidate.value) + '"]');
          for (let j = 0; j < all.length; j++) {
            if (all[j] === element) { candidate.nthIndex = j; break; }
          }
        } catch (_) {}
      }
      locatorInfo = candidate;
      break;
    }
    if (countLocatorMatches(candidate) === 1) {
      locatorInfo = candidate;
      break;
    }
  }
  if (!locatorInfo) {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].method === 'text') { locatorInfo = candidates[i]; break; }
    }
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
    if (info.filterText) {
      const base = "locator('" + (info.childSelector || '> *') + "').filter({ hasText: '" + info.filterText + "' })";
      return base + (info.inner ? '.' + locatorInfoToText(info.inner) : '');
    }
    const base = "locator('" + (info.childSelector || '> *') + "')" + (typeof info.nthIndex === 'number' ? '.nth(' + info.nthIndex + ')' : '');
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
    case 'placeholder':
      return "getByPlaceholder('" + info.placeholder + "')" + nthSuffix;
    case 'alt':
      return "getByAltText('" + info.alt + "')" + nthSuffix;
    case 'title':
      return "getByTitle('" + info.title + "')" + nthSuffix;
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
  let check = parentElementOrShadowHost(el);
  while (check && check.nodeType === 1) {
    if (check.tagName === 'BODY' || check.tagName === 'HTML') return null;
    const tid = check.getAttribute && (check.getAttribute('data-testid') || check.getAttribute('data-test-id'));
    const tag = (check.tagName && check.tagName.toLowerCase()) || '';
    if (tid || tag === 'button' || tag === 'a') return check;
    if (tag === 'table' || tag === 'tbody' || tag === 'ul' || tag === 'ol' || tag === 'select') return check;
    check = parentElementOrShadowHost(check);
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
      if (text && text.length > 0 && text.length <= 80 && !isGuidLike(text) && isTextUnique(text)) {
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

function _findFilterText(rowEl) {
  if (!rowEl || !rowEl.children) return null;
  for (let i = 0; i < rowEl.children.length; i++) {
    const child = rowEl.children[i];
    const t = child.textContent && child.textContent.trim().replace(/\s+/g, ' ');
    if (t && t.length >= 2 && t.length <= 50 && !isGuidLike(t) && isTextUnique(t)) return t;
  }
  const full = rowEl.textContent && rowEl.textContent.trim().replace(/\s+/g, ' ');
  if (full && full.length >= 2 && full.length <= 50 && !isGuidLike(full) && isTextUnique(full)) return full;
  return null;
}

export function getHighlightInfo(el) {
  while (el && el instanceof SVGElement) el = parentElementOrShadowHost(el);
  if (!el || el.tagName === 'HTML' || el.tagName === 'BODY') return null;

  const elInfo = generateLocatorInfo(el);
  if (!elInfo || !elInfo.locatorInfo) {
    const fb = generateCssFallback(el);
    return { target: el, text: "locator('" + (fb || el.tagName.toLowerCase()) + "')", method: 'css', locatorInfo: { method: 'css', selector: fb }, innerLocatorInfo: null, selector: fb };
  }

  const elOwnTestId = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));

  if (elInfo.locatorInfo.method === 'testId' && elOwnTestId) {
    const tag = (el.tagName || '').toLowerCase();
    const elRole = el.getAttribute && el.getAttribute('role');
    const isInteractive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea' ||
      (elRole && /^(button|link|checkbox|radio|combobox|listbox|tab|menuitem|option|switch|slider)$/.test(elRole));
    if (!isInteractive) {
      let parent = parentElementOrShadowHost(el);
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
        parent = parentElementOrShadowHost(parent);
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
            const sameTag = Array.from(nthCtx.container.children).filter(function (c) { return (c.tagName && c.tagName.toLowerCase()) === nthCtx.childTag; });
            const rowEl = sameTag[nthCtx.index];
            let nthChildInner;
            if (rowEl) {
              const ft = _findFilterText(rowEl);
              if (ft) nthChildInner = { method: 'nthChild', childSelector: childSelector, filterText: ft };
              else nthChildInner = { method: 'nthChild', childSelector: childSelector, nthIndex: nthCtx.index };
            } else {
              nthChildInner = { method: 'nthChild', childSelector: childSelector, nthIndex: nthCtx.index };
            }
            if (el === rowEl || (rowEl && rowEl.contains(el))) {
              let innerLoc = nthChildInner;
              if (el !== rowEl) {
                const elInRowInfo = generateLocatorInfo(el);
                if (elInRowInfo && elInRowInfo.locatorInfo && elInRowInfo.locatorInfo.method !== 'css') {
                  innerLoc = nthChildInner.filterText
                    ? { method: 'nthChild', childSelector: nthChildInner.childSelector, filterText: nthChildInner.filterText, inner: elInRowInfo.locatorInfo }
                    : { method: 'nthChild', childSelector: nthChildInner.childSelector, nthIndex: nthChildInner.nthIndex, inner: elInRowInfo.locatorInfo };
                } else {
                  const elText = (el.textContent && el.textContent.trim().replace(/\s+/g, ' ')) || '';
                  if (elText && elText.length <= 80 && !isGuidLike(elText) && isTextUniqueInScope(elText, rowEl)) {
                    const textInner = { method: 'text', text: elText };
                    innerLoc = nthChildInner.filterText
                      ? { method: 'nthChild', childSelector: nthChildInner.childSelector, filterText: nthChildInner.filterText, inner: textInner }
                      : { method: 'nthChild', childSelector: nthChildInner.childSelector, nthIndex: nthChildInner.nthIndex, inner: textInner };
                  } else {
                    let cell = el;
                    while (cell && cell.parentElement && cell.parentElement !== rowEl) cell = cell.parentElement;
                    if (cell && cell.parentElement === rowEl) {
                      const cellTag = (cell.tagName || '').toLowerCase();
                      if (cellTag === 'td' || cellTag === 'th') {
                        const sameCells = Array.from(rowEl.children).filter(function (c) { return (c.tagName || '').toLowerCase() === cellTag; });
                        if (sameCells.length >= 2) {
                          const cellIdx = sameCells.indexOf(cell);
                          if (cellIdx >= 0) {
                            const cellInner = { method: 'nthChild', childSelector: '> ' + cellTag, nthIndex: cellIdx };
                            innerLoc = nthChildInner.filterText
                              ? { method: 'nthChild', childSelector: nthChildInner.childSelector, filterText: nthChildInner.filterText, inner: cellInner }
                              : { method: 'nthChild', childSelector: nthChildInner.childSelector, nthIndex: nthChildInner.nthIndex, inner: cellInner };
                          }
                        }
                      }
                    }
                  }
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
  role: '#2e7d32', label: '#1565c0', testId: '#6a1b9a', text: '#e65100',
  placeholder: '#00695c', alt: '#4527a0', title: '#bf360c',
  css: '#757575', rowCell: '#e65100'
};
export const METHOD_BADGES = {
  role: 'ROLE', label: 'LABEL', testId: 'TEST-ID', text: 'TEXT',
  placeholder: 'PLACEHOLDER', alt: 'ALT', title: 'TITLE',
  css: 'CSS', rowCell: 'TEXT'
};
