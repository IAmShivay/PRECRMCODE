# Workspace deal stages

Deal stages are shared by every pipeline in one workspace. When a workspace has
no saved configuration, `services/dealStages.ts` supplies the seven existing
stages in their original order. Only `won` counts as a conversion by default.

## NoCodeBackend storage

The workspace stage list is stored in the existing `lead_webhook_logs` table,
using its established fields. It needs no new cloud table or migration.

| Field | Value |
| --- | --- |
| `workspace_id` | Workspace that owns the configuration |
| `lead_id` | `0` |
| `status` and `source` | `deal_stage_config` |
| `event_id` | `deal_stages_<workspace_id>` |
| `payload` | JSON object with ordered `stages` array and `updated_at` |

Each stage has a stable `slug`, editable `name`, hex `color`, and boolean
`counts_as_conversion`. Renaming or reordering preserves the slug, so saved
deals remain attached to the same stage. The backend rejects duplicate names
and slugs, and refuses to remove a stage while any deal uses it.

`GET /api/deals/stages?workspace_id=<id>` requires workspace membership.
`PUT /api/deals/stages` requires a workspace admin and accepts
`{ workspace_id, stages }`. Deal creation and stage updates validate against
the saved list. When a deal is created without a stage, it enters the first
configured stage.

Customers and lead conversion reporting include deals in any stage marked as a
conversion. A deal gets `converted_at` when it enters a conversion stage.
Existing deals whose stage is later marked as a conversion use their previous
update or creation date for display. `won_at` remains for the original Won
stage and existing records.

## Deal custom fields and stage requirements

Workspace admins manage fields in **Workspace Settings → Deals**. Supported
types are text, long text, number, date, email, phone and dropdown. Every field
has a stable ID, an editable label, dropdown options, an archive flag and a list
of stage slugs in which it is required. Requirements apply to each explicitly
selected stage, across all pipelines in that workspace; they are not cumulative.
Renaming or reordering a stage does not change its requirements.

`GET /api/deals/configuration?workspace_id=<id>` returns `{ stages, fields, required_documents }`.
`PUT /api/deals/configuration` accepts `{ workspace_id, stages, fields, required_documents }` and
requires workspace admin access. Both lists are persisted in the same existing
`deal_stage_config` payload, so no NoCodeBackend table migration is needed.
Legacy stage-only API clients keep working and preserve field definitions.

```json
{
  "id": "df_purchase_order",
  "label": "Purchase order",
  "type": "text",
  "options": [],
  "required_in_stages": ["won"],
  "archived": false
}
```

Each deal's existing JSON payload now supports `custom_fields`, an object keyed
by field ID with string values. Existing deals and configurations default to
empty values/fields. Partial API updates merge provided values; an empty string
clears an optional field. Number zero is valid. Archived field values are retained
and shown read-only in the edit form. Saved field types are immutable; create a
new field for a different type. Archive fields instead of deleting them.

The backend validates types/options and required values on every create/update,
including lead-to-deal creation, direct API writes, and drag/drop. Invalid or
missing values return HTTP 422 with a message and `field_errors` keyed by field
ID, before changing the deal, conversion timestamps or stage history. Unknown
and archived field writes are rejected. Missing a new requirement does not move
or delete existing deals, but their next save must satisfy their target stage.
Removing a stage still requires moving its deals first, and removes its field
requirements. Definitions are limited to 50 fields, dropdowns to 50 options and
each value to 4,000 characters.

Validation: `node --import tsx scripts/test-deal-fields.ts` runs isolated HTTP
integration tests with in-memory persistence, never the cloud database. After
`npm run build`, adding `--serve` starts a disposable browser fixture at
`http://127.0.0.1:4316`; its fake login is documented by the script output.

## Deal documents and required paperwork

Each deal card can store file attachments (MOU, quotations, NDA scans).
Files live in Cloudinary (private delivery) under
`scraft/deals/<workspace_id>/<deal_id>/<doc_id>` and are described by
`deal_document` rows in the existing `lead_webhook_logs` table
(`lead_id` = deal ID, `event_id` = document ID, JSON payload), so no
NoCodeBackend table migration is needed. Set `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`; without them the document
endpoints return HTTP 503:

```json
{
  "id": "doc_m7abc123_xyz45678",
  "name": "Influencer-MOU-signed.pdf",
  "kind": "mou",
  "mime": "application/pdf",
  "size": 182400,
  "storage_path": "scraft/deals/57/12/doc_m7abc123_xyz45678",
  "resource_type": "raw",
  "uploaded_by": 6,
  "uploaded_at": "2026-10-09 07:00:00"
}
```

`POST /api/deals/:id/documents` accepts `{ name, kind, mime, size, data }`
with base64 file content (10 MB max; PDF, JPG, PNG, WebP, DOC, DOCX, with the
byte size verified server-side) and requires deal edit access. Uploads are
stored as private assets; `GET /api/deals/:id/documents/:docId/download`
redirects to a 15-minute signed URL and requires deal view access.
`DELETE` removes the metadata row and the Cloudinary asset, and requires deal
edit access. Deleting a deal removes its document rows and assets too.

Per-pipeline paperwork rules live beside stages and fields: the configuration
payload carries `required_documents`, a list of lowercase document kinds
(e.g. `["mou"]` for an influencer pipeline, managed in
**Workspace Settings → Deals**). Moving a deal into a conversion stage
returns HTTP 422 until every required kind is attached. Existing deals and
configurations default to no requirements.
