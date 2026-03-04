

```markdown
# 🔤 Manga Lens — AI Manga Translator

A free Chrome extension that translates raw manga, manhwa & manhua instantly using Google Gemini AI.

> Your API key. Your privacy. No limits.

![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Gemini](https://img.shields.io/badge/Powered%20by-Gemini%20AI-8E75B2?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## ✨ Features

- 🔤 **One-click translate** — hover any manga image, click the button
- 📖 **Batch translate** — translate entire chapters at once
- 📄 **Page range selection** — choose specific pages (`1-5`, `3,7,9-12`)
- 🎯 **Smart overlay** — translations appear on speech bubbles
- 📋 **Translation panel** — organized list with original + translated text
- 🔑 **3 API key slots** — auto-rotates if one hits rate limit
- 🌍 **18 languages** supported
- ⚡ **Multiple Gemini models** — Flash, Flash Lite, Pro & latest previews
- 🛡️ **100% private** — keys stay on YOUR device, no external servers
- 🚫 **No subscriptions** — completely free using Gemini's free tier
- ❌ **Cancel anytime** — click the button again to stop translation
- 📊 **Error log** — see actual API errors in the popup

---

## 🚀 Setup (5 minutes)

### 1. Get a Free Gemini API Key

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **"Create API Key"**
3. Copy the key

> 💡 You can create up to 3 keys for rotation to avoid rate limits.

### 2. Install the Extension

```bash
git clone https://github.com/AkashKumar3/manga-lens.git
```

1. Open Chrome → go to `chrome://extensions/`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the `manga-lens` folder

### 3. Generate Icons

1. Open `create_icons.html` in your browser
2. Click the 3 download buttons
3. Move `icon16.png`, `icon48.png`, `icon128.png` into the `manga-lens/` folder

### 4. Configure

1. Click the **Manga Lens** icon in Chrome toolbar
2. Paste your API key(s)
3. Choose model & language
4. Click **Save Settings**

### 5. Translate!

| Method | How |
|---|---|
| **Hover button** | Hover manga image → click 🔤 |
| **Right-click** | Right-click image → *"Translate this image"* |
| **Batch** | Open popup → set page range → click ▶ Translate |
| **Cancel** | Click the button again while translating |

---

## 🤖 Supported Models

| Model | Speed | Quality | Free Quota |
|---|---|---|---|
| **Gemini 2.5 Flash** ⭐ | Fast | Best | 15 req/min |
| Gemini 2.5 Flash Lite | Fastest | Good | 15 req/min |
| Gemini 2.5 Pro Preview | Slower | Best | 5 req/min |
| Gemini 2.0 Flash | Fast | Good | 15 req/min |
| Gemini 2.0 Flash Lite | Fastest | Decent | 15 req/min |
| Gemini 1.5 Flash | Fast | Good | 15 req/min |
| Gemini 1.5 Pro | Slower | Great | 2 req/min |

> ⭐ **Recommended:** Gemini 2.5 Flash — best quality, fewer rate limit issues, same free quota.

---

## 🌍 Supported Languages

English · Spanish · French · German · Portuguese · Italian · Russian · Arabic · Hindi · Indonesian · Vietnamese · Thai · Turkish · Polish · Dutch · Filipino · Malay · Bengali

---

## 📁 Project Structure

```
manga-lens/
├── manifest.json        # Extension config
├── background.js        # API calls, queue, retry logic
├── content.js           # Image detection, UI overlays
├── content.css          # Overlay & panel styles
├── popup.html           # Settings popup
├── popup.js             # Popup logic
├── popup.css            # Popup styles
├── create_icons.html    # Open in browser to generate icons
├── icon16.png           # Generated icon
├── icon48.png           # Generated icon
└── icon128.png          # Generated icon
```

---

## 🔧 How It Works

```
Manga page image on website
        ↓
Extension detects images (min 200×300px)
        ↓
You click 🔤 (or batch translate)
        ↓
Image sent to Gemini Vision API
  → OCR + Translation in one call
        ↓
Rate-limited queue (1 request at a time)
  → Auto key rotation on 429 errors
  → Exponential backoff & retry
        ↓
Translation returned as JSON
        ↓
Overlay bubbles + panel displayed on page
```

---

## ⚡ Free Tier Limits

| Resource | Limit | Real Usage |
|---|---|---|
| Requests/minute | 15 | ~10 pages/min with safety margin |
| Requests/day | 1,500 | ~75 full chapters |
| Cost | **$0** | Forever free |

With **3 API keys** you effectively get: **4,500 requests/day**.

---

## 🛡️ Privacy

- ✅ **No data collection** — zero analytics, zero tracking
- ✅ **No external servers** — we don't have any
- ✅ **API keys stored locally** in Chrome's encrypted storage
- ✅ **Images go directly** from your browser → Google Gemini API
- ✅ **Open source** — read every line of code yourself

---

## 🐛 Troubleshooting

| Issue | Fix |
|---|---|
| "API key not set" | Open popup → paste key → Save |
| Rate limit errors | Add more API keys (up to 3) and use Gemini 2.5 Flash |
| Stuck on retrying | Click the button to cancel, then retry |
| No button on images | Image might be too small (<200×300px) |
| CORS errors | Extension will try URL fetch as fallback |
| Wrong translations | Try Gemini 2.5 Flash (recommended) |
| Extension not working | Go to `chrome://extensions/` → click refresh ↻ |

---

## 🤝 Contributing

Contributions welcome! Feel free to:

- 🐛 Report bugs via [Issues](https://github.com/AkashKumar3/manga-lens/issues)
- 💡 Suggest features
- 🔧 Submit pull requests

---

## 📝 License

MIT License — do whatever you want with it.

---

## ⭐ Star This Repo

If Manga Lens helps you read raw manga, give it a ⭐ — it helps others find it!

---

<p align="center">
  Made with ❤️ for manga readers who can't wait for translations
</p>
```
