# FlowLenZ — Quick install

Open Chrome → `chrome://extensions` → turn on **Developer mode**.
Click **Load unpacked** → select the **`flowlenz`** folder (contains `manifest.json`).
Open Genesys **Architect** on `*.mypurecloud.com` and open a flow.
Click the **FlowLenZ** toolbar icon to open the panel; sign in to Genesys if OAuth prompts (**architect:readonly**).
Create a Genesys Cloud OAuth client and the extension redirect URL (https://<extension-id>.chromiumapp.org/), then update the CLIENT_ID value in background.js.
After code changes: **Reload** the extension on `chrome://extensions`, then refresh Architect.

**Files (one line each):**
- **`manifest.json`** — Declares the extension (MV3): icons, permissions, and which scripts run on Architect pages.
- **`background.js`** — Service worker: PKCE login to Genesys, stores tokens, fetches flow/versions/config JSON via API.
- **`content.js`** — Injects the side panel, compares published vs saved flow, and renders change impact and lint/risk.
- **`content.css`** — Layout and styling for the FlowLenZ panel on Architect.
- **`save-hook.js`** — Runs in the Architect page: detects when you **Save** a flow (POST to versions API).
- **`save-bridge.js`** — Passes save events from the page into the extension so the panel can refresh after Save.
- **`Release-Notes/`** — Step 9 release notes page (opened from the panel's **Open Release Notes**; Download PDF). No build step.
- **`Visual-Diff/`** — Step 8 visual change report (`report.html`, bundles); open from the panel link. Rebuild: `npm run build:report` from project root.