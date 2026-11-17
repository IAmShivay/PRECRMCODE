import crypto from 'node:crypto';
import { decryptConfigSecret, encryptConfigSecret } from './secureConfigCrypto.js';
import { deleteIntegrationRecords, parseIntegrationPayload, readIntegrationRecords, writeIntegrationRecord } from './metaIntegrationStore.js';
import { MetaIntegrationError, publicAppOrigin, signMetaState, verifyMetaState } from './metaSecurity.js';
import type { InstagramConnectionView, InstagramConversation, InstagramConversationPage, InstagramMessage, InstagramMessagePage } from '../types/instagram.js';

const SOURCE = 'instagram';
const CONFIG = 'ig_connection';
const OAUTH = 'ig_oauth';
const ACTIVITY = 'ig_activity';
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];
interface Connection {
  workspace_id: number;
  account_id: string;
  user_id: string;
  username: string;
  access_token_enc: string;
  expires_at: string;
  refreshed_at: string;
  last_webhook_at?: string;
}
interface OAuthState { workspaceId: number; userId: number; jti: string; }
interface OAuthRecord { state_hash: string; used: boolean; redirect_uri: string; expires_at: string; }
interface GraphPage<T> { data?: T[]; paging?: { cursors?: { after?: string }; next?: string }; }
type GraphResult = Record<string, any>;

function settings() {
  const appId = process.env.INSTAGRAM_APP_ID || '';
  const secret = process.env.INSTAGRAM_APP_SECRET || '';
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${publicAppOrigin()}/api/instagram/oauth/callback`;
  return { appId, secret, redirectUri, configured: Boolean(appId && secret) };
}

export function instagramWebhookVerifyToken(): string {
  if (process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) return process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  const secret = process.env.INSTAGRAM_APP_SECRET;
  return secret ? crypto.createHmac('sha256', secret).update('scraft-instagram-webhook-verification').digest('hex') : '';
}

async function request(url: URL, options: RequestInit = {}): Promise<GraphResult> {
  let response: globalThis.Response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new MetaIntegrationError('Instagram could not be reached. Please try again.', 502);
  }
  const data = await response.json().catch(() => ({})) as GraphResult;
  if (!response.ok || data.error || data.error_type) {
    const code = Number(data.error?.code);
    if (response.status === 429 || [4, 17, 32, 613].includes(code)) {
      throw new MetaIntegrationError('Instagram is temporarily limiting requests. Please try later.', 429);
    }
    if (code === 190 || response.status === 401) throw new MetaIntegrationError('Instagram access expired or was revoked. Please reconnect.', 409);
    // Provider error bodies can include credentials and private message text. Do not log or relay them.
    throw new MetaIntegrationError('Instagram could not complete this request. Check account permissions and try again.', 502);
  }
  return data;
}

function graph(path: string, token: string, params: Record<string, string> = {}, body?: unknown, method = body ? 'POST' : 'GET') {
  const version = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v26.0';
  const url = new URL(`https://graph.instagram.com/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return request(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function getConnection(workspaceId: number): Promise<Connection | null> {
  const row = (await readIntegrationRecords(SOURCE, CONFIG, workspaceId, `ig_ws_${workspaceId}`))[0];
  return row ? parseIntegrationPayload<Connection>(row) : null;
}

async function saveConnection(connection: Connection): Promise<void> {
  await writeIntegrationRecord(SOURCE, CONFIG, connection.workspace_id, `ig_ws_${connection.workspace_id}`, connection);
}

export async function getInstagramConnection(workspaceId: number): Promise<InstagramConnectionView> {
  const connection = await getConnection(workspaceId);
  const activity = connection ? (await readIntegrationRecords(SOURCE, ACTIVITY, workspaceId))[0] : undefined;
  return {
    configured: settings().configured, connected: Boolean(connection),
    ...(connection ? { account_id: connection.account_id, username: connection.username, expires_at: connection.expires_at,
      last_webhook_at: activity ? parseIntegrationPayload<{ last_webhook_at: string }>(activity).last_webhook_at : undefined } : {}),
  };
}

export async function startInstagramOAuth(workspaceId: number, userId: number): Promise<string> {
  const config = settings();
  if (!config.configured) throw new MetaIntegrationError('Instagram connection setup is pending. Contact your administrator.', 503);
  const state = signMetaState('instagram-connect', { workspaceId, userId });
  const parsed = verifyMetaState<OAuthState>(state, 'instagram-connect');
  // Remove expired attempts without retaining authorization codes or tokens.
  for (const row of await readIntegrationRecords(SOURCE, OAUTH, workspaceId)) {
    if (Date.parse(parseIntegrationPayload<OAuthRecord>(row).expires_at) < Date.now()) await deleteIntegrationRecords([row]);
  }
  await writeIntegrationRecord(SOURCE, OAUTH, workspaceId, parsed.jti, {
    state_hash: crypto.createHash('sha256').update(state).digest('hex'), used: false,
    redirect_uri: config.redirectUri, expires_at: new Date(Date.now() + 600_000).toISOString(),
  } satisfies OAuthRecord);
  const url = new URL('https://www.instagram.com/oauth/authorize');
  for (const [key, value] of Object.entries({ client_id: config.appId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES.join(','), state, enable_fb_login: 'false' })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function finishInstagramOAuth(workspaceId: number, userId: number, code: string, state: string): Promise<InstagramConnectionView> {
  const decoded = verifyMetaState<OAuthState>(state, 'instagram-connect');
  if (decoded.workspaceId !== workspaceId || decoded.userId !== userId) throw new MetaIntegrationError('Connect from the same workspace and account that started this request.', 403);
  const rows = await readIntegrationRecords(SOURCE, OAUTH, workspaceId, decoded.jti);
  const record = rows[0] ? parseIntegrationPayload<OAuthRecord>(rows[0]) : null;
  if (!record || record.used || record.state_hash !== crypto.createHash('sha256').update(state).digest('hex')) {
    throw new MetaIntegrationError('This connection request has already been used. Please connect again.');
  }
  await writeIntegrationRecord(SOURCE, OAUTH, workspaceId, decoded.jti, { ...record, used: true });
  const config = settings();
  const exchange = await request(new URL('https://api.instagram.com/oauth/access_token'), {
    method: 'POST', body: new URLSearchParams({ client_id: config.appId, client_secret: config.secret,
      grant_type: 'authorization_code', redirect_uri: record.redirect_uri, code }),
  });
  const short = exchange.data?.[0] || exchange;
  if (!short.access_token || !short.user_id) throw new MetaIntegrationError('Instagram did not provide an account token.', 502);
  if (short.permissions && !SCOPES.every(scope => String(short.permissions).split(',').map(s => s.trim()).includes(scope))) {
    throw new MetaIntegrationError('Allow profile and messaging permissions to connect your inbox.');
  }
  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: config.secret, access_token: short.access_token }).toString();
  const long = await request(longUrl);
  if (!long.access_token || !(Number(long.expires_in) > 0)) throw new MetaIntegrationError('Instagram did not provide a long-lived token.', 502);
  const profileResult = await graph('me', long.access_token, { fields: 'user_id,username' });
  const profile = profileResult.data?.[0] || profileResult;
  if (!profile.user_id || !profile.username) throw new MetaIntegrationError('An Instagram professional account is required.');
  const existing = await readIntegrationRecords(SOURCE, CONFIG);
  if (existing.some(row => Number(row.workspace_id) !== workspaceId && parseIntegrationPayload<Connection>(row).account_id === String(profile.user_id))) {
    throw new MetaIntegrationError('This Instagram account is connected to another workspace. Disconnect it there first.', 409);
  }
  const previous = await getConnection(workspaceId);
  if (previous && previous.account_id !== String(profile.user_id)) throw new MetaIntegrationError('Disconnect the current Instagram account before connecting another.', 409);
  const subscribed = await graph(`${encodeURIComponent(profile.user_id)}/subscribed_apps`, long.access_token, {}, { subscribed_fields: 'messages' });
  if (subscribed.success !== true) throw new MetaIntegrationError('Instagram webhook subscription was not confirmed.', 502);
  await saveConnection({ workspace_id: workspaceId, account_id: String(profile.user_id), user_id: String(short.user_id), username: profile.username,
    access_token_enc: encryptConfigSecret(long.access_token), refreshed_at: new Date().toISOString(), expires_at: new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() });
  await deleteIntegrationRecords(rows);
  return getInstagramConnection(workspaceId);
}

const refreshes = new Map<number, Promise<Connection>>();
async function activeConnection(workspaceId: number): Promise<Connection> {
  let connection = await getConnection(workspaceId);
  if (!connection) throw new MetaIntegrationError('Connect an Instagram account first.', 409);
  if (Date.parse(connection.expires_at) <= Date.now()) throw new MetaIntegrationError('Instagram access expired. Please reconnect.', 409);
  if (Date.parse(connection.expires_at) - Date.now() < 14 * 86_400_000 && Date.now() - Date.parse(connection.refreshed_at) > 86_400_000) {
    let pending = refreshes.get(workspaceId);
    if (!pending) {
      const current = connection;
      pending = (async () => {
        const url = new URL('https://graph.instagram.com/refresh_access_token');
        url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: decryptConfigSecret(current.access_token_enc) }).toString();
        const refreshed = await request(url);
        if (!refreshed.access_token || !(Number(refreshed.expires_in) > 0)) throw new MetaIntegrationError('Please reconnect Instagram.', 409);
        const updated = { ...current, access_token_enc: encryptConfigSecret(refreshed.access_token), refreshed_at: new Date().toISOString(), expires_at: new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() };
        const latest = await getConnection(workspaceId);
        if (!latest || latest.access_token_enc !== current.access_token_enc) throw new MetaIntegrationError('The Instagram connection changed. Refresh the page.', 409);
        await saveConnection(updated);
        return updated;
      })().finally(() => refreshes.delete(workspaceId));
      refreshes.set(workspaceId, pending);
    }
    connection = await pending;
  }
  return connection;
}

export async function listInstagramConversations(workspaceId: number, after?: string): Promise<InstagramConversationPage> {
  const connection = await activeConnection(workspaceId);
  const result = await graph(`${encodeURIComponent(connection.account_id)}/conversations`, decryptConfigSecret(connection.access_token_enc), {
    platform: 'instagram', fields: 'id,updated_time,participants', limit: '25', ...(after ? { after } : {}),
  }) as GraphPage<InstagramConversation>;
  return { conversations: result.data || [], ...(result.paging?.next && result.paging.cursors?.after ? { after: result.paging.cursors.after } : {}) };
}

export function instagramReplyTarget(accountId: string, messages: InstagramMessage[], now = Date.now()): string | undefined {
  const incoming = messages.filter(message => message.from?.id && message.from.id !== accountId && message.to?.data?.some(person => person.id === accountId))
    .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time))[0];
  const time = incoming ? Date.parse(incoming.created_time) : NaN;
  return incoming && time <= now && now - time < 24 * 60 * 60 * 1000 ? incoming.from.id : undefined;
}

async function readMessages(connection: Connection, conversationId: string): Promise<InstagramMessagePage> {
  const result = await graph(encodeURIComponent(conversationId), decryptConfigSecret(connection.access_token_enc), {
    fields: 'id,participants,messages.limit(20){id,created_time,from,to,message}',
  });
  const participants = result.participants?.data || [];
  if (!participants.some((person: { id: string }) => String(person.id) === connection.account_id)) {
    throw new MetaIntegrationError('This conversation does not belong to this workspace.', 403);
  }
  const messages = (result.messages?.data || []) as InstagramMessage[];
  const recipient = instagramReplyTarget(connection.account_id, messages);
  return { messages, can_reply: Boolean(recipient), ...(recipient ? { recipient_id: recipient } : {}) };
}

export async function getInstagramMessages(workspaceId: number, conversationId: string): Promise<InstagramMessagePage> {
  return readMessages(await activeConnection(workspaceId), conversationId);
}

export async function replyToInstagramConversation(workspaceId: number, conversationId: string, text: string): Promise<{ message_id: string }> {
  const connection = await activeConnection(workspaceId);
  // Derive the recipient and reply window from Meta on every send. Never trust a browser-supplied recipient.
  const page = await readMessages(connection, conversationId);
  if (!page.can_reply || !page.recipient_id) throw new MetaIntegrationError('A new message from this person is required before you can reply (24-hour window).');
  const result = await graph(`${encodeURIComponent(connection.account_id)}/messages`, decryptConfigSecret(connection.access_token_enc), {}, {
    recipient: { id: page.recipient_id }, message: { text },
  });
  if (!result.message_id) throw new MetaIntegrationError('Instagram did not confirm the message. Refresh the conversation before trying again.', 502);
  return { message_id: String(result.message_id) };
}

export async function disconnectInstagram(workspaceId: number): Promise<void> {
  // Stop local access first. No DM content is stored in our database. Meta's own conversation remains intact.
  await deleteIntegrationRecords(await readIntegrationRecords(SOURCE, CONFIG, workspaceId));
  await deleteIntegrationRecords(await readIntegrationRecords(SOURCE, OAUTH, workspaceId));
  await deleteIntegrationRecords(await readIntegrationRecords(SOURCE, ACTIVITY, workspaceId));
}

export async function deleteInstagramUserData(userId: string): Promise<void> {
  for (const row of await readIntegrationRecords(SOURCE, CONFIG)) {
    const connection = parseIntegrationPayload<Connection>(row);
    if (connection.user_id === userId || connection.account_id === userId) await disconnectInstagram(Number(row.workspace_id));
  }
}

export async function receiveInstagramWebhook(body: Record<string, unknown>): Promise<void> {
  if (body.object !== 'instagram' || !Array.isArray(body.entry)) return;
  const ids = new Set(body.entry.map(entry => String(entry?.id || '')));
  const rows = await readIntegrationRecords(SOURCE, CONFIG);
  for (const row of rows) {
    const connection = parseIntegrationPayload<Connection>(row);
    if (ids.has(connection.account_id)) {
      await writeIntegrationRecord(SOURCE, ACTIVITY, connection.workspace_id, `ig_activity_${connection.workspace_id}`, { last_webhook_at: new Date().toISOString() });
    }
  }
}
