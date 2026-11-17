# Meta integration review preparation

App: **break the ice crm** (`1121383243335859`), legally operated by **Next Up Design, India**, as confirmed by the owner. The Meta business portfolio is named Scraft Studios.
Production site: https://breaktheice.in
Instagram login app: `880346581384522`.

## Current status

This is a preparation document, not evidence of Meta approval or a completed submission.
Local automated checks mock Meta and NoCodeBackend. They do not prove live delivery.
Do not submit review videos or claim successful live integration until the steps below have been demonstrated.

## Server configuration

Set only in the backend runtime environment and the gitignored local environment:

- `INSTAGRAM_APP_ID=880346581384522`
- `INSTAGRAM_APP_SECRET`: the Instagram app secret from Meta, never the frontend.
- `INSTAGRAM_REDIRECT_URI=https://api.breaktheice.in/api/instagram/oauth/callback`
- `PUBLIC_BASE_URL=https://breaktheice.in` (or equivalent `APP_BASE_URL`).
- `WHATSAPP_CONFIG_ID=1714470129642134`
- Existing `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, encryption/signing secrets and WhatsApp webhook verifier remain required.
- Optional `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. If absent, the backend derives a separate verifier using HMAC-SHA256 of `scraft-instagram-webhook-verification` with the Instagram app secret. This does not expose the app secret. Reverify the webhook if the app secret is rotated.

Meta URLs:

| Setting | Value |
| --- | --- |
| Instagram redirect | `https://api.breaktheice.in/api/instagram/oauth/callback` |
| Instagram webhook | `https://api.breaktheice.in/api/instagram/webhook` |
| Instagram deauthorization | `https://api.breaktheice.in/api/instagram/deauthorize` |
| Instagram data deletion callback, if separately supported | `https://api.breaktheice.in/api/instagram/data-deletion` |
| Parent app data deletion mode | Instructions URL |
| Parent app deletion instructions | `https://breaktheice.in/data-deletion` |
| Privacy | `https://breaktheice.in/privacy-policy` |
| Terms | `https://breaktheice.in/terms-of-service` |

Only the backend exchanges authorization codes and stores encrypted access tokens. The Instagram inbox fetches message content from Meta without persisting DM content in NoCodeBackend. Webhooks store receipt time only. Workspace administrators connect/disconnect accounts; workspace members can read and reply. The server derives the recipient and checks the 24-hour reply window before every Instagram send.

## Facebook Lead Ads dependency

The Facebook connection requests `pages_show_list`, `leads_retrieval`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads` and `ads_management`. Meta's current [lead retrieval guide](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving/) lists `ads_management` for reading ad-specific fields and complete lead/ad data. The CRM requests ad and campaign attribution when retrieving leads. Explain this dependency in App Review; do not claim that the CRM creates advertisements or manages campaign budgets. Preserve these permissions when narrowing the review draft.

## Instagram permission explanations

### instagram_business_basic

Break the ice CRM lets a workspace administrator connect an Instagram business or creator account through Instagram Login. We use this permission to identify the selected professional account and display its username in the workspace so the team knows which inbox is connected. Accounts cannot be connected to more than one workspace at a time. Administrators can disconnect the account and remove its saved connection data from the CRM.

### instagram_business_manage_messages

Businesses use the Instagram inbox in Break the ice CRM to read recent conversations initiated by Instagram users and send replies. Team members select a conversation and type a reply. The backend checks that the conversation belongs to that workspace and that the person's latest inbound message is within 24 hours. The integration does not start unsolicited Instagram conversations. We subscribe to message webhooks to record incoming activity; users refresh the inbox to retrieve current content from Meta.

### Instagram demonstration

Use only the owner-approved account **@_snack_zack_**. Obtain the user's participation for login and any new permission consent.

1. Sign in to an isolated review workspace as its administrator.
2. Open Instagram and click Connect Instagram.
3. Show Instagram Login and the basic and messaging permission consent screen.
4. Complete consent and show the account username in the CRM.
5. From a second account controlled by the owner, send a clearly labeled test DM to @_snack_zack_.
6. Refresh the CRM inbox, open that conversation and show the inbound message.
7. Reply from the CRM and show the same reply received in Instagram.
8. Show the disconnect control and explain how the administrator can remove access. Do not erase the working demo account before review unless intended.

## WhatsApp permission explanations

### whatsapp_business_messaging

Break the ice CRM allows businesses to send WhatsApp customer-service messages and approved message templates from their workspace. The business administrator connects their own WhatsApp Business account and number with Embedded Signup. The CRM sends messages using that workspace's credentials and shows delivery outcomes from signed Meta webhooks. Businesses must obtain recipient opt-in for proactive messages and use approved templates outside the customer-service window.

### whatsapp_business_management

The workspace administrator uses Embedded Signup to choose their WhatsApp Business account and phone number. The backend verifies that Meta granted access to those assets and subscribes the account to webhooks. The Templates tab reads templates and approval statuses from that account and lets administrators submit new utility or marketing templates to Meta for review. Verified new phone numbers can be registered using the administrator's own two-step verification PIN, which the CRM does not store.

### WhatsApp demonstrations

Meta requests separate demonstrations for messaging and template management.

1. Messaging: use Meta's test number and an owner-controlled test recipient explicitly supplied by the owner. Show the CRM test send and the same message received in WhatsApp. Do not message arbitrary contacts.
2. Management: open Templates, create a clearly labeled useful template using fictional example values, submit it to Meta and show its returned status. Show the same template in WhatsApp Manager if available.
3. Show the client connection flow through Embedded Signup. For a number awaiting registration, the owner enters the PIN themselves.

## Before submission

- Deploy the reviewed code and confirm both applications are healthy.
- Configure app-level secrets and exact login URLs; verify webhook challenges and signatures.
- Enable only permissions supported by the submitted use cases. Preserve existing approved lead integrations.
- Run real account login, conversation read and message delivery checks on the approved demo accounts.
- Record the demonstrations without exposing credentials or unrelated customer conversations.
- Provide a dedicated reviewer login and an isolated workspace with clear, reproducible instructions.
- Complete Access Verification using the actual service description and actual business portfolio IDs; never invent client relationships.
- Check the final App Review page for missing permission explanations, videos and reviewer access before submitting.

The app's Published badge does not establish Advanced Access approval. Meta decides approval after reviewing the actual submission.
