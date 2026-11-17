import { MetaIntegrationError, signMetaState, verifyMetaState } from './metaSecurity.js';
import { deleteIntegrationRecords, parseIntegrationPayload, readIntegrationRecords, writeIntegrationRecord } from './metaIntegrationStore.js';
import { upsertWhatsAppConfig, type WhatsAppWorkspaceConfig } from './whatsapp.js';

export function whatsappSignupSettings(workspaceId: number, userId: number) {
  const appId = process.env.WHATSAPP_APP_ID || process.env.FACEBOOK_APP_ID || '';
  const configId = process.env.WHATSAPP_CONFIG_ID || '';
  const configured = Boolean(appId && configId && (process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET));
  return {
    configured, app_id: appId, config_id: configId, version: process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0',
    ...(configured ? { state: signMetaState('whatsapp-signup', { workspaceId, userId }, 1800) } : {}),
  };
}

async function graph(path: string, token: string, params: Record<string, string> = {}, body?: unknown) {
  const url = new URL(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0'}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json() as Record<string, any>;
  if (!response.ok || result.error) throw new MetaIntegrationError('Meta could not finish WhatsApp setup. Check the account permissions and try again.', 502);
  return result;
}

export async function completeWhatsAppSignup(workspaceId: number, userId: number, input: { code: string; state: string; waba_id: string; phone_number_id: string }) {
  const state = verifyMetaState<{ workspaceId: number; userId: number; jti: string }>(input.state, 'whatsapp-signup');
  if (state.workspaceId !== workspaceId || state.userId !== userId) throw new MetaIntegrationError('Start the connection from this workspace.', 403);
  const config = whatsappSignupSettings(workspaceId, userId);
  if (!config.configured) throw new MetaIntegrationError('WhatsApp signup is not configured.', 503);
  if ((await readIntegrationRecords('whatsapp', 'wa_signup_used', workspaceId, state.jti)).length) throw new MetaIntegrationError('This connection attempt was already used. Please try again.');
  for (const row of await readIntegrationRecords('whatsapp', 'wa_signup_used', workspaceId)) {
    if (Date.parse(parseIntegrationPayload<{ expires_at: string }>(row).expires_at) < Date.now()) await deleteIntegrationRecords([row]);
  }
  await writeIntegrationRecord('whatsapp', 'wa_signup_used', workspaceId, state.jti, { expires_at: new Date(Date.now() + 1800000).toISOString() });
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
  const tokenResult = await graph('oauth/access_token', `${config.app_id}|${secret}`, { client_id: config.app_id, client_secret: secret, code: input.code });
  const token = String(tokenResult.access_token || '');
  if (!token) throw new MetaIntegrationError('Meta did not return an access token.', 502);
  const debug = (await graph('debug_token', `${config.app_id}|${secret}`, { input_token: token })).data;
  if (!debug?.is_valid || String(debug.app_id) !== config.app_id ||
      !['whatsapp_business_management', 'whatsapp_business_messaging'].every(scope => debug.scopes?.includes(scope))) {
    throw new MetaIntegrationError('Both WhatsApp management and messaging permissions are required.', 403);
  }
  const allowed = (debug.granular_scopes || []).filter((scope: { scope: string }) => scope.scope === 'whatsapp_business_management')
    .flatMap((scope: { target_ids?: string[] }) => scope.target_ids || []).map(String);
  if (!allowed.includes(input.waba_id)) throw new MetaIntegrationError('This WhatsApp account was not granted by Meta.', 403);
  let phone: { id: string; display_phone_number?: string } | undefined;
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const numbers = await graph(`${input.waba_id}/phone_numbers`, token, { fields: 'id,display_phone_number', limit: '100', ...(after ? { after } : {}) });
    phone = numbers.data?.find((item: { id: string }) => String(item.id) === input.phone_number_id);
    if (phone) break;
    after = numbers.paging?.next ? numbers.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  if (!phone) throw new MetaIntegrationError('The selected phone does not belong to this WhatsApp account.', 403);
  const connections = await readIntegrationRecords('whatsapp', 'wa_config');
  if (connections.some(row => Number(row.workspace_id) !== workspaceId && parseIntegrationPayload<WhatsAppWorkspaceConfig>(row).phone_number_id === input.phone_number_id)) {
    throw new MetaIntegrationError('This number is connected to another workspace.', 409);
  }
  const subscribed = await graph(`${input.waba_id}/subscribed_apps`, token, {}, {});
  if (subscribed.success !== true) throw new MetaIntegrationError('Meta did not confirm the WhatsApp webhook subscription.', 502);
  // New numbers may still need registration. The admin completes that separately with their own PIN.
  return upsertWhatsAppConfig(workspaceId, {
    enabled: true, phone_number_id: input.phone_number_id, waba_id: input.waba_id,
    access_token: token, display_phone: phone.display_phone_number,
  });
}
