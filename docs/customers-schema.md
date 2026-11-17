# Customers data model

Customers are a read model over existing NoCodeBackend records. A lead becomes a
customer when one of its deals reaches a stage marked as a conversion. By default,
only `won` is marked. The lead record stays in
`leads`. Customer-only details are stored separately in a profile log, while
deal amounts and conversion state continue to come from deal records.

## Persisted NoCodeBackend schema

| Table | Field | Purpose |
| --- | --- | --- |
| `lead_webhook_logs` | `id` | Deal ID and order ID |
| `lead_webhook_logs` | `workspace_id` | Tenant boundary |
| `lead_webhook_logs` | `lead_id` | Optional link to `leads.id`; zero for a standalone deal |
| `lead_webhook_logs` | `status` | `deal` identifies deal rows |
| `lead_webhook_logs` | `payload` | JSON deal fields described below |
| `leads` | `id`, `workspace_id`, `name`, `email`, `phone` | Customer identity and contact details for linked deals |
| `lead_webhook_logs` | `status = customer_profile` | Customer-specific details; one record per customer and workspace |
| `lead_webhook_logs` | `status = deal_stage_config` | One workspace-specific ordered stage list, with stable slug, name, color, and conversion flag |

The deal `payload` contains `name`, `value`, `contact`, `stage`,
`pipeline_slug`, optional `lead_id`, `created_at`, and `updated_at`. The Node
backend now also stores `won_at` when a deal first enters `won`. It keeps that
date during edits and clears it if the deal leaves `won`. Existing Won deals
without `won_at` use their last update or creation date for display.
It also stores `converted_at` when a deal enters any configured conversion stage.
Existing deals converted by a configuration change use their last update or
creation date for display. Deal stage settings are read through
`GET /api/deals/stages?workspace_id=<id>` and saved by workspace admins through
`PUT /api/deals/stages`. The backend refuses to remove a stage while deals use it.

A customer profile log has `source = customer_profile`,
`event_id = customer_profile_<lead_or_deal>_<id>`, and a JSON `payload` with
`customer_id`, optional email and phone overrides, `address`, `custom_fields`
(`label` and `value`), and `order_items` keyed by converted deal ID. Omitting email or
phone keeps the current lead value as the default. An explicit empty string
clears that value for the customer. Each ordered item has a name and quantity.
The Node backend validates the profile, limits its size, verifies workspace
access and deal ownership, and updates that customer's profile record.

## Node backend response schema

`GET /api/customers?workspace_id=<id>` is authenticated and checks membership in
that workspace. It returns only `status = deal` rows whose stage is marked as a
conversion, with the persisted row type `StoredDealLog` and response types in `types/index.ts` and
`components/types.ts`:

```text
Customer {
  id: "lead:<lead_id>" | "deal:<deal_id>"
  workspace_id: number
  lead_id?: number
  name: string
  email?: string
  phone?: string
  lead_email?: string
  lead_phone?: string
  address: string
  custom_fields: { label: string; value: string }[]
  contact: string
  order_count: number
  total_value: number
  first_won_at: string
  last_won_at: string
  orders: CustomerOrder[]
}

CustomerOrder {
  deal_id: number
  deal_name: string
  value: number
  pipeline_slug: string
  won_at: string
  items: { name: string; quantity: number }[]
}
```

`PUT /api/customers/:customerId` saves contact overrides, address, custom
fields, and items for that customer's converted deals. Lead records and deal amounts
are not modified by this endpoint.

Converted deals linked to the same lead form one customer. A standalone deal remains
its own customer because the free-text contact field is not a reliable unique
person identifier. Only deals currently in a conversion stage count toward totals. No separate
cloud table or migration is required for this read model.
