# Kommo-style Bot Automation — Architecture & Build Plan

## Context

The CRM already ships "phase 1" of a Kommo-style automation system: `docs/automations.md`
describes a flat **trigger → condition → action** engine (a "Kommo Digital Pipeline"
analog) and explicitly defers the Salesbot bot-builder, conversation triggers, and AI
step to "phases 2–4". The user wants to replicate Kommo in full: **(1) pipeline creation
for automation, (2) bot-flow creation, and (3) shareable direct-link bot launching over
live conversations** — using the same architecture Kommo uses.

This plan is the blueprint for that build. It was written after reading Kommo's developer
docs (Salesbot scenario reference, launch API, widget/webhook integration, Chats/amojo
channel API) and after mapping our codebase (automations engine, deals/pipelines, and the
chat/channel layer).

### Decisions locked with the user
- **Build order:** Pipeline polish → Bot engine → Channel layer.
- **Data model:** real dedicated tables for the net-new entities (bots, bot_runs,
  channels, conversations, messages) — not more JSON rows in `lead_webhook_logs`.
- **First channel:** follow Kommo — a channel-agnostic conversation runtime with the
  **Live-Chat website widget** as the first (self-contained) channel, then **WhatsApp** as
  the first external messenger adapter (reusing existing WhatsApp Cloud API infra).

### How Kommo actually works (reference, for faithfulness)
- **Digital Pipeline trigger** (the "when"): a trigger on a pipeline stage (lead created
  in / moved to a stage, responsible changed), optionally condition-gated, whose job is to
  **launch a Salesbot** against the entity.
- **Salesbot** (the "engine"): a JSON script = a flat, 0-indexed **array of step objects**
  (≤64 KB). Each step is `{ "question": [handlers], "answer": [handlers], "finish": [handlers] }`.
  Every unit of work is a **handler** `{ "handler": "<type>", "params": {...} }`. Control
  flow is explicit: `goto {type, step}`, `wait_answer {type, step}`, `condition
  {term1, term2, operation, result:[...]}`, `buttons` (branch on reply), `stop {action}`.
  CRM mutations live under one `action` handler (`change_status`, `set_tag`,
  `set_custom_fields`, `create_task`, …). External logic via `widget_request {url, data}`:
  Kommo POSTs `{token(JWT), data, return_url}`, **pauses** the bot, and the external service
  resumes by calling `return_url` with an `execute_handlers:[...]` array injected back.
  Launch API: `POST /api/v4/bots/{id}/run` `{entity_id, entity_type}`; batch ≤100.
- **Channels (amojo Chats API):** every channel connects as a custom chat channel into one
  conversation transport (HMAC-SHA1 signed requests to `amojo.kommo.com`: channel
  `connect`/`disconnect`, `create chat`, `send/import messages`, `history`). The bot has an
  ID from channel registration and replies into the same conversation. **The bot is
  channel-agnostic.** The website Chat Button (Live Chat) is one such channel.

### Our codebase today (what we build on)
- **Automations engine** `services/automations/*`: worker with claim/lock, retries +
  exponential backoff, stale-run requeue, 5s poll (`runner.ts`), depth-guarded chaining
  via emit-on-mutate (`dealOps.ts`, `engine.ts`, `MAX_CHAIN_DEPTH=3`). `action_config` and
  `automation_runs.context` are **opaque JSON** → can carry stepped-flow state. Action
  dispatch is a hardcoded `switch` in `actions.ts` (the key generalization seam). Editor:
  `pages/AutomationsPage.tsx`; API: `routes/automationsRoutes.ts` (zod `ruleSchema`,
  `action_config` is `z.record` — schema-less on purpose).
- **Deals/pipelines** (`routes/dealsRoutes.ts`, `services/deals.ts`, `services/dealStages.ts`):
  multi-pipeline per workspace, per-pipeline editable stages + custom fields, Kanban board
  (`pages/DealsPage.tsx`), stage editor (`components/DealStagesSettings.tsx`). Persisted as
  `status`-discriminated JSON rows in `lead_webhook_logs`.
- **Ingress/attribution:** public, workspace-scoped, optionally token-secured webhook
  `POST /api/webhook/:workspaceId/...` (`middleware/webhook.js`) + shareable-URL builder
  (`lib/webhookUrl.ts`) + source registry (`services/sourceRegistry.ts`). New-lead fan-out
  at `webhook.js:598-651` is the natural "launch bot / first message" hook.
- **Bot brain option:** Grok + MCP agent with confirmation tickets (`services/ai/*`,
  `services/mcp/*`) — reusable for an AI handler/step later.
- **Channel layer:** ~90% greenfield. IG = live-proxy (nothing stored), WhatsApp =
  outbound template sends + delivery-status webhook (logs only, no two-way inbox). No
  persisted conversation/message store, no Telegram, no customer-facing chat, no bot/flow
  engine. A `conversations` permission + `middleware/conversationAccess.ts` already exist.

---

## Phase A — Pipeline builder polish (match Kommo pipeline creation)

Smallest, lowest-risk, ships immediately. Closes the gaps between our pipeline builder and
Kommo's.

1. **Pipeline rename + delete** (today only create + list exist).
   - Backend: add `PUT /pipelines/:slug` and `DELETE /pipelines/:slug` in
     `routes/dealsRoutes.ts` (admin-only; block delete when the pipeline has deals, mirror
     the stage-delete guard at `dealsRoutes.ts:158-172`). Add update/remove to
     `dealPipelinesApi` in `services/api.js`. Keep slug immutable; rename edits the stored
     `name` only.
   - Frontend: extend `CreatePipelineModal` (`pages/DealsPage.tsx:~1095`) into a manage
     modal; add rename/delete affordances next to the pipeline `<select>` (`:1750`).
2. **Per-stage color picker** — color is already in `DealStageConfig` but hardcoded to
   `#2563EB` on add (`DealStagesSettings.tsx:163`). Add a color input to the stage row.
3. **Stage status semantics (open/won/lost)** — Kommo stages have a status type. Add
   `status_type` to `DealStageConfig` (`types/index.ts:97-102`), wire the already-defined
   but unused `PIPELINE_STATUS_TYPES` (`constants.ts:43`), and replace hardcoded
   `stage === 'won'` detection (`DEAL_STAGE_WON`) with `status_type`-based checks. Backfill
   defaults from `DEFAULT_DEAL_STAGES`.
4. **Deal tags UI** — `tags` exist in the deal model but have no create/edit UI (only
   automation actions set them). Add a tags editor to `CreateDealModal` / edit modal in
   `pages/DealsPage.tsx`.

**Verify:** create/rename/delete a pipeline; add a colored stage marked `won`; create a
deal with tags; confirm conversion/won reporting still works. Extend
`scripts/automations-smoke.ts` or add a deals smoke check.

---

## Phase B — Bot flow engine + visual designer (the core "same as Kommo")

The Salesbot clone. Built server-side on the existing worker; proven on deal triggers
first (no live chat needed), so the interpreter is solid before the channel layer.

### B1. Data model (real tables)
- **`bots`**: `id, workspace_id, name, active, sort_order, trigger_type, pipeline_slug,
  stage, conditions(JSON), script(JSON step-array), created_by, created_at, updated_at`.
  Bots carry their own Digital-Pipeline-style trigger (reuse `engine.ts` matching), so a
  stage event launches a bot exactly like Kommo.
- **`bot_runs`**: `id, workspace_id, bot_id, entity_type, entity_id, conversation_id(null
  until Phase C), status(pending|running|waiting|done|failed|stopped), cursor(JSON: block
  type + step index + vars), attempts, claim_id, run_at, result, error, created_at,
  updated_at`. Mirrors `automation_runs` so the existing worker patterns port directly.

### B2. Script schema = Kommo's (exact)
Array of steps; each `{ question:[handler], answer:[handler], finish:[handler] }`;
handler `{ handler, params }`; 0-indexed; validate ≤64 KB. A zod schema in a new
`services/bots/schema.ts` validates on save (unlike Kommo we validate strictly up front).

### B3. Handler registry (generalize `runAction`)
Refactor the hardcoded `switch` in `services/automations/actions.ts` into a handler
registry `services/bots/handlers/*` keyed by handler name. Port existing actions as
`action` sub-handlers (`move_stage`/`change_status`, `set_tag`, `create_task`, `send_email`,
`send_whatsapp`, `send_webhook`, `notify_user`). Add control-flow + Kommo handlers:
`condition` (wrap existing `conditionsMet`, `runner.ts:28-43`), `goto`, `wait_answer`,
`stop`, `show` (emits a message — queued in Phase B, delivered in Phase C), and
`widget_request` (Kommo pause/resume: POST `{token, data, return_url}`, park the run,
resume via `return_url` with `execute_handlers` injection; reuse the SSRF guard
`assertPublicHttpsUrl`, `actions.ts:84-97`). Keep the `{{scope.key}}` templating
(`actions.ts:20-47`), extend with `{{json.*}}` for widget/answer values.

### B4. Interpreter (extend the worker)
A bot launch inserts a `bot_runs` row; the worker walks the step array using `cursor` as
the program counter. `goto`/`condition` move the cursor; `wait_answer` sets status
`waiting` and parks until resumed (Phase C inbound, or `widget_request` callback);
`stop`/end → `done`. Reuse claim/lock, retry/backoff, and the `MAX_CHAIN_DEPTH` guard. In
Phase B we exercise non-conversational steps (action/condition/goto/delay/stop/
widget_request) driven by a deal trigger — this proves the engine without any chat.

### B5. Launch API + trigger bridge
`POST /api/bots/:id/run {entity_id, entity_type}` and batch `POST /api/bots/run` (≤100),
mirroring Kommo. Digital-Pipeline bots launch from the existing `emitAutomationEvent`
matching; also add an `action_type: 'launch_bot'` to Phase-1 rules so existing flat rules
can hand off to a bot.

### B6. Visual flow designer
New `pages/BotBuilderPage.tsx`: a step/handler canvas that **compiles to the JSON step
array** (exactly as Kommo's designer does). Start with a structured step-list + branch
editor that round-trips the JSON and reuses `AutomationsPage.tsx`'s per-action config
blocks as handler-param editors; a full drag-graph canvas is a later enhancement. Include a
"View source" JSON panel (Kommo parity) and client-side schema validation.

**Verify:** author a multi-step bot (set tag → condition → move stage → create task →
stop), launch it via the trigger and via the API on a test deal, and confirm `bot_runs`
cursor progression + chaining in a run log. Add `scripts/bots-smoke.ts`.

---

## Phase C — Channel link + conversation runtime (Kommo amojo model)

The greenfield 90%. A **channel-agnostic conversation layer** (our "amojo"), the
**Live-Chat website widget** as channel #1, then **WhatsApp** as the first external adapter.

### C1. Data model (real tables)
- **`channels`**: `id, workspace_id, type(live_chat|whatsapp|telegram|…), name,
  config(JSON), secret, bot_id(attached bot, null=inbox-only), active, created_at`.
- **`conversations`**: `id, workspace_id, channel_id, lead_id, visitor_uid, session_id,
  utm(JSON), status(open|closed), bot_run_id, last_message_at, created_at`. Attribution
  lives here (and can be promoted to lead custom fields).
- **`messages`**: `id, conversation_id, workspace_id, direction(in|out),
  sender_type(client|bot|manager), text, payload(JSON: buttons/media), external_id,
  created_at`.

### C2. Conversation runtime
An internal transport analogous to amojo: inbound message → find/create conversation
(attributed via `visitor_uid` from the deep-link) → create lead if needed (reuse
`webhook.js` lead-creation + fan-out) → launch or **resume** the bot_run (a `wait_answer`
resolves with `{{json.message}}`/`{{message_text}}`). The bot's `show` handler enqueues an
outbound `messages` row; the channel adapter delivers it. Gate staff views with the
existing `conversations` permission + `middleware/conversationAccess.ts`.

### C3. Public ingress + share links
A public channel endpoint following the `POST /api/webhook/:workspaceId/...` pattern
(`middleware/webhook.js`) — public, optional per-channel secret, workspace by URL. Extend
`lib/webhookUrl.ts` to generate (a) the **Live-Chat widget embed snippet** and (b) deep
links `wa.me`/`t.me` carrying `visitor_uid`, mirroring Kommo's
`?ref=VisitorUid_{{visitor_uid}}` / `ID:%20{{session_id}}` formats.

### C4. Channel adapters
1. **Live-Chat website widget** (self-contained, no external approval — Kommo's default
   channel): an embeddable JS bubble served from our domain; posts to the public channel
   endpoint; renders bot `show` text/buttons; carries `visitor_uid` for attribution.
2. **WhatsApp**: reuse `services/whatsapp.ts` Cloud API for outbound; add **two-way inbound**
   by extending the WhatsApp webhook (`routes/whatsappRoutes.ts`) to ingest messages into
   `conversations`/`messages` and resume the bot. Share via the `wa.me` link with the
   session/visitor id.
3. **Telegram** (optional, later): bot token, simplest full two-way adapter.

**Verify:** embed the widget on a scratch page, open it (new conversation + attributed
lead), drive a bot that asks a question, replies via `wait_answer`, branches on the answer,
moves the deal, and closes — all visible in the conversation + bot run log. Then repeat the
same bot over WhatsApp to prove channel-agnosticism.

---

## Cross-cutting notes
- **Table creation:** the backend uses hosted NoCodeBackend (no in-repo SQL migrations);
  "real tables" = new NoCodeBackend collections created in its console, accessed via a
  thin `tableApi()` wrapper in `services/api.js` (same pattern as `automationsApi`).
  Document each schema in `docs/` as `automations.md` does.
- **Reuse over rebuild:** worker/claim/retry (`runner.ts`), chaining + depth guard
  (`dealOps.ts`/`engine.ts`), templating + SSRF guard (`actions.ts`), ingress + attribution
  (`webhook.js`, `webhookUrl.ts`, `sourceRegistry.ts`), conversation permissions
  (`conversationAccess.ts`), WhatsApp Cloud API (`whatsapp.ts`), Grok+MCP brain
  (`services/ai/*`).
- **Admin gating:** bot/channel CRUD is admin-only, matching automations
  (`adminOnlyMiddleware`).
- **Risk/dependency:** WhatsApp two-way needs Meta app review — that's why Live-Chat is
  channel #1. Telegram is the cheapest real-messenger proof if WhatsApp approval stalls.
