import {
  escapeSelectorAttr,
  getImplicitRole,
  getAccessibleName,
  getHeadingLevel,
  getLabelForFormControl,
  parentElementOrShadowHost,
} from './locators.js';

let _actionHighlightBox = null;

export function findElementByLocatorInfo(info, root) {
  if (!info || !info.method) return null;
  const searchRoot = root || document.body;

  switch (info.method) {
    case 'testId': {
      const attr = info.attr || 'data-testid';
      const nodes = searchRoot.querySelectorAll('[' + attr + '="' + escapeSelectorAttr(info.value) + '"]');
      if (typeof info.nthIndex === 'number' && info.nthIndex >= 0 && info.nthIndex < nodes.length) return nodes[info.nthIndex];
      return nodes[0] || null;
    }
    case 'text': {
      if (!info.text) return null;
      const all = searchRoot.querySelectorAll('*:not(script):not(style)');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const t = el.textContent && el.textContent.trim().replace(/\s+/g, ' ');
        if (t !== info.text) continue;
        let leaf = true;
        for (let j = 0; j < el.children.length; j++) {
          const ct = el.children[j].textContent && el.children[j].textContent.trim().replace(/\s+/g, ' ');
          if (ct === info.text) { leaf = false; break; }
        }
        if (leaf) return el;
      }
      return null;
    }
    case 'role': {
      const all = searchRoot.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (getImplicitRole(el) !== info.role) continue;
        if (info.name) {
          const elName = getAccessibleName(el);
          if (!elName || elName !== info.name) continue;
        }
        if (info.level != null) {
          const tag = el.tagName && el.tagName.toLowerCase();
          if (getHeadingLevel(tag) !== info.level) continue;
        }
        return el;
      }
      return null;
    }
    case 'label': {
      const controls = searchRoot.querySelectorAll('input, select, textarea');
      for (let i = 0; i < controls.length; i++) {
        if (getLabelForFormControl(controls[i]) === info.label) return controls[i];
      }
      return null;
    }
    case 'placeholder': {
      if (!info.placeholder) return null;
      const sel = 'input[placeholder="' + escapeSelectorAttr(info.placeholder) + '"],textarea[placeholder="' + escapeSelectorAttr(info.placeholder) + '"]';
      try { return searchRoot.querySelector(sel); } catch (_) { return null; }
    }
    case 'alt': {
      if (!info.alt) return null;
      try { return searchRoot.querySelector('[alt="' + escapeSelectorAttr(info.alt) + '"]'); } catch (_) { return null; }
    }
    case 'title': {
      if (!info.title) return null;
      try { return searchRoot.querySelector('[title="' + escapeSelectorAttr(info.title) + '"]'); } catch (_) { return null; }
    }
    case 'css': {
      try { return searchRoot.querySelector(info.selector); } catch (_) { return null; }
    }
    case 'nthChild': {
      const sel = (info.childSelector || '> *').trim();
      const parts = sel.split(/\s*>\s*/).map(function (p) { return p.trim().toLowerCase(); });
      let root = searchRoot;
      if (parts.length >= 2 && parts[0] !== '') {
        const first = root.querySelector(parts[0]);
        if (first) root = first;
      }
      const tag = parts.length >= 2 ? parts[parts.length - 1] : parts[0].replace(/^>\s*/, '') || '*';
      const direct = Array.from(root.children).filter(function (c) {
        const ct = (c.tagName && c.tagName.toLowerCase()) || '';
        return tag === '*' || ct === tag;
      });
      let row;
      if (info.filterText) {
        row = null;
        for (let i = 0; i < direct.length; i++) {
          const t = direct[i].textContent && direct[i].textContent.trim().replace(/\s+/g, ' ');
          if (t && t.indexOf(info.filterText) >= 0) { row = direct[i]; break; }
        }
      } else {
        const idx = typeof info.nthIndex === 'number' && info.nthIndex >= 0 ? info.nthIndex : 0;
        row = direct[idx];
      }
      if (!row) return null;
      if (info.inner) return findElementByLocatorInfo(info.inner, row);
      return row;
    }
    case 'rowCell': {
      if (!info.rowText) return null;
      const rowEl = findElementByLocatorInfo({ method: 'text', text: info.rowText }, searchRoot);
      if (!rowEl) return null;
      let row = rowEl;
      while (row && row.parentElement && row.parentElement !== searchRoot) {
        if (row.children && row.children.length > 1) break;
        row = row.parentElement;
      }
      if (!row) return null;
      const withinRow = row;
      if (info.cellText) {
        const cells = withinRow.querySelectorAll('*');
        for (let i = 0; i < cells.length; i++) {
          const t = cells[i].textContent && cells[i].textContent.trim().replace(/\s+/g, ' ');
          if (t === info.cellText) return cells[i];
        }
      } else if (info.dataIndex) {
        const cell = withinRow.querySelector('[data-index="' + escapeSelectorAttr(info.dataIndex) + '"]');
        if (cell) return cell;
      }
      return null;
    }
    default:
      return null;
  }
}

export function showActionHighlight(locatorInfo, innerLocatorInfo) {
  let el = null;
  if (locatorInfo) {
    const scope = findElementByLocatorInfo(locatorInfo, document.body);
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
    const s = _actionHighlightBox.style;
    s.position = 'fixed';
    s.border = '2px solid rgba(255, 0, 0, 0.5)';
    s.backgroundColor = 'rgba(255, 0, 0, 0.15)';
    s.borderRadius = '3px';
    s.pointerEvents = 'none';
    s.zIndex = '2147483646';
    s.transition = 'all 0.08s ease-out';
    document.documentElement.appendChild(_actionHighlightBox);
  }

  const rect = el.getBoundingClientRect();
  const s = _actionHighlightBox.style;
  s.left = rect.left + 'px';
  s.top = rect.top + 'px';
  s.width = rect.width + 'px';
  s.height = rect.height + 'px';
  s.display = 'block';
}

export function hideActionHighlight() {
  if (_actionHighlightBox) {
    _actionHighlightBox.style.display = 'none';
  }
}
