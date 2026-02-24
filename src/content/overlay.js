import { contentState } from './state.js';
import { getHighlightInfo, METHOD_BADGES, METHOD_COLORS } from './locators.js';

let _highlightGlass = null;
let _highlightBox = null;
let _highlightTooltip = null;
let _highlightedEl = null;

let _scrollbarOverlayStyle = null;

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

export function getElementUnderPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (el && _highlightGlass && _highlightGlass.contains(el)) return null;
  return el;
}

export function ensureHighlightOverlay() {
  injectScrollbarFix();
  if (_highlightGlass) return;
  _highlightGlass = document.createElement('div');
  _highlightGlass.id = '__pw-rec-glass';
  const gs = _highlightGlass.style;
  gs.position = 'fixed';
  gs.top = '0'; gs.left = '0'; gs.width = '100%'; gs.height = '100%';
  gs.pointerEvents = 'none';
  gs.zIndex = '2147483647';

  _highlightBox = document.createElement('div');
  _highlightBox.id = '__pw-rec-highlight';
  const bs = _highlightBox.style;
  bs.position = 'absolute';
  bs.border = '2px solid #6fa8dc';
  bs.backgroundColor = 'rgba(111, 168, 220, 0.15)';
  bs.borderRadius = '3px';
  bs.transition = 'all 0.05s ease-out';
  bs.display = 'none';
  bs.pointerEvents = 'none';

  _highlightTooltip = document.createElement('div');
  _highlightTooltip.id = '__pw-rec-tooltip';
  const ts = _highlightTooltip.style;
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

export function removeHighlightOverlay() {
  removeScrollbarFix();
  if (_highlightGlass && _highlightGlass.parentNode) {
    _highlightGlass.parentNode.removeChild(_highlightGlass);
  }
  _highlightGlass = null;
  _highlightBox = null;
  _highlightTooltip = null;
  _highlightedEl = null;
}

export function updateHighlight(event) {
  if (!contentState.recording || !contentState.highlightEnabled) {
    if (_highlightGlass) removeHighlightOverlay();
    return;
  }
  ensureHighlightOverlay();
  const x = event.clientX;
  const y = event.clientY;
  let el = getElementUnderPoint(x, y);
  if (!el) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
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

  const info = getHighlightInfo(el);
  if (!info || !info.text) {
    _highlightBox.style.display = 'none';
    _highlightTooltip.style.display = 'none';
    _highlightedEl = null;
    return;
  }

  if (info.target === _highlightedEl) return;
  _highlightedEl = info.target;

  console.log('[Playwright Recorder] HIGHLIGHT:', info.text, '| target:', info.target.tagName, info.target.id || '', info.target);

  const rect = info.target.getBoundingClientRect();
  _highlightBox.style.left = rect.left + 'px';
  _highlightBox.style.top = rect.top + 'px';
  _highlightBox.style.width = rect.width + 'px';
  _highlightBox.style.height = rect.height + 'px';
  _highlightBox.style.display = 'block';

  const badge = METHOD_BADGES[info.method] || 'CSS';
  const badgeColor = METHOD_COLORS[info.method] || '#757575';
  _highlightTooltip.innerHTML = '<span style="display:inline-block;background:' + badgeColor + ';color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-right:6px;vertical-align:middle;letter-spacing:0.5px">' + badge + '</span><span style="vertical-align:middle">' + info.text.replace(/</g, '&lt;') + '</span>';
  _highlightTooltip.style.display = 'block';

  let tooltipLeft = Math.max(4, rect.left);
  let tooltipTop = rect.bottom + 6;
  if (tooltipTop + 30 > window.innerHeight) {
    tooltipTop = Math.max(0, rect.top - 32);
  }
  if (tooltipLeft + _highlightTooltip.offsetWidth > window.innerWidth - 4) {
    tooltipLeft = Math.max(4, window.innerWidth - _highlightTooltip.offsetWidth - 4);
  }
  _highlightTooltip.style.left = tooltipLeft + 'px';
  _highlightTooltip.style.top = tooltipTop + 'px';
}
