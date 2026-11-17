# Automations (pipeline rules)

Kommo-style Digital Pipeline: rules attached to deal pipeline stages. Each rule is **when → only if → wait → then**.

| Part | Options |
|---|---|
| When | Deal created in a stage, moved to a stage, created or moved, owner changed, new lead arrives |
| Only if | Deal value range, has any of these tags, lacks these tags, lead source contains, owner is |
| Wait | Immediately, 5 min, 10 min, 1 h, 1 day, 3 days or custom minutes. Delayed rules skip if the deal left the stage (can be turned off) |
| Then | Send email (workspace SMTP), send WhatsApp template, add task, change stage, change owner, add/remove tags, notify a teammate, send webhook |

Messages and task titles accept variables: `{{lead.name}}`, `{{lead.email}}`, `{{lead.phone}}`, `{{deal.name}}`, `{{deal.value}}`, `{{deal.stage}}`, `{{deal.pipeline}}`, `{{deal.tags}}`.

## How it runs

1. Code that creates leads, creates deals, moves deals or changes owners calls `emitAutomationEvent` (`services/automations/engine.ts`).
2. Every matching active rule gets a row in `automation_runs` with `run_at = now + delay`.
3. The worker (`services/automations/runner.ts`, every 5 s) claims due runs, re-reads the deal, checks the conditions, runs the action and records `done`, `skipped` or `failed`. Failures retry with backoff (30 s, 1 min, 2 min… up to 5 attempts).
4. Actions that change a deal (stage, owner) emit their own events, so rules can chain. Chains stop after 3 levels to prevent loops.

The worker starts when `AUTOMATIONS_WORKER_ENABLED=true` (defaults to `BACKGROUND_WORKERS_ENABLED`). Poll interval: `AUTOMATION_POLL_INTERVAL_MS` (default 5000).

## Tables

Created on 2026-11-17 in instance `54182_scraft_crm_database` through the NoCodeBackend MCP (`execute_sql`). Each also has the standard `id` and `secret_key` columns. To recreate them elsewhere, use these definitions.

End-to-end check (throwaway workspace 999999, cleans up after itself): `npx tsx scripts/automations-smoke.ts`

### `automations`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| pipeline_slug | text | e.g. `default` |
| stage | text | stage slug, empty for new-lead rules |
| name | text | |
| trigger_type | text | `deal_created`, `deal_moved`, `deal_created_or_moved`, `deal_owner_changed`, `lead_created` |
| conditions | text | JSON |
| delay_minutes | integer | |
| action_type | text | `send_email`, `send_whatsapp`, `move_stage`, `assign_owner`, `add_tags`, `remove_tags`, `create_task`, `notify_user`, `send_webhook` |
| action_config | text | JSON |
| active | integer | 1 on, 0 off |
| sort_order | integer | |
| created_by | integer | |
| created_at | datetime | |
| updated_at | datetime | |

### `automation_runs`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| automation_id | integer | |
| deal_id | integer | 0 for lead-only runs |
| lead_id | integer | |
| event_type | text | |
| status | text | `pending`, `running`, `done`, `skipped`, `failed` |
| run_at | datetime | when it is due |
| attempts | integer | |
| claim_id | text | worker lock |
| result | text | |
| error | text | |
| context | text | JSON snapshot of the event |
| created_at | datetime | |
| updated_at | datetime | |

### `tasks`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| deal_id | integer | |
| lead_id | integer | |
| assigned_to | integer | user id |
| title | text | |
| description | text | |
| task_type | text | `follow_up`, `call`, `meeting`, `email`, `other` |
| due_at | datetime | |
| status | text | `open`, `done` |
| completed_at | datetime | nullable |
| created_by | integer | 0 when created by an automation |
| automation_id | integer | |
| created_at | datetime | |

Deal tags need no table: they live on the deal record (`tags` array).

## Not in this phase

Incoming WhatsApp/Instagram messages, conversation triggers, the bot builder (Salesbot) and the AI agent step come in phases 2–4.
