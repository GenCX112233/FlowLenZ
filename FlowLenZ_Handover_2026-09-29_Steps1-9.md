# FlowLenZ — Handover Document

**File:** `FlowLenZ_Handover_2026-09-29_Steps1-9.md` (the **only** handover — replace this file and delete the old one when a new dated handover is created)  
**Project:** PS Hackathon 2026  
**Product name:** FlowLenZ (capital Z)  
**Date:** 2026-09-29  
**Steps completed:** **1–9** (all confirmed by user in Architect) + demo polish (2026-09-29)  
**Next step:** **10 — Customer-journey explanation (AI)** — AI part owned by **Arun**

Progress table: [FlowLenZ_Completion_Tracker.md](./FlowLenZ_Completion_Tracker.md) · Install: [FlowLenZ_User_Guide.md](./FlowLenZ_User_Guide.md) · Use cases: [FlowLenZ_Use_Cases.md](./FlowLenZ_Use_Cases.md)

---

## 1. Product summary

**Positioning:** AI Assistant for Genesys Cloud Architect  
**Core message:** Don't just tell me what changed — tell me what the change **means**.  
**Tagline:** Understand the flow. See the change. Know the impact.

Genesys Cloud Architect remains the **source of truth**. FlowLenZ keeps no separate version repository.

| UC | Who | What |
|----|-----|------|
| **1** | Developer | Ask questions and understand the open flow (Step 11 — AI, not built). |
| **2** | Developer | After **Save**: compare, impact, lint & risk, Genesys validation, visual report, release-notes preview (Steps 1–9 done; Steps 10–12 AI). |
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
| Data | **Official Genesys Cloud APIs**; **one approved exception (2026-09-29):** Architect's **Validate** list is read from the page for Flow Validation Errors (read-only, no clicks) |
| Unsaved edits | Not analyzed |
| Trigger | After **Save** (save-hook; also **opens the panel scrolled to the top**) and on panel open; no polling |
| Flow JSON | From each version's `configurationUri` |
| Comparison | Deterministic JavaScript (`compareActions`) |
| Report pages | Panel button → **new tab** extension page + **Download PDF** (Visual Change Report, Release Notes) |
| Release notes storage | **None** — rebuilt on demand from the versions API |
| Region | `mypurecloud.com` / `api.mypurecloud.com` only |

**API flow:** `GET /api/v2/flows/{flowId}` → `GET /api/v2/flows/{flowId}/versions` → `GET {configurationUri}` (published versions + saved) · `GET /api/v2/users/{id}` (Release Notes publisher name).

**Save detection:** `save-hook.js` (MAIN world) detects `POST /api/v2/flows/{flowId}/versions` → `save-bridge.js` → `background.js` → `content.js` (`ARCHITECT_SAVE_COMPLETED`). Config still loaded via APIs.

**OAuth:** Authorization Code + **PKCE**, scopes **`architect:readonly users:readonly`** (both enabled on the client), client ID `31e1986a-b2ff-4b79-a657-d182e223e976`, tokens in `chrome.storage.local`. The scope is stored with the token (`genesysScope`); a scope change forces a fresh sign-in.

**Report pages:** `background.js` maps `FLOWLENZ_OPEN_VISUAL_REPORT` → `Visual-Diff/report.html` (`flowlenzVisualReport`) and `FLOWLENZ_OPEN_RELEASE_NOTES` → `Release-Notes/release-notes.html` (`flowlenzReleaseNotes`); payload stored in `chrome.storage.session`, tab opened with `chrome.tabs.create`. `GET_USER_NAME` resolves user ids.

**Test flow (dev):** `34c70fe1-96a5-4528-8d67-5c659aa1b2ee`

---

## 4. Repository layout

```text
flowlenz/
├── manifest.json          (MV3; permissions: storage, identity, tabs; web-accessible logos)
├── background.js          (PKCE, API calls, user-name lookup, report-page opener)
├── content.js             (panel, compare, impact, dependencies, lint, validation, visual graph model, release notes)
├── content.css
├── save-hook.js / save-bridge.js
├── genesys-logo-flowlenz*.png
├── FlowLenZ-logo-light.png (panel header logo: wordmark + tagline + lens icon)
├── FlowLenZ-logo-dark.png  (dark banner, kept for slides; not used by the panel)
├── package.json           (npm run build:report)
├── Visual-Diff/           (report.html, report.css, report-src.jsx, report-bundle.js, package.json)
├── Release-Notes/         (release-notes.html, release-notes.css, release-notes.js — no build)
├── FlowLenZ_Completion_Tracker.md
├── FlowLenZ_Handover_2026-09-29_Steps1-9.md   ← this file (only handover)
├── FlowLenZ_User_Guide.md
└── FlowLenZ_Use_Cases.md
```

**Source control:** private GitHub repo [GenCX112233/FlowLenZ](https://github.com/GenCX112233/FlowLenZ), branch `main`. Commit and push after each confirmed change.

---

## 5. Panel sections (top to bottom)

| Section | Content |
|---------|---------|
| Header | Genesys logo + **FlowLenZ light logo** (80 px tall in an 88 px header) |
| Welcome | "How can I help?" box (padding at 70%; heading 20px, tagline 15px) |
| **Current Flow** | Flow name |
| **Change Report** | Published / saved version labels, config status |
| **Visual Change Report** | Status line + **Open Visual Change Report** button |
| **Change Impact Analysis** | **Affected Blocks** · **Affected Branches** · **Affected dependencies** (Queues, Data Actions, Prompts / Audio, **Flows**, Reusable Tasks) · **Potential regression** |
| **Lint & Risk** | Delta-only logical findings + **Flow Validation Errors** (Genesys Validate messages for changed blocks) |
| **Release Notes** | Version picker (newest first) + status (published date, **Published by**) + **Open Release Notes** button |
| Chat | AI placeholder |

**Formatting rules:** no gaps between Added / Removed / Modified or between modified blocks; headings in details use the same font/colour; lines starting with `+`, `-`, `~` have **no** bullet (symbol acts as marker); other lines use `•`; all bullet lines use a hanging indent (`renderBulletLines`).

**Colour coding** (`CHANGE_COLORS`, `SEVERITY_COLORS`, `colorText`): Added heading + `+` green, Modified + `~` orange, Removed + `-` red; Lint severity tag `[High]` red, `[Medium]` orange, `[Low]` green. Block names stay in normal text.

**Empty states:** Affected Blocks "No blocks are impacted"; Affected Branches "No branch impact detected"; Flow Validation Errors "No validation errors for changed blocks" / "Click Validate in Architect to include Genesys validation results".

**Lint & Risk message format:** `"Path name" → Outcome` with the quoted path in bold (`formatRiskMessage`), e.g. **"Failure path"** → Has no recovery handling; **"No branch"** → Has no action.

---

## 6. Steps 1–7 (done — do not break)

1. **Extension on Architect** — injects `#flowlenz-root`; toggled via extension icon; **also opens on Save** (scrolled to top).
2. **OAuth + API** — `GET_FLOW_DETAILS`, `GET_FLOW_VERSIONS`, `GET_FLOW_CONFIGURATION`, `GET_USER_NAME`; `fetchCurrentContext`, `loadConfiguration`.
3. **Flow ID** — `detectFlowId()` from Architect URL.
4. **Change Report** — `compareActions` / `extractActions`; A/R/M with trackingId; meaningful compare ignores `nextAction` / routing noise; reusable tasks from `flowSequenceItemList` (initial task excluded); concise change lines.
5. **FlowLenZ Update** — `refreshOnOpen`; `refreshAfterSave` retries `[0, 250, 500, 750, 1000, 1500]` ms.
6. **Change Impact Analysis** — Affected Blocks; **Affected Branches** (§7.4); **Affected dependencies** (§6.1); Potential regression = deduped test recommendations. Body built by `buildChangeImpactHtml` (shared with Release Notes).
7. **Lint & Risk** — `RISK_RULES` + `getDeltaRisks`, **delta-only**. Rules: Decision empty Yes/No, constant Decision, Switch empty path, Loop empty body, Data Action failure / timeout recovery. Rendering via `buildRiskReport`. **Flow Validation Errors** (§6.2) shows Genesys' own Validate messages.

**Delta rules:** removed blocks appear in scope but produce no lint; added can produce lint; modified only reports **newly introduced** issues.

### 6.1 Affected dependencies (updated 2026-09-29)

- **Line format:** `<symbol> <block number + name> — <resource>`, e.g. `~ 17 Call Data Action — Data Action: RegExVerify → Get User Presence`, `+ 18 Transfer to ACD — Queue: FlowLenz_Authenticated`.
- **Name extraction** (`collectActionReferences`, `findReferenceTexts`): scans each changed block's named references (skipping branches and output variables) and picks by field role — robust to unknown field names.
  - **Data Actions:** data action **name only** (integration name only as fallback); modified blocks show `old → new`.
  - **Prompts / Audio:** `Prompt.X` names + `TTS "…"` preview (`cleanPromptText`); playback flags (`true`/`false`/numbers) ignored; modified blocks list only added/removed prompts.
  - **Flows (new group):** bot flows, common modules, secure flows, transfer-to-flow, in-queue flows (`getFlowReferences`).
- **Flow input impact** (`addFlowInputDependencies`, `getBlockVariableUse`): variables **set** by changed blocks (`Task.` / `Flow.` / `State.` in assignment/output positions; modified blocks count before + after) are matched against **unchanged** flow-calling blocks that read them → `~ 26 Call Bot Flow — Bot flow: X (input Task.BotInputValue changed in 25 Update Data)`.
- Also used by Potential regression (names) and Release Notes (per-version saved config).
- Diagnostic: console `FlowLenZ dependency refs: <block>` lists what was found.

### 6.2 Flow Validation Errors (added 2026-09-29)

- Heading under Lint & Risk; shows **block name + message** for **changed blocks only** (matched by block name); quoted names in messages rendered bold; no severity tag, no timestamp.
- **Source:** Architect's Validate list, located by its footer text "Press validate again to refresh list" (not Architect class names). Read via DOM **text nodes** (`getTextChunks`) so it works while Architect keeps the list hidden (it only shows on CSS hover). Prefers a rendered copy, else the most recent hidden copy; never climbs to the toolbar (the "Validate 4" button is excluded).
- **Updates:** whenever the list changes (MutationObserver, debounced) and ~2.5 s after Save. FlowLenZ **never clicks or hovers** Architect's Validate button. Hidden/half-rendered lists never wipe existing results.
- **Limits:** Validate rows have no block number — two changed blocks with the same name both get the message; identical rows are merged. Results refresh only when Architect's list updates (hover/click Validate in Architect to be sure).
- Diagnostic: console `FlowLenZ validation: rows read`.

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
- **Print/PDF rules** (`report.css` `@media print`): sections flow across pages; diagram scaled to page width and capped at `62vh` (fallback 110 mm) so it starts on page 1 under the header; scroll boxes don't clip; Connections table starts on a new page. Release Notes print: sections flow, headings kept with content.

### 7.4 Affected Branches

`analyzeBranchImpact(before, after)` compares branching blocks (≥ 2 exits) between two graphs: **new**, **rerouted** (exit now leads elsewhere), **removed**. `formatBranchImpactLines` shows one line per count with a short, non-redundant tail:
- `5 new branches — from 2 added blocks` (plus e.g. `Timeout on 12 Transfer…` for new exits on existing blocks)
- `1 existing branch rerouted — Success on 15 Collect Input`
- `2 branches removed — with 1 removed block` (plus exits removed from blocks that still exist)

Max 3 blocks named, then "+N more". A block can count as rerouted when something below it was added/removed.

---

## 8. Step 9 — Release Notes & supervisor view (done, confirmed 2026-09-28)

- **Panel:** last section **Release Notes**. Dropdown lists **newest first**: `Version N (Saved)` (when a saved draft exists), then `Version N-1` … `Version 1.0`; newest selected by default. Status: publish date and **Published by: <name>** (published versions), or "Not yet published".
- **Comparison:** each entry is compared with the version before it (saved draft vs latest published). Oldest version shows "(first publish)" with block count.
- **Page:** **Open Release Notes** → `Release-Notes/release-notes.html` — header (flow, "Version X · compared with Version Y", date, **Published by**, generated time), **Summary** (added · removed · modified), **Change Impact Analysis** (Affected Blocks, Affected Branches, Affected dependencies). **No** Potential regression and **no** Lint & Risk. **Download PDF** via print.
- **Publisher name:** `version.createdBy.name` if present, else `GET /api/v2/users/{id}` via `GET_USER_NAME` (needs `users:readonly`), cached per user; "Unknown" if unavailable. Diagnostic: console `FlowLenZ release`.
- **Storage:** none — rebuilt on demand; configurations cached per `configurationUri` in memory. Works for **anyone who opens the flow with the extension**.
- **Code:** `buildReleaseEntries`, `buildReleaseNotesBody`, `openReleaseNotes`, `renderReleaseNotesPicker`, `updateReleaseStatus`, `resolveReleasePublisher` (`content.js`); `analyseVersions` returns `publishedVersions`.

**Supervisor view — open question:** no role check today; a supervisor sees the whole panel. If Genesys doesn't return a saved draft for them, only Release Notes has content; if it does, they also see the draft analysis (not yet verified with a supervisor login).

---

## 9. Roadmap

| Step | Item |
|-----:|------|
| **10** | Customer-journey explanation (AI) — **next**; AI part by **Arun** (UC2 + UC3: "Customer Impact" in panel and Release Notes) |
| 11 | Flow Q&A (AI) |
| 12 | AI assistance while building |

---

## 10. Known limitations

- Set Whisper Audio not investigated; chat is UI only; single region.
- Visual graph verified on real flows and synthetic reference / nested schemas; unusual block types may need tweaks in `getVisualExits` / `isVisualTerminalAction`.
- Dependency names come from field-role heuristics; if a name is missing/wrong, check console `FlowLenZ dependency refs` and tune the include patterns.
- Flow Validation Errors depends on Architect's page (approved exception); it may need adjusting if Genesys changes the Validate list text.
- **Open bug (seen once, not reproduced since):** after publishing and clicking **Edit** with no changes, a Call Data Action showed as Modified. Diagnostic: `logModifiedDifferences` writes `FlowLenZ diff: <block>` to the console; if it recurs, add the volatile field to `normalizeForComparison`'s ignore list.

---

## 11. Testing checklist

1. Load / reload extension; OAuth (sign-in again after scope change); toggle panel.
2. No saved version → published-only state (Release Notes still available).
3. Save → panel opens scrolled to top; Change Report + Affected Blocks.
4. Change Transfer queue → Modified + Affected dependencies (with block name) + Potential regression.
5. Change Update Data used as a Call Bot Flow input → Flows line with "input … changed in …".
6. Add branching blocks → Affected Branches counts; Lint & Risk delta-only.
7. Hover / click **Validate** in Architect → Flow Validation Errors for changed blocks.
8. Open Visual Change Report → wiring matches Architect; toggles; Connections table; PDF.
9. Release Notes → newest first incl. `(Saved)`; Published by shown; page content matches; PDF.

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
| Impact | `renderChangeImpactAnalysis`, `buildChangeImpactHtml`, `renderChangeScope`, `analyzeBranchImpact`, `formatBranchImpactLines`, `analyzePotentialRegression` |
| Dependencies | `analyzeDependencyImpact`, `renderDependencyImpactContent`, `collectActionReferences`, `findReferenceTexts`, `getDataActionReferenceLabel`, `getPlayAudioReferences`, `cleanPromptText`, `getFlowReferences`, `getBlockVariableUse`, `addFlowInputDependencies` |
| Lint & Risk | `RISK_RULES`, `getDeltaRisks`, `renderRiskValidation`, `buildRiskReport`, `formatRiskMessage` |
| Flow validation | `findValidationFooters`, `findValidationPanel`, `getTextChunks`, `parseValidationRows`, `captureValidationResults`, `renderValidationSection`, `findArchitectValidateButton` |
| Formatting / diagnostics | `renderBulletLines`, `colorText`, `CHANGE_COLORS`, `SEVERITY_COLORS`, `logModifiedDifferences` |
| Visual | `buildVisualFlowModel`, `buildVisualSequenceGraph`, `getVisualExits`, `buildVisualReportPayload`, `openVisualChangeReport`, `updateVisualReportControls` |
| Release Notes | `buildReleaseEntries`, `buildReleaseNotesBody`, `openReleaseNotes`, `renderReleaseNotesPicker`, `updateReleaseStatus`, `resolveReleasePublisher`, `loadReleaseConfiguration` |
| Background | `reportPages` map, `GET_USER_NAME`, scope check in `getAccessToken` (`background.js`) |

---

## 14. Decisions log

| Date | Decision |
|------|----------|
| 2026-09-27 | Single Step 1–12 tracker; Change Impact is one section; dependencies = resources only; no lint duplicating Architect Validate; AI after Steps 8–9 |
| 2026-09-28 | Visual report in new tab with PDF; assets under `Visual-Diff/`; SVG + dagre |
| 2026-09-28 | Replaced heuristic wiring with structured graph model + Architect join rule; per-task sections; direction and view toggles |
| 2026-09-28 | Branch Impact → Affected Branches on graph model |
| 2026-09-28 | Panel renames: Change Report, Affected Blocks, Affected Branches, Lint & Risk; bullet / spacing rules (§5) |
| 2026-09-28 | Steps 8 and 9 confirmed Done; release notes rebuilt on demand (no storage) |
| 2026-09-28 | Code in private GitHub repo `GenCX112233/FlowLenZ`; Step 10 AI wording owned by **Arun** |
| 2026-09-28 | Polish: colour coding, empty states, Affected Branches tails, `"Path" → Outcome` lint messages, PDF print fixes |
| 2026-09-29 | Affected dependencies: block name on every line, data action name only, prompt names without flags, new **Flows** group incl. flow-input variable impact |
| 2026-09-29 | **Exception to APIs-only:** read Architect's Validate list for **Flow Validation Errors** (changed blocks only); FlowLenZ must **not** click Validate |
| 2026-09-29 | Release Notes newest first; **Published by** via `users:readonly` scope (added to OAuth client) |
| 2026-09-29 | Save opens the panel scrolled to top; header uses the **FlowLenZ light logo** (tagline "AI Assistant for Genesys Cloud Architect"), header 88 px |

---

**Next implementation step:** **Step 10 — Customer-journey explanation (AI)** (Arun).
