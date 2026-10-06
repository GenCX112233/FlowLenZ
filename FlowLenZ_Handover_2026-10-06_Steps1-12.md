# FlowLenZ — Handover Document

**File:** `FlowLenZ_Handover_2026-10-06_Steps1-12.md` (the **only** handover — replace this file and delete the old one when a new dated handover is created)
**Project:** PS Hackathon 2026
**Product name:** FlowLenZ (capital Z)
**Date:** 2026-10-06
**Steps completed:** **1–12 (ALL STEPS COMPLETE)** — Steps 10–12 AI by Arun Govindan; 2026-10-06 polish + security fixes merged into `main` (GitHub `GenCX112233/FlowLenZ`, private)

Progress table: [FlowLenZ_Completion_Tracker.md](./FlowLenZ_Completion_Tracker.md) · Install: [FlowLenZ_User_Guide.md](./FlowLenZ_User_Guide.md) · Use cases: [FlowLenZ_Use_Cases.md](./FlowLenZ_Use_Cases.md)

---

## 1. Product summary

**Positioning:** AI Assistant for Genesys Cloud Architect
**Core message:** Don't just tell me what changed — tell me what the change **means**.
**Tagline:** Understand the flow. See the change. Know the impact.

Genesys Cloud Architect remains the **source of truth**. FlowLenZ keeps no separate version repository.

| UC | Who | What |
|----|-----|------|
| **1** | Developer | Ask questions, understand the flow, get build guidance (Steps 11–12). |
| **2** | Developer | After **Save**: compare, impact, lint & risk, Genesys validation, visual report, customer impact, release-notes preview (Steps 1–10). |
| **3** | Supervisor | Review any **published** version via **Release Notes** (Steps 9–10). |

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
| AI service | Standalone Node.js Express service (`ai-service/`) on `localhost:3000`; shared-secret auth (`x-api-key` header); OpenAI `gpt-4o-mini` (cloud). `GET /` = status JSON |
| Secrets | **Never in git.** `ai-service/.env` (OPENAI_API_KEY, API_SECRET) and `browser-plugin/ai-config.js` (same secret) are git-ignored; only `.env.example` / `ai-config.example.js` are committed. `.env` loaded with `override: true` (a stale Windows `OPENAI_API_KEY` env var once overrode it) |
| AI fallback | AI off / not configured / error / timeout (15 s impact, 30 s Q&A) → rule-based Customer Journey Impact and chat answers from flow data, marked "(Rule-based summary — AI service unavailable.)" |

**API flow:** `GET /api/v2/flows/{flowId}` → `GET /api/v2/flows/{flowId}/versions` → `GET {configurationUri}` (published versions + saved) · `GET /api/v2/users/{id}` (Release Notes publisher name).

**Save detection:** `save-hook.js` (MAIN world) detects `POST /api/v2/flows/{flowId}/versions` → `save-bridge.js` → `background.js` → `content.js` (`ARCHITECT_SAVE_COMPLETED`).

**OAuth:** Authorization Code + **PKCE**, scopes **`architect:readonly users:readonly`**, client ID `31e1986a-b2ff-4b79-a657-d182e223e976`, tokens in `chrome.storage.local`.

**AI service endpoints:**
- `POST /flows/impact` — `GET_CUSTOMER_IMPACT` → returns `{ narrative }`
- `POST /flows/qa` — `FLOW_QA` → returns `{ answer }` (multi-turn, supports both Q&A and Build Guidance)

Both share `ARCHITECT_SEMANTICS` constant in `server.js`.

**Test flow (dev):** `34c70fe1-96a5-4528-8d67-5c659aa1b2ee`

---

## 4. Repository layout

```text
flowlenz/
├── browser-plugin/        ← load this folder as the unpacked extension
│   ├── manifest.json      (MV3; host_permissions includes localhost:3000)
│   ├── background.js      (PKCE, API calls, callAiService → GET_CUSTOMER_IMPACT, FLOW_QA)
│   ├── ai-config.example.js  (copy to ai-config.js — git-ignored — with the shared secret)
│   ├── content.js         (~4700 lines — all panel logic)
│   ├── content.css
│   ├── panel.html         (panel sections + chat; loaded by initPanel)
│   ├── save-hook.js / save-bridge.js
│   ├── genesys-logo-flowlenz*.png, FlowLenZ-logo-light.png / -dark.png
│   ├── Visual-Diff/       (report.html, report.css, report-src.jsx, report-bundle.js, package.json)
│   └── Release-Notes/     (release-notes.html, release-notes.css, release-notes.js)
├── ai-service/
│   ├── server.js          (GET / status, POST /flows/impact, POST /flows/qa; gpt-4o-mini)
│   ├── package.json
│   └── .env.example       (OPENAI_API_KEY, API_SECRET, PORT=3000; real .env git-ignored)
├── package.json           (npm run build:report)
├── FlowLenZ_Completion_Tracker.md
├── FlowLenZ_Handover_2026-10-06_Steps1-12.md   ← this file (only handover)
├── FlowLenZ_User_Guide.md
└── FlowLenZ_Use_Cases.md
```

**Extension ID note:** an unpacked extension's ID comes from its folder path. Loading `browser-plugin/` gave a new ID — its `https://<id>.chromiumapp.org/` redirect was **added to the same OAuth client** (no new client needed).

---

## 5. Panel sections (top to bottom)

| Section | Content |
|---------|---------|
| Header | Genesys logo + FlowLenZ light logo |
| Welcome | "How can I help?" + tagline |
| **Current Flow** | Flow name |
| **Change Report** | Published / saved version labels, config status, refresh status |
| **Visual Change Report** | Status + Open Visual Change Report button |
| **Change Impact Analysis** | Affected Blocks · Affected Branches · Affected dependencies · Potential regression |
| **Customer Journey Impact** | Short AI narrative (2–3 sentences, ≤45 words, ~5–6 lines) refreshed on Save; rule-based fallback. No Regenerate button |
| **Lint & Risk** | Delta-only logical findings + Flow Validation Errors |
| **Release Notes** | Version picker + Published by + Open Release Notes button |
| **Chat** | "Ask FlowLenZ" toolbar + input always visible; full-screen when used; Send + Clear |

---

## 6. Steps 1–10 summary (done — do not break)

| Step | Summary |
|------|---------|
| 1 | Extension injected into Architect; toggle via icon |
| 2 | OAuth PKCE; `architect:readonly users:readonly` |
| 3 | Flow ID from Architect URL |
| 4 | Change Report — published vs saved delta (A/R/M) |
| 5 | FlowLenZ Update — on open + after Save (retry loop) |
| 6 | Change Impact Analysis — Blocks, Branches, Dependencies, Potential regression |
| 7 | Lint & Risk — delta-only RISK_RULES + Flow Validation Errors from Architect DOM |
| 8 | Visual Change Report — dagre graph, direction/view toggles, Connections table, PDF |
| 9 | Release Notes — version picker newest first, Published by, separate page, PDF. Page sections: Summary · Customer Journey Impact · Change Impact Analysis · **Lint & Risk** (added 2026-10-06) |
| 10 | Customer Journey Impact — short AI narrative from deterministic facts; rule-based fallback; also in Release Notes page |

---

## 7. Step 11 — Flow Q&A (done, confirmed 2026-10-03)

Chat panel at the bottom of FlowLenZ. User types a question → AI answers grounded in the current flow context.

### 7.1 `buildFlowContext` output

```
Flow: <name>

Blocks:
  11 Play Audio - Welcome Customer
  17 Decision — Condition: Task.varAccountNumber != ""
  19 Call Data Action — Get User Presence
  22 Transfer to User (added)
  ...

Wiring:
  11 Play Audio - Welcome Customer -> 15 Collect Input
  15 Collect Input [Failure] -> 22 Transfer to User
  ...

Resources:
  Queues: FlowLenZ_Default
  Prompts/Audio: TTS "Thank you for contacting FlowLenz", ...
  Data Actions: Get User Presence
  Sub-flows: (none)

Lint & Risk issues:
  [High] 15 Collect Input — "No branch" → Has no action (Branch may skip intended processing.)

Genesys Architect Validation Errors:
  Transfer to ACD — Queue is required
```

Key design decisions:
- Wiring uses `edge.source`/`edge.target` (not `edge.from`/`edge.to`)
- Decision condition via `extractExpressionText(action.expression)`
- Switch cases from `action.paths[].label`
- Data action name via `getDataActionReferenceLabel`
- Prompts via `getPlayAudioReferences` (clean TTS strings, no raw expressions)
- Queues via `getQueueNames`
- Lint via `getAllRisks(configuration)` — full flow, not delta-only
- Architect validation errors from `lastValidationRows` (populated after user clicks Validate)
- Added blocks marked `(added)` by comparing against published model node keys
- `chatFlowContext` rebuilt on every `applyContext` call — from the **saved** version (vs published) or, if nothing is saved, from the **published** version (`Version:` line in context)

### 7.2 Chat UI

- Two states only (`setChatFullScreen`): **minimised** (toolbar + input visible, messages hidden, sections visible, chevron ^) and **full screen** (`.flowlenz-chat-full` hides sections; chat fills the panel below the header, chevron ⌄)
- Full screen on input focus, Send, or clicking "Ask FlowLenZ"; chevron ⌄ minimises; Save returns to sections scrolled to top
- **Clear** button (after Send) empties messages, input and chat history
- Placeholder: "Ask about your Flow"
- Bubbles: `.user` (orange, right) / `.ai` (grey, left)
- AI bubbles render markdown via inline `parseMarkdown` (bold, bullets, inline code, paragraphs)
- Input: `<textarea>` auto-grows to 3 lines, then scrolls; Enter = send, Shift+Enter = newline
- Chat history bounded to 20 entries (10 turns); cleared on panel reload

### 7.3 Key functions

| Function | Purpose |
|----------|---------|
| `extractExpressionText(expr)` | Pulls readable text from Architect expression objects |
| `buildFlowContext(config, publishedConfig, flowName)` | Assembles full plain-text flow document |
| `getAllRisks(configuration)` | Runs RISK_RULES against all blocks (not delta-only) |
| `runRiskRules(items)` | Shared helper used by both `getDeltaRisks` and `getAllRisks` |
| `parseMarkdown(text)` | Inline markdown → HTML (bold, bullets, code, paragraphs) |
| `inlineMd(text)` | HTML-escapes then applies inline patterns |
| `renderChatMessage(role, text, isLoading)` | Appends plain-text bubble |
| `sendChatQuestion(question)` | Sends FLOW_QA, renders markdown answer, updates history |

---

## 8. Step 12 — Build Guidance (done, confirmed 2026-10-03)

**What it is:** The same chat panel as Step 11, upgraded with a second AI role — Architect build guidance. The user can ask how to build, implement, or improve something in Architect and get concrete, actionable advice referencing existing blocks in the current flow.

**Example questions:**
- *"How should I handle the Failure path on block 22?"*
- *"What's the best way to add a retry loop for DTMF input?"*
- *"Should I use a Decision or Switch for 3 routing options?"*

**What changed from Step 11:**
- `QA_SYSTEM_PROMPT` in `server.js` upgraded with Role 2 — Build Guidance:
  - Gives concrete advice using Architect block types by name
  - References existing blocks in the flow where relevant
  - Uses bullet points for steps/options
- Chat placeholder: `"Ask about your Flow"` (changed 2026-10-06)
- No new endpoints, no new UI — same chat, same context, same history

**AI service (`server.js`):**
- `ARCHITECT_SEMANTICS` — shared by both `/flows/impact` and `/flows/qa`
- `QA_SYSTEM_PROMPT` — two roles: Flow Q&A + Build Guidance
- `/flows/qa` logs: context → question → answer. `max_tokens: 600`, `temperature: 0.3`

---

## 9. Running the AI service

```bash
cd ai-service
cp .env.example .env   # fill in OPENAI_API_KEY and API_SECRET
npm install
npm start              # check http://localhost:3000 → status JSON
```

Copy `browser-plugin/ai-config.example.js` → `browser-plugin/ai-config.js` and set `secret` = `API_SECRET` from `.env`. Both files are git-ignored. If the secret is missing, AI calls are skipped and the fallback is used.

---

## 10. Known limitations

- AI service must run locally on port 3000 for AI answers; otherwise the rule-based fallback is shown (keyword-based chat: overview, changes, impact, queues, prompts, data actions, called flows, risks/validation, block count).
- Flow data (block names, queues, conditions, prompts) is sent to OpenAI via the local service; the service logs it to its console.
- Chat history is in-memory only — cleared on extension reload, page navigation or **Clear**.
- Release Notes waits for the AI narrative (up to 15 s) before opening.
- Architect validation errors only appear in context after the user clicks Validate in Architect.
- All Step 1–10 limitations still apply.

---

## 11. Testing checklist

1–14. All previous checklist items still apply.
15. Open a flow → save → ask a question → AI answers based on the flow.
16. Decision block shows condition (e.g. `Condition: Task.varAccountNumber != ""`).
17. Data action blocks show action name (e.g. `Call Data Action — Get User Presence`).
18. Wiring shows correct block names (not `undefined -> undefined`).
19. Prompts show clean TTS strings.
20. Lint & Risk issues appear in context and AI can explain them.
21. After clicking Validate in Architect, validation errors appear in context.
22. Multi-turn: follow-up questions reference previous answers.
23. Build guidance: ask "how do I add a retry loop?" → AI gives Architect-specific block advice.
24. Chat: input visible when minimised; focus/Send → full screen below header (chevron ⌄); chevron → fully minimised (chevron ^); Clear empties chat.
25. Textarea grows to 3 lines then scrolls; Enter sends, Shift+Enter newlines.
26. AI service down → rule-based Customer Journey Impact + chat answers, marked "(Rule-based summary — AI service unavailable.)"; rest of panel unaffected.
27. Published-only flow (no saved changes) → chat still answers about the published version.
28. Customer Journey Impact stays ~5–6 lines.
29. Release Notes page shows Lint & Risk after Change Impact Analysis.
30. Before every push: `git grep` staged files for the OpenAI key / API secret — must be 0 hits.

---

## 12. Working style

1. One step at a time; mark **Done** only after user confirms testing.
2. Short, crisp answers.
3. Don't break Steps 1–11 without approval.
4. **One handover file only** — delete the previous one when creating a new one.

---

## 13. Key symbols (`content.js`)

| Area | Functions |
|------|-----------|
| Context / update | `fetchCurrentContext`, `analyseVersions`, `applyContext`, `refreshOnOpen`, `refreshAfterSave` |
| Compare | `extractActions`, `compareActions`, `getConciseChanges`, `getActionKey` |
| Impact | `renderChangeImpactAnalysis`, `buildChangeImpactHtml`, `renderChangeScope`, `analyzeBranchImpact`, `formatBranchImpactLines`, `analyzePotentialRegression` |
| Dependencies | `analyzeDependencyImpact`, `renderDependencyImpactContent`, `collectActionReferences`, `findReferenceTexts`, `getDataActionReferenceLabel`, `getPlayAudioReferences`, `cleanPromptText`, `getFlowReferences`, `getQueueNames` |
| Lint & Risk | `RISK_RULES`, `runRiskRules`, `getDeltaRisks`, `getAllRisks`, `renderRiskValidation`, `buildRiskReport`, `formatRiskMessage` |
| Flow validation | `findValidationFooters`, `findValidationPanel`, `getTextChunks`, `parseValidationRows`, `captureValidationResults`, `renderValidationSection` |
| Visual | `buildVisualFlowModel`, `buildVisualSequenceGraph`, `getVisualExits`, `buildVisualReportPayload`, `openVisualChangeReport` |
| Release Notes | `buildReleaseEntries`, `buildReleaseNotesBody`, `openReleaseNotes`, `renderReleaseNotesPicker`, `updateReleaseStatus`, `resolveReleasePublisher` |
| Customer Journey Impact | `getTransferTarget`, `buildBranchWiringLines`, `collectCustomerImpactData`, `buildCustomerImpactFacts`, `buildFallbackCustomerImpact`, `cleanDependencyName`, `joinNames`, `fetchCustomerImpact`, `renderCustomerImpact` |
| Flow Q&A / Build Guidance | `extractExpressionText`, `collectFlowResources`, `buildFlowContext`, `buildFallbackChatAnswer`, `buildFallbackFlowOverview`, `getAllRisks`, `runRiskRules`, `parseMarkdown`, `inlineMd`, `renderChatMessage`, `sendChatQuestion` |
| Panel / chat UI | `initPanel` (`panelReady` promise — messages wait for it), `handleExtensionMessage`, `setChatFullScreen` |
| Background | `GET_USER_NAME`, `GET_CUSTOMER_IMPACT`, `FLOW_QA`, `callAiService` (secret check, timeout, HTTP status check), `ai-config.js` via `importScripts` |

---

## 14. Decisions log

| Date | Decision |
|------|----------|
| 2026-09-27 | Single Step 1–12 tracker; Change Impact is one section; dependencies = resources only; no lint duplicating Architect Validate; AI after Steps 8–9 |
| 2026-09-28 | Visual report in new tab with PDF; dagre graph; per-task sections; direction and view toggles |
| 2026-09-28 | Branch Impact → Affected Branches on graph model |
| 2026-09-28 | Steps 8 and 9 confirmed Done; release notes rebuilt on demand (no storage) |
| 2026-09-29 | Affected dependencies: block name on every line; new Flows group |
| 2026-09-29 | **Exception to APIs-only:** read Architect's Validate list for Flow Validation Errors (changed blocks only) |
| 2026-09-29 | Release Notes newest first; Published by via `users:readonly` scope |
| 2026-09-29 | Save opens the panel scrolled to top; header uses FlowLenZ light logo |
| 2026-10-03 | Step 10: AI service as standalone Express on localhost:3000; shared-secret auth; `gpt-4o-mini` |
| 2026-10-03 | Facts payload uses graph edges for branch wiring (not getBranchingBlocks) |
| 2026-10-03 | `getTransferTarget` for TransferPureMatchAction uses only `getQueueNames` |
| 2026-10-03 | System prompt includes Architect exit semantics: Failure = system error, not unavailability |
| 2026-10-03 | Step 11: `buildFlowContext` uses `edge.source`/`edge.target`; Decision condition; Switch cases; data action name |
| 2026-10-03 | Chat history bounded to 20 entries; `chatFlowContext` rebuilt on every `applyContext` |
| 2026-10-03 | Chat toolbar with SVG chevron toggle (20×20 codicon-style) |
| 2026-10-03 | Markdown via inline `parseMarkdown` — no external library |
| 2026-10-03 | Auto-grow textarea (max 3 lines); Enter = send, Shift+Enter = newline |
| 2026-10-03 | Step 12: Build Guidance via upgraded `QA_SYSTEM_PROMPT` — same chat, same endpoint, second AI role |
| 2026-10-03 | `getAllRisks` runs RISK_RULES on full flow (not delta-only) for Q&A context |
| 2026-10-03 | Architect validation errors (`lastValidationRows`) included in Q&A context |
| 2026-10-03 | Layout push (body margin-right) attempted and reverted — Architect fixed-position elements don't respond |
| 2026-10-06 | Use Arun's `flowlenz_ai` code as `main` (based on latest Steps 1–9 commit — no merge needed); squashed into one commit so the old hard-coded secret never reached GitHub |
| 2026-10-06 | AI secret removed from `background.js` and rotated; lives only in git-ignored `ai-config.js` + `.env`; `.env` loaded with `override: true` |
| 2026-10-06 | Rule-based fallback for Customer Journey Impact (panel + Release Notes) and chat; AI timeouts 15 s / 30 s |
| 2026-10-06 | `panelReady` guard so toolbar/Save messages never hit an unloaded panel |
| 2026-10-06 | Customer Impact renamed **Customer Journey Impact**; Regenerate removed; narrative limited to 2–3 sentences / 45 words |
| 2026-10-06 | Chat: input always visible; full screen below header when used; Clear button; placeholder "Ask about your Flow"; works for published-only flows |
| 2026-10-06 | Release Notes page: Lint & Risk section added back (delta of that version vs previous) |
| 2026-10-06 | AI service `GET /` status page |
