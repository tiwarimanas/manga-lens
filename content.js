/* ═══════════════════════════════════════════════
   CONTENT SCRIPT – Manga Lens v3
   Cancel support, page selection, error forwarding
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  const MIN_WIDTH  = 200;
  const MIN_HEIGHT = 300;
  const BATCH_DELAY = 5000;

  const state = {
    settings: null,
    translated: new Map(),      // img → data
    processing: new Map(),      // img → { opId }
    allImages: [],              // ordered list of detected manga images
    batchRunning: false,
    batchCancelled: false,
  };

  // ═══════════════════════════════════
  //  INIT
  // ═══════════════════════════════════
  async function init() {
    state.settings = await loadSettings();
    listenForMessages();
    observeDOM();
    setTimeout(() => {
      scanImages();
      numberImages();
    }, 800);
  }

  function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get({
        apiKey: '', apiKey2: '', apiKey3: '',
        model: 'gemini-2.5-flash',
        targetLanguage: 'English',
        displayMode: 'both'
      }, resolve);
    });
  }

  // ═══════════════════════════════════
  //  IMAGE DETECTION & NUMBERING
  // ═══════════════════════════════════
  function isMangaImage(img) {
    const w = img.naturalWidth  || img.offsetWidth;
    const h = img.naturalHeight || img.offsetHeight;
    return w >= MIN_WIDTH && h >= MIN_HEIGHT;
  }

  function scanImages() {
    document.querySelectorAll('img').forEach(img => {
      if (img.complete && img.naturalWidth) processImage(img);
      else img.addEventListener('load', () => processImage(img), { once: true });
    });
  }

  function processImage(img) {
    if (img.dataset.mlProcessed) return;
    if (!isMangaImage(img)) return;
    img.dataset.mlProcessed = '1';
    attachButton(img);
  }

  function numberImages() {
    // Rebuild ordered list of all manga images on page
    state.allImages = Array.from(document.querySelectorAll('img'))
      .filter(isMangaImage);

    state.allImages.forEach((img, i) => {
      img.dataset.mlIndex = i + 1;
      const wrap = img.closest('.ml-wrap') || img.parentElement;
      if (!wrap) return;

      // Update or create number badge
      let badge = wrap.querySelector('.ml-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'ml-badge';
        wrap.appendChild(badge);
      }
      badge.textContent = `#${i + 1}`;
    });
  }

  function observeDOM() {
    new MutationObserver(mutations => {
      let found = false;
      for (const m of mutations)
        for (const n of m.addedNodes)
          if (n.nodeName === 'IMG' || n.querySelector?.('img')) { found = true; break; }
      if (found) setTimeout(() => { scanImages(); numberImages(); }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════
  //  WRAPPER & BUTTONS
  // ═══════════════════════════════════
  function ensureWrapper(img) {
    if (img.parentElement?.classList.contains('ml-wrap')) return img.parentElement;

    const parent = img.parentElement;
    if (parent && parent.children.length === 1 &&
        !['BODY','HTML','HEAD'].includes(parent.tagName)) {
      parent.classList.add('ml-wrap');
      parent.style.position = 'relative';
      return parent;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ml-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    return wrap;
  }

  function attachButton(img) {
    const wrap = ensureWrapper(img);
    if (wrap.querySelector('.ml-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ml-btn';
    btn.innerHTML = '🔤';
    btn.title = 'Translate (Manga Lens)';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();

      // If currently processing → CANCEL
      if (state.processing.has(img)) {
        cancelImageTranslation(img);
        return;
      }
      // If already translated → toggle
      if (state.translated.has(img)) {
        toggleVisibility(img);
        return;
      }
      // Otherwise → translate
      handleTranslateClick(img);
    });
    wrap.appendChild(btn);
  }

  function setButtonState(img, s, extra) {
    const btn = img.closest('.ml-wrap')?.querySelector('.ml-btn')
             || img.parentElement?.querySelector('.ml-btn');
    if (!btn) return;
    btn.classList.remove('ml-loading','ml-done','ml-error','ml-waiting','ml-cancellable');

    switch (s) {
      case 'loading':
        btn.innerHTML = '❌';   // Click to cancel
        btn.title = 'Click to cancel';
        btn.classList.add('ml-loading', 'ml-cancellable');
        break;
      case 'retrying':
        btn.innerHTML = `🔄 ${extra || ''}`;
        btn.title = `Retrying… Click to cancel`;
        btn.classList.add('ml-loading', 'ml-cancellable');
        break;
      case 'waiting':
        btn.innerHTML = `⏳ #${extra || ''}`;
        btn.title = 'In queue — click to cancel';
        btn.classList.add('ml-waiting', 'ml-cancellable');
        break;
      case 'done':
        btn.innerHTML = '✅';
        btn.title = 'Click to toggle translation';
        btn.classList.add('ml-done');
        break;
      case 'error':
        btn.innerHTML = '❌';
        btn.title = extra || 'Error — click to retry';
        btn.classList.add('ml-error');
        break;
      case 'cancelled':
        btn.innerHTML = '🔤';
        btn.title = 'Cancelled — click to retry';
        break;
      default:
        btn.innerHTML = '🔤';
        btn.title = 'Translate (Manga Lens)';
    }
  }

  // ═══════════════════════════════════
  //  TRANSLATE SINGLE IMAGE
  // ═══════════════════════════════════
  async function handleTranslateClick(img) {
    if (state.translated.has(img)) { toggleVisibility(img); return; }
    if (state.processing.has(img)) return;

    state.settings = await loadSettings();
    const keys = [state.settings.apiKey, state.settings.apiKey2, state.settings.apiKey3]
      .filter(k => k && k.trim());

    if (keys.length === 0) {
      notify('⚠️ Set at least one Gemini API key in the popup.', 'error');
      return;
    }

    setButtonState(img, 'loading');

    try {
      let payload = canvasBase64(img);
      let message;

      if (payload) {
        message = {
          action: 'geminiTranslate',
          base64Data: payload.base64,
          mimeType: payload.mime,
          settings: state.settings
        };
      } else {
        message = {
          action: 'geminiTranslate',
          imageUrl: img.src,
          settings: state.settings
        };
      }

      // Mark as processing
      state.processing.set(img, { opId: null });

      const response = await chrome.runtime.sendMessage(message);

      // Store opId for cancellation
      if (response.opId) {
        const info = state.processing.get(img);
        if (info) info.opId = response.opId;
      }

      if (!response.success) {
        if (response.cancelled) {
          setButtonState(img, 'cancelled');
        } else {
          throw new Error(response.error);
        }
      } else if (response.data.length === 0) {
        notify('No text found in this image.', 'info');
        setButtonState(img, 'default');
      } else {
        state.translated.set(img, response.data);
        renderTranslation(img, response.data);
        setButtonState(img, 'done');
      }
    } catch (err) {
      if (err.message === 'Cancelled') {
        setButtonState(img, 'cancelled');
      } else {
        console.error('[MangaLens]', err);
        const errorMsg = err.message || 'Unknown error';
        notify('❌ ' + errorMsg, 'error');
        setButtonState(img, 'error', errorMsg);

        // Forward error to popup
        try {
          chrome.runtime.sendMessage({
            action: 'apiError',
            error: errorMsg,
            timestamp: new Date().toLocaleTimeString()
          });
        } catch {}
      }
    } finally {
      state.processing.delete(img);
    }
  }

  // ── Cancel single image ──
  function cancelImageTranslation(img) {
    const info = state.processing.get(img);
    if (info?.opId) {
      chrome.runtime.sendMessage({ action: 'cancelOp', opId: info.opId });
    }
    state.processing.delete(img);
    setButtonState(img, 'cancelled');
    notify('🚫 Translation cancelled.', 'info');
  }

  function canvasBase64(img) {
    try {
      const c = document.createElement('canvas');
      c.width  = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const url = c.toDataURL('image/jpeg', 0.85);
      return { base64: url.split(',')[1], mime: 'image/jpeg' };
    } catch { return null; }
  }

  // ═══════════════════════════════════
  //  RENDER TRANSLATIONS
  // ═══════════════════════════════════
  function renderTranslation(img, items) {
    const wrap = ensureWrapper(img);
    clearTranslation(wrap);
    const mode = state.settings.displayMode || 'both';
    if (mode === 'overlay' || mode === 'both') renderOverlay(wrap, items);
    renderPanel(wrap, items);
  }

  function renderOverlay(wrap, items) {
    const ov = document.createElement('div');
    ov.className = 'ml-overlay';
    items.forEach(t => {
      const b = document.createElement('div');
      b.className = 'ml-bubble ml-t-' + t.type;
      b.style.left = t.x + '%';
      b.style.top  = t.y + '%';
      b.innerHTML = `<span class="ml-bubble-text">${esc(t.translation)}</span>`;
      b.title = t.original;
      ov.appendChild(b);
    });
    wrap.appendChild(ov);
  }

  function renderPanel(wrap, items) {
    const panel = document.createElement('div');
    panel.className = 'ml-panel';

    const hdr = document.createElement('div');
    hdr.className = 'ml-panel-hdr';
    hdr.innerHTML = `
      <span>Translation — ${items.length} block${items.length > 1 ? 's' : ''}</span>
      <div class="ml-panel-btns">
        <button class="ml-pbtn" data-action="overlay" title="Toggle overlay">📌</button>
        <button class="ml-pbtn" data-action="copy" title="Copy all">📋</button>
        <button class="ml-pbtn" data-action="close" title="Collapse">▼</button>
      </div>`;
    panel.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'ml-panel-body';
    items.forEach(t => {
      const row = document.createElement('div');
      row.className = 'ml-row ml-t-' + t.type;
      row.innerHTML = `
        <span class="ml-row-id">${t.id}</span>
        <div class="ml-row-content">
          <div class="ml-row-tl">${esc(t.translation)}</div>
          <div class="ml-row-og">${esc(t.original)}</div>
        </div>
        <span class="ml-row-type">${t.type}</span>`;
      body.appendChild(row);
    });
    panel.appendChild(body);

    hdr.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'close') {
        body.classList.toggle('ml-collapsed');
        e.target.closest('[data-action]').textContent =
          body.classList.contains('ml-collapsed') ? '▲' : '▼';
      }
      if (action === 'copy') {
        const txt = items.map(t => `[${t.type}] ${t.translation}`).join('\n');
        navigator.clipboard.writeText(txt).then(() => notify('📋 Copied!', 'success'));
      }
      if (action === 'overlay') {
        const ov = wrap.querySelector('.ml-overlay');
        if (ov) ov.classList.toggle('ml-hidden');
        else renderOverlay(wrap, items);
      }
    });

    wrap.appendChild(panel);
  }

  function clearTranslation(wrap) {
    wrap.querySelectorAll('.ml-overlay, .ml-panel').forEach(el => el.remove());
  }

  function toggleVisibility(img) {
    const wrap = img.closest('.ml-wrap') || img.parentElement;
    if (!wrap) return;
    wrap.querySelectorAll('.ml-overlay, .ml-panel').forEach(el =>
      el.classList.toggle('ml-hidden'));
  }

  // ═══════════════════════════════════
  //  BATCH TRANSLATE WITH RANGE
  // ═══════════════════════════════════
  async function translateAll(rangeStr) {
    // Refresh image list
    numberImages();

    const images = parseRange(rangeStr, state.allImages);

    // Filter already translated
    const todo = images.filter(img => !state.translated.has(img) && !state.processing.has(img));

    if (todo.length === 0) {
      notify('Nothing to translate in that range.', 'info');
      return;
    }

    state.batchRunning = true;
    state.batchCancelled = false;

    notify(`Translating ${todo.length} images…`, 'info');

    for (let i = 0; i < todo.length; i++) {
      // Check if batch was cancelled
      if (state.batchCancelled) {
        notify(`⏸ Batch stopped. ${i}/${todo.length} done.`, 'info');
        break;
      }

      const img = todo[i];
      if (!img.dataset.mlProcessed) processImage(img);

      // Show queue positions on upcoming images
      for (let j = i + 1; j < todo.length; j++) {
        setButtonState(todo[j], 'waiting', j - i);
      }

      await handleTranslateClick(img);

      // Report progress
      try {
        chrome.runtime.sendMessage({
          action: 'batchProgress',
          current: i + 1,
          total: todo.length
        });
      } catch {}

      // Delay between requests
      if (i < todo.length - 1 && !state.batchCancelled) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }

    // Clean up waiting states
    todo.forEach(img => {
      if (!state.translated.has(img) && !state.processing.has(img)) {
        setButtonState(img, 'default');
      }
    });

    state.batchRunning = false;
    if (!state.batchCancelled) {
      notify('✅ All selected images translated!', 'success');
    }
  }

  // ── Parse range string ──
  // Supports: "all", "1-5", "3,5,7", "1-3,5,8-10"
  function parseRange(rangeStr, allImages) {
    if (!rangeStr || rangeStr.trim().toLowerCase() === 'all') {
      return [...allImages];
    }

    const indices = new Set();
    const parts = rangeStr.split(',').map(s => s.trim());

    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map(s => s.trim());
        const start = parseInt(startStr, 10);
        const end   = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end && i <= allImages.length; i++) {
            if (i >= 1) indices.add(i);
          }
        }
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= allImages.length) {
          indices.add(n);
        }
      }
    }

    // Convert 1-based indices to images
    const sorted = Array.from(indices).sort((a, b) => a - b);
    return sorted.map(i => allImages[i - 1]).filter(Boolean);
  }

  // ── Stop batch ──
  function stopBatch() {
    state.batchCancelled = true;
    state.batchRunning = false;

    // Cancel all queued + active requests
    chrome.runtime.sendMessage({ action: 'cancelAll' });

    // Reset all processing states
    for (const [img] of state.processing) {
      setButtonState(img, 'cancelled');
    }
    state.processing.clear();

    notify('⏹ Batch stopped.', 'info');
  }

  // ═══════════════════════════════════
  //  MESSAGES
  // ═══════════════════════════════════
  function listenForMessages() {
    chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {

      if (msg.action === 'translateImage') {
        const img = document.querySelector(`img[src="${msg.imageUrl}"]`);
        if (img) handleTranslateClick(img);
      }

      if (msg.action === 'translateAll') {
        if (state.batchRunning) {
          notify('Batch already running. Stop it first.', 'info');
          return;
        }
        translateAll(msg.range);
      }

      if (msg.action === 'stopBatch') {
        stopBatch();
      }

      if (msg.action === 'rateLimitWait') {
        notify(`⏳ ${msg.message}`, 'info');
      }

      if (msg.action === 'getStats') {
        numberImages();
        sendResponse({
          total: state.allImages.length,
          done: state.translated.size,
          processing: state.processing.size,
          batchRunning: state.batchRunning
        });
      }

      if (msg.action === 'settingsUpdated') {
        loadSettings().then(s => state.settings = s);
      }

      return true;
    });
  }

  // ═══════════════════════════════════
  //  NOTIFICATIONS
  // ═══════════════════════════════════
  function notify(text, type = 'info') {
    document.querySelectorAll('.ml-notif').forEach(n => n.remove());
    const n = document.createElement('div');
    n.className = `ml-notif ml-notif-${type}`;
    n.textContent = text;
    document.body.appendChild(n);
    requestAnimationFrame(() => n.classList.add('ml-notif-show'));
    setTimeout(() => {
      n.classList.remove('ml-notif-show');
      setTimeout(() => n.remove(), 300);
    }, 4500);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Boot ──
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();