# Website Form → Lead + Deal Automation

A website form submission can create a **lead** and a **linked deal** in one request.

## The endpoint

```
POST /api/webhook/{workspaceId}[/{sourceSlug}][/{sourceId}]
```

It is public (no JWT) so a plain HTML form on any website can post to it.
`middleware/webhook.js` handles it.

| URL part | Meaning |
|---|---|
| `workspaceId` | The workspace the lead belongs to |
| `sourceSlug` | Optional human-readable source name |
| `sourceId` | The source registry id (`src_...`). This is what binds the submission to a deal mapping |

Request body — `name` (or `email`) is required:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+919876543210",
  "budget": "1500000",
  "property_type": "3 BHK Villa",
  "event_id": "optional-company-submission-id"
}
```

`event_id` (or `submission_id`, `x-idempotency-key`, ...) is used for deduplication.
Without it the SHA-256 of the body is used.

Response:

```json
{
  "status": "success",
  "data": {
    "lead_id": 6234,
    "deal_id": 8005,
    "workspace_id": 19,
    "source": "LANDING_PAGE_evt_abc",
    "custom_fields_saved": 0,
    "deal_skipped_reason": null,
    "processing_time_ms": 3898
  }
}
```

`deal_id` is `null` when no deal was created. `deal_skipped_reason` explains why.

## Access token

A source can require a secret token. Once enabled, requests must send it as
`?token=...` or the `X-Webhook-Token` header, otherwise the webhook answers `401`.

The token lives in the source registry payload (`webhookSecret`) and is managed
from the **Access Token** card on the source detail page. The webhook URL shown
in the UI already contains the token.

## Deal automation configuration

Each source can have one deal mapping, stored as a `lead_webhook_logs` row with
`status='web_form_mapping'` and `event_id = wfm_{workspaceId}_{sourceId}`.

```json
{
  "workspace_id": 19,
  "source_id": "src_1779271704674_hmhwyxzau",
  "enabled": true,
  "pipeline_slug": "default",
  "stage": "new_lead",
  "owner_user_id": 12,
  "fields": {
    "name": "lead.name",
    "contact": "lead.email",
    "value": "budget",
    "priority": "priority",
    "expected_close_date": "close_on"
  },
  "deal_custom_fields": {
    "df_property_type": "property_type"
  }
}
```

### Field mapping

Every entry in `fields` points at a key in the submitted payload. Three reserved
keys read from the created lead instead:

| Key | Resolves to |
|---|---|
| `lead.name` | Lead name |
| `lead.email` | Lead email |
| `lead.phone` | Lead phone |

Payload keys are matched loosely: `budget_amount`, `budgetAmount` and
`Budget Amount` all resolve to the same field.

| Deal property | Falls back to | Notes |
|---|---|---|
| `name` | Lead name, then lead email | Required — the deal is skipped when empty |
| `contact` | Lead email, then lead phone | |
| `value` | `0` | The mapped value must be numeric. `1,50,000` becomes `150000`. A range such as `12 - 15 Lacs` is rejected and the deal is skipped |
| `priority` | none | Must be `low`, `medium` or `high` (case-insensitive). Anything else is ignored |
| `expected_close_date` | none | `YYYY-MM-DD` is used as is, other formats are normalised |

`deal_custom_fields` maps a deal field id (`df_...`) to a payload key. If a
mapped deal field is required for the target stage and the payload does not
carry a value, the deal is skipped with that reason.

### Rules

- One submission produces one lead and at most one deal.
- The lead is always created. A deal problem never fails the submission — it is
  recorded in `deal_skipped_reason` and in a `lead_webhook_logs` row with
  `status='web_form_deal'`.
- The deal is linked to the lead (`lead_id`) and a `deal_created` activity is
  written on the lead.
- The deal is created through `services/deals.ts` → `createDealRecord()`, the
  same code path as `POST /api/deals`.
- Deals are idempotent per submission: the deal row uses
  `event_id = deal_wf_{sourceRef}`.

## API

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/sources/:workspaceId/:sourceId/deal-mapping` | Workspace admin |
| `PUT` | `/api/sources/:workspaceId/:sourceId/deal-mapping` | Workspace admin |

`PUT` body:

```json
{
  "workspace_id": 19,
  "source_id": "src_1779271704674_hmhwyxzau",
  "enabled": true,
  "pipeline_slug": "default",
  "stage": "new_lead",
  "owner_user_id": null,
  "fields": { "name": "lead.name", "value": "budget" },
  "deal_custom_fields": {}
}
```

The route rejects an unknown pipeline, a stage that is not configured for that
pipeline, and an owner who is not a workspace member.

## Where the UI lives

`pages/SourceDetailPage.tsx` → **Deal Automation** card.
`components/WebFormDealMappingForm.tsx` renders it.

## Reading the data

Deals are stored as `lead_webhook_logs` rows with `status='deal'`, exactly like
deals created in the CRM. `GET /api/deals?workspace_id=19` returns both.

The audit trail for each submission is a `lead_webhook_logs` row with
`status='web_form_deal'` whose payload holds `deal_id`, `outcome` and `reason`.
