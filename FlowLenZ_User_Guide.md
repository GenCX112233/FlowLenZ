# FlowLenZ — User Guide

## Repo structure

```
flowlenz/
├── browser-plugin/   ← Chrome extension (load this folder in Chrome)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js / content.css
│   ├── panel.html
│   ├── save-hook.js / save-bridge.js
│   ├── *.png icons
│   ├── Visual-Diff/
│   └── Release-Notes/
├── ai-service/       ← Node.js AI backend (run separately)
│   ├── server.js
│   ├── package.json
│   └── .env
└── package.json      ← root build scripts only
```

---

## 1. AI service setup

The AI service is a standalone Express server that the browser plugin calls for impact analysis and flow Q&A. It must be running before using those features.

```bash
cd ai-service
npm install
npm start          # production
npm run dev        # auto-restart on file changes (node --watch)
```

Runs on `http://localhost:3000` by default.

**`.env` file** (create in `ai-service/` if missing):

```
OPENAI_API_KEY=<your OpenAI API key>
API_SECRET=<shared secret — must match secret in browser-plugin/ai-config.js>
PORT=3000
```

**`browser-plugin/ai-config.js`** (git-ignored): copy `ai-config.example.js` to `ai-config.js` and set `secret` to the same value as `API_SECRET`. Never commit either file.

**Fallback:** if the AI service is off, not configured, slow (15 s impact / 30 s Q&A timeout) or returns an error, FlowLenZ still works — Customer Journey Impact (panel and Release Notes) shows a rule-based summary and chat answers from flow data (changes, impact, queues, prompts, data actions, flows, risks, block count). These are marked "(Rule-based summary — AI service unavailable.)".

If an old `OPENAI_API_KEY` exists in your Windows environment variables, `.env` still wins (`override: true`).

Endpoints:
- `GET /` — status check (open `http://localhost:3000` in a browser)
- `POST /flows/impact` — generates a short customer journey impact narrative from change facts
- `POST /flows/qa` — answers flow Q&A and build guidance questions (multi-turn)

---

## 2. Browser plugin install

Open Chrome → `chrome://extensions` → turn on **Developer mode**.
Click **Load unpacked** → select the **`flowlenz/browser-plugin`** folder (contains `manifest.json`).
Open Genesys **Architect** on `*.mypurecloud.com` and open a flow.
Click the **FlowLenZ** toolbar icon to open the panel (it also opens automatically when you **Save** a flow); sign in to Genesys if OAuth prompts (**architect:readonly users:readonly** — both scopes must be enabled on the OAuth client).
Create a Genesys Cloud OAuth client and add the extension redirect URL (`https://<extension-id>.chromiumapp.org/`), then update the `CLIENT_ID` value in `browser-plugin/background.js`.
After code changes: **Reload** the extension on `chrome://extensions` (point at `browser-plugin/`), then refresh Architect.
The extension ID depends on the folder path — if you load from a new folder, add the new `https://<new-id>.chromiumapp.org/` redirect to the **same** OAuth client (no new client needed) and turn the old extension off.

**Using the chat:** type in "Ask about your Flow" (always visible). The chat opens full screen below the header; ⌄ minimises it; **Clear** resets the conversation. Works for saved and published-only flows.

---

## 3. Browser plugin files

All files below live inside `browser-plugin/`.

- **`manifest.json`** — Declares the extension (MV3): icons, permissions, and which scripts run on Architect pages.
- **`background.js`** — Service worker: PKCE login to Genesys, stores tokens, fetches flow/versions/config JSON via API, proxies requests to the AI service.
- **`content.js`** — Injects the side panel, compares published vs saved flow, and renders change impact, lint/risk, and flow Q&A.
- **`content.css`** — Layout and styling for the FlowLenZ panel on Architect.
- **`FlowLenZ-logo-light.png`** — Logo shown in the panel header (`FlowLenZ-logo-dark.png` kept for slides).
- **`save-hook.js`** — Runs in the Architect page: detects when you **Save** a flow (POST to versions API).
- **`save-bridge.js`** — Passes save events from the page into the extension so the panel can refresh after Save.
- **`Release-Notes/`** — Release notes page opened from the panel's **Open Release Notes** button. Download PDF supported. No build step.
- **`Visual-Diff/`** — Visual change report (`report.html` + bundled React/dagre app). Opened from the panel. Rebuild after editing `report-src.jsx`: run `npm run build:report` from the repo root.

---

## 4. Building the Visual Diff bundle

The `Visual-Diff/report-src.jsx` React app must be bundled before it works in the extension. The pre-built `report-bundle.js` is committed, so this is only needed after editing the source.

```bash
# from repo root (flowlenz/)
npm run build:report
```

This runs esbuild inside `browser-plugin/Visual-Diff/` and overwrites `report-bundle.js`.
