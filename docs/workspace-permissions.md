# Workspace member permissions

Admins manage permissions under **Settings → Members**. Permissions apply to one workspace and one membership. A person can have different access in each client workspace.

| Control | Options | Scope |
| --- | --- | --- |
| Assigned deals | No access / View only / Edit and move | Regular members can see only deals whose **Assigned to** value is their user ID. |
| Workspace conversations | No access / View only / Read and reply | Instagram inbox, WhatsApp message logs and lead communication history in the workspace. |

Workspace owners and admins retain full access. Regular members without saved settings, including existing members and new invitations, default to **View only** for both controls. Admins should grant edit/reply access where needed. Existing unassigned deals remain visible to admins until assigned.

## Deal assignment

- Admins select a workspace member in **Assigned to** when creating or editing a deal. They can reassign, unassign and delete deals, and manage pipelines, stages and custom fields.
- Members with edit access can create deals assigned to themselves and edit/move their assigned deals. They cannot change assignment or delete deals.
- Viewers can open assigned deals and custom fields without changing them or dragging cards.
- Required custom fields continue to be checked before a stage change is saved.
- Customer order history and totals include only visible deals. Shared customer profile editing remains admin-only. Activity logs hide records for deals the member cannot view.

## Conversation controls

- View-only members can read conversations but cannot reply, manually trigger WhatsApp messages, start email/WhatsApp/call actions, or change communication activities.
- Deal editing and conversation replying are independent permissions.
- Connection management, templates, campaigns and bulk resend remain admin-only.
- Existing admin-configured automatic lead notifications and messaging workflows continue to run. These permissions control manual member actions.
- WhatsApp currently provides the existing message logs and manual trigger; this change does not add a new two-way WhatsApp inbox.
- Conversation access is workspace-wide, independent of deal assignment. Lead browsing and ordinary internal notes retain their existing workspace access rules.

## Persistence and enforcement

The existing NoCodeBackend `lead_webhook_logs` table stores a configuration record with `source` and `status` set to `workspace_member_permissions`. Its event ID is `member_permissions_<membership ID>_<user ID>`. The JSON payload stores the matching membership/user IDs, permissions and update time. No new table or database migration is required.

Authorization reads membership and permission records without the API cache. Deal reads also bypass the cache so reassignment is checked against the current owner. Permission changes and membership removal apply on the next backend request, including requests made with an existing token. Missing settings use the view-only default; malformed settings or unavailable permission storage fail closed. New memberships do not inherit grants from a removed membership.

The interface refreshes its access controls on focus and every 30 seconds while visible. The deal board refreshes assignment visibility at the same time and closes a deal that is no longer accessible. Old requests are cancelled when switching pipelines or workspaces. The backend checks every protected action regardless of the state of the interface.

Saving one member's permissions preserves unsaved selections for other members. Failed saves retain the current permissions; malformed or incomplete permission reads do not grant fallback access.

## Verification

```text
npx tsc -p tsconfig.json --noEmit
npm run build
npm run build:server
node --import tsx scripts/test-workspace-permissions.ts
node --import tsx scripts/test-deal-fields.ts
node --import tsx scripts/test-meta-integrations.ts
```

The permission tests use an in-memory database and a fake Meta provider, including hostile direct API calls. Optional `--serve` runs an isolated UI fixture at `http://127.0.0.1:4316/login`; fake accounts are `admin@example.test`, `designer@example.test` and `sales@example.test`, with any test password. It cannot send real messages or write to the cloud database.
