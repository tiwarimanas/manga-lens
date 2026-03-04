/* ═══════════════════════════════════════════════
   BACKGROUND SERVICE WORKER — v3
   Queue + Retry + Key Rotation + Cancel Support
   ═══════════════════════════════════════════════ */

// ── Active Operations (for cancellation) ──
const activeOps = new Map();     // opId → AbortController
let opCounter = 0;

// ═══════════════════════════════════
//  RATE-LIMITED QUEUE
// ═══════════════════════════════════
const queue = {
  tasks: [],
  running: false,
  lastRequestTime: 0,
  MIN_INTERVAL: 4500,

  add(fn, opId) {
    return new Promise((resolve, reject) => {
      this.tasks.push({ fn, opId, resolve, reject });
      this.process();
    });
  },

  cancel(opId) {
    // Remove from queue if not yet started
    this.tasks = this.tasks.filter(t => {
      if (t.opId === opId) {
        t.reject(new Error('Cancelled'));
        return false;
      }
      return true;
    });
    // Abort if currently running
    const ctrl = activeOps.get(opId);
    if (ctrl) ctrl.abort();
  },

  cancelAll() {
    // Cancel everything in queue
    const pending = [...this.tasks];
    this.tasks = [];
    pending.forEach(t => t.reject(new Error('Cancelled')));
    // Abort all active
    for (const [id, ctrl] of activeOps) ctrl.abort();
    activeOps.clear();
  },

  async process() {
    if (this.running) return;
    this.running = true;

    while (this.tasks.length > 0) {
      const task = this.tasks.shift();
      if (!task) break;

      // Check if already cancelled
      const ctrl = activeOps.get(task.opId);
      if (ctrl?.signal?.aborted) {
        task.reject(new Error('Cancelled'));
        continue;
      }

      // Enforce interval
      const elapsed = Date.now() - this.lastRequestTime;
      if (elapsed < this.MIN_INTERVAL) {
        await sleep(this.MIN_INTERVAL - elapsed + 200);
      }

      // Check cancellation again after waiting
      if (activeOps.get(task.opId)?.signal?.aborted) {
        task.reject(new Error('Cancelled'));
        continue;
      }

      this.lastRequestTime = Date.now();

      try {
        const result = await task.fn();
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }

    this.running = false;
  }
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Cancellable sleep — resolves early if aborted
function cancellableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Cancelled')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    }, { once: true });
  });
}

// ═══════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translateImage',
    title: '🔤 Translate this image (Manga Lens)',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translateImage' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateImage',
      imageUrl: info.srcUrl
    });
  }
});

// ═══════════════════════════════════
//  MESSAGE ROUTER
// ═══════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'geminiTranslate') {
    const opId = ++opCounter;
    const controller = new AbortController();
    activeOps.set(opId, controller);

    // Send back opId immediately so content script can cancel later
    // We'll use the sendResponse for the final result

    queue.add(
      () => handleTranslation(msg.imageUrl, msg.base64Data, msg.mimeType, msg.settings, controller.signal),
      opId
    )
      .then(data => {
        activeOps.delete(opId);
        sendResponse({ success: true, data, opId });
      })
      .catch(err => {
        activeOps.delete(opId);
        if (err.message === 'Cancelled') {
          sendResponse({ success: false, error: 'Cancelled', cancelled: true, opId });
        } else {
          // Log error with full details
          broadcastError(err.message);
          sendResponse({ success: false, error: err.message, opId });
        }
      });
    return true;
  }

  if (msg.action === 'cancelOp') {
    const ctrl = activeOps.get(msg.opId);
    if (ctrl) {
      ctrl.abort();
      activeOps.delete(msg.opId);
    }
    queue.cancel(msg.opId);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'cancelAll') {
    queue.cancelAll();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'translateAllFromPopup') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'translateAll',
          range: msg.range || 'all'
        });
      }
    });
  }

  if (msg.action === 'getQueueSize') {
    sendResponse({
      queued: queue.tasks.length,
      active: activeOps.size
    });
    return true;
  }
});

// ── Broadcast errors to popup ──
function broadcastError(errorMsg) {
  chrome.runtime.sendMessage({
    action: 'apiError',
    error: errorMsg,
    timestamp: new Date().toLocaleTimeString()
  }).catch(() => {}); // popup might be closed
}

// ── Broadcast to active tab ──
async function notifyTab(msg) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, msg);
  } catch {}
}

// ═══════════════════════════════════
//  TRANSLATION HANDLER
// ═══════════════════════════════════
async function handleTranslation(imageUrl, base64Data, mimeType, settings, signal) {
  if (signal?.aborted) throw new Error('Cancelled');

  let base64, mime;

  if (base64Data) {
    base64 = base64Data;
    mime   = mimeType || 'image/jpeg';
  } else if (imageUrl?.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    mime   = match[1];
    base64 = match[2];
  } else {
    const res = await fetch(imageUrl, { signal });
    if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
    const blob = await res.blob();
    mime   = blob.type || 'image/jpeg';
    base64 = await blobToBase64(blob);
  }

  if (signal?.aborted) throw new Error('Cancelled');
  return await callGeminiWithRetry(base64, mime, settings, signal);
}

// ═══════════════════════════════════
//  API KEY ROTATION + RETRY
// ═══════════════════════════════════
async function callGeminiWithRetry(base64, mimeType, settings, signal, attempt = 1) {
  const MAX_RETRIES = 3;
  const BASE_DELAY  = 10000;

  // Collect all valid keys
  const keys = [settings.apiKey, settings.apiKey2, settings.apiKey3]
    .filter(k => k && k.trim().length > 0);

  if (keys.length === 0) throw new Error('No API key configured. Open Manga Lens popup to add one.');

  // Determine which key to try for this attempt
  const keyIndex = (attempt - 1) % keys.length;
  const currentKey = keys[keyIndex];

  try {
    if (signal?.aborted) throw new Error('Cancelled');
    return await callGemini(base64, mimeType, { ...settings, apiKey: currentKey }, signal);

  } catch (err) {
    if (err.message === 'Cancelled') throw err;

    const isRateLimit = /429|rate|quota|resource.exhausted|too.many/i.test(err.message);
    const isServerError = /500|502|503|overloaded|internal/i.test(err.message);
    const isRetryable = isRateLimit || isServerError;

    if (isRetryable && attempt <= MAX_RETRIES * keys.length) {
      // If we have more keys, try next key immediately
      if (keys.length > 1 && attempt % keys.length !== 0) {
        const nextKey = (keyIndex + 1) % keys.length;
        console.log(`[MangaLens] Key ${keyIndex + 1} failed, trying key ${nextKey + 1}`);

        await notifyTab({
          action: 'rateLimitWait',
          message: `Key ${keyIndex + 1} rate limited → switching to key ${nextKey + 1}`,
          waitTime: 2,
        });

        await cancellableSleep(2000, signal);
        return callGeminiWithRetry(base64, mimeType, settings, signal, attempt + 1);
      }

      // All keys exhausted for this round — backoff
      const round = Math.ceil(attempt / keys.length);
      if (round <= MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, round - 1);
        const jitter = Math.random() * 3000;
        const wait = delay + jitter;

        console.log(`[MangaLens] All keys exhausted. Round ${round}/${MAX_RETRIES}, waiting ${(wait/1000).toFixed(1)}s`);

        await notifyTab({
          action: 'rateLimitWait',
          message: `All keys rate limited. Retry round ${round}/${MAX_RETRIES} in ${Math.ceil(wait/1000)}s`,
          waitTime: Math.ceil(wait / 1000),
        });

        await cancellableSleep(wait, signal);
        return callGeminiWithRetry(base64, mimeType, settings, signal, attempt + 1);
      }
    }

    // Not retryable or max retries exhausted
    throw new Error(`[Key ${keyIndex + 1}] ${err.message}`);
  }
}

// ═══════════════════════════════════
//  GEMINI API CALL
// ═══════════════════════════════════
async function callGemini(base64, mimeType, settings, signal) {
  const apiKey     = settings.apiKey;
  const model = settings.model || 'gemini-2.5-flash';
  const targetLang = settings.targetLanguage || 'English';

  const prompt = `You are an expert translator for manga, manhwa, and manhua comics.

TASK: Find and translate ALL visible text in this comic page image to ${targetLang}.

Look for:
1. Speech bubbles (dialogue)
2. Thought bubbles (internal thoughts)
3. Narration boxes
4. Sound effects / onomatopoeia (SFX)
5. Signs, labels, or any other visible text

RESPOND WITH ONLY a valid JSON array — no markdown, no code fences, no explanation.

Each element must be:
{
  "id": <number starting at 1 in reading order>,
  "original": "<original text>",
  "translation": "<natural ${targetLang} translation>",
  "type": "dialogue" | "narration" | "sfx" | "sign",
  "x": <horizontal center 0-100, 0=left edge>,
  "y": <vertical center 0-100, 0=top edge>
}

Rules:
- Translate naturally, match the tone
- For SFX give an expressive English equivalent
- Use correct reading order for the source language
- If NO text exists respond with exactly: []`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",  threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT",  threshold: "BLOCK_NONE" }
    ]
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') throw new Error('Cancelled');
    throw new Error(`Network error: ${fetchErr.message}`);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.error?.message || '';
    const status = err.error?.status || '';
    throw new Error(`${res.status} ${status}: ${detail}`.trim());
  }

  const data = await res.json();

  // Check for blocked content
  if (data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('Content blocked by safety filter');
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Blocked: ${blockReason}`);
    throw new Error('Empty response from Gemini (no text returned)');
  }

  return parseJSON(text);
}

// ═══════════════════════════════════
//  HELPERS
// ═══════════════════════════════════
function parseJSON(raw) {
  let s = raw.trim();
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Extract JSON array
  const first = s.indexOf('[');
  const last  = s.lastIndexOf(']');
  if (first !== -1 && last > first) {
    s = s.substring(first, last + 1);
  }

  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    return parsed;
  } catch (e) {
    throw new Error(`Invalid JSON from Gemini: ${e.message}\nRaw: ${s.substring(0, 200)}`);
  }
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}