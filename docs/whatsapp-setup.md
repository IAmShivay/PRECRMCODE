# WhatsApp Integration Setup Guide

This guide walks you through connecting your Scraft workspace to WhatsApp so that every new lead automatically receives a welcome message. You do not need any technical background to follow these steps — just take it one part at a time.

---

## Before You Start

Make sure you have the following ready before you begin:

- [ ] A **Meta Business Account** that is fully verified (visit [business.facebook.com](https://business.facebook.com) to check)
- [ ] A **WhatsApp Business phone number** registered on that account (this is the number your leads will receive messages from)
- [ ] Admin access to your **Scraft workspace**
- [ ] A computer with a web browser open to both Meta Business Manager and Scraft at the same time

> **Note:** WhatsApp messages can only be sent using approved message templates. Meta reviews and approves templates before they can be used. This process usually takes a few minutes to a few hours, but can occasionally take up to 24 hours.

---

## Part 1 — Get Your Credentials from Meta

You need three pieces of information from Meta: your **WABA ID**, your **Phone Number ID**, and an **Access Token**. Here is how to find each one.

### Step 1 — Open Meta Business Manager

1. Go to [business.facebook.com](https://business.facebook.com) in your browser.
2. Log in with the Facebook account that owns your WhatsApp Business Account.
3. In the left-hand menu, click **Business settings** (the gear icon near the bottom).

### Step 2 — Find your WABA ID

1. In Business Settings, look for **Accounts** in the left sidebar.
2. Click **WhatsApp accounts**.
3. You will see your WhatsApp Business Account listed. Click on it.
4. On the right side of the screen you will see an **Account ID** (a long number). This is your **WABA ID**. Copy it and save it somewhere — you will need it in Part 3.

### Step 3 — Find your Phone Number ID

1. Stay in Business Settings. Under **Accounts**, click **WhatsApp accounts** if it is not already open.
2. Click on your WhatsApp account, then click **Settings** or **Open in WhatsApp Manager**.
3. You are now in **WhatsApp Manager**. In the left menu, click **Phone numbers**.
4. Find your business phone number in the list. Below the phone number you will see a **Phone number ID** (another long number). Copy it and save it.

> **Watch out:** The Phone Number ID and the WABA ID are different numbers. Make sure you copy each one separately and label them clearly.

### Step 4 — Create a System User Access Token

An Access Token is like a password that allows Scraft to send messages on your behalf. You should create a **System User** token — this type of token does not expire when you log out or change your Facebook password.

1. Go back to [Business Settings](https://business.facebook.com/settings).
2. In the left sidebar, under **Users**, click **System Users**.
3. Click **Add** to create a new system user. Give it a name like `Scraft Integration`. Set the role to **Admin**. Click **Create System User**.
4. Once created, click on the system user you just made, then click **Add Assets**.
5. In the asset window, choose **Apps** on the left, find your WhatsApp app, and give it **Full control**. Click **Save changes**.
6. Still on the system user page, click **Generate new token**.
7. In the popup, select your app, then tick the permissions **whatsapp_business_messaging** and **whatsapp_business_management**.
8. Click **Generate token**. A long string of letters and numbers will appear. **Copy it immediately and save it** — Meta will not show it again after you close this window.

> **Watch out:** Do not use a short-lived token (the kind found in the API Setup page with a small lock icon). Those expire in hours. Only the system user token lasts indefinitely.

---

## Part 2 — Create Your Message Template in Meta

Before Scraft can send a WhatsApp message, Meta requires you to submit and get approval for a **message template** — a fixed message format that Meta reviews for quality and compliance.

### Step 1 — Open Message Templates

1. Go to [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/).
2. In the left menu, click **Account tools**, then click **Message templates**.
3. Click the **Create template** button (green button, top right).

### Step 2 — Fill in the template details

Fill in the form as follows:

| Field | What to enter |
|-------|---------------|
| **Category** | Marketing |
| **Name** | `new_lead_welcome` (all lowercase, underscores not spaces) |
| **Language** | English |

Click **Continue**.

### Step 3 — Write the message body

On the next screen, focus on the **Body** section. Type or paste this exact text:

```
Hi {{1}}, your request has been received. Our team will reach out to you shortly on WhatsApp.
```

The `{{1}}` is a placeholder — Scraft will automatically replace it with the lead's name when the message is sent.

> **Watch out:** Do not change `{{1}}` to anything else and do not add extra `{{2}}`, `{{3}}` etc. Scraft sends exactly one variable (the lead's name). Having a different number of placeholders will cause an error.

### Step 4 — Add a sample value

Scroll down to **Sample content** (or **Variable samples**). Meta requires you to show an example of what `{{1}}` will look like:

1. In the box next to `{{1}}`, type any first name, for example `Ahmed`.
2. This is just for Meta's review — it does not affect what gets sent to your leads.

### Step 5 — Submit for review

1. Click **Submit** (or **Submit for review**) at the bottom of the page.
2. You will be taken back to the templates list. Your new template will show a status of **Pending**.
3. Wait until the status changes to **Approved** (shown in green). This usually takes a few minutes.

> **Watch out:** Do not proceed to Part 3 or Part 4 until the template status is **Approved**. Messages will not deliver if the template is still pending or if there is an unsaved draft edit showing a "Submit for review" button.

### Step 6 — Note the exact language code

Once the template is approved, click on it to open it. Note what language is displayed (e.g. "English"). In most cases the language code you will need to enter in Scraft is `en`. If Meta shows "English (US)" then the code is `en_US`. Write down whichever one applies.

---

## Part 3 — Connect Scraft to WhatsApp

Now that you have all three credentials (WABA ID, Phone Number ID, and Access Token), you can connect your Scraft workspace.

### Step 1 — Open WhatsApp settings in Scraft

1. Log in to Scraft and go to your workspace.
2. In the left sidebar, click **Settings** (or the gear icon).
3. Click **WhatsApp** from the settings menu. The WhatsApp Integration page will open.
4. Make sure you are on the **Connect** tab.

### Step 2 — Enter your credentials

Fill in the four fields in the **Meta WhatsApp Cloud API** section:

| Field | What to enter |
|-------|---------------|
| **Phone Number ID** | The number you copied in Part 1, Step 3 |
| **WABA ID** | The number you copied in Part 1, Step 2 |
| **Access Token** | The long token you copied in Part 1, Step 4 |
| **Display Phone** | Your business phone number as you want it to appear (e.g. `+91 81550 01360`) |

> **Watch out:** The Access Token field will be blank every time you open this page after saving — this is intentional for security. Leave it blank unless you want to update the token. If you type a new token, it replaces the saved one.

### Step 3 — Enable the integration

Tick the checkbox that says **Enable WhatsApp integration for this workspace**.

### Step 4 — Save

Click **Save Connection**. You should see a success message and the header badge should change to **Connected** (shown in green).

---

## Part 4 — Match the Template in Scraft

Scraft needs to know the exact name and language of your approved Meta template so it can reference it when sending messages.

### Step 1 — Open the Templates tab

On the WhatsApp Integration page, click the **Templates** tab.

### Step 2 — Edit New Lead Welcome

Find the card titled **New Lead Welcome** and click into it.

Fill in the fields as follows:

| Field | What to enter |
|-------|---------------|
| **Meta Template Name** | `new_lead_welcome` (must match exactly — lowercase, underscores) |
| **Language Code** | The code you noted in Part 2, Step 6 (usually `en`) |
| **Message body** | `Hi {{lead.name}}, your request has been received. Our team will reach out to you shortly on WhatsApp.` |
| **Template approved in Meta Business Manager** | Tick this checkbox |
| **Enabled** | Make sure this is ticked |

> **Watch out:** The Meta Template Name must match what is shown in WhatsApp Manager exactly — including capitalisation and underscores. A single typo will cause the message to fail.

### Step 3 — Save

Click **Save Template** on the New Lead Welcome card.

---

## Part 5 — Turn On Automation

Now tell Scraft when to send WhatsApp messages automatically.

### Step 1 — Open the Triggers tab

On the WhatsApp Integration page, click the **Triggers** tab.

### Step 2 — Enable New Lead

Find the toggle labelled **New lead captured** and turn it on. This means every time a new lead is added to your workspace — whether from a form, a webhook, or manually — they will automatically receive your welcome message.

### Step 3 — Optional: Enable other triggers

You can also enable:

- **Call not answered** — sends a WhatsApp message when you click "No answer" on a lead. You can set a cooldown period (e.g. 24 hours) so the same lead is not messaged too often.
- **Lead marked as done** — sends a message when a lead's status is changed to a completed state (such as Won or Closed). Configure which statuses count as "done" using the checkboxes below this toggle.

### Step 4 — Save

Click **Save Triggers**.

---

## Part 6 — Send a Test Message

Before going live, verify that everything is working by sending yourself a test message.

### Step 1 — Go back to the Connect tab

On the WhatsApp Integration page, click the **Connect** tab and scroll down to the **Send Test Message** section.

### Step 2 — Choose Production mode

Click the **Production** option (radio button). This sends a real template message exactly as leads will receive it.

### Step 3 — Enter your phone number

In the phone field, type your own mobile number in international format, for example:
- India: `+91 98765 43210`
- Ethiopia: `+251 91 234 5678`
- UAE: `+971 50 123 4567`

Select the template to test from the dropdown — choose **New Lead Welcome**.

### Step 4 — Send and check your phone

Click **Send Test**. Within one minute you should receive a WhatsApp message that looks like:

> *Hi Test User, your request has been received. Our team will reach out to you shortly on WhatsApp.*

If you receive this message, your integration is working. New leads will now automatically receive this message.

---

## Checking Message History

To see all messages that have been sent (or attempted) from your workspace, click the **Message Log** tab on the WhatsApp Integration page.

Each row shows:

- The date and time the message was sent
- Which lead it was sent to (click a row to open that lead)
- The phone number
- The trigger that caused the send (e.g. "new lead")
- The delivery status — **delivered** or **failed**
- If it failed, the error message explaining why

If a message shows as **failed**, you will see a **Resend** button in the Actions column. Click it to try again after fixing the underlying issue.

---

## Troubleshooting

If a test message or an automated message fails, the error message in the Message Log or the toast notification will give you a clue. Here are the most common errors and what to do about them.

---

### Error: "not in allowed list" (or error code #131030)

**What it means:** Your Meta account is still in developer/sandbox mode. In sandbox mode, messages can only be sent to a small list of test phone numbers that you manually approve in Meta.

**How to fix it:**
1. Make sure you have completed Part 1, Step 4 — you must use a System User token, not a short-lived developer token.
2. Make sure your business phone number is a verified production number, not the Meta test number (which starts with `+1 555…`).
3. If you are still seeing this error after using a system user token and a real business number, contact Meta support to confirm your account has been approved for sending to general audiences.

---

### Error: "does not exist in the translation" (or error code #132001)

**What it means:** Scraft could not find a template matching the name and language you configured. This is almost always caused by one of three things:

1. **Typo in the template name** — go to Part 4 and double-check the Meta Template Name field. It must match WhatsApp Manager exactly (including underscores and lowercase).
2. **Wrong language code** — check the language code in the Templates tab. If Meta shows "English" the code is `en`; if it shows "English (US)" use `en_US`. Open the template in WhatsApp Manager and confirm.
3. **Pending unsaved edit in Meta** — if you edited the template and did not submit it for review, Meta can get confused. Go to WhatsApp Manager, open the template, and either click **Submit for review** or **Discard** to remove the draft. Then wait for it to return to **Approved** status.

---

### Error: "parameters does not match" (or error code #132000)

**What it means:** The number of variable placeholders in your Meta template does not match what Scraft is sending.

**How to fix it:**
- Open your template in WhatsApp Manager and confirm the body contains **exactly one** `{{1}}` and nothing else (no `{{2}}`, `{{3}}` etc.).
- In Scraft's Templates tab, the body should contain **exactly one** `{{lead.name}}`.
- If your Meta template has no variables at all (no `{{1}}`), remove `{{lead.name}}` from the Scraft template body as well.

---

## Frequently Asked Questions

**What is a WABA ID?**
WABA stands for WhatsApp Business Account. It is the account that holds your WhatsApp phone number and templates in Meta. The WABA ID is just the unique number Meta assigns to it.

**What is a System User?**
A System User is a special type of Meta account that represents an app or automation rather than a real person. Its access token does not expire when you change your password, which makes it safe to use for automated sending.

**Can I use a different template name?**
Yes — you can name your template anything you like in Meta (e.g. `welcome_new_client`). Just make sure you enter the exact same name in Scraft under Templates → New Lead Welcome → Meta Template Name, and that the template is approved.

**Why do I have to wait for Meta to approve my template?**
Meta reviews every template to make sure it meets their messaging policies. This protects users from spam. There is no way to skip this step — the template must show **Approved** in green before messages can be delivered.

**Can I customise the message body?**
Yes. You can edit the body text in both Meta (when creating or updating the template) and in Scraft (in the Templates tab). Just make sure the number of `{{1}}` placeholders in Meta always matches the number of `{{lead.name}}` entries in Scraft. If you change the template in Meta, submit it for review again and wait for re-approval.

**What if a lead does not receive the message?**
Check the **Message Log** tab. If the status is **failed**, read the error message for guidance. Common causes are: the lead's phone number is not a WhatsApp number, the phone number is in an unsupported format, or there is a template configuration issue. Fix the issue and click **Resend**.
