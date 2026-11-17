import { getWhatsAppConfig } from './whatsapp.js';
import { decryptConfigSecret } from './secureConfigCrypto.js';
import { MetaIntegrationError } from './metaSecurity.js';
import type { WhatsAppMetaTemplate, WhatsAppMetaTemplateDraft, WhatsAppPhoneStatus } from '../types/whatsappManagement.js';

async function credentials(workspaceId: number) {
  const config = await getWhatsAppConfig(workspaceId);
  if (!config?.waba_id || !config.phone_number_id || !config.access_token_enc) {
    throw new MetaIntegrationError('Connect WhatsApp first.', 409);
  }
  return { config, token: decryptConfigSecret(config.access_token_enc) };
}

async function request(path: string, token: string, params: Record<string, string> = {}, body?: unknown) {
  const url = new URL(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0'}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as Record<string, any>;
  if (!response.ok || data.error) {
    const code = Number(data.error?.code);
    if (code === 190) throw new MetaIntegrationError('WhatsApp access expired. Reconnect your account.', 409);
    if (response.status === 429 || [4, 17, 32, 613].includes(code)) throw new MetaIntegrationError('Meta is limiting requests. Please try later.', 429);
    // Do not return provider messages, which may include tokens or submitted content.
    throw new MetaIntegrationError('Meta could not complete this request. Check the account permissions and submitted details.', 502);
  }
  return data;
}

export async function listWorkspaceMetaTemplates(workspaceId: number, after?: string): Promise<{ templates: WhatsAppMetaTemplate[]; after?: string }> {
  const { config, token } = await credentials(workspaceId);
  const result = await request(`${encodeURIComponent(config.waba_id)}/message_templates`, token, {
    fields: 'id,name,language,status,category,components', limit: '25', ...(after ? { after } : {}),
  });
  return { templates: result.data || [], ...(result.paging?.next && result.paging.cursors?.after ? { after: result.paging.cursors.after } : {}) };
}

export async function createWorkspaceMetaTemplate(workspaceId: number, input: WhatsAppMetaTemplateDraft): Promise<{ id: string; status: string }> {
  const { config, token } = await credentials(workspaceId);
  const result = await request(`${encodeURIComponent(config.waba_id)}/message_templates`, token, {}, {
    name: input.name, language: input.language, category: input.category,
    components: [{ type: 'BODY', text: input.body,
      ...(input.examples.length ? { example: { body_text: [input.examples] } } : {}),
    }],
  });
  if (!result.id || !result.status) throw new MetaIntegrationError('Meta did not confirm template creation. Refresh the list before trying again.', 502);
  return { id: String(result.id), status: String(result.status) };
}

export async function getWorkspaceWhatsAppPhoneStatus(workspaceId: number): Promise<WhatsAppPhoneStatus> {
  const { config, token } = await credentials(workspaceId);
  const phone = await request(encodeURIComponent(config.phone_number_id), token, { fields: 'status,code_verification_status,display_phone_number' });
  return {
    status: String(phone.status || 'UNKNOWN'), code_verification_status: String(phone.code_verification_status || 'UNKNOWN'),
    display_phone_number: String(phone.display_phone_number || ''),
    can_register: phone.status === 'PENDING' && phone.code_verification_status === 'VERIFIED',
  };
}

export async function registerWorkspaceWhatsAppPhone(workspaceId: number, pin: string): Promise<void> {
  const status = await getWorkspaceWhatsAppPhoneStatus(workspaceId);
  if (status.status === 'CONNECTED') return;
  if (!status.can_register) throw new MetaIntegrationError('Finish phone verification in Meta before registering this number.', 409);
  const { config, token } = await credentials(workspaceId);
  const result = await request(`${encodeURIComponent(config.phone_number_id)}/register`, token, {}, { messaging_product: 'whatsapp', pin });
  if (result.success !== true) throw new MetaIntegrationError('Meta did not confirm registration. Check the number status before trying again.', 502);
  // The administrator supplies the two-step verification PIN. Never save or log it.
}
