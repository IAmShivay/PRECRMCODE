import crypto from 'crypto';

const META_GRAPH_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0').trim();
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaSendTemplateInput {
  phoneNumberId: string;
  accessToken: string;
  toPhoneE164Digits: string;
  templateName: string;
  languageCode: string;
  bodyParameters?: string[];
}

export interface MetaSendTemplateResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string | number;
}

export interface MetaTemplateListItem {
  name: string;
  language: string;
  status: string;
  category?: string;
}

function stripNonDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export async function sendWhatsAppTextMessage(input: {
  phoneNumberId: string;
  accessToken: string;
  toPhoneE164Digits: string;
  body: string;
}): Promise<MetaSendTemplateResult> {
  const phoneNumberId = String(input.phoneNumberId || '').trim();
  const accessToken = String(input.accessToken || '').trim();
  const to = stripNonDigits(input.toPhoneE164Digits);
  const body = String(input.body || '').trim();

  if (!phoneNumberId || !accessToken || !to) {
    return {
      success: false,
      error: 'Missing phone_number_id, access token, or recipient phone',
    };
  }
  if (!body) {
    return { success: false, error: 'Message body is required' };
  }

  const url = `${META_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data?.error as Record<string, unknown> | undefined;
      const errMsg = String(errObj?.message || data?.message || `Meta API error (${response.status})`);
      const errCode = errObj?.code as string | number | undefined;
      const hint =
        errCode === 131047 || /re-engagement|24 hour|session/i.test(errMsg)
          ? ' Plain text only works if this number messaged your WhatsApp business in the last 24 hours. Otherwise use a template or send hello_world from Meta sandbox.'
          : '';
      return {
        success: false,
        error: `${errMsg}${hint}`,
        errorCode: errCode,
      };
    }

    const messages = data?.messages as Array<{ id?: string }> | undefined;
    return {
      success: true,
      messageId: messages?.[0]?.id ? String(messages[0].id) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Failed to reach Meta WhatsApp API',
    };
  }
}

export async function sendWhatsAppTemplateMessage(
  input: MetaSendTemplateInput
): Promise<MetaSendTemplateResult> {
  const phoneNumberId = String(input.phoneNumberId || '').trim();
  const accessToken = String(input.accessToken || '').trim();
  const to = stripNonDigits(input.toPhoneE164Digits);
  const templateName = String(input.templateName || '').trim();
  const languageCode = String(input.languageCode || 'en').trim() || 'en';

  if (!phoneNumberId || !accessToken || !to || !templateName) {
    return {
      success: false,
      error: 'Missing phone_number_id, access token, recipient phone, or template name',
    };
  }

  const bodyParams = (input.bodyParameters || [])
    .map((value) => String(value ?? '').trim())
    .filter((_, index, arr) => index < arr.length);

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  };

  if (bodyParams.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text: text || '-' })),
      },
    ];
  }

  const url = `${META_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template,
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data?.error as Record<string, unknown> | undefined;
      const errMsg = String(errObj?.message || data?.message || `Meta API error (${response.status})`);
      const errCode = errObj?.code as string | number | undefined;
      const hint =
        errCode === 131030 || /not in allowed list/i.test(errMsg)
          ? ' Your Meta app is still in sandbox/dev mode. Add this number as a test recipient in Meta Developer Console, or switch to a verified production phone number and system user token.'
          : errCode === 132001 || /does not exist in the translation/i.test(errMsg)
            ? ' Template name or language code mismatch. In Scraft Templates, set Meta Template Name and Language Code to exactly match WhatsApp Manager (e.g. en vs en_US).'
            : errCode === 132000 || /parameters does not match/i.test(errMsg)
              ? ' Template variable count mismatch: ensure Meta body {{1}} placeholders match {{lead.name}} entries in Scraft Templates.'
              : '';
      return {
        success: false,
        error: `${errMsg}${hint}`,
        errorCode: errCode,
      };
    }

    const messages = data?.messages as Array<{ id?: string }> | undefined;
    const messageId = messages?.[0]?.id ? String(messages[0].id) : undefined;

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Failed to reach Meta WhatsApp API',
    };
  }
}

export async function listWhatsAppMessageTemplates(
  wabaId: string,
  accessToken: string
): Promise<{ success: boolean; templates?: MetaTemplateListItem[]; error?: string }> {
  const waba = String(wabaId || '').trim();
  const token = String(accessToken || '').trim();
  if (!waba || !token) {
    return { success: false, error: 'Missing WABA ID or access token' };
  }

  const url = `${META_GRAPH_BASE}/${encodeURIComponent(waba)}/message_templates?limit=100`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data?.error as Record<string, unknown> | undefined;
      return {
        success: false,
        error: String(errObj?.message || `Meta API error (${response.status})`),
      };
    }

    const raw = (data?.data as Array<Record<string, unknown>>) || [];
    const templates: MetaTemplateListItem[] = raw.map((item) => ({
      name: String(item.name || ''),
      language: String(item.language || ''),
      status: String(item.status || ''),
      category: item.category ? String(item.category) : undefined,
    }));

    return { success: true, templates };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Failed to list Meta templates',
    };
  }
}

export function verifyMetaWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  const secret = String(appSecret || '').trim();
  if (!secret || !signatureHeader) return false;

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const provided = signatureHeader.slice(expectedPrefix.length);
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(computed, 'hex'));
  } catch {
    return false;
  }
}
