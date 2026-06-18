'use strict';

const DEBOUNCE_MS = 1000;
const MIN_TEXT = 3;

// Copied from computed style to overlay div so text layout matches
const LAYOUT_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'boxSizing', 'tabSize'
];

// ---- Settings ----

const settings = {
  enabled: true,
  language: 'en-US',
  provider: 'languagetool',
  claudeApiKey: '',
  claudeModel: 'claude-haiku-4-5-20251001',
  ignoredWords: new Set()
};

chrome.storage.sync.get(null, (prefs) => {
  settings.enabled = prefs.enabled !== false;
  settings.language = prefs.language || 'en-US';
  settings.provider = prefs.provider || 'languagetool';
  settings.claudeApiKey = prefs.claudeApiKey || '';
  settings.claudeModel = prefs.claudeModel || 'claude-haiku-4-5-20251001';
  settings.ignoredWords = new Set(prefs.ignoredWords || []);
});

chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes) {
    settings.enabled = changes.enabled.newValue;
    if (!settings.enabled) removeAllOverlays();
  }
  if ('language' in changes) settings.language = changes.language.newValue;
  if ('provider' in changes) settings.provider = changes.provider.newValue;
  if ('claudeApiKey' in changes) settings.claudeApiKey = changes.claudeApiKey.newValue;
  if ('claudeModel' in changes) settings.claudeModel = changes.claudeModel.newValue;
  if ('ignoredWords' in changes) {
    settings.ignoredWords = new Set(changes.ignoredWords.newValue || []);
    rerenderAll();
  }
});

// ---- Per-element state ----

const elementState = new WeakMap(); // el -> { timer, checkId, matches, overlay }

// ---- Tooltip ----

let tooltipEl = null;

function getTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'grammarr-tooltip';
    document.documentElement.appendChild(tooltipEl);
    document.addEventListener('click', (e) => {
      if (tooltipEl && !tooltipEl.contains(e.target)) hideTooltip();
    }, { capture: true, passive: true });
  }
  return tooltipEl;
}

function showTooltip(match, rect, targetEl) {
  const tt = getTooltip();
  const isSpelling = match.type === 'spelling';
  const typeLabel = isSpelling ? 'Spelling' : 'Grammar';
  const fixes = (match.replacements || []).slice(0, 5);

  tt.innerHTML = `
    <div class="grammarr-tt-header">
      <span class="grammarr-tt-badge grammarr-tt-${typeLabel.toLowerCase()}">${typeLabel}</span>
    </div>
    <p class="grammarr-tt-msg">${escapeHtml(match.message)}</p>
    <div class="grammarr-tt-actions">
      ${fixes.map((f, i) =>
        `<button class="grammarr-tt-fix" data-idx="${i}">${escapeHtml(f)}</button>`
      ).join('')}
      <button class="grammarr-tt-ignore">Ignore</button>
    </div>
  `;

  tt.querySelectorAll('.grammarr-tt-fix').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const f = fixes[parseInt(btn.dataset.idx, 10)];
      if (f !== undefined) applyFix(targetEl, match, f);
      hideTooltip();
    });
  });

  tt.querySelector('.grammarr-tt-ignore').addEventListener('mousedown', (e) => {
    e.preventDefault();
    ignoreWord(match._word || '');
    hideTooltip();
  });

  tt.style.display = 'block';

  // Position: below error word, clamped to viewport
  const w = 300;
  let top = rect.bottom + 6;
  let left = rect.left;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (left < 8) left = 8;
  if (top + 140 > window.innerHeight - 8) top = rect.top - 140 - 6;

  tt.style.top = top + 'px';
  tt.style.left = left + 'px';
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// ---- Whitelist ----

function ignoreWord(word) {
  if (!word) return;
  const w = word.toLowerCase();
  settings.ignoredWords.add(w);
  chrome.storage.sync.set({ ignoredWords: [...settings.ignoredWords] });
}

function filterMatches(matches, text) {
  return matches.filter(m => {
    const w = text.slice(m.offset, m.offset + m.length).toLowerCase().trim();
    return w && !settings.ignoredWords.has(w);
  });
}

// ---- Fix application ----

function applyFix(el, match, replacement) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.setRangeText(replacement, match.offset, match.offset + match.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    const range = textRangeInElement(el, match.offset, match.offset + match.length);
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, replacement);
  }
}

function textRangeInElement(container, start, end) {
  let count = 0;
  let startNode = null, endNode = null, startOff = 0, endOff = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.length;
    if (!startNode && count + len > start) {
      startNode = node;
      startOff = start - count;
    }
    if (!endNode && count + len >= end) {
      endNode = node;
      endOff = end - count;
      break;
    }
    count += len;
  }
  if (!startNode) return null;
  if (!endNode) { endNode = startNode; endOff = startNode.length; }
  const range = document.createRange();
  range.setStart(startNode, Math.min(startOff, startNode.length));
  range.setEnd(endNode, Math.min(endOff, endNode.length));
  return range;
}

// ---- Overlay creation ----

function buildOverlay(el, isMultiline) {
  const overlay = document.createElement('div');
  overlay.className = 'grammarr-overlay';

  const cs = window.getComputedStyle(el);
  for (const prop of LAYOUT_PROPS) {
    overlay.style[prop] = cs[prop];
  }

  if (isMultiline) {
    overlay.style.whiteSpace = 'pre-wrap';
    overlay.style.overflowWrap = 'break-word';
    overlay.style.wordBreak = 'normal';
  } else {
    overlay.style.whiteSpace = 'nowrap';
    overlay.style.overflowWrap = 'normal';
  }

  overlay.style.position = 'fixed';
  overlay.style.margin = '0';
  overlay.style.color = 'transparent';
  overlay.style.backgroundColor = 'transparent';
  overlay.style.border = 'none';
  overlay.style.outline = 'none';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483646';
  overlay.style.overflow = 'hidden';

  document.documentElement.appendChild(overlay);
  positionOverlay(el, overlay);
  return overlay;
}

function positionOverlay(el, overlay) {
  const r = el.getBoundingClientRect();
  overlay.style.top = r.top + 'px';
  overlay.style.left = r.left + 'px';
  overlay.style.width = r.width + 'px';
  overlay.style.height = r.height + 'px';
}

// ---- Overlay rendering ----

function buildHighlightedHtml(text, sorted) {
  let html = '';
  let pos = 0;
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.offset < pos) continue;
    html += escapeHtml(text.slice(pos, m.offset));
    const word = text.slice(m.offset, m.offset + m.length);
    m._word = word;
    const cls = m.type === 'spelling' ? 'grammarr-spell' : 'grammarr-grammar';
    html += `<span class="${cls}" data-idx="${i}">${escapeHtml(word)}</span>`;
    pos = m.offset + m.length;
  }
  html += escapeHtml(text.slice(pos));
  return html;
}

function wireSpanClicks(overlay, sorted, targetEl) {
  overlay.querySelectorAll('[data-idx]').forEach(span => {
    span.style.pointerEvents = 'auto';
    span.style.cursor = 'pointer';
    const idx = parseInt(span.dataset.idx, 10);
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const match = sorted[idx];
      if (match) showTooltip(match, span.getBoundingClientRect(), targetEl);
    });
  });
}

function renderTextareaOverlay(el, matches) {
  const s = elementState.get(el);
  if (!s?.overlay) return;

  const text = el.value;
  const filtered = filterMatches(matches, text);
  const sorted = filtered.slice().sort((a, b) => a.offset - b.offset);

  positionOverlay(el, s.overlay);
  s.overlay.innerHTML = buildHighlightedHtml(text, sorted);
  s.overlay.scrollTop = el.scrollTop;
  s.overlay.scrollLeft = el.scrollLeft;
  wireSpanClicks(s.overlay, sorted, el);
}

function renderContentEditableOverlay(el, matches) {
  const s = elementState.get(el);
  if (!s) return;

  if (!s.overlay) {
    s.overlay = buildOverlay(el, true);
    // Match additional CE-specific styles
    const cs = window.getComputedStyle(el);
    s.overlay.style.whiteSpace = cs.whiteSpace || 'normal';
    s.overlay.style.wordBreak = cs.wordBreak;
  }

  const text = el.innerText || '';
  const filtered = filterMatches(matches, text);
  const sorted = filtered.slice().sort((a, b) => a.offset - b.offset);

  positionOverlay(el, s.overlay);
  s.overlay.innerHTML = buildHighlightedHtml(text, sorted);
  wireSpanClicks(s.overlay, sorted, el);
}

// ---- API check ----

async function checkElement(el, checkId) {
  if (!settings.enabled) return;

  const isNative = el.value !== undefined;
  const text = isNative ? el.value : (el.innerText || '');
  if (!text || text.trim().length < MIN_TEXT) {
    clearMatches(el);
    return;
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'CHECK_TEXT',
      text,
      language: settings.language,
      provider: settings.provider,
      claudeApiKey: settings.claudeApiKey,
      claudeModel: settings.claudeModel
    });
  } catch {
    return; // extension context invalidated
  }

  const s = elementState.get(el);
  if (!s || s.checkId !== checkId) return; // stale response

  if (!response || response.error) return;

  s.matches = response.matches || [];

  if (isNative) {
    renderTextareaOverlay(el, s.matches);
  } else {
    renderContentEditableOverlay(el, s.matches);
  }
}

function scheduleCheck(el) {
  const s = elementState.get(el);
  if (!s) return;
  clearTimeout(s.timer);
  const id = Date.now();
  s.checkId = id;
  s.timer = setTimeout(() => checkElement(el, id), DEBOUNCE_MS);
}

function clearMatches(el) {
  const s = elementState.get(el);
  if (!s) return;
  s.matches = [];
  if (s.overlay) s.overlay.innerHTML = '';
}

function rerenderAll() {
  elementState.forEach((s, el) => {
    if (!s.matches?.length) return;
    if (el.value !== undefined) renderTextareaOverlay(el, s.matches);
    else renderContentEditableOverlay(el, s.matches);
  });
}

function removeAllOverlays() {
  document.querySelectorAll('.grammarr-overlay').forEach(o => o.remove());
  hideTooltip();
  elementState.forEach(s => { s.overlay = null; s.matches = []; });
}

// ---- Element setup ----

function isCheckable(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const t = (el.type || '').toLowerCase();
    return !t || ['text', 'search', 'email', 'url'].includes(t);
  }
  return el.isContentEditable === true;
}

function setupElement(el) {
  if (elementState.has(el) || !isCheckable(el)) return;

  const isNative = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  const isMultiline = el.tagName === 'TEXTAREA' || !isNative;
  const overlay = isNative ? buildOverlay(el, isMultiline) : null;

  elementState.set(el, { timer: null, checkId: 0, matches: [], overlay });

  el.addEventListener('input', () => scheduleCheck(el));
  el.addEventListener('focus', () => {
    const s = elementState.get(el);
    if (s?.overlay) positionOverlay(el, s.overlay);
    scheduleCheck(el);
  });
  el.addEventListener('blur', hideTooltip);

  if (isNative) {
    el.addEventListener('scroll', () => {
      const s = elementState.get(el);
      if (s?.overlay) {
        s.overlay.scrollTop = el.scrollTop;
        s.overlay.scrollLeft = el.scrollLeft;
      }
    });
  }

  const initialText = el.value !== undefined ? el.value : el.innerText;
  if (initialText && initialText.trim().length >= MIN_TEXT) scheduleCheck(el);
}

// ---- DOM scanning ----

function scan(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('textarea, input, [contenteditable="true"]').forEach(el => {
    if (isCheckable(el)) setupElement(el);
  });
}

scan(document);

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (isCheckable(node)) setupElement(node);
      scan(node);
    }
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scan(document);
  });
}

// Reposition overlays on scroll/resize
window.addEventListener('scroll', () => {
  elementState.forEach((s, el) => {
    if (s.overlay) positionOverlay(el, s.overlay);
  });
}, { capture: true, passive: true });

window.addEventListener('resize', () => {
  elementState.forEach((s, el) => {
    if (s.overlay) {
      const cs = window.getComputedStyle(el);
      for (const prop of LAYOUT_PROPS) s.overlay.style[prop] = cs[prop];
      positionOverlay(el, s.overlay);
    }
  });
}, { passive: true });

// ---- Utility ----

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
