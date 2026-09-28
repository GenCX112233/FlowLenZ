# FlowLenZ — Handover Document

**File:** `FlowLenZ_Handover_2026-09-28_Steps1-9.md` (the **only** handover — replace this file and delete the old one when a new dated handover is created)  
**Project:** PS Hackathon 2026  
**Product name:** FlowLenZ (capital Z)  
**Date:** 2026-09-28  
**Steps completed:** **1–9** (all confirmed by user in Architect)  
**Next step:** **10 — Customer-journey explanation (AI)**

Progress table: [FlowLenZ_Completion_Tracker.md](./FlowLenZ_Completion_Tracker.md) · Install: [FlowLenZ_User_Guide.md](./FlowLenZ_User_Guide.md) · Use cases: [FlowLenZ_Use_Cases.md](./FlowLenZ_Use_Cases.md)

---

## 1. Product summary

**Positioning:** AI Intelligence for Genesys Cloud Architect  
**Core message:** Don't just tell me what changed — tell me what the change **means**.  
**Tagline:** Understand the flow. See the change. Know the impact.

Genesys Cloud Architect remains the **source of truth**. FlowLenZ keeps no separate version repository.

| UC | Who | What |
|----|-----|------|
| **1** | Developer | Ask questions and understand the open flow (Step 11 — AI, not built). |
| **2** | Developer | After **Save**: compare, impact, lint & risk, visual report, release-notes preview (Steps 1–9 done; Steps 10–12 AI). |
| **3** | Supervisor | Review any **published** version via **Release Notes** (Step 9 — done). |

**Design principle:** Code finds the facts. AI explains what those facts mean.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Real-time** | **After Flow Save**, before Publish — not every keystroke |
| **Delta** | **Published** vs **saved** (`saved_version_xxx`) configuration |
| **FlowLenZ Update** | Re-analysis on **open of FlowLenZ** or after **Save** |
| **Unchanged** (visual report) | Blocks not in the delta, shown for wiring context |
| **Release Notes** | A version compared with the version before it, rebuilt on demand |

Developer lifecycle: `Edit → Save → FlowLenZ Update → Fix & re-save → Publish`

---

## 3. Architecture (frozen)

| Area | Decision |
|------|----------|
| UI | Chrome extension **right-side panel** on real Architect (no iframe, no Architect changes) |
| Data | **Official Genesys Cloud APIs** only; no DOM scraping / network body capture |
| Unsaved edits | Not analyzed |
| Trigger | After **Save** (save-hook) and on panel open; no polling |
| Flow JSON | From each version's `configurationUri` |
| Comparison | Deterministic JavaScript (`compareActions`) |
| Report pages | Panel button → **new tab** extension page + **Download PDF** (Visual Change Report, Release Notes) |
| Release notes storage | **None** — rebuilt on demand from the versions API |
| Region | `mypurecloud.com` / `api.mypurecloud.com` only |

**API flow:** `GET /api/v2/flows/{flowId}` → `GET /api/v2/flows/{flowId}/versions` → `GET {configurationUri}` (published versions + saved).

**Save detection:** `save-hook.js` (MAIN world) detects `POST /api/v2/flows/{flowId}/versions` → `save-bridge.js` → `background.js` → `content.js` (`ARCHITECT_SAVE_COMPLETED`). Config still loaded via APIs.

**OAuth:** Authorization Code + **PKCE**, scope `architect:readonly`, client ID `31e1986a-b2ff-4b79-a657-d182e223e976`, tokens in `chrome.storage.local`.

**Report pages:** `background.js` maps `FLOWLENZ_OPEN_VISUAL_REPORT` → `Visual-Diff/report.html` (`flowlenzVisualReport`) and `FLOWLENZ_OPEN_RELEASE_NOTES` → `Release-Notes/release-notes.html` (`flowlenzReleaseNotes`); payload stored in `chrome.storage.session`, tab opened with `chrome.tabs.create`.

**Test flow (dev):** `34c70fe1-96a5-4528-8d67-5c659aa1b2ee`

---

## 4. Repository layout

```text
flowlenz/
├── manifest.json          (MV3; permissions: storage, identity, tabs)
├── background.js          (PKCE, API calls, report-page opener)
├── content.js             (panel, compare, impact, lint, visual graph model, release notes)
├── content.css
├── save-hook.js / save-bridge.js
├── genesys-logo-flowlenz*.png
├── package.json           (npm run build:report)
├── Visual-Diff/           (report.html, report.css, report-src.jsx, report-bundle.js, package.json)
├── Release-Notes/         (release-notes.html, release-notes.css, release-notes.js — no build)
├── FlowLenZ_Completion_Tracker.md
├── FlowLenZ_Handover_2026-09-28_Steps1-9.md   ← this file (only handover)
├── FlowLenZ_User_Guide.md
└── FlowLenZ_Use_Cases.md
```

Not a git repo yet (no online backup).

---

## 5. Panel sections (top to bottom)

| Section | Content |
|---------|---------|
| Welcome | "How can I help?" box (padding at 70%; heading 20px, tagline 15px) |
| **Current Flow** | Flow name |
| **Change Report** | Published / saved version labels, config status |
| **Visual Change Report** | Status line + **Open Visual Change Report** button |
| **Change Impact Analysis** | **Affected Blocks** (Added / Removed / Modified) · **Affected Branches** (counts only) · **Affected dependencies** (Queues, Data Actions, Prompts / Audio, Reusable Tasks) · **Potential regression** |
| **Lint & Risk** | Delta-only logical findings (High / Medium) |
| **Release Notes** | Version picker + status line + **Open Release Notes** button |
| Chat | AI placeholder |

**Formatting rules:** no gaps between Added / Removed / Modified or between modified blocks; headings in details use the same font/colour; lines starting with `+`, `-`, `~` have **no** bullet (symbol acts as marker); other lines use `•`; all bullet lines use a hanging indent (`renderBulletLines`).

---

## 6. Steps 1–7 (done — do not break)

1. **Extension on Architect** — injects `#flowlenz-root`; toggled via extension icon.
2. **OAuth + API** — `GET_FLOW_DETAILS`, `GET_FLOW_VERSIONS`, `GET_FLOW_CONFIGURATION`; `fetchCurrentContext`, `loadConfiguration`.
3. **Flow ID** — `detectFlowId()` from Architect URL.
4. **Change Report** — `compareActions` / `extractActions`; A/R/M with trackingId; meaningful compare ignores `nextAction` / routing noise; reusable tasks from `flowSequenceItemList` (initial task excluded); concise change lines.
5. **FlowLenZ Update** — `refreshOnOpen`; `refreshAfterSave` retries `[0, 250, 500, 750, 1000, 1500]` ms.
6. **Change Impact Analysis** — Affected Blocks; **Affected Branches** (see §7.4); Affected dependencies = **resources only** (not a repeat of Modified); Potential regression = deduped test recommendations. Body built by `buildChangeImpactHtml` (shared with Release Notes).
7. **Lint & Risk** — `RISK_RULES` + `getDeltaRisks`, **delta-only**. Rules: Decision empty Yes/No, constant Decision, Switch empty path, Loop empty body, Data Action failure / timeout recovery. Does **not** duplicate Architect Validate (missing queue / prompt). Rendering via `buildRiskReport`.

**Delta rules:** removed blocks appear in scope but produce no lint; added can produce lint; modified only reports **newly introduced** issues.

---

## 7. Step 8 — Visual Change Report (done, confirmed 2026-09-28)

### 7.1 Flow

Panel button → `buildVisualReportPayload()` in `content.js` → `FLOWLENZ_OPEN_VISUAL_REPORT` → session storage → `Visual-Diff/report.html`. (Content scripts can't use session storage; `window.open` to extension URL was blocked.) Regenerated on each click.

### 7.2 Graph model (`content.js`)

Heuristic merge guessing was **removed**. Structured model:

- `buildVisualFlowModel(config)` → one graph per sequence in `flowSequenceItemList` (`buildVisualSequenceGraph`).
- `getVisualExits(action)` reads exits from `paths`, `cases`, `outputs` (map or array) and Loop `path`. Targets via id refs (`nextAction`, `nextActionId`, `startAction`, `actionId`) **or** nested `actions` arrays.
- **Join rule (Architect semantics):** a chain that ends without an explicit next continues at the enclosing block's continuation; an empty output goes straight to it.
- Terminal: Disconnect / End* / ExitLoop / JumpTo; Transfer **Success** = End of Flow.
- Data Action `outputs` variable mappings (e.g. `statusCode`, `result`) are **ignored** — only known exits (Success, Failure, Timeout, Yes, No, Default) or entries with targets count.
- Data Action with no explicit Success exit gets an implied Success to its continuation.
- Removed blocks and their wiring come from the published graph (dashed red edges).
- Payload `version: 2` → `sequences[]`. Reusable tasks are **sections**, not nodes.

### 7.3 Report page (`Visual-Diff/report-src.jsx`)

- dagre layout with routed edges; **Direction** toggle: Top → Bottom (default) / Left → Right.
- **View** toggle: Changes + neighbors / Full task (tasks ≤ 30 blocks always full). Hidden stretches drawn as dashed "…" edges.
- Legend; **Connections (Saved Flow Wiring)** table (From / Path / To), grouped by task; **Download PDF**. Rebuild after edits: `npm run build:report`.

### 7.4 Affected Branches

`analyzeBranchImpact(before, after)` compares branching blocks (≥ 2 exits) between two graphs: **new**, **changed** (exit now leads elsewhere), **removed**. Counts only (`formatBranchImpactLines`). A block can count as changed when something below it was added/removed.

---

## 8. Step 9 — Release Notes & supervisor view (done, confirmed 2026-09-28)

- **Panel:** last section **Release Notes** (below Lint & Risk). Dropdown lists `Version 1.0`, `Version 2.0`, … oldest first, plus `Version N (Saved)` (next version number) when a saved draft exists. Latest entry selected by default. Status line shows publish date (and publisher name if the API returns it) or "Not yet published".
- **Comparison:** each entry is compared with the version before it (saved draft vs latest published). Oldest version shows "(first publish)" with block count.
- **Page:** **Open Release Notes** → `Release-Notes/release-notes.html` — header (flow, "Version X · compared with Version Y", date, generated time), **Summary** (added · removed · modified), **Change Impact Analysis** (Affected Blocks, Affected Branches, Affected dependencies). **No** Potential regression and **no** Lint & Risk. **Download PDF** via print.
- **Storage:** none — rebuilt on demand; configurations cached per `configurationUri` in memory. Works with read-only scope for **anyone who opens the flow with the extension**.
- **Code:** `buildReleaseEntries`, `buildReleaseNotesBody`, `openReleaseNotes`, `renderReleaseNotesPicker` (`content.js`); `analyseVersions` now returns `publishedVersions`.

**Supervisor view — open question:** no role check today; a supervisor sees the whole panel. If Genesys doesn't return a saved draft for them, only Release Notes has content; if it does, they also see the draft analysis (not yet verified with a supervisor login). Options if needed: permission-based auto detection (extra OAuth scope) or a manual "Supervisor view" toggle.

---

## 9. Roadmap

| Step | Item |
|-----:|------|
| **10** | Customer-journey explanation (AI) — **next** |
| 11 | Flow Q&A (AI) |
| 12 | AI assistance while building |

---

## 10. Known limitations

- Set Whisper Audio not investigated; chat is UI only; single region.
- Visual graph verified on real flows and synthetic reference / nested schemas; unusual block types may need tweaks in `getVisualExits` / `isVisualTerminalAction`.
- Release Notes publisher name depends on what the versions API returns.

---

## 11. Testing checklist

1. Load / reload extension; OAuth; toggle panel.
2. No saved version → published-only state (Release Notes still available).
3. Save → Change Report + Affected Blocks.
4. Change Transfer queue → Modified + Affected dependencies + Potential regression.
5. Add branching blocks → Affected Branches counts; Lint & Risk delta-only.
6. Open Visual Change Report → wiring matches Architect; toggles; Connections table; PDF.
7. Release Notes → pick each version incl. `(Saved)`; page content matches; PDF.

---

## 12. Working style

1. One step at a time; mark **Done** only after user confirms testing.
2. Short, crisp answers.
3. Don't break Step 7 (Lint & Risk) without approval.
4. Cursor Agent + repo as source of truth.
5. **One handover file only** — delete the previous one when creating a new one.

---

## 13. Key symbols (`content.js`)

| Area | Functions |
|------|-----------|
| Context / update | `fetchCurrentContext`, `analyseVersions`, `applyContext`, `refreshOnOpen`, `refreshAfterSave` |
| Compare | `extractActions`, `compareActions`, `getConciseChanges`, `getActionKey` |
| Impact | `renderChangeImpactAnalysis`, `buildChangeImpactHtml`, `renderChangeScope`, `analyzeBranchImpact`, `formatBranchImpactLines`, `analyzeDependencyImpact`, `analyzePotentialRegression`, `renderBulletLines` |
| Lint & Risk | `RISK_RULES`, `getDeltaRisks`, `renderRiskValidation`, `buildRiskReport` |
| Visual | `buildVisualFlowModel`, `buildVisualSequenceGraph`, `getVisualExits`, `buildVisualReportPayload`, `openVisualChangeReport`, `updateVisualReportControls` |
| Release Notes | `buildReleaseEntries`, `buildReleaseNotesBody`, `openReleaseNotes`, `renderReleaseNotesPicker`, `loadReleaseConfiguration` |
| Background | `reportPages` map (`FLOWLENZ_OPEN_VISUAL_REPORT`, `FLOWLENZ_OPEN_RELEASE_NOTES`) in `background.js` |

---

## 14. Decisions log

| Date | Decision |
|------|----------|
| 2026-09-27 | Single Step 1–12 tracker; Change Impact is one section; dependencies = resources only; no lint duplicating Architect Validate; AI after Steps 8–9 |
| 2026-09-28 | Visual report in new tab with PDF; assets under `Visual-Diff/`; SVG + dagre |
| 2026-09-28 | Replaced heuristic wiring with structured graph model + Architect join rule; per-task sections; direction and view toggles |
| 2026-09-28 | Branch Impact → Affected Branches on graph model, counts only |
| 2026-09-28 | Panel renames: Change Report, Affected Blocks, Affected Branches, Lint & Risk; bullet / spacing rules (§5) |
| 2026-09-28 | Step 8 confirmed Done |
| 2026-09-28 | Release notes rebuilt on demand (no storage); separate page with PDF; dropdown `Version X` / `Version N (Saved)`; RN excludes Potential regression and Lint & Risk; section last in panel |
| 2026-09-28 | Step 9 confirmed Done |

---

**Next implementation step:** **Step 10 — Customer-journey explanation (AI).**
