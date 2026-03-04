/* ═══════════════════════════════════
   POPUP SCRIPT v3
   ═══════════════════════════════════ */

const $ = id => document.getElementById(id);

const modelHints = {
  'gemini-2.0-flash':                '⚡ Best balance — 15 req/min free',
  'gemini-2.0-flash-lite':           '⚡ Fastest — slightly less accurate',
  'gemini-2.5-flash':                '🆕 Newer, better quality — 15 req/min free',
  'gemini-2.5-flash-lite-preview':   '🆕 Latest lite — fast & cheap',
  'gemini-2.5-pro-preview-06-05':    '🧪 Best quality — only 5 req/min free',
  'gemini-1.5-flash':                '📦 Stable — good fallback',
  'gemini-1.5-flash-8b':            '📦 Smallest 1.5 — very fast',
  'gemini-1.5-pro':                  '📦 Older pro — 2 req/min free',
};

// ── Load saved settings ──
chrome.storage.sync.get({
  apiKey: '', apiKey2: '', apiKey3: '',
  model: 'gemini-2.0-flash',
  targetLanguage: 'English',
  displayMode: 'both'
}, s => {
  $('apiKey').value      = s.apiKey;
  $('apiKey2').value     = s.apiKey2;
  $('apiKey3').value     = s.apiKey3;
  $('model').value       = s.model;
  $('lang').value        = s.targetLanguage;
  $('displayMode').value = s.displayMode;
  updateModelHint();
});

$('model').addEventListener('change', updateModelHint);

function updateModelHint() {
  $('modelHint').textContent = modelHints[$('model').value] || '';
}

// ── Save ──
$('saveBtn').addEventListener('click', () => {
  const key1 = $('apiKey').value.trim();
  const key2 = $('apiKey2').value.trim();
  const key3 = $('apiKey3').value.trim();

  if (!key1 && !key2 && !key3) {
    setStatus('⚠️ Enter at least one API key', 'error');
    return;
  }

  const settings = {
    apiKey:         key1,
    apiKey2:        key2,
    apiKey3:        key3,
    model:          $('model').value,
    targetLanguage: $('lang').value,
    displayMode:    $('displayMode').value
  };

  chrome.storage.sync.set(settings, () => {
    const keyCount = [key1, key2, key3].filter(Boolean).length;
    setStatus(`✅ Saved! ${keyCount} API key${keyCount > 1 ? 's' : ''} configured.`, 'success');
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id)
        chrome.tabs.sendMessage(tabs[0].id, { action: 'settingsUpdated' });
    });
  });
});

// ── Translate Selected Range ──
$('translateBtn').addEventListener('click', () => {
  const keys = [$('apiKey').value, $('apiKey2').value, $('apiKey3').value]
    .filter(k => k.trim());
  if (keys.length === 0) {
    setStatus('⚠️ Save at least one API key first', 'error');
    return;
  }

  const range = $('pageRange').value.trim() || 'all';
  setStatus(`⏳ Starting (range: ${range})…`, 'info');

  chrome.runtime.sendMessage({
    action: 'translateAllFromPopup',
    range: range
  });
});

// ── Stop ──
$('stopBtn').addEventListener('click', () => {
  // Cancel queue in background
  chrome.runtime.sendMessage({ action: 'cancelAll' });
  // Tell content script to stop batch
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'stopBatch' });
    }
  });
  setStatus('⏹ Stopped.', 'info');
});

// ── Error Log ──
const errors = [];

function addError(msg, time) {
  errors.push({ msg, time });
  if (errors.length > 20) errors.shift(); // keep last 20
  renderErrors();
}

function renderErrors() {
  const log = $('errorLog');
  if (errors.length === 0) {
    log.innerHTML = '<div class="error-log-empty">No errors</div>';
    return;
  }
  log.innerHTML = errors.map(e =>
    `<div class="error-entry">
      <span class="error-time">${e.time}</span>
      <span class="error-msg">${escHtml(e.msg)}</span>
    </div>`
  ).reverse().join('');  // newest first
}

$('clearLog').addEventListener('click', () => {
  errors.length = 0;
  renderErrors();
});

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Listen for events ──
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'batchProgress') {
    setStatus(`⏳ Translating ${msg.current} / ${msg.total}…`, 'info');
    if (msg.current === msg.total) {
      setTimeout(() => setStatus('✅ All done!', 'success'), 500);
    }
  }
  if (msg.action === 'apiError') {
    addError(msg.error, msg.timestamp || new Date().toLocaleTimeString());
  }
});

// ── Get page stats ──
function refreshStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getStats' }, res => {
      if (chrome.runtime.lastError || !res) {
        $('pageHint').textContent = 'Open a manga page first';
        return;
      }
      $('pageHint').textContent =
        `Found ${res.total} images · ${res.done} translated` +
        (res.processing > 0 ? ` · ${res.processing} in progress` : '') +
        (res.batchRunning ? ' · BATCH RUNNING' : '');
    });
  });
}

refreshStats();
setInterval(refreshStats, 3000);  // auto-refresh stats

function setStatus(text, type) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status status-' + type;
}