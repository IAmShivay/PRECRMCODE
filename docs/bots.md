# Bots (Salesbot flow engine)

Kommo-style Salesbot: a bot carries its own Digital-Pipeline-style trigger and a JSON **script** — a flat, 0-indexed array of step objects. Each step is `{ question:[handler], answer:[handler], finish:[handler] }`, and every unit of work is a **handler** `{ handler, params }`. Phase B proves the interpreter on deal triggers (no live chat yet); conversational delivery (`show`/`wait_answer` resume) lands in Phase C.

| Part | Options |
|---|---|
| Trigger | `deal_created`, `deal_moved`, `deal_created_or_moved`, `deal_owner_changed`, `lead_created` (same values as automations), gated by pipeline + stage + conditions |
| Handlers | `show`, `action`, `condition`, `goto`, `wait_answer`, `stop` |
| Actions (`action` handler) | `move_stage`, `add_tags`, `remove_tags`, `assign_owner`, `create_task`, `send_email`, `send_whatsapp`, `send_webhook`, `notify_user` — reuse Phase-1 implementations in `services/automations/actions.ts` |

Messages/titles accept the same variables as automations: `{{lead.name}}`, `{{lead.email}}`, `{{lead.phone}}`, `{{deal.name}}`, `{{deal.value}}`, `{{deal.stage}}`, `{{deal.pipeline}}`, `{{deal.tags}}`.

## Handler semantics

- `show {text}` — Phase B logs the rendered text to the run result (real delivery is Phase C).
- `action {action, config}` — dispatches to `runAction` with a synthesized rule so behaviour matches Phase 1 (stage/tags/owner changes go through `dealOps.patchDeal`, which emits chained automation/bot events).
- `condition {term1, operation, term2, result:[handler]}` — renders both terms, compares (`equals`, `not_equals`, `contains`, `not_contains`, `gt`, `lt`, `is_empty`, `is_not_empty`); when met, the nested `result` handlers run inline.
- `goto {block, step}` — moves the cursor to a 0-indexed step/block (validated in range on save).
- `wait_answer` — sets the run status to `waiting` and parks the cursor at the next block (resumed in Phase C).
- `stop {action}` — ends the run. `talk-close` is a no-op end; `salesbot-start` with `bot_id` (or `bot:<id>`) enqueues another bot run (depth-guarded, max 3).

## How it runs

1. `emitAutomationEvent` (`services/automations/engine.ts`) calls `maybeLaunchBotsForEvent` (`services/bots/engine.ts`) — the Digital-Pipeline bridge. Every active bot whose trigger/pipeline/stage/conditions match a deal event gets a `bot_runs` row (`status=pending`, cursor at `question/0`).
2. Bots can also be launched directly: `POST /api/bots/:id/run {workspace_id, entity_id, entity_type}`.
3. The worker (`services/bots/runner.ts`, same poll interval as automations) claims due pending runs with a unique `claim_id`, loads the bot + deal + lead, and walks the step array using `cursor` `{block, step, vars}` as the program counter. `goto` jumps, `condition` runs nested handlers, `wait_answer` → `waiting`, `stop`/end → `done`. Failures retry with backoff (30 s… up to 5 attempts); stale `running` rows requeue after 10 min.
4. The script is validated with zod on save (`services/bots/schema.ts`): ≤ 65536 bytes serialized, `goto` targets in range.

The worker starts alongside the automations worker under `AUTOMATIONS_WORKER_ENABLED` (defaults to `BACKGROUND_WORKERS_ENABLED`).

## API

All CRUD endpoints are admin-gated (`authMiddleware` + `workspaceAuthMiddleware` + `adminOnlyMiddleware`) and zod-validated.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/bots?workspace_id` | — | `{ status, data: Bot[] }` |
| POST | `/api/bots` | `Bot` (no id) | `{ status, data: Bot }` (201) |
| PUT | `/api/bots/:id` | `Bot` | `{ status, data: Bot }` |
| DELETE | `/api/bots/:id?workspace_id` | — | `{ status, data: { id } }` |
| GET | `/api/bots/runs?workspace_id&bot_id?&limit?` | — | `{ status, data: BotRun[] }` |
| POST | `/api/bots/:id/run` | `{ workspace_id, entity_id, entity_type? }` | `{ status, data: { id, bot_id, entity_id, entity_type } }` (201) |

## Tables

In instance `54182_scraft_crm_database`. Each also has the standard `id` and `secret_key` columns.

### `bots`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| name | text | |
| active | integer | 1 on, 0 off |
| sort_order | integer | |
| trigger_type | text | `deal_created`, `deal_moved`, `deal_created_or_moved`, `deal_owner_changed`, `lead_created` |
| pipeline_slug | text | default `default` |
| stage | text | stage slug, empty = any stage |
| conditions | text (TEXT) | JSON (same shape as automations conditions) |
| script | text (MEDIUMTEXT) | JSON step array (≤ 65536 bytes) |
| created_by | integer | |
| created_at | datetime | |
| updated_at | datetime | |

### `bot_runs`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| bot_id | integer | |
| entity_type | text | `deal` |
| entity_id | integer | the deal id |
| conversation_id | integer | 0 until Phase C |
| status | text | `pending`, `running`, `waiting`, `done`, `failed`, `stopped` |
| cursor | text (TEXT) | JSON `{ block, step, vars }` program counter |
| attempts | integer | |
| claim_id | text | worker lock |
| run_at | datetime | when it is due |
| result | text | run log of handler outcomes |
| error | text | |
| created_at | datetime | |
| updated_at | datetime | |

## Not in this phase

Live chat / conversation runtime, `show` message delivery, `wait_answer` inbound resume, and channel adapters come in Phase C.
