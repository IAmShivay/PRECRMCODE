import crypto from 'crypto';
import { emitAutomationEvent } from './automations/engine.js';
import { getJwtSecret } from '../utils/authHelpers.js';
import { customFieldValuesApi, customFieldsApi, leadsApi, webhookLogsApi } from './api.js';
import {
  enqueueLeadAutoReplyEmailJob,
  sendLeadNotificationForNewLead,
} from './leadAutoReplyEmail.js';
import { enqueueWhatsAppMessage } from './whatsapp.js';
import { ApiResponse, WebhookLog } from '../types/index.js';
import { getDefaultStatusIdForWorkspace } from '../utils/leadHelpers.js';
import { verifyEmail as verifyEmailAPI, isEmailValid } from './emailVerifier.js';
import { formatMySqlDateTimeUtc, validatePhone } from '../lib/validation.js';
import { deleteIntegrationRecords, parseIntegrationPayload, readIntegrationRecords } from './metaIntegrationStore.js';

const FACEBOOK_GRAPH_API_VERSION = process.env.FACEBOOK_GRAPH_API_VERSION || 'v21.0';
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
function getFacebookStateSecret(): string {
  return process.env.FACEBOOK_STATE_SECRET?.trim() || getJwtSecret();
}
const FACEBOOK_TOKEN_ENCRYPTION_SECRET =
  process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || '';

// Debug logging (only log presence, not values)
if (process.env.NODE_ENV !== 'production') {
  console.log('[Facebook] FACEBOOK_APP_ID loaded:', FACEBOOK_APP_ID ? 'YES' : 'NO');
  console.log('[Facebook] FACEBOOK_APP_SECRET loaded:', FACEBOOK_APP_SECRET ? 'YES' : 'NO');
}

const FACEBOOK_CONNECTION_STATUS = 'facebook_connection';

function getConfiguredFacebookAppId(): string {
  return process.env.FACEBOOK_APP_ID || FACEBOOK_APP_ID;
}

function getConfiguredFacebookAppSecret(): string {
  return process.env.FACEBOOK_APP_SECRET || FACEBOOK_APP_SECRET;
}

function normalizeFacebookSubscriptionFields(fields: unknown): string[] {
  if (typeof fields === 'string') {
    return fields
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
  }

  const fieldList = Array.isArray(fields) ? fields : [fields];
  return fieldList
    .map((field) => {
      if (typeof field === 'string') return field;
      if (field && typeof field === 'object') {
        const namedField = field as { name?: unknown; field?: unknown };
        return String(namedField.name || namedField.field || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeFacebookCallbackUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function hasLeadgenSubscription(subscription: FacebookAppWebhookSubscription): boolean {
  return (
    subscription.object === 'page' &&
    subscription.active !== false &&
    Array.isArray(subscription.fields) &&
    subscription.fields.includes('leadgen')
  );
}

function findMatchingLeadgenSubscription(
  subscriptions: FacebookAppWebhookSubscription[],
  callbackUrl: string
): FacebookAppWebhookSubscription | undefined {
  const expectedCallbackUrl = normalizeFacebookCallbackUrl(callbackUrl);
  return subscriptions.find(
    (subscription) =>
      hasLeadgenSubscription(subscription) &&
      normalizeFacebookCallbackUrl(subscription.callback_url) === expectedCallbackUrl
  );
}

function findDifferentLeadgenSubscription(
  subscriptions: FacebookAppWebhookSubscription[],
  callbackUrl: string
): FacebookAppWebhookSubscription | undefined {
  const expectedCallbackUrl = normalizeFacebookCallbackUrl(callbackUrl);
  return subscriptions.find(
    (subscription) =>
      hasLeadgenSubscription(subscription) &&
      normalizeFacebookCallbackUrl(subscription.callback_url) !== expectedCallbackUrl
  );
}

function buildDifferentCallbackError(
  subscription: FacebookAppWebhookSubscription,
  callbackUrl: string
): string {
  return (
    `Facebook app leadgen webhook is subscribed to ${subscription.callback_url || 'another callback URL'}, ` +
    `but this deployment expects ${callbackUrl}. Update FACEBOOK_WEBHOOK_BASE_URL/PUBLIC_BASE_URL ` +
    'or reconnect the app webhook to the current callback URL.'
  );
}

function logFacebookSyncInfo(message: string, context?: Record<string, unknown>): void {
  if (context && Object.keys(context).length > 0) {
    console.info(`[Facebook Sync] ${message}`, context);
    return;
  }
  console.info(`[Facebook Sync] ${message}`);
}

// ---------------------------------------------------------------------------
// Dedup time-window helpers  (mirrors middleware/webhook.js)
// ---------------------------------------------------------------------------
const DEDUP_WINDOW_HOURS: number = Math.max(1, Number(process.env.DEDUP_WINDOW_HOURS) || 48);
const DEDUP_WINDOW_MS: number = DEDUP_WINDOW_HOURS * 60 * 60 * 1000;

function parseDateSafe(value: unknown): Date | null {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str || str === 'null' || str === 'undefined') return null;
  const normalized = str.includes('T') ? str : `${str.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLeadSoftDeleted(lead: Record<string, unknown>): boolean {
  const deletedAt = lead.deleted_at != null ? String(lead.deleted_at).trim() : '';
  return deletedAt !== '' && deletedAt !== 'null' && deletedAt !== 'undefined';
}

function isDuplicateWithinWindow(lead: Record<string, unknown>): boolean {
  if (isLeadSoftDeleted(lead)) return false;
  const createdAt = parseDateSafe(lead.created_at);
  if (!createdAt) return true; // unparseable → preserve old dedup behaviour
  return (Date.now() - createdAt.getTime()) <= DEDUP_WINDOW_MS;
}

function resolveEmailVerificationStatus(verification: any, emailValidFlag: 0 | 1): string {
  const status =
    typeof verification?.status === 'string' ? verification.status.trim().toLowerCase() : '';
  if (status) return status;
  return emailValidFlag === 1 ? 'valid' : 'invalid';
}

async function verifyEmailForLead(email: string): Promise<{
  verification: any;
  mode: 'power' | 'quick';
  emailValidFlag: 0 | 1;
}> {
  const toLeadEmailValidFlag = (verification: any, mode: 'power' | 'quick'): 0 | 1 => {
    if (isEmailValid(verification, mode)) return 1;

    const status =
      typeof verification?.status === 'string' ? verification.status.trim().toLowerCase() : '';
    const syntaxOk = verification?.is_valid_syntax !== false;
    const notDisposable = verification?.is_disposable !== true;
    const notSpamtrap = verification?.is_spamtrap !== true;
    const treatSafeAsDeliverable =
      (status === 'safe' || status === 'valid') && syntaxOk && notDisposable && notSpamtrap;

    return treatSafeAsDeliverable ? 1 : 0;
  };

  try {
    const verification = await verifyEmailAPI(email, 'power');
    const emailValidFlag = toLeadEmailValidFlag(verification, 'power');
    return { verification, mode: 'power', emailValidFlag };
  } catch (powerError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[Facebook] Power email verification failed, falling back to quick:',
        (powerError as Error).message || powerError
      );
    }
    const verification = await verifyEmailAPI(email, 'quick');
    const emailValidFlag = toLeadEmailValidFlag(verification, 'quick');
    return { verification, mode: 'quick', emailValidFlag };
  }
}

async function persistLeadEmailVerification(
  leadId: number,
  payload: { verification: any; emailValidFlag: 0 | 1 }
): Promise<void> {
  const verificationStatus = resolveEmailVerificationStatus(
    payload.verification,
    payload.emailValidFlag
  );
  const verifiedAt = formatMySqlDateTimeUtc(new Date());

  try {
    await leadsApi.updateLead(leadId, {
      email_valid: payload.emailValidFlag,
      email_verification_status: verificationStatus,
      email_verified_at: verifiedAt,
    });
  } catch (richUpdateError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[Facebook] Failed to persist full email verification payload for lead ${leadId}, retrying with email_valid only:`,
        (richUpdateError as Error).message || richUpdateError
      );
    }
    await leadsApi.updateLead(leadId, {
      email_valid: payload.emailValidFlag,
    });
  }
}

export interface FacebookConnection {
  workspace_id: number;
  user_id: number;
  access_token: string;
  facebook_user_id?: string;
  created_at: string;
  updated_at: string;
}

function deriveAesKey(secret: string): Buffer | null {
  const s = String(secret || '').trim();
  if (!s) return null;
  return crypto.createHash('sha256').update(s).digest();
}

function encryptTokenIfPossible(token: string): string {
  const key = deriveAesKey(FACEBOOK_TOKEN_ENCRYPTION_SECRET);
  if (!key) return token;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

function decryptTokenIfPossible(stored: string): string {
  const value = String(stored || '');
  if (!value.startsWith('enc:')) return value;

  const key = deriveAesKey(FACEBOOK_TOKEN_ENCRYPTION_SECRET);
  if (!key) {
    throw new Error('Missing FACEBOOK_TOKEN_ENCRYPTION_KEY/JWT_SECRET for decrypting token');
  }

  const raw = Buffer.from(value.slice('enc:'.length), 'base64url');
  if (raw.length < 12 + 16 + 1) {
    throw new Error('Invalid encrypted token payload');
  }

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

interface FacebookStatePayload {
  workspaceId: number;
  userId: number;
  nonce: string;
  returnTo?: string;
}

interface FacebookAuthStatePayload {
  action: 'login' | 'signup';
  nonce: string;
  returnTo?: string;
}

function buildConnectionEventId(workspaceId: number, userId: number): string {
  return `fb_conn_${workspaceId}_${userId}`;
}

function isLocalHostname(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function normalizePublicBaseUrl(input: string): string {
  const trimmed = String(input || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
      url.protocol = 'https:';
      if (url.port === '80') url.port = '';
    }
    if (url.protocol === 'https:' && url.port === '443') url.port = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    if (trimmed.startsWith('http://')) {
      const withoutProtocol = trimmed.slice('http://'.length);
      const hostname = withoutProtocol.split(/[/:]/)[0] || '';
      if (!isLocalHostname(hostname)) {
        return `https://${withoutProtocol}`.replace(/\/+$/, '');
      }
    }
    return trimmed;
  }
}

function resolveFacebookOAuthBaseUrl(originBase: string): string {
  const explicit = normalizePublicBaseUrl(
    String(process.env.FACEBOOK_OAUTH_BASE_URL || process.env.FACEBOOK_REDIRECT_BASE_URL || '').trim()
  );
  if (explicit) return explicit;

  const origin = normalizePublicBaseUrl(originBase || '');
  const publicBase = normalizePublicBaseUrl(String(process.env.PUBLIC_BASE_URL || '').trim());

  if (!publicBase) return origin;
  if (!origin) return publicBase;

  try {
    const originUrl = new URL(origin);
    const publicUrl = new URL(publicBase);
    const originHost = String(originUrl.hostname || '').toLowerCase();
    const publicHost = String(publicUrl.hostname || '').toLowerCase();

    if (originHost === publicHost) return publicBase;
    if (originHost.startsWith('api.') && !publicHost.startsWith('api.')) return origin;
    return publicBase;
  } catch {
    return publicBase || origin;
  }
}

function encodeState(payload: FacebookStatePayload): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getFacebookStateSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function decodeState(state: string): FacebookStatePayload {
  const [b64, sig] = String(state || '').split('.');
  if (!b64 || !sig) {
    throw new Error('Invalid state format');
  }

  const expectedSig = crypto
    .createHmac('sha256', getFacebookStateSecret())
    .update(b64)
    .digest('base64url');

  const providedSig = Buffer.from(sig);
  const expectedSigBuffer = Buffer.from(expectedSig);
  if (
    providedSig.length !== expectedSigBuffer.length ||
    !crypto.timingSafeEqual(providedSig, expectedSigBuffer)
  ) {
    throw new Error('Invalid state signature');
  }

  const json = Buffer.from(b64, 'base64url').toString('utf8');
  const payload = JSON.parse(json) as FacebookStatePayload;

  if (
    !payload ||
    typeof payload.workspaceId !== 'number' ||
    typeof payload.userId !== 'number' ||
    !payload.nonce
  ) {
    throw new Error('Invalid state payload');
  }

  return payload;
}

export function createFacebookStateToken(workspaceId: number, userId: number, returnTo?: string): string {
  const rt = String(returnTo ?? '').trim();
  const payload: FacebookStatePayload = {
    workspaceId,
    userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    ...(rt && rt.length <= 512 ? { returnTo: rt } : {}),
  };
  return encodeState(payload);
}

export function verifyFacebookStateToken(
  state: string
): { workspaceId: number; userId: number; returnTo?: string } {
  const payload = decodeState(state);
  return { workspaceId: payload.workspaceId, userId: payload.userId, returnTo: payload.returnTo };
}

export function getFacebookRedirectUri(originBase: string): string {
  const base = resolveFacebookOAuthBaseUrl(originBase);
  if (!base) {
    throw new Error('Unable to determine PUBLIC_BASE_URL or request origin for Facebook OAuth.');
  }
  return `${base}/api/facebook/oauth/callback`;
}

export function getFacebookAuthRedirectUri(originBase: string): string {
  const base = resolveFacebookOAuthBaseUrl(originBase);
  if (!base) {
    throw new Error('Unable to determine PUBLIC_BASE_URL or request origin for Facebook OAuth.');
  }
  return `${base}/api/auth/facebook/callback`;
}

export function buildFacebookOAuthUrl(
  redirectUri: string,
  state: string
): string {
  // Re-read env variables at runtime in case they were loaded after module initialization
  const appId = getConfiguredFacebookAppId();
  const appSecret = getConfiguredFacebookAppSecret();
  
  if (!appId || !appSecret) {
    const missing: string[] = [];
    if (!appId) missing.push('FACEBOOK_APP_ID');
    if (!appSecret) missing.push('FACEBOOK_APP_SECRET');
    throw new Error(
      `Facebook app configuration is missing. Please set ${missing.join(' and ')} in your .env.local or .env file. Make sure to restart the server after adding these variables.`
    );
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: 'pages_show_list,leads_retrieval,pages_read_engagement,pages_manage_metadata,pages_manage_ads,ads_management',
    return_scopes: 'true',
    auth_type: 'rerequest',
  });

  return `https://www.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export function buildFacebookAuthOAuthUrl(
  redirectUri: string,
  state: string
): string {
  // Re-read env variables at runtime in case they were loaded after module initialization
  const appId = getConfiguredFacebookAppId();
  const appSecret = getConfiguredFacebookAppSecret();
  
  if (!appId || !appSecret) {
    const missing: string[] = [];
    if (!appId) missing.push('FACEBOOK_APP_ID');
    if (!appSecret) missing.push('FACEBOOK_APP_SECRET');
    throw new Error(
      `Facebook app configuration is missing. Please set ${missing.join(' and ')} in your .env.local or .env file. Make sure to restart the server after adding these variables.`
    );
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: 'email,public_profile',
    return_scopes: 'true',
  });

  return `https://www.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

function encodeAuthState(payload: FacebookAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getFacebookStateSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function decodeAuthState(state: string): FacebookAuthStatePayload {
  const [b64, sig] = String(state || '').split('.');
  if (!b64 || !sig) {
    throw new Error('Invalid state format');
  }

  const expectedSig = crypto
    .createHmac('sha256', getFacebookStateSecret())
    .update(b64)
    .digest('base64url');

  const providedSig = Buffer.from(sig);
  const expectedSigBuffer = Buffer.from(expectedSig);
  if (
    providedSig.length !== expectedSigBuffer.length ||
    !crypto.timingSafeEqual(providedSig, expectedSigBuffer)
  ) {
    throw new Error('Invalid state signature');
  }

  const json = Buffer.from(b64, 'base64url').toString('utf8');
  const payload = JSON.parse(json) as FacebookAuthStatePayload;

  if (
    !payload ||
    (payload.action !== 'login' && payload.action !== 'signup') ||
    !payload.nonce
  ) {
    throw new Error('Invalid state payload');
  }

  return payload;
}

export function createFacebookAuthStateToken(action: 'login' | 'signup', returnTo?: string): string {
  const rt = String(returnTo ?? '').trim();
  const payload: FacebookAuthStatePayload = {
    action,
    nonce: crypto.randomBytes(16).toString('hex'),
    ...(rt && rt.length <= 512 ? { returnTo: rt } : {}),
  };
  return encodeAuthState(payload);
}

export function verifyFacebookAuthStateToken(
  state: string
): { action: 'login' | 'signup'; returnTo?: string } {
  const payload = decodeAuthState(state);
  return { action: payload.action, returnTo: payload.returnTo };
}

export interface FacebookUserProfile {
  id: string;
  name: string;
  email?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
}

export async function getFacebookUserProfile(accessToken: string): Promise<FacebookUserProfile> {
  const data = await makeGraphApiRequest(
    `/me?fields=id,name,email,picture.type(large)`,
    accessToken,
    'GET'
  );
  return data as FacebookUserProfile;
}

interface FacebookOAuthResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
  };
  message?: string;
}

export async function exchangeCodeForUserAccessToken(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  // Re-read env variables at runtime in case they were loaded after module initialization
  const appId = getConfiguredFacebookAppId();
  const appSecret = getConfiguredFacebookAppSecret();
  
  if (!appId || !appSecret) {
    const missing: string[] = [];
    if (!appId) missing.push('FACEBOOK_APP_ID');
    if (!appSecret) missing.push('FACEBOOK_APP_SECRET');
    throw new Error(
      `Facebook app configuration is missing. Please set ${missing.join(' and ')} in your .env.local or .env file. Make sure to restart the server after adding these variables.`
    );
  }

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/oauth/access_token?${params.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const data = (await response.json()) as FacebookOAuthResponse;

  if (!response.ok || !data?.access_token) {
    const message =
      data?.error?.message ||
      data?.message ||
      `Failed to exchange Facebook OAuth code (status ${response.status})`;
    throw new Error(message);
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
  };
}

export async function exchangeForLongLivedUserAccessToken(
  shortLivedUserAccessToken: string
): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  const appId = getConfiguredFacebookAppId();
  const appSecret = getConfiguredFacebookAppSecret();

  if (!appId || !appSecret) {
    const missing: string[] = [];
    if (!appId) missing.push('FACEBOOK_APP_ID');
    if (!appSecret) missing.push('FACEBOOK_APP_SECRET');
    throw new Error(
      `Facebook app configuration is missing. Please set ${missing.join(' and ')} in your .env.local or .env file. Make sure to restart the server after adding these variables.`
    );
  }

  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedUserAccessToken,
  });

  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/oauth/access_token?${params.toString()}`;
  const response = await fetch(url, { method: 'GET' });
  const data = (await response.json()) as FacebookOAuthResponse;

  if (!response.ok || !data?.access_token) {
    const message =
      data?.error?.message ||
      data?.message ||
      `Failed to exchange Facebook token (status ${response.status})`;
    throw new Error(message);
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
  };
}

export async function getFacebookConnection(
  workspaceId: number,
  userId: number
): Promise<FacebookConnection | null> {
  const eventId = buildConnectionEventId(workspaceId, userId);
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: FACEBOOK_CONNECTION_STATUS,
    event_id: eventId,
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data || response.data.length === 0) {
    return null;
  }

  const log = Array.isArray(response.data) ? response.data[0] : (response.data as any);

  try {
    const payload = JSON.parse(log.payload || '{}') as FacebookConnection;
    if (!payload || !payload.access_token) {
      return null;
    }
    payload.access_token = decryptTokenIfPossible(payload.access_token);
    return payload;
  } catch {
    return null;
  }
}

export async function saveFacebookConnection(
  workspaceId: number,
  userId: number,
  accessToken: string
): Promise<FacebookConnection> {
  const eventId = buildConnectionEventId(workspaceId, userId);
  const now = new Date().toISOString();

  const identity = await makeGraphApiRequest('/me?fields=id', accessToken);
  if (!identity.id) throw new Error('Facebook did not return the authorizing account identity');
  const connection: FacebookConnection = {
    workspace_id: workspaceId,
    user_id: userId,
    access_token: encryptTokenIfPossible(accessToken),
    facebook_user_id: String(identity.id),
    created_at: now,
    updated_at: now,
  };

  const existing = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: FACEBOOK_CONNECTION_STATUS,
    event_id: eventId,
  })) as ApiResponse<WebhookLog[]>;

  if (existing.status === 'success' && existing.data && existing.data.length > 0) {
    const log = Array.isArray(existing.data) ? existing.data[0] : (existing.data as any);
    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: 'facebook',
      source_old: 'facebook',
      event_id: eventId,
      payload: JSON.stringify(connection),
      status: FACEBOOK_CONNECTION_STATUS,
    });
  } else {
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: 'facebook',
      source_old: 'facebook',
      event_id: eventId,
      payload: JSON.stringify(connection),
      status: FACEBOOK_CONNECTION_STATUS,
      created_at: now,
    });
  }

  return connection;
}

export async function revokeFacebookUserConnections(facebookUserId: string): Promise<void> {
  const connections = await readIntegrationRecords('facebook', FACEBOOK_CONNECTION_STATUS);
  let unresolved = false;
  for (const row of connections) {
    const connection = parseIntegrationPayload<FacebookConnection>(row);
    let identity = connection.facebook_user_id;
    if (!identity) {
      // Legacy records did not retain Meta's app-scoped identity. Debugging the existing token
      // can identify those grants without confusing a CRM user ID with a Facebook user ID.
      const url = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/debug_token`);
      url.searchParams.set('input_token', decryptTokenIfPossible(connection.access_token));
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: {
          Authorization: `Bearer ${getConfiguredFacebookAppId()}|${getConfiguredFacebookAppSecret()}`,
        } });
        const data = await response.json() as { data?: { user_id?: string }; error?: unknown };
        if (!response.ok || data.error || !data.data?.user_id) throw new Error('Unknown grant');
        identity = String(data.data.user_id);
      } catch {
        unresolved = true;
        continue;
      }
    }
    if (identity !== facebookUserId) continue;
    for (const status of ['facebook_mapping', 'fb_reconcile']) {
      const records = await readIntegrationRecords('facebook', status, connection.workspace_id);
      const owned = records.filter(record => {
        const payload = parseIntegrationPayload<{ user_id?: number; userId?: number }>(record);
        return Number(payload.user_id || payload.userId) === connection.user_id;
      });
      await deleteIntegrationRecords(owned);
    }
    // A page/form index may contain grants from several workspaces. Remove only this grant.
    for (const indexRow of await readIntegrationRecords('facebook', 'fb_map_idx')) {
      const index = parseIntegrationPayload<FacebookMappingIndex>(indexRow);
      const remaining = index.mappings.filter(mapping =>
        Number(mapping.workspace_id) !== Number(connection.workspace_id) || Number(mapping.user_id) !== Number(connection.user_id));
      if (remaining.length === index.mappings.length) continue;
      if (remaining.length === 0) await deleteIntegrationRecords([indexRow]);
      else {
        const result = await webhookLogsApi.updateWebhookLog(indexRow.id, {
          payload: JSON.stringify({ ...index, mappings: remaining, updated_at: new Date().toISOString() }),
        }) as ApiResponse;
        if (result.status !== 'success') throw new Error('Unable to remove revoked Facebook mapping');
      }
    }
    await deleteIntegrationRecords([row]);
  }
  if (unresolved) throw new Error('Unable to identify a legacy Facebook grant for revocation');
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token?: string;
}

export interface FacebookForm {
  id: string;
  name: string;
}

export interface FacebookFormField {
  name: string;
  label: string;
  type: string;
}

interface FacebookGraphApiResponse {
  error?: {
    message?: string;
    code?: number;
    type?: string;
    error_subcode?: number;
    fbtrace_id?: string;
  };
  message?: string;
  [key: string]: any;
}

function redactFacebookSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactFacebookSensitiveData(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(source)) {
    const normalizedKey = key.toLowerCase();
    const shouldRedact =
      normalizedKey.includes('token') ||
      normalizedKey.includes('secret') ||
      normalizedKey.includes('authorization') ||
      normalizedKey === 'values';

    redacted[key] = shouldRedact ? '[REDACTED]' : redactFacebookSensitiveData(nestedValue);
  }

  return redacted;
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

let graphRateLimitedUntil = 0;

export class FacebookRateLimitError extends Error {
  constructor() { super('Facebook API rate limit reached. Background sync is paused for one hour.'); }
}

async function makeGraphApiRequest(
  endpoint: string,
  accessToken: string,
  method: 'GET' | 'POST' = 'GET',
  body?: any
): Promise<any> {
  if (Date.now() < graphRateLimitedUntil) throw new FacebookRateLimitError();
  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}${endpoint}`;
  const params = new URLSearchParams();
  params.append('access_token', accessToken);
  const joiner = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${joiner}${params.toString()}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const requestOptions: RequestInit =
    method === 'GET'
      ? options
      : {
          ...options,
          body: body ? JSON.stringify(body) : undefined,
        };

  const response = await fetch(fullUrl, requestOptions);
  const rawResponseBody = await response.text();

  let data: FacebookGraphApiResponse;
  try {
    data = rawResponseBody
      ? (JSON.parse(rawResponseBody) as FacebookGraphApiResponse)
      : ({} as FacebookGraphApiResponse);
  } catch {
    console.error('[Facebook API] Failed to parse JSON response body', {
      method,
      endpoint,
      status: response.status,
      ok: response.ok,
    });
    throw new Error(`Invalid JSON from Facebook Graph API (status ${response.status})`);
  }

  console.info('[Facebook API] Response status', {
    method,
    endpoint,
    status: response.status,
    ok: response.ok,
  });
  if (!response.ok || data.error) {
    if (response.status === 429 || [4, 17, 32, 613].includes(Number(data.error?.code))) {
      graphRateLimitedUntil = Date.now() + 60 * 60 * 1000;
      throw new FacebookRateLimitError();
    }
    console.error(
      '[Facebook API] Response error payload:',
      stringifyForLog(redactFacebookSensitiveData(data.error || data))
    );

    const message =
      data.error?.message || data.message || `Facebook Graph API error (status ${response.status})`;
    throw new Error(message);
  }

  return data;
}

export async function getFacebookPages(
  accessToken: string
): Promise<FacebookPage[]> {
  const data = await makeGraphApiRequest('/me/accounts?fields=id,name,access_token', accessToken, 'GET');
  const pages: FacebookPage[] = (data.data || []).map((page: any) => ({
    id: page.id,
    name: page.name,
    access_token: page.access_token,
  }));
  return pages;
}

export async function getFacebookForms(
  pageId: string,
  pageAccessToken: string
): Promise<FacebookForm[]> {
  const data = await makeGraphApiRequest(
    `/${pageId}/leadgen_forms`,
    pageAccessToken,
    'GET'
  );
  const forms: FacebookForm[] = (data.data || []).map((form: any) => ({
    id: form.id,
    name: form.name || form.id,
  }));
  return forms;
}

export async function getFacebookFormFields(
  formId: string,
  accessToken: string
): Promise<FacebookFormField[]> {
  const data = await makeGraphApiRequest(
    `/${formId}?fields=questions`,
    accessToken,
    'GET'
  );

  const questions = data.questions || [];
  const fields: FacebookFormField[] = questions.map((q: any) => {
    // Facebook question structure: { key, label, type }
    return {
      name: q.key || q.name || '',
      label: q.label || q.name || '',
      type: q.type || 'text',
    };
  });

  return fields;
}

export async function getFacebookLeadData(
  leadgenId: string,
  accessToken: string
): Promise<any> {
  const data = await makeGraphApiRequest(
    `/${leadgenId}?fields=field_data,created_time,ad_name,campaign_name`,
    accessToken,
    'GET'
  );
  return data;
}

export async function getFacebookFormLeads(
  formId: string,
  accessToken: string,
  limit: number = 100,
  after?: string
): Promise<{
  data: any[];
  paging?: { cursors?: { after?: string }; next?: string };
}> {
  let endpoint =
    `/${formId}/leads?fields=id,created_time,field_data,ad_name,campaign_name&limit=${limit}`;
  if (after) {
    endpoint += `&after=${encodeURIComponent(after)}`;
  }

  const data = await makeGraphApiRequest(endpoint, accessToken, 'GET');
  return data;
}

const FACEBOOK_MAPPING_STATUS = 'facebook_mapping';

export interface FacebookFormMapping {
  workspace_id: number;
  user_id: number;
  page_id: string;
  form_id: string;
  form_name?: string;
  mapping_config: {
    coreFields: Record<string, string>; // Facebook field name -> CRM core field (name, email, phone, company, notes)
    customFields: Array<{
      facebookField: string;
      customFieldId: number;
      customFieldSlug?: string;
    }>;
  };
  created_at: string;
  updated_at: string;
}

function getFacebookLeadFieldMap(fbLeadData: any): Record<string, string> {
  const fieldData = Array.isArray(fbLeadData?.field_data) ? fbLeadData.field_data : [];
  const fieldMap: Record<string, string> = {};

  for (const field of fieldData) {
    const fieldName = String(field?.name || field?.key || '').trim();
    if (!fieldName) continue;

    const rawValue = Array.isArray(field?.values) ? field.values[0] : field?.values;
    fieldMap[fieldName] = rawValue == null ? '' : String(rawValue);
  }

  return fieldMap;
}

function getCustomMappingValue(
  normalizedPayload: Record<string, any>,
  customMapping: FacebookFormMapping['mapping_config']['customFields'][number]
): string {
  const facebookField = String(customMapping.facebookField || '').trim();
  const facebookFieldValue = facebookField
    ? getFacebookLeadFieldMap(normalizedPayload._facebook_data)[facebookField]
    : '';

  if (facebookFieldValue) return facebookFieldValue;

  const slug = String(customMapping.customFieldSlug || '').trim();
  const slugValue = slug ? normalizedPayload[slug] : '';
  return slugValue == null ? '' : String(slugValue);
}

function normalizeFacebookMappingConfig(
  mappingConfig: FacebookFormMapping['mapping_config'],
  customFields: any[]
): FacebookFormMapping['mapping_config'] {
  const customFieldsById = new Map<number, any>();
  for (const field of customFields) {
    const id = Number(field?.id);
    if (Number.isFinite(id)) {
      customFieldsById.set(id, field);
    }
  }

  const nextCustomFields = Array.isArray(mappingConfig?.customFields)
    ? mappingConfig.customFields
        .map((mapping) => {
          const customFieldId = Number(mapping?.customFieldId);
          if (!Number.isFinite(customFieldId) || customFieldId <= 0) return null;

          const field = customFieldsById.get(customFieldId);
          return {
            facebookField: String(mapping.facebookField || '').trim(),
            customFieldId,
            customFieldSlug: String(field?.slug || mapping.customFieldSlug || '').trim(),
          };
        })
        .filter((mapping): mapping is NonNullable<typeof mapping> => Boolean(mapping?.facebookField))
    : [];

  return {
    coreFields: mappingConfig?.coreFields || {},
    customFields: nextCustomFields,
  };
}

function buildMappingEventId(workspaceId: number, userId: number, formId: string): string {
  return `fb_form_${workspaceId}_${userId}_${formId}`;
}

export async function getFacebookFormMapping(
  workspaceId: number,
  userId: number,
  formId: string
): Promise<FacebookFormMapping | null> {
  const eventId = buildMappingEventId(workspaceId, userId, formId);
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: FACEBOOK_MAPPING_STATUS,
    event_id: eventId,
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data || response.data.length === 0) {
    return null;
  }

  const log = Array.isArray(response.data) ? response.data[0] : (response.data as any);

  try {
    const payload = JSON.parse(log.payload || '{}') as FacebookFormMapping;
    if (!payload || !payload.mapping_config) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function saveFacebookFormMapping(
  workspaceId: number,
  userId: number,
  pageId: string,
  formId: string,
  mappingConfig: FacebookFormMapping['mapping_config'],
  formName?: string
): Promise<FacebookFormMapping> {
  const eventId = buildMappingEventId(workspaceId, userId, formId);
  const now = new Date().toISOString();
  let normalizedMappingConfig = mappingConfig;

  try {
    const customFieldsResponse = await customFieldsApi.getCustomFields(workspaceId);
    const customFields = Array.isArray(customFieldsResponse?.data)
      ? customFieldsResponse.data
      : customFieldsResponse?.data
        ? [customFieldsResponse.data]
        : [];
    normalizedMappingConfig = normalizeFacebookMappingConfig(mappingConfig, customFields);
  } catch (error) {
    console.warn('[Facebook] Failed to normalize mapping custom field slugs; saving provided mapping', {
      workspaceId,
      formId,
      error: (error as Error).message || error,
    });
  }

  const mapping: FacebookFormMapping = {
    workspace_id: workspaceId,
    user_id: userId,
    page_id: pageId,
    form_id: formId,
    form_name: formName,
    mapping_config: normalizedMappingConfig,
    created_at: now,
    updated_at: now,
  };

  const existing = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: FACEBOOK_MAPPING_STATUS,
    event_id: eventId,
  })) as ApiResponse<WebhookLog[]>;

  if (existing.status === 'success' && existing.data && existing.data.length > 0) {
    const log = Array.isArray(existing.data) ? existing.data[0] : (existing.data as any);
    const existingMapping = JSON.parse(log.payload || '{}') as FacebookFormMapping;
    mapping.created_at = existingMapping.created_at || now;

    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: 'facebook',
      source_old: 'facebook',
      event_id: eventId,
      payload: JSON.stringify(mapping),
      status: FACEBOOK_MAPPING_STATUS,
    });
  } else {
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: 'facebook',
      source_old: 'facebook',
      event_id: eventId,
      payload: JSON.stringify(mapping),
      status: FACEBOOK_MAPPING_STATUS,
      created_at: now,
    });
  }

  try {
    await upsertFacebookMappingIndexEntry(mapping);
  } catch {
  }

  return mapping;
}

export async function deleteFacebookFormMapping(
  workspaceId: number,
  userId: number,
  formId: string
): Promise<void> {
  const mapping = await getFacebookFormMapping(workspaceId, userId, formId);
  const eventId = buildMappingEventId(workspaceId, userId, formId);
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: FACEBOOK_MAPPING_STATUS,
    event_id: eventId,
  })) as ApiResponse<WebhookLog[]>;

  if (response.status === 'success' && response.data && response.data.length > 0) {
    const log = Array.isArray(response.data) ? response.data[0] : (response.data as any);
    await webhookLogsApi.deleteWebhookLog(log.id);
  }

  if (mapping) {
    try {
      await removeFacebookMappingIndexEntry(workspaceId, userId, mapping.page_id, mapping.form_id);
    } catch {
    }
  }
}

export async function listFacebookFormMappings(
  workspaceId: number,
  userId?: number
): Promise<FacebookFormMapping[]> {
  const params: any = {
    workspace_id: workspaceId,
    status: FACEBOOK_MAPPING_STATUS,
  };

  const response = (await webhookLogsApi.getWebhookLogs(params)) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) {
    return [];
  }

  const logs = Array.isArray(response.data) ? response.data : [response.data];
  const mappings: FacebookFormMapping[] = [];

  for (const log of logs) {
    try {
      const payload = JSON.parse(log.payload || '{}') as FacebookFormMapping;
      if (payload && payload.mapping_config) {
        if (!userId || payload.user_id === userId) {
          mappings.push(payload);
        }
      }
    } catch {
      // Skip invalid entries
    }
  }

  return mappings;
}

/**
 * Subscribe a Facebook page to webhook notifications for leadgen events.
 * This must be called with a page access token.
 */
export async function subscribePageToWebhooks(
  pageId: string,
  pageAccessToken: string,
  webhookUrl: string,
  verifyToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const appSubscription = await subscribeAppToPageWebhooks(webhookUrl, verifyToken);
    if (!appSubscription.success) {
      return appSubscription;
    }

    const subscribeResponse = await makeGraphApiRequest(
      `/${pageId}/subscribed_apps`,
      pageAccessToken,
      'POST',
      {
        subscribed_fields: 'leadgen',
      }
    );

    // Check if subscription was successful
    if (subscribeResponse.success === true || subscribeResponse.success === 'true') {
      console.log(`[Facebook] Successfully subscribed page ${pageId} to leadgen webhooks`);
      return { success: true };
    } else {
      // Subscription might already exist, check current subscriptions
      const currentSubs = await getPageWebhookSubscriptions(pageId, pageAccessToken);
      if (currentSubs.includes('leadgen')) {
        console.log(`[Facebook] Page ${pageId} already subscribed to leadgen webhooks`);
        return { success: true };
      }
      return {
        success: false,
        error: subscribeResponse.error?.message || 'Failed to subscribe to webhooks',
      };
    }
  } catch (error: any) {
    // If error indicates already subscribed, treat as success
    if (error?.message?.includes('already subscribed') || error?.message?.includes('duplicate')) {
      return { success: true };
    }
    console.error(`[Facebook] Error subscribing page ${pageId} to webhooks:`, error);
    return {
      success: false,
      error: error?.message || 'Failed to subscribe to webhooks',
    };
  }
}

export async function subscribeAppToPageWebhooks(
  webhookUrl: string,
  verifyToken: string
): Promise<{ success: boolean; error?: string }> {
  const appId = getConfiguredFacebookAppId();
  const appSecret = getConfiguredFacebookAppSecret();
  const callbackUrl = String(webhookUrl || '').trim();
  const token = String(verifyToken || '').trim();

  try {
    if (!appId || !appSecret) {
      return { success: false, error: 'Facebook app ID/secret not configured' };
    }

    if (!callbackUrl || !token) {
      return { success: false, error: 'Facebook webhook callback URL or verify token missing' };
    }

    const subscriptionResponse = await makeGraphApiRequest(
      `/${appId}/subscriptions`,
      `${appId}|${appSecret}`,
      'POST',
      {
        object: 'page',
        fields: 'leadgen',
        callback_url: callbackUrl,
        verify_token: token,
        include_values: true,
      }
    );

    if (subscriptionResponse.success === true || subscriptionResponse.success === 'true') {
      console.log('[Facebook] Successfully subscribed app to page leadgen webhook', {
        callbackUrl,
      });
      return { success: true };
    }

    const currentSubscriptions = await getFacebookAppWebhookSubscriptions();
    const activeLeadgenSubscription = findMatchingLeadgenSubscription(
      currentSubscriptions,
      callbackUrl
    );

    if (activeLeadgenSubscription) {
      return { success: true };
    }

    const differentCallbackSubscription = findDifferentLeadgenSubscription(
      currentSubscriptions,
      callbackUrl
    );
    if (differentCallbackSubscription) {
      return {
        success: false,
        error: buildDifferentCallbackError(differentCallbackSubscription, callbackUrl),
      };
    }

    return {
      success: false,
      error: subscriptionResponse.error?.message || 'Failed to subscribe app webhook',
    };
  } catch (error: any) {
    console.error('[Facebook] Error subscribing app to page leadgen webhook:', error);
    const currentSubscriptions = await getFacebookAppWebhookSubscriptions();
    const activeLeadgenSubscription = findMatchingLeadgenSubscription(
      currentSubscriptions,
      callbackUrl
    );
    if (activeLeadgenSubscription) {
      return { success: true };
    }

    const differentCallbackSubscription = findDifferentLeadgenSubscription(
      currentSubscriptions,
      callbackUrl
    );
    if (differentCallbackSubscription) {
      return {
        success: false,
        error: buildDifferentCallbackError(differentCallbackSubscription, callbackUrl),
      };
    }

    return {
      success: false,
      error: error?.message || 'Failed to subscribe app webhook',
    };
  }
}

export interface FacebookAppWebhookSubscription {
  object?: string;
  callback_url?: string;
  fields?: string[];
  active?: boolean;
}

export async function getFacebookAppWebhookSubscriptions(): Promise<FacebookAppWebhookSubscription[]> {
  try {
    const appId = getConfiguredFacebookAppId();
    const appSecret = getConfiguredFacebookAppSecret();

    if (!appId || !appSecret) return [];

    const data = await makeGraphApiRequest(
      `/${appId}/subscriptions`,
      `${appId}|${appSecret}`,
      'GET'
    );

    const subscriptions = Array.isArray(data.data) ? data.data : [];
    return subscriptions.map((subscription: any) => ({
      object: subscription.object,
      callback_url: subscription.callback_url,
      fields: normalizeFacebookSubscriptionFields(subscription.fields),
      active: subscription.active !== false,
    }));
  } catch (error: any) {
    console.error('[Facebook] Error getting app webhook subscriptions:', error);
    return [];
  }
}

/**
 * Get current webhook subscriptions for a Facebook page.
 */
export async function getPageWebhookSubscriptions(
  pageId: string,
  pageAccessToken: string
): Promise<string[]> {
  try {
    const data = await makeGraphApiRequest(
      `/${pageId}/subscribed_apps?fields=subscribed_fields`,
      pageAccessToken,
      'GET'
    );

    const apps = data.data || [];
    const subscribedFields = new Set<string>();
    const appId = getConfiguredFacebookAppId();

    for (const app of apps) {
      if (String(app.id || '') === appId && app.subscribed_fields) {
        const fields = normalizeFacebookSubscriptionFields(app.subscribed_fields);
        fields.forEach((field: string) => subscribedFields.add(field));
      }
    }

    return Array.from(subscribedFields);
  } catch (error: any) {
    console.error(`[Facebook] Error getting webhook subscriptions for page ${pageId}:`, error);
    return [];
  }
}

/**
 * Check if a page is subscribed to leadgen webhooks.
 */
export async function isPageSubscribedToLeadgen(
  pageId: string,
  pageAccessToken: string
): Promise<boolean> {
  const subscriptions = await getPageWebhookSubscriptions(pageId, pageAccessToken);
  return subscriptions.includes('leadgen');
}

const FACEBOOK_MAPPING_INDEX_STATUS = 'fb_map_idx';

export interface FacebookMappingIndex {
  page_id: string;
  form_id: string;
  mappings: FacebookFormMapping[];
  created_at: string;
  updated_at: string;
}

function buildMappingIndexEventId(pageId: string, formId: string): string {
  return `fb_map_${pageId}_${formId}`;
}

export async function getFacebookMappingIndex(
  pageId: string,
  formId: string
): Promise<FacebookMappingIndex | null> {
  const eventId = buildMappingIndexEventId(pageId, formId);
  const response = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_MAPPING_INDEX_STATUS,
    event_id: eventId,
    limit: 1,
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data || response.data.length === 0) {
    return null;
  }

  const log = Array.isArray(response.data) ? response.data[0] : (response.data as any);
  try {
    const payload = JSON.parse(log.payload || '{}') as FacebookMappingIndex;
    if (!payload || !Array.isArray(payload.mappings)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function saveFacebookMappingIndex(
  index: FacebookMappingIndex,
  existingLog?: WebhookLog
): Promise<void> {
  const eventId = buildMappingIndexEventId(index.page_id, index.form_id);
  const existingWorkspaceId = Number((existingLog as any)?.workspace_id || 0);
  const fallbackWorkspaceId = Number((index.mappings?.[0] as any)?.workspace_id || 0);
  const workspaceId =
    Number.isFinite(existingWorkspaceId) && existingWorkspaceId > 0
      ? existingWorkspaceId
      : Number.isFinite(fallbackWorkspaceId) && fallbackWorkspaceId > 0
        ? fallbackWorkspaceId
        : 0;

  if (existingLog?.id) {
    await webhookLogsApi.updateWebhookLog(existingLog.id, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: 'facebook',
      source_old: 'facebook',
      event_id: eventId,
      payload: JSON.stringify(index),
      status: FACEBOOK_MAPPING_INDEX_STATUS,
    });
    return;
  }

  await webhookLogsApi.createWebhookLog({
    workspace_id: workspaceId,
    lead_id: 0,
    source: 'facebook',
    source_old: 'facebook',
    event_id: eventId,
    payload: JSON.stringify(index),
    status: FACEBOOK_MAPPING_INDEX_STATUS,
    created_at: new Date().toISOString(),
  });
}

export async function upsertFacebookMappingIndexEntry(mapping: FacebookFormMapping): Promise<void> {
  const eventId = buildMappingIndexEventId(mapping.page_id, mapping.form_id);
  const now = new Date().toISOString();
  const existing = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_MAPPING_INDEX_STATUS,
    event_id: eventId,
    limit: 1,
  })) as ApiResponse<WebhookLog[]>;

  const existingLog =
    existing.status === 'success' && existing.data && existing.data.length > 0
      ? (Array.isArray(existing.data) ? existing.data[0] : (existing.data as any))
      : undefined;

  let index: FacebookMappingIndex;
  if (existingLog?.payload) {
    try {
      index = JSON.parse(existingLog.payload || '{}') as FacebookMappingIndex;
    } catch {
      index = {
        page_id: mapping.page_id,
        form_id: mapping.form_id,
        mappings: [],
        created_at: now,
        updated_at: now,
      };
    }
  } else {
    index = {
      page_id: mapping.page_id,
      form_id: mapping.form_id,
      mappings: [],
      created_at: now,
      updated_at: now,
    };
  }

  const nextMappings = Array.isArray(index.mappings) ? [...index.mappings] : [];
  const existingIdx = nextMappings.findIndex(
    (m) => m.workspace_id === mapping.workspace_id && m.user_id === mapping.user_id
  );

  if (existingIdx >= 0) {
    const prev = nextMappings[existingIdx] as FacebookFormMapping | undefined;
    nextMappings[existingIdx] = {
      ...mapping,
      created_at: prev?.created_at || mapping.created_at || now,
      updated_at: now,
    };
  } else {
    nextMappings.push({
      ...mapping,
      created_at: mapping.created_at || now,
      updated_at: now,
    });
  }

  index.mappings = nextMappings;
  index.updated_at = now;

  await saveFacebookMappingIndex(index, existingLog);
}

export async function removeFacebookMappingIndexEntry(
  workspaceId: number,
  userId: number,
  pageId: string,
  formId: string
): Promise<void> {
  const eventId = buildMappingIndexEventId(pageId, formId);
  const existing = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_MAPPING_INDEX_STATUS,
    event_id: eventId,
    limit: 1,
  })) as ApiResponse<WebhookLog[]>;

  if (existing.status !== 'success' || !existing.data || existing.data.length === 0) return;

  const existingLog = Array.isArray(existing.data) ? existing.data[0] : (existing.data as any);
  let index: FacebookMappingIndex | null = null;
  try {
    index = JSON.parse(existingLog.payload || '{}') as FacebookMappingIndex;
  } catch {
    index = null;
  }
  if (!index || !Array.isArray(index.mappings)) return;

  const nextMappings = index.mappings.filter(
    (m) => !(m.workspace_id === workspaceId && m.user_id === userId)
  );

  if (nextMappings.length === 0) {
    await webhookLogsApi.deleteWebhookLog(existingLog.id);
    return;
  }

  index.mappings = nextMappings;
  index.updated_at = new Date().toISOString();
  await saveFacebookMappingIndex(index, existingLog);
}

export async function getFacebookMappingsForPageForm(
  pageId: string,
  formId: string
): Promise<FacebookFormMapping[]> {
  const index = await getFacebookMappingIndex(pageId, formId);
  if (index?.mappings?.length) return index.mappings;

  const response = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_MAPPING_STATUS,
    limit: 500,
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return [];

  const logs = Array.isArray(response.data) ? response.data : [response.data];
  const matches: FacebookFormMapping[] = [];

  for (const log of logs) {
    try {
      const payload = JSON.parse(log.payload || '{}') as FacebookFormMapping;
      if (
        payload?.mapping_config &&
        payload.page_id === pageId &&
        payload.form_id === formId
      ) {
        matches.push(payload);
      }
    } catch {
    }
  }

  if (matches.length > 0) {
    const now = new Date().toISOString();
    try {
      await saveFacebookMappingIndex(
        {
          page_id: pageId,
          form_id: formId,
          mappings: matches,
          created_at: now,
          updated_at: now,
        },
        undefined
      );
    } catch (error: any) {
      console.warn('[Facebook Sync] Failed to refresh mapping index from fallback lookup:', {
        pageId,
        formId,
        mappings: matches.length,
        error: error?.message || 'Unknown error',
      });
    }
  }

  return matches;
}

export async function getFacebookMappingsForPage(pageId: string): Promise<FacebookFormMapping[]> {
  const response = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_MAPPING_STATUS,
    limit: 1000,
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return [];

  const logs = Array.isArray(response.data) ? response.data : [response.data];
  const latestByWorkspaceUser = new Map<string, FacebookFormMapping>();

  for (const log of logs) {
    try {
      const payload = JSON.parse(log.payload || '{}') as FacebookFormMapping;
      if (!payload?.mapping_config || payload.page_id !== pageId) {
        continue;
      }

      const key = `${payload.workspace_id}:${payload.user_id}`;
      const existing = latestByWorkspaceUser.get(key);
      if (!existing) {
        latestByWorkspaceUser.set(key, payload);
        continue;
      }

      const incomingUpdated = Date.parse(payload.updated_at || payload.created_at || '');
      const existingUpdated = Date.parse(existing.updated_at || existing.created_at || '');

      if (!Number.isFinite(existingUpdated) || incomingUpdated > existingUpdated) {
        latestByWorkspaceUser.set(key, payload);
      }
    } catch {
    }
  }

  return Array.from(latestByWorkspaceUser.values());
}

export function normalizeFacebookLeadData(
  fbLeadData: any,
  mappingConfig: FacebookFormMapping['mapping_config']
): Record<string, any> {
  const normalized: Record<string, any> = {
    source: 'facebook',
    event_id: fbLeadData.id || '',
  };

  const fieldMap = getFacebookLeadFieldMap(fbLeadData);

  for (const [fbField, crmField] of Object.entries(mappingConfig.coreFields || {})) {
    const value = fieldMap[fbField];
    if (value) {
      normalized[crmField] = value;
    }
  }

  for (const customMapping of mappingConfig.customFields || []) {
    const value = fieldMap[customMapping.facebookField];
    if (value && customMapping.customFieldSlug) {
      normalized[customMapping.customFieldSlug] = value;
    }
  }

  normalized._facebook_data = fbLeadData;

  return normalized;
}

async function ensureFacebookLeadSource(workspaceId: number): Promise<string> {
  const sourceName = 'Facebook Lead Ads';
  const sourceEventId = `facebook_lead_ads_${workspaceId}`;

  try {
    const existingSources = await webhookLogsApi.getWebhookLogs({
      workspace_id: workspaceId,
      status: 'source_registry',
      event_id: sourceEventId,
    }) as ApiResponse<WebhookLog[]>;

    if (existingSources.status === 'success' && existingSources.data && existingSources.data.length > 0) {
      return sourceEventId;
    }

    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: sourceName,
      source_old: sourceName,
      event_id: sourceEventId,
      payload: JSON.stringify({ type: 'source_registry', integration: 'facebook' }),
      status: 'source_registry',
      created_at: new Date().toISOString(),
    });

    return sourceEventId;
  } catch (error) {
    console.error('[Facebook] Failed to ensure lead source:', error);
    return sourceEventId;
  }
}

export async function createLeadFromFacebookData(
  workspaceId: number,
  leadgenId: string,
  normalizedPayload: Record<string, any>,
  mappingConfig: FacebookFormMapping['mapping_config']
): Promise<{ created: boolean; leadId?: number; error?: string }> {
  try {
    logFacebookSyncInfo('Creating CRM lead from Facebook payload', {
      workspaceId,
      leadgenId,
    });

    // --- source_ref dedup (idempotency guard) ---
    // Facebook leadgenIds are truly unique per lead-gen event, so we keep this
    // check permanent (no time window).  However we skip soft-deleted leads so
    // that a user who trashed a lead can re-import it.
    try {
      const existingLeads = await leadsApi.searchLeads({
        workspace_id: workspaceId,
        source_ref: leadgenId,
      });

      if (existingLeads.status === 'success' && existingLeads.data && existingLeads.data.length > 0) {
        const candidates = Array.isArray(existingLeads.data) ? existingLeads.data : [existingLeads.data];
        const activeDuplicate = candidates.find((l: any) => !isLeadSoftDeleted(l));
        if (activeDuplicate) {
          const existingLeadId = typeof activeDuplicate === 'object' && (activeDuplicate as any).id
            ? Number((activeDuplicate as any).id)
            : undefined;
          logFacebookSyncInfo('Skipping lead creation because source_ref already exists', {
            workspaceId,
            leadgenId,
            leadId: existingLeadId,
          });
          return { created: false, leadId: existingLeadId };
        }
      }
    } catch (searchError) {
      // Log but don't fail - continue with creation attempt
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Facebook] Error checking for existing lead by source_ref:', (searchError as Error).message);
      }
    }

    // --- email dedup (time-windowed) ---
    // Only treat a lead as a duplicate if a non-deleted lead with the same
    // email was created within the configurable DEDUP_WINDOW (default 48 h).
    // This allows returning leads to create new entries while still preventing
    // rapid-fire duplicates from Facebook webhook retries.
    const trimmedEmail = String(normalizedPayload.email || '').trim();
    if (trimmedEmail) {
      try {
        const byEmail = await leadsApi.searchLeads({
          workspace_id: workspaceId,
          email: trimmedEmail,
        });
        if (byEmail.status === 'success' && byEmail.data && byEmail.data.length > 0) {
          const candidates = Array.isArray(byEmail.data) ? byEmail.data : [byEmail.data];
          const recentDuplicate = candidates.find((l: any) => isDuplicateWithinWindow(l));
          if (recentDuplicate) {
            const existingLeadId = typeof recentDuplicate === 'object' && (recentDuplicate as any).id
              ? Number((recentDuplicate as any).id)
              : undefined;
            logFacebookSyncInfo('Skipping lead creation because email already exists within dedup window', {
              workspaceId,
              leadgenId,
              leadId: existingLeadId,
              hasEmail: true,
            });
            return { created: false, leadId: existingLeadId };
          }
        }
      } catch (emailSearchError) {
        // Log but don't fail - continue with creation attempt
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Facebook] Error checking for existing lead by email:', (emailSearchError as Error).message);
        }
      }
    }

    const trimmedPhone = String(normalizedPayload.phone || '').trim();
    let normalizedPhone = '';
    let phoneValidFlag: 0 | 1 = 0;

    if (trimmedPhone) {
      const phoneValidation = validatePhone(trimmedPhone, false);
      if (phoneValidation.valid && phoneValidation.normalized) {
        normalizedPhone = phoneValidation.normalized;
        phoneValidFlag = 1;
      } else {
        console.warn('[Facebook Sync] Skipping invalid phone value from Facebook lead payload', {
          workspaceId,
          leadgenId,
          error: phoneValidation.error || 'Invalid phone format',
        });
      }
    }

    const statusId = await getDefaultStatusIdForWorkspace(workspaceId);
    const sourceEventId = await ensureFacebookLeadSource(workspaceId);
    const sourceDisplayName = 'Facebook Lead Ads';
    const leadName = normalizedPayload.name || normalizedPayload.email?.split('@')[0] || 'Unknown';

    const primaryLeadData: any = {
      workspace_id: workspaceId,
      name: leadName,
      source: `facebook_${workspaceId}_${leadgenId}`,
      source_old: sourceDisplayName,
      source_ref: leadgenId,
      source_id: sourceEventId,
      email_verification_status: 'pending',
      email_valid: 0,
      phone_valid: phoneValidFlag,
      ...(normalizedPayload.company ? { company: String(normalizedPayload.company) } : {}),
      ...(normalizedPayload.notes ? { notes: String(normalizedPayload.notes) } : {}),
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(statusId !== null ? { status_id: statusId } : {}),
    };

    const fallbackLeadData: any = {
      workspace_id: workspaceId,
      name: leadName,
      source_old: sourceDisplayName,
      source_ref: leadgenId,
      email_verification_status: 'pending',
      email_valid: 0,
      phone_valid: phoneValidFlag,
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(statusId !== null ? { status_id: statusId } : {}),
    };

    let leadResponse: any;
    let payloadMode: 'primary' | 'fallback' = 'primary';

    logFacebookSyncInfo('Attempting CRM lead insert', {
      workspaceId,
      leadgenId,
      hasEmail: Boolean(trimmedEmail),
      hasPhone: Boolean(normalizedPhone),
      phoneValid: phoneValidFlag,
      hasStatusId: statusId !== null,
      sourceId: sourceEventId,
    });

    try {
      leadResponse = await leadsApi.createLead(primaryLeadData);
    } catch (primaryError: any) {
      payloadMode = 'fallback';
      console.warn('[Facebook Sync] Primary lead create failed, retrying with minimal payload', {
        workspaceId,
        leadgenId,
        error: primaryError?.message || 'Unknown error',
      });
      leadResponse = await leadsApi.createLead(fallbackLeadData);
    }

    const isClearlySuccess =
      leadResponse.status === 'success' ||
      (leadResponse.status === 'failed' &&
        (leadResponse.message === 'Record created successfully' ||
          leadResponse.error === 'Record created successfully'));

    if (isClearlySuccess) {
      let leadId: number | null = null;

      if (leadResponse.data) {
        const raw = leadResponse.data as any;
        const parsed = Number(raw?.id ?? raw);
        leadId = Number.isFinite(parsed) ? parsed : null;
      }

      if (!leadId && leadResponse.id) {
        const parsed = Number(leadResponse.id);
        leadId = Number.isFinite(parsed) ? parsed : null;
      }

      if (!leadId) {
        try {
          const searchResponse = await leadsApi.searchLeads({
            workspace_id: workspaceId,
            source_ref: leadgenId,
          });

          if (
            searchResponse.status === 'success' &&
            Array.isArray(searchResponse.data) &&
            searchResponse.data.length > 0
          ) {
            const parsed = Number((searchResponse.data[0] as any)?.id);
            leadId = Number.isFinite(parsed) ? parsed : null;
          }
        } catch {
        }
      }

      if (!leadId) {
        throw new Error('Lead creation succeeded but no ID was returned');
      }

      if (payloadMode === 'fallback') {
        logFacebookSyncInfo('Lead inserted via fallback payload', {
          workspaceId,
          leadgenId,
          leadId,
        });
      }

      const customFields = await customFieldsApi.getCustomFields(workspaceId);
      if (customFields.status === 'success' && customFields.data) {
        const customFieldList = Array.isArray(customFields.data)
          ? customFields.data
          : [customFields.data];

        for (const customMapping of mappingConfig.customFields || []) {
          const value = getCustomMappingValue(normalizedPayload, customMapping);
          const targetFieldId = Number(customMapping.customFieldId);

          if (value && Number.isFinite(targetFieldId) && targetFieldId > 0) {
            const field = customFieldList.find((f) => Number(f.id) === targetFieldId);
            if (field) {
              try {
                await customFieldValuesApi.createCustomFieldValue({
                  lead_id: leadId,
                  field_id: targetFieldId,
                  value: String(value),
                });
              } catch (customFieldError) {
                console.error('[Facebook Sync] Failed to save custom field value', {
                  workspaceId,
                  leadgenId,
                  leadId,
                  facebookField: customMapping.facebookField,
                  customFieldId: targetFieldId,
                  error: (customFieldError as Error).message || customFieldError,
                });
              }
            }
          }
        }
      }

      if (trimmedEmail) {
        try {
          const { verification, mode, emailValidFlag } = await verifyEmailForLead(trimmedEmail);
          await persistLeadEmailVerification(leadId, { verification, emailValidFlag });

          if (process.env.NODE_ENV !== 'production') {
            console.log(`[Facebook] Email verified for lead ${leadId} (${mode}):`, {
              status: verification?.status,
              email_valid: emailValidFlag,
            });
          }
        } catch (verificationError) {
          console.error(
            `[Facebook] Email verification failed for lead ${leadId}:`,
            (verificationError as Error).message || verificationError
          );
        }
      }

      emitAutomationEvent({ workspaceId: Number(workspaceId), type: 'lead_created', leadId: Number(leadId) });

      try {
        await enqueueLeadAutoReplyEmailJob({
          workspaceId,
          leadId,
          leadName,
          leadEmail: trimmedEmail || undefined,
          leadPhone: normalizedPhone || undefined,
          leadSource: sourceDisplayName,
          leadSourceRef: leadgenId,
        });
      } catch (queueError) {
        console.error(
          `[Facebook Sync] Failed to enqueue lead auto-reply for lead ${leadId}:`,
          (queueError as Error).message || queueError
        );
      }

      void sendLeadNotificationForNewLead({
        workspaceId,
        leadId,
        leadName,
        leadEmail: trimmedEmail || undefined,
        leadPhone: normalizedPhone || undefined,
        leadSource: sourceDisplayName,
        leadSourceRef: leadgenId,
      }).then((notificationResult) => {
        if (!notificationResult.sent && notificationResult.reason) {
          console.warn(
            `[Facebook Sync] Lead notification email not sent for lead ${leadId}. Reason: ${notificationResult.reason}`
          );
        }
      }).catch((notificationError) => {
        console.error(
          `[Facebook Sync] Failed to send lead notification for lead ${leadId}:`,
          (notificationError as Error).message || notificationError
        );
      });

      void enqueueWhatsAppMessage({
        workspaceId,
        leadId,
        triggerKind: 'new_lead',
        leadName,
        leadPhone: normalizedPhone || undefined,
        leadEmail: trimmedEmail || undefined,
        leadSource: sourceDisplayName,
      }).catch((waError) => {
        console.error(
          `[Facebook Sync] Failed to enqueue WhatsApp for lead ${leadId}:`,
          (waError as Error).message || waError
        );
      });

      await webhookLogsApi.createWebhookLog({
        workspace_id: workspaceId,
        lead_id: leadId,
        source: 'facebook',
        source_old: 'facebook',
        event_id: leadgenId,
        payload: JSON.stringify(normalizedPayload),
        status: 'success',
        error: null,
        created_at: new Date().toISOString(),
      });

      logFacebookSyncInfo('Lead synced into CRM', {
        workspaceId,
        leadgenId,
        leadId,
      });

      return { created: true, leadId };
    }

    const errorMsg = leadResponse.message || leadResponse.error || 'Failed to create lead';
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: 'facebook',
      source_old: 'facebook',
      event_id: leadgenId,
      payload: JSON.stringify(normalizedPayload),
      status: 'failed',
      error: errorMsg,
      created_at: new Date().toISOString(),
    });

    console.error('[Facebook Sync] CRM lead creation failed', {
      workspaceId,
      leadgenId,
      error: errorMsg,
    });

    return { created: false, error: errorMsg };
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';

    console.error('[Facebook Sync] Unexpected error during CRM lead creation', {
      workspaceId,
      leadgenId,
      error: errorMessage,
    });
    
    // Log the error but don't throw - return gracefully
    try {
      await webhookLogsApi.createWebhookLog({
        workspace_id: workspaceId,
        lead_id: 0,
        source: 'facebook',
        source_old: 'facebook',
        event_id: leadgenId,
        payload: JSON.stringify(normalizedPayload),
        status: 'failed',
        error: errorMessage,
        created_at: new Date().toISOString(),
      });
    } catch (logError) {
      // Even logging failed, but we still want to return gracefully
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Facebook] Failed to log error:', (logError as Error).message);
      }
    }
    
    return { created: false, error: errorMessage };
  }
}

export interface FacebookLeadJobPayload {
  workspaceId: number;
  userId: number;
  leadgenId: string;
  pageId: string;
  formId: string;
  mappingConfig: FacebookFormMapping['mapping_config'];
}

export async function processFacebookLeadJob(payload: FacebookLeadJobPayload): Promise<void> {
  logFacebookSyncInfo('Processing lead sync job', {
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    pageId: payload.pageId,
    formId: payload.formId,
    leadgenId: payload.leadgenId,
  });

  const connection = await getFacebookConnection(payload.workspaceId, payload.userId);
  if (!connection?.access_token) {
    throw new Error('Facebook connection not found');
  }

  let accessToken = connection.access_token;
  if (payload.pageId) {
    const pages = await getFacebookPages(connection.access_token);
    const page = pages.find((p) => p.id === payload.pageId);
    if (!page?.access_token) {
      throw new Error('Page not found or access token unavailable');
    }
    accessToken = page.access_token;
  }

  const leadData = await getFacebookLeadData(payload.leadgenId, accessToken);
  const normalized = normalizeFacebookLeadData(leadData, payload.mappingConfig);
  const result = await createLeadFromFacebookData(
    payload.workspaceId,
    payload.leadgenId,
    normalized,
    payload.mappingConfig
  );

  if (result.error) {
    throw new Error(result.error);
  }

  if (result.created) {
    logFacebookSyncInfo('Lead sync job created a new lead', {
      workspaceId: payload.workspaceId,
      leadgenId: payload.leadgenId,
      leadId: result.leadId,
    });
  } else {
    logFacebookSyncInfo('Lead sync job resolved to existing lead', {
      workspaceId: payload.workspaceId,
      leadgenId: payload.leadgenId,
      leadId: result.leadId,
    });
  }
}

export interface FacebookImportJobPayload {
  workspaceId: number;
  userId: number;
  pageId: string;
  formId: string;
  mappingConfig: FacebookFormMapping['mapping_config'];
  after?: string;
  stats: { processed: number; created: number; duplicates: number; errors: number };
  batchSize: number;
}

export async function processFacebookImportJobBatch(
  payload: FacebookImportJobPayload
): Promise<{ done: boolean; nextAfter?: string; stats: FacebookImportJobPayload['stats'] }> {
  const connection = await getFacebookConnection(payload.workspaceId, payload.userId);
  if (!connection?.access_token) {
    throw new Error('Facebook connection not found');
  }

  const pages = await getFacebookPages(connection.access_token);
  const page = pages.find((p) => p.id === payload.pageId);
  if (!page?.access_token) {
    throw new Error('Page not found or access token unavailable');
  }

  const response = await getFacebookFormLeads(
    payload.formId,
    page.access_token,
    payload.batchSize,
    payload.after
  );
  const leads = response.data || [];
  if (leads.length === 0) {
    return { done: true, stats: payload.stats };
  }

  for (const fbLead of leads) {
    payload.stats.processed++;
    try {
      const leadgenId = fbLead.id;
      const fullLeadData = await getFacebookLeadData(leadgenId, page.access_token);
      const normalized = normalizeFacebookLeadData(fullLeadData, payload.mappingConfig);

      // createLeadFromFacebookData now handles duplicate checking internally
      const result = await createLeadFromFacebookData(
        payload.workspaceId,
        leadgenId,
        normalized,
        payload.mappingConfig
      );
      
      if (result.created) {
        payload.stats.created++;
      } else if (result.error) {
        // Only count as error if there was an actual error (not a duplicate)
        payload.stats.errors++;
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[Facebook Import] Error creating lead ${leadgenId}:`, result.error);
        }
      } else {
        // No error but not created = duplicate
        payload.stats.duplicates++;
      }
    } catch (error) {
      // Unexpected error during the process
      payload.stats.errors++;
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Facebook Import] Unexpected error processing lead:', (error as Error).message);
      }
    }
  }

  const nextAfter = response.paging?.cursors?.after;
  if (!nextAfter) {
    return { done: true, stats: payload.stats };
  }

  return { done: false, nextAfter, stats: payload.stats };
}
