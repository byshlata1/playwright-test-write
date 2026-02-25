import { contentState } from './state.js';
import { getElementUnderPoint } from './overlay.js';
import { generateLocatorInfo, getHighlightInfo, locatorInfoToText, parentElementOrShadowHost } from './locators.js';

function sendAction(data) {
  let locatorStr = '';
  if (data.locatorInfo) {
    locatorStr = locatorInfoToText(data.locatorInfo);
    if (data.innerLocatorInfo) locatorStr += '.' + locatorInfoToText(data.innerLocatorInfo);
  } else if (data.selector) locatorStr = data.selector;
  console.log('[Playwright Recorder] ACTION:', data.type || '?', '|', locatorStr || '[raw]', '| target:', data.tagName);
  chrome.runtime.sendMessage({ type: 'ADD_ACTION', data: data }).catch(e => console.warn('[PW Recorder]', e));
}

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

export function getClickTarget(element) {
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
    if (tag === 'table' || tag === 'tbody' || tag === 'thead') break;
    if (!classCandidate) {
      const cls = (el.className && typeof el.className === 'string' ? el.className : '') || '';
      if ((tag === 'div' || tag === 'span') && /btn|button|cta|action/.test(cls.toLowerCase())) {
        classCandidate = el;
      }
    }
    el = parentElementOrShadowHost(el);
    if (el && (el.tagName === 'BODY' || el.tagName === 'HTML')) break;
  }
  return classCandidate;
}

let clickDebounceTimer;
document.addEventListener(
  'click',
  function (e) {
    if (!contentState.recording) return;

    const under = getElementUnderPoint(e.clientX, e.clientY);
    const clickedEl = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);
    const target = getClickTarget(clickedEl) || clickedEl;

    if (!contentState.captureAllClicks) {
      const info = getHighlightInfo(clickedEl);
      if (info && info.locatorInfo) {
        const payload = {
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
    if (!contentState.recording) return;
    clearTimeout(clickDebounceTimer);
    const under = getElementUnderPoint(e.clientX, e.clientY);
    const clickedEl = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);

    if (!contentState.captureAllClicks) {
      const info = getHighlightInfo(clickedEl);
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
  if (!contentState.recording || e.button !== 0) return;
  const under = getElementUnderPoint(e.clientX, e.clientY);
  const el = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);
  const target = el;
  if (!target || target.matches('input[type="file"]') || target.tagName === 'BODY' || target.tagName === 'HTML') return;
  const r = generateLocatorInfo(target);
  if (r.selector) contentState.dragSource = { element: target, selector: r.selector, locatorInfo: r.locatorInfo };
}, true);

document.addEventListener('mouseup', function (e) {
  if (!contentState.recording || e.button !== 0 || !contentState.dragSource) return;
  const el = getElementUnderPoint(e.clientX, e.clientY);
  if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') { contentState.dragSource = null; return; }
  const dropTarget = el;
  if (dropTarget === contentState.dragSource.element) { contentState.dragSource = null; return; }
  const drop = generateLocatorInfo(dropTarget);
  if (!drop.selector) { contentState.dragSource = null; return; }
  sendAction({ type: 'dragTo', selector: contentState.dragSource.selector, locatorInfo: contentState.dragSource.locatorInfo, targetSelector: drop.selector, targetLocatorInfo: drop.locatorInfo, timestamp: Date.now() });
  contentState.dragSource = null;
}, true);

document.addEventListener('mouseleave', function () { contentState.dragSource = null; }, true);

document.addEventListener(
  'contextmenu',
  function (e) {
    if (!contentState.recording) return;
    const under = getElementUnderPoint(e.clientX, e.clientY);
    const clickedEl = under || (e.target?.nodeType === 1 ? e.target : e.target?.parentElement);

    if (!contentState.captureAllClicks) {
      const info = getHighlightInfo(clickedEl);
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

let fillDebounce;
document.addEventListener(
  'input',
  function (e) {
    if (!contentState.recording) return;
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
    if (!contentState.recording) return;

    const el = e.target;
    if (!el) return;
    if (el.matches && el.matches('input[type="checkbox"]')) return;

    if (el.matches && el.matches('input[type="file"]')) {
      const r = generateLocatorInfo(el);
      if (!r.selector) return;
      const files = el.files;
      const names = [];
      if (files && files.length) for (let i = 0; i < files.length; i++) names.push(files[i].name);
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
    if (!contentState.recording) return;

    if (e.shiftKey && (e.key === '1' || e.code === 'Digit1')) {
      e.preventDefault();
      const el = getElementUnderPoint(contentState.lastMousePos.x, contentState.lastMousePos.y);
      if (!el || !el.tagName || el.tagName === 'BODY' || el.tagName === 'HTML') return;
      const r = generateLocatorInfo(el);
      if (!r.selector) return;
      sendAction({ type: 'hover', selector: r.selector, locatorInfo: r.locatorInfo, tagName: el.tagName.toLowerCase(), timestamp: Date.now() });
      console.log('[Playwright Recorder] Hover recorded:', r.selector);
      return;
    }
    if (e.shiftKey && (e.key === '2' || e.code === 'Digit2')) {
      e.preventDefault();
      const el = getElementUnderPoint(contentState.lastMousePos.x, contentState.lastMousePos.y);
      if (!el || !el.tagName || el.tagName === 'BODY' || el.tagName === 'HTML') return;
      const r = generateLocatorInfo(el);
      if (!r.selector) return;
      sendAction({ type: 'scroll', selector: r.selector, locatorInfo: r.locatorInfo, tagName: el.tagName.toLowerCase(), timestamp: Date.now() });
      console.log('[Playwright Recorder] Scroll recorded:', r.selector);
      return;
    }

    const recordableKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    const isSpecialKey = recordableKeys.indexOf(e.key) >= 0;
    if (!hasModifier && !isSpecialKey) return;
    const inInput = e.target && (e.target.matches && (e.target.matches('input') || e.target.matches('textarea')));
    if (inInput && !hasModifier && e.key !== 'Tab' && e.key !== 'Escape') return;
    if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('textarea')) return;
    const keyParts = [];
    if (e.ctrlKey) keyParts.push('Control');
    if (e.metaKey) keyParts.push('Meta');
    if (e.altKey) keyParts.push('Alt');
    if (e.shiftKey) keyParts.push('Shift');
    const keyName = (e.key.length === 1 ? e.key : e.key);
    if (keyParts.indexOf(keyName) < 0) keyParts.push(keyName);
    const keyStr = keyParts.join('+');
    const target = e.target;
    const r = target && target !== document.body ? generateLocatorInfo(target) : { selector: 'body', locatorInfo: { method: 'css', selector: 'body' } };
    if (!r.selector) return;
    sendAction({ type: 'press', selector: r.selector, locatorInfo: r.locatorInfo, key: keyStr, timestamp: Date.now() });
  },
  true
);
