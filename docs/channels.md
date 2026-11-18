# Channels (conversation runtime)

Phase C adds a channel-agnostic conversation layer (our "amojo") on top of the Phase B Salesbot engine. The first channel is a self-contained **live-chat website widget**; WhatsApp/Telegram reuse the same runtime as external adapters (two-way WhatsApp is a documented stretch — see the end).

An inbound client message finds/creates a conversation (attributed by `visitor_uid`), ensures a CRM lead, stores the message, then **launches** the channel's bot or **resumes** a `wait_answer` that was parked waiting for the reply. The bot's `show` handler queues outbound messages that the widget renders.

## Tables

In instance `54182_scraft_crm_database`. Each also has the standard `id` and `secret_key` columns.

### `channels`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| type | text | `live_chat`, `whatsapp`, `telegram` |
| name | text | |
| config | text (TEXT) | JSON (`title`, `accent`, `handle`…) |
| secret | text | optional per-channel token for the public endpoints |
| bot_id | integer | attached bot, `0` = inbox only |
| active | integer | 1 on, 0 off |
| created_at | datetime | |

### `conversations`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| channel_id | integer | |
| lead_id | integer | CRM lead, `0` until one is created |
| visitor_uid | text | attribution key (from the widget / deep link) |
| session_id | text | per-browser-session id |
| utm | text (TEXT) | JSON attribution |
| status | text | `open`, `closed` |
| bot_run_id | integer | the live/last bot run |
| last_message_at | datetime | |
| created_at | datetime | |

### `messages`
| Column | Type | Notes |
|---|---|---|
| workspace_id | integer | |
| conversation_id | integer | |
| direction | text | `in` (from client), `out` (to client) |
| sender_type | text | `client`, `bot`, `manager` |
| text | text (TEXT) | |
| payload | text (TEXT) | JSON (`buttons`, media) |
| external_id | text | messenger message id (external adapters) |
| created_at | datetime | |

## API

### Public ingress (no JWT)
CORS is open (`*`) for these paths; an optional per-channel `secret` is required as `?token=` or the `X-Channel-Token` header when the channel has one.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/api/channels/:id/inbound` | `{ visitor_uid, session_id?, text, utm? }` | `{ status, conversation_id, messages: Message[] }` — outbound messages already available after the inbound one |
| GET | `/api/channels/:id/poll` | `?conversation_id&after=<msgId>&token?` | `{ status, conversation_id, messages: Message[] }` — new outbound messages |
| GET | `/api/channels/:id/widget.js` | — | the embeddable widget script (`application/javascript`) |

### Admin CRUD (`authMiddleware` + `workspaceAuthMiddleware` + `adminOnlyMiddleware`, zod-validated)
| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/channels?workspace_id` | — | `{ status, data: Channel[] }` |
| POST | `/api/channels` | `Channel` (no id) | `{ status, data: Channel }` (201) |
| PUT | `/api/channels/:id` | `Channel` | `{ status, data: Channel }` |
| DELETE | `/api/channels/:id?workspace_id` | — | `{ status, data: { id } }` |

### Inbox (staff — `conversations` permission via `conversationAccess('view')`)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/channels/:id/conversations?workspace_id` | `{ status, data: Conversation[] }` |
| GET | `/api/conversations/:id/messages?workspace_id` | `{ status, data: Message[] }` |

## How an inbound message becomes a bot reply

1. `POST /api/channels/:id/inbound` → `ingestInboundMessage` (`services/channels/runtime.ts`).
2. Find the conversation by `(channel_id, visitor_uid)` or create one.
3. If the conversation has no lead, create one via `leadsApi.createLead` + the `lead_created` fan-out (`emitAutomationEvent`) — the same lead-creation path the web-form webhook uses. `visitor_uid` is the dedup key, so the webhook's email/source_ref dedup does not apply.
4. Append the inbound `messages` row (`direction=in`, `sender_type=client`).
5. Drive the bot:
   - **No live run** → `createBotRun({ entity_type: 'conversation', conversation_id, cursor vars = { message_text, json.message } })`. The worker walks the script; every `show` pushes to `ctx.outbox`; after the step pass the runner persists each as an `out`/`bot` `messages` row (the widget's delivery).
   - **A `waiting` run** (parked by `wait_answer`) → `resumeBotRun(run, text)` injects the reply into `cursor.vars` (`{{message_text}}` / `{{json.message}}`), sets the run back to `pending` at the parked cursor, and kicks the worker. The bot resumes exactly where `wait_answer` left off.
6. The widget polls `GET /poll?after=<lastId>` and renders new outbound messages + buttons.

`wait_answer` parks the cursor at the next block (e.g. after a `question` block, at the `answer` block, same step). The resume keeps that cursor, so the `answer`/`finish` handlers run with the reply available.

Phase B (deal-triggered runs, `conversation_id = 0`) is unchanged: `show` only logs, there is no outbox delivery, and `{{message_text}}`/`{{json.*}}` simply render empty.

## Visitor attribution

The widget generates a `visitor_uid` once and stores it in `localStorage` (and a per-tab `session_id` in `sessionStorage`). Every inbound call carries it, so the same visitor always maps to the same conversation and lead. Messenger deep links mirror Kommo: `buildChannelDeepLink` produces `wa.me/<phone>?text=VisitorUid_<uid>%20ID:%20<session>` and `t.me/<handle>?start=VisitorUid_<uid>` (`lib/webhookUrl.ts`).

## Live-chat widget

Add the channel's embed snippet to any page:

```html
<script src="https://YOUR_HOST/api/channels/<id>/widget.js" async></script>
```

The script (served by `GET /api/channels/:id/widget.js`, built in `services/channels/widget.ts`) is dependency-free vanilla JS: it injects a chat bubble + panel, generates/stores the `visitor_uid`, POSTs to `/inbound`, polls `/poll`, and renders bot messages and buttons. Title/accent come from the channel `config` (`title`, `accent`).

## Manual test

1. Create a bot (`/bots`) whose `question` block does `show` ("Hi! What's your name?") then `wait_answer`, and whose `answer` block does `show` ("Thanks {{message_text}}!").
2. Create a `live_chat` channel (`/channels`), attach that bot, Save.
3. `POST /api/channels/<id>/inbound` with `{ "visitor_uid": "test-1", "text": "hi" }`. A conversation + lead are created and a bot run launches.
4. `GET /api/channels/<id>/poll?conversation_id=<id>&after=0` → the bot's "Hi! What's your name?" outbound message.
5. `POST .../inbound` again with `{ "visitor_uid": "test-1", "text": "Alex" }` → resumes the `wait_answer`; poll again to see "Thanks Alex!".
6. Or embed `widget.js` on a scratch page and chat in the bubble; watch the same conversation in the admin inbox (`/channels` → Inbox).

## Stretch / not implemented

- **WhatsApp/Telegram two-way**: the runtime, tables, adapter seam (`deliverOutbound`), and share links are channel-agnostic, but inbound ingestion from the WhatsApp webhook (`routes/whatsappRoutes.ts`) and outbound push to the Cloud API are not wired yet (WhatsApp inbound needs Meta app review — the reason live chat is channel #1). For these channels `deliverOutbound` currently only stores the outbound `messages` row.
- Manager replies from the inbox UI (compose box) — the inbox is read-only for now.
