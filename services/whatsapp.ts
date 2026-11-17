import { webhookLogsApi, leadActivitiesApi, leadsApi, workspacesApi } from './api.js';
import { ApiResponse, Lead, LeadStatus, WebhookLog, Workspace } from '../types/index.js';
import { decryptConfigSecret, encryptConfigSecret } from './secureConfigCrypto.js';
import { sendWhatsAppTemplateMessage, sendWhatsAppTextMessage } from './whatsappMetaApi.js';
import { validatePhone } from '../lib/validation.js';

// Status discriminators
export const WA_CONFIG_STATUS = 'wa_config';
export const WA_TRIGGER_CFG_STATUS = 'wa_trigger_cfg';
export const WA_TEMPLATE_STATUS = 'wa_tpl';
export const WA_MSG_JOB_PENDING = 'wa_msg_pending';
export const WA_MSG_JOB_PROCESSING = 'wa_msg_proc';
export const WA_MSG_JOB_COMPLETED = 'wa_msg_done';
export const WA_MSG_JOB_FAILED = 'wa_msg_failed';
export const WA_MSG_LOG_STATUS = 'wa_msg_log';
export const WA_CAMPAIGN_STATUS = 'wa_campaign';

export const WA_CONFIG_SOURCE = 'whatsapp';
export const WA_SEND_JOB_SOURCE = 'whatsapp_send';
export const WA_BULK_JOB_SOURCE = 'whatsapp_bulk';

export type WhatsAppTriggerKind =
  | 'new_lead'
  | 'hello_world'
  | 'call_no_answer'
  | 'lead_done'
  | 'bulk_marketing';

export const WHATSAPP_TRIGGER_KINDS: WhatsAppTriggerKind[] = [
  'new_lead',
  'hello_world',
  'call_no_answer',
  'lead_done',
  'bulk_marketing',
];

const WA_JOB_MAX_ATTEMPTS = toBoundedInt(process.env.WHATSAPP_JOB_MAX_ATTEMPTS, 6, 1, 20);
const WA_JOB_FETCH_LIMIT = toBoundedInt(process.env.WHATSAPP_JOB_FETCH_LIMIT, 25, 1, 100);
const WA_JOB_MAX_PAGES = toBoundedInt(process.env.WHATSAPP_JOB_MAX_PAGES, 20, 1, 50);
const WA_JOB_STALE_MS = toBoundedInt(process.env.WHATSAPP_JOB_STALE_MS, 10 * 60 * 1000, 10 * 1000, 60 * 60 * 1000);
export const WHATSAPP_JOB_POLL_ENABLED =
  String(process.env.WHATSAPP_JOB_POLL_ENABLED || 'true').trim().toLowerCase() !== 'false';
const WA_CAMPAIGN_MAX_RECIPIENTS = toBoundedInt(process.env.WHATSAPP_CAMPAIGN_MAX_RECIPIENTS, 500, 1, 5000);
const WA_CAMPAIGN_RATE_PER_SECOND = toBoundedInt(process.env.WHATSAPP_CAMPAIGN_RATE_PER_SECOND, 5, 1, 80);
const WA_NO_ANSWER_COOLDOWN_HOURS = toBoundedInt(process.env.WHATSAPP_NO_ANSWER_COOLDOWN_HOURS, 24, 1, 168);

const DEFAULT_TEMPLATES: Record<
  WhatsAppTriggerKind,
  { body: string; metaTemplateName: string; language?: string }
> = {
  new_lead: {
    metaTemplateName: 'new_lead_welcome',
    body: 'Hi {{lead.name}}, your request has been received. Our team will reach out to you shortly on WhatsApp.',
  },
  hello_world: {
    metaTemplateName: 'hello_world',
    language: 'en_US',
    body: 'Hi {{lead.name}}, welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.',
  },
  call_no_answer: {
    metaTemplateName: 'call_no_answer',
    body: 'Hi {{lead.name}}, we tried calling you but couldn\'t connect. Please reply with your availability.',
  },
  lead_done: {
    metaTemplateName: 'lead_done',
    body: 'Hi {{lead.name}}, thank you for connecting with us. We\'ve marked your request as complete.',
  },
  bulk_marketing: {
    metaTemplateName: 'marketing_promo',
    body: 'Hi {{lead.name}}, we have an update for you from {{workspace.name}}.',
  },
};

export interface WhatsAppWorkspaceConfig {
  workspace_id: number;
  enabled: boolean;
  phone_number_id: string;
  waba_id: string;
  access_token_enc: string;
  display_phone?: string;
  created_at?: string;
  updated_at: string;
}

export interface WhatsAppWorkspaceConfigMasked {
  workspace_id: number;
  enabled: boolean;
  phone_number_id: string;
  waba_id: string;
  display_phone?: string;
  connected: boolean;
  has_access_token: boolean;
  updated_at: string;
}

export interface WhatsAppTemplateConfig {
  kind: WhatsAppTriggerKind;
  enabled: boolean;
  meta_template_name: string;
  language: string;
  body: string;
  meta_approved: boolean;
  updated_at: string;
}

export interface WhatsAppTriggerConfig {
  workspace_id: number;
  new_lead: boolean;
  call_no_answer: boolean;
  lead_done: boolean;
  done_status_ids: number[];
  done_status_types: Array<'won' | 'closed' | 'lost' | 'open'>;
  no_answer_cooldown_hours: number;
  updated_at: string;
}

export interface WhatsAppSendJobPayload {
  kind: 'whatsapp_send_job';
  workspaceId: number;
  leadId: number;
  triggerKind: WhatsAppTriggerKind;
  toPhone: string;
  toPhoneDigits: string;
  lead: {
    id: number;
    name: string;
    phone: string;
    email?: string;
    source_old?: string;
  };
  campaignId?: string;
  attempts: number;
  nextRunAt: string;
  createdAt: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastErrorAt?: string;
  workerClaimId?: string;
  workerClaimedAt?: string;
  providerMessageId?: string;
}

export interface WhatsAppCampaignPayload {
  kind: 'whatsapp_campaign';
  campaignId: string;
  workspaceId: number;
  templateKind: WhatsAppTriggerKind;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  totalRecipients: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  leadIds: number[];
  createdAt: string;
  updatedAt: string;
  createdByUserId?: number;
}

export interface EnqueueWhatsAppResult {
  queued: boolean;
  reason?: string;
  eventId?: string;
}

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function toTrimmedString(value: unknown): string {
  return String(value ?? '').trim();
}

function safeJsonParse(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatMySqlDateTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function maskPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

function eventIdForConfig(workspaceId: number): string {
  return `wa_ws_${workspaceId}`;
}

function eventIdForTriggers(workspaceId: number): string {
  return `wa_triggers_ws_${workspaceId}`;
}

function eventIdForTemplate(workspaceId: number, kind: WhatsAppTriggerKind): string {
  return `wa_tpl_${kind}_ws_${workspaceId}`;
}

export function buildWhatsAppJobEventId(
  workspaceId: number,
  leadId: number,
  triggerKind: WhatsAppTriggerKind
): string {
  return `wa_send_ws${workspaceId}_lead${leadId}_${triggerKind}`;
}

function templateSourceForKind(kind: WhatsAppTriggerKind): string {
  return `whatsapp_${kind}`;
}

function resolvePathValue(context: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cursor: unknown = context;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in (cursor as object))) return '';
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor === null || cursor === undefined) return '';
  return String(cursor);
}

function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key: string) =>
    resolvePathValue(context, key)
  );
}

function extractBodyParameters(bodyTemplate: string, context: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(bodyTemplate)) !== null) {
    const key = match[1] || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys.map((key) => resolvePathValue(context, key) || '-');
}

function computeBackoffMs(attempts: number): number {
  const base = 2000;
  return Math.min(base * Math.pow(2, Math.max(0, attempts - 1)), 5 * 60 * 1000);
}

async function findWebhookLogByEvent(
  workspaceId: number,
  status: string,
  eventId: string,
  source?: string
): Promise<WebhookLog | null> {
  const params: Record<string, unknown> = {
    workspace_id: workspaceId,
    status,
    event_id: eventId,
    limit: 5,
    sort: 'id',
    order: 'desc',
    cache: 'no-store',
  };
  if (source) params.source = source;

  const response = (await webhookLogsApi.getWebhookLogs(params)) as ApiResponse<WebhookLog[]>;
  if (response.status !== 'success' || !response.data) return null;
  const logs = asArray<WebhookLog>(response.data);
  return logs[0] || null;
}

async function upsertWebhookLog(input: {
  workspaceId: number;
  status: string;
  eventId: string;
  source: string;
  payload: Record<string, unknown>;
  leadId?: number;
  error?: string | null;
}): Promise<void> {
  const existing = await findWebhookLogByEvent(input.workspaceId, input.status, input.eventId, input.source);
  const body = {
    workspace_id: input.workspaceId,
    lead_id: input.leadId || 0,
    source: input.source,
    source_old: input.source,
    event_id: input.eventId,
    payload: JSON.stringify(input.payload),
    status: input.status,
    error: input.error ?? null,
    created_at: formatMySqlDateTime(),
  };

  if (existing?.id) {
    const result = await webhookLogsApi.updateWebhookLog(Number(existing.id), body) as ApiResponse;
    if (result.status !== 'success') throw new Error('Unable to save WhatsApp configuration');
  } else {
    const result = await webhookLogsApi.createWebhookLog(body as WebhookLog) as ApiResponse;
    if (result.status !== 'success') throw new Error('Unable to save WhatsApp configuration');
  }
}

function normalizeConfig(payload: unknown, workspaceId: number): WhatsAppWorkspaceConfig | null {
  const obj = safeJsonParse(payload);
  if (!obj) return null;
  const wsId = Number(obj.workspace_id || workspaceId);
  if (!Number.isFinite(wsId) || wsId <= 0) return null;

  return {
    workspace_id: wsId,
    enabled: Boolean(obj.enabled),
    phone_number_id: toTrimmedString(obj.phone_number_id),
    waba_id: toTrimmedString(obj.waba_id),
    access_token_enc: toTrimmedString(obj.access_token_enc || obj.access_token),
    ...(toTrimmedString(obj.display_phone) ? { display_phone: toTrimmedString(obj.display_phone) } : {}),
    ...(toTrimmedString(obj.created_at) ? { created_at: toTrimmedString(obj.created_at) } : {}),
    updated_at: toTrimmedString(obj.updated_at) || new Date().toISOString(),
  };
}

function maskConfig(config: WhatsAppWorkspaceConfig): WhatsAppWorkspaceConfigMasked {
  const hasToken = Boolean(toTrimmedString(config.access_token_enc));
  return {
    workspace_id: config.workspace_id,
    enabled: config.enabled,
    phone_number_id: config.phone_number_id,
    waba_id: config.waba_id,
    ...(config.display_phone ? { display_phone: config.display_phone } : {}),
    connected: hasToken && Boolean(config.phone_number_id),
    has_access_token: hasToken,
    updated_at: config.updated_at,
  };
}

export async function getWhatsAppConfig(workspaceId: number): Promise<WhatsAppWorkspaceConfig | null> {
  const log = await findWebhookLogByEvent(workspaceId, WA_CONFIG_STATUS, eventIdForConfig(workspaceId), WA_CONFIG_SOURCE);
  if (!log?.payload) return null;
  return normalizeConfig(log.payload, workspaceId);
}

export async function getWhatsAppConfigMasked(workspaceId: number): Promise<WhatsAppWorkspaceConfigMasked | null> {
  const config = await getWhatsAppConfig(workspaceId);
  if (!config) return null;
  return maskConfig(config);
}

export async function upsertWhatsAppConfig(
  workspaceId: number,
  input: {
    enabled?: boolean;
    phone_number_id?: string;
    waba_id?: string;
    access_token?: string;
    display_phone?: string;
  }
): Promise<WhatsAppWorkspaceConfigMasked> {
  const existing = await getWhatsAppConfig(workspaceId);
  const nowIso = new Date().toISOString();

  let accessTokenEnc = existing?.access_token_enc || '';
  const newToken = toTrimmedString(input.access_token);
  if (newToken && !newToken.startsWith('***')) {
    accessTokenEnc = encryptConfigSecret(newToken);
  }

  const config: WhatsAppWorkspaceConfig = {
    workspace_id: workspaceId,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : (existing?.enabled ?? false),
    phone_number_id: toTrimmedString(input.phone_number_id) || existing?.phone_number_id || '',
    waba_id: toTrimmedString(input.waba_id) || existing?.waba_id || '',
    access_token_enc: accessTokenEnc,
    display_phone: toTrimmedString(input.display_phone) || existing?.display_phone,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
  };

  await upsertWebhookLog({
    workspaceId,
    status: WA_CONFIG_STATUS,
    eventId: eventIdForConfig(workspaceId),
    source: WA_CONFIG_SOURCE,
    payload: config as unknown as Record<string, unknown>,
  });

  return maskConfig(config);
}

function normalizeTriggerConfig(payload: unknown, workspaceId: number): WhatsAppTriggerConfig {
  const obj = safeJsonParse(payload) || {};
  const doneIds = asArray<unknown>(obj.done_status_ids)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  const doneTypes = asArray<string>(obj.done_status_types).filter((t): t is 'won' | 'closed' | 'lost' | 'open' =>
    ['won', 'closed', 'lost', 'open'].includes(t)
  );

  return {
    workspace_id: workspaceId,
    new_lead: obj.new_lead !== undefined ? Boolean(obj.new_lead) : true,
    call_no_answer: obj.call_no_answer !== undefined ? Boolean(obj.call_no_answer) : true,
    lead_done: obj.lead_done !== undefined ? Boolean(obj.lead_done) : false,
    done_status_ids: doneIds,
    done_status_types: doneTypes.length > 0 ? doneTypes : ['won', 'closed'],
    no_answer_cooldown_hours: toBoundedInt(
      obj.no_answer_cooldown_hours,
      WA_NO_ANSWER_COOLDOWN_HOURS,
      1,
      168
    ),
    updated_at: toTrimmedString(obj.updated_at) || new Date().toISOString(),
  };
}

export async function getWhatsAppTriggerConfig(workspaceId: number): Promise<WhatsAppTriggerConfig> {
  const log = await findWebhookLogByEvent(
    workspaceId,
    WA_TRIGGER_CFG_STATUS,
    eventIdForTriggers(workspaceId),
    WA_CONFIG_SOURCE
  );
  if (!log?.payload) {
    return normalizeTriggerConfig(null, workspaceId);
  }
  return normalizeTriggerConfig(log.payload, workspaceId);
}

export async function upsertWhatsAppTriggerConfig(
  workspaceId: number,
  input: Partial<Omit<WhatsAppTriggerConfig, 'workspace_id' | 'updated_at'>>
): Promise<WhatsAppTriggerConfig> {
  const existing = await getWhatsAppTriggerConfig(workspaceId);
  const config: WhatsAppTriggerConfig = {
    ...existing,
    ...input,
    workspace_id: workspaceId,
    done_status_ids: input.done_status_ids ?? existing.done_status_ids,
    done_status_types: input.done_status_types ?? existing.done_status_types,
    updated_at: new Date().toISOString(),
  };

  await upsertWebhookLog({
    workspaceId,
    status: WA_TRIGGER_CFG_STATUS,
    eventId: eventIdForTriggers(workspaceId),
    source: WA_CONFIG_SOURCE,
    payload: config as unknown as Record<string, unknown>,
  });

  return config;
}

function normalizeTemplate(_payload: unknown, _workspaceId: number, kind: WhatsAppTriggerKind): WhatsAppTemplateConfig {
  const obj = safeJsonParse(_payload) || {};
  const defaults = DEFAULT_TEMPLATES[kind];
  return {
    kind,
    enabled:
      obj.enabled !== undefined
        ? Boolean(obj.enabled)
        : kind === 'new_lead' || kind === 'hello_world',
    meta_template_name: toTrimmedString(obj.meta_template_name) || defaults.metaTemplateName,
    language: toTrimmedString(obj.language) || defaults.language || 'en',
    body: toTrimmedString(obj.body) || defaults.body,
    meta_approved: Boolean(obj.meta_approved),
    updated_at: toTrimmedString(obj.updated_at) || new Date().toISOString(),
  };
}

export async function getWhatsAppTemplate(
  workspaceId: number,
  kind: WhatsAppTriggerKind
): Promise<WhatsAppTemplateConfig> {
  const log = await findWebhookLogByEvent(
    workspaceId,
    WA_TEMPLATE_STATUS,
    eventIdForTemplate(workspaceId, kind),
    templateSourceForKind(kind)
  );
  if (!log?.payload) return normalizeTemplate(null, workspaceId, kind);
  return normalizeTemplate(log.payload, workspaceId, kind);
}

export async function getAllWhatsAppTemplates(workspaceId: number): Promise<WhatsAppTemplateConfig[]> {
  return Promise.all(WHATSAPP_TRIGGER_KINDS.map((kind) => getWhatsAppTemplate(workspaceId, kind)));
}

export async function upsertWhatsAppTemplate(
  workspaceId: number,
  kind: WhatsAppTriggerKind,
  input: Partial<Omit<WhatsAppTemplateConfig, 'kind' | 'updated_at'>>
): Promise<WhatsAppTemplateConfig> {
  const existing = await getWhatsAppTemplate(workspaceId, kind);
  const template: WhatsAppTemplateConfig = {
    ...existing,
    ...input,
    kind,
    updated_at: new Date().toISOString(),
  };

  await upsertWebhookLog({
    workspaceId,
    status: WA_TEMPLATE_STATUS,
    eventId: eventIdForTemplate(workspaceId, kind),
    source: templateSourceForKind(kind),
    payload: template as unknown as Record<string, unknown>,
  });

  return template;
}

function getDecryptedAccessToken(config: WhatsAppWorkspaceConfig): string {
  const enc = toTrimmedString(config.access_token_enc);
  if (!enc) return '';
  try {
    return decryptConfigSecret(enc);
  } catch {
    return enc.startsWith('enc:') ? '' : enc;
  }
}

export async function isWhatsAppReady(workspaceId: number, triggerKind: WhatsAppTriggerKind): Promise<boolean> {
  const config = await getWhatsAppConfig(workspaceId);
  if (!config?.enabled || !config.phone_number_id || !getDecryptedAccessToken(config)) return false;

  const template = await getWhatsAppTemplate(workspaceId, triggerKind);
  if (!template.enabled || !template.meta_template_name) return false;

  const triggers = await getWhatsAppTriggerConfig(workspaceId);
  if (triggerKind === 'new_lead' && !triggers.new_lead) return false;
  if (triggerKind === 'call_no_answer' && !triggers.call_no_answer) return false;
  if (triggerKind === 'lead_done' && !triggers.lead_done) return false;

  return true;
}

async function hasBlockingWhatsAppJob(
  workspaceId: number,
  eventId: string,
  triggerKind: WhatsAppTriggerKind,
  cooldownHours?: number,
  forceResend = false
): Promise<boolean> {
  const pendingOrProcessing = [WA_MSG_JOB_PENDING, WA_MSG_JOB_PROCESSING];
  for (const status of pendingOrProcessing) {
    const log = await findWebhookLogByEvent(workspaceId, status, eventId, WA_SEND_JOB_SOURCE);
    if (log) return true;
  }

  if (forceResend) return false;

  const completedLog = await findWebhookLogByEvent(
    workspaceId,
    WA_MSG_JOB_COMPLETED,
    eventId,
    WA_SEND_JOB_SOURCE
  );
  if (!completedLog) return false;

  if (triggerKind === 'call_no_answer' && cooldownHours) {
    const payload = safeJsonParse(completedLog.payload);
    const completedAt = payload?.lastCompletedAt
      ? Date.parse(String(payload.lastCompletedAt))
      : completedLog.created_at
        ? Date.parse(String(completedLog.created_at))
        : NaN;
    if (Number.isFinite(completedAt) && Date.now() - completedAt > cooldownHours * 60 * 60 * 1000) {
      return false;
    }
  }

  return triggerKind === 'call_no_answer' || Boolean(completedLog);
}

async function findSendJobByEventId(
  workspaceId: number,
  eventId: string,
  statuses: string[]
): Promise<WebhookLog | null> {
  for (const status of statuses) {
    const log = await findWebhookLogByEvent(workspaceId, status, eventId, WA_SEND_JOB_SOURCE);
    if (log) return log;
  }
  return null;
}

export interface WhatsAppQueueInput {
  workspaceId: number;
  leadId: number;
  triggerKind: WhatsAppTriggerKind;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  leadSource?: string;
  campaignId?: string;
  forceResend?: boolean;
}

export async function enqueueWhatsAppMessage(input: WhatsAppQueueInput): Promise<EnqueueWhatsAppResult> {
  const workspaceId = Number(input.workspaceId || 0);
  const leadId = Number(input.leadId || 0);
  const triggerKind = input.triggerKind;
  const eventId = buildWhatsAppJobEventId(workspaceId, leadId, triggerKind);

  if (!WHATSAPP_JOB_POLL_ENABLED) {
    return { queued: false, reason: 'whatsapp_worker_disabled', eventId };
  }

  if (!Number.isFinite(workspaceId) || workspaceId <= 0 || !Number.isFinite(leadId) || leadId <= 0) {
    return { queued: false, reason: 'invalid_workspace_or_lead_id', eventId };
  }

  const ready = await isWhatsAppReady(workspaceId, triggerKind);
  const forceResend = Boolean(input.forceResend);
  if (!ready && triggerKind !== 'bulk_marketing' && !forceResend) {
    return { queued: false, reason: 'whatsapp_not_ready_or_trigger_disabled', eventId };
  }

  if (forceResend) {
    const config = await getWhatsAppConfig(workspaceId);
    const accessToken = config ? getDecryptedAccessToken(config) : '';
    const template = await getWhatsAppTemplate(workspaceId, triggerKind);
    if (!config?.enabled || !config.phone_number_id || !accessToken) {
      return { queued: false, reason: 'whatsapp_not_configured', eventId };
    }
    if (!template.enabled || !template.meta_template_name) {
      return { queued: false, reason: 'whatsapp_template_not_enabled', eventId };
    }
  }

  const phoneRaw = toTrimmedString(input.leadPhone);
  const phoneValidation = validatePhone(phoneRaw, true);
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { queued: false, reason: 'lead_missing_valid_phone', eventId };
  }

  const toPhoneDigits = phoneValidation.normalized.replace(/\D/g, '');
  if (!toPhoneDigits) {
    return { queued: false, reason: 'lead_missing_valid_phone', eventId };
  }

  const triggers = await getWhatsAppTriggerConfig(workspaceId);
  const cooldown =
    triggerKind === 'call_no_answer' ? triggers.no_answer_cooldown_hours : undefined;

  const blocked = await hasBlockingWhatsAppJob(
    workspaceId,
    eventId,
    triggerKind,
    cooldown,
    forceResend
  );
  if (blocked) {
    return { queued: false, reason: 'job_already_exists_or_cooldown', eventId };
  }

  const nowIso = new Date().toISOString();
  const payload: WhatsAppSendJobPayload = {
    kind: 'whatsapp_send_job',
    workspaceId,
    leadId,
    triggerKind,
    toPhone: phoneValidation.normalized,
    toPhoneDigits,
    lead: {
      id: leadId,
      name: toTrimmedString(input.leadName) || 'there',
      phone: phoneValidation.normalized,
      ...(toTrimmedString(input.leadEmail) ? { email: toTrimmedString(input.leadEmail) } : {}),
      ...(toTrimmedString(input.leadSource) ? { source_old: toTrimmedString(input.leadSource) } : {}),
    },
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    attempts: 0,
    nextRunAt: nowIso,
    createdAt: nowIso,
  };

  if (forceResend) {
    const existingJob = await findSendJobByEventId(workspaceId, eventId, [
      WA_MSG_JOB_FAILED,
      WA_MSG_JOB_COMPLETED,
    ]);
    if (existingJob) {
      await updateJobLog(existingJob, {
        payload: JSON.stringify(payload),
        status: WA_MSG_JOB_PENDING,
        error: null,
      });
      return { queued: true, eventId };
    }
  }

  await webhookLogsApi.createWebhookLog({
    workspace_id: workspaceId,
    lead_id: leadId,
    source: WA_SEND_JOB_SOURCE,
    source_old: WA_SEND_JOB_SOURCE,
    event_id: eventId,
    payload: JSON.stringify(payload),
    status: WA_MSG_JOB_PENDING,
    created_at: formatMySqlDateTime(),
  });

  return { queued: true, eventId };
}

async function buildTemplateContext(
  workspaceId: number,
  lead: WhatsAppSendJobPayload['lead']
): Promise<Record<string, unknown>> {
  let workspaceName = '';
  try {
    const wsRes = (await workspacesApi.getWorkspaceById(workspaceId)) as ApiResponse<Workspace>;
    const ws = Array.isArray(wsRes.data) ? wsRes.data[0] : wsRes.data;
    workspaceName = ws?.name || '';
  } catch {
    workspaceName = '';
  }

  return {
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email || '',
      source_old: lead.source_old || '',
    },
    workspace: {
      id: workspaceId,
      name: workspaceName,
    },
  };
}

async function createWhatsAppActivity(
  leadId: number,
  workspaceId: number,
  userId: number,
  title: string,
  description: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await leadActivitiesApi.createActivity({
      lead_id: leadId,
      workspace_id: workspaceId,
      user_id: userId || 1,
      type: 'whatsapp',
      title,
      description,
      metadata: JSON.stringify(metadata),
      created_at: formatMySqlDateTime(),
    } as Parameters<typeof leadActivitiesApi.createActivity>[0]);
  } catch (error) {
    console.error('[WhatsApp] Failed to create activity:', (error as Error).message);
  }
}

async function createMessageLog(input: {
  workspaceId: number;
  leadId: number;
  toPhone: string;
  triggerKind: WhatsAppTriggerKind;
  templateName: string;
  providerMessageId?: string;
  status: string;
  error?: string;
  campaignId?: string;
}): Promise<void> {
  const eventId = input.providerMessageId
    ? `wa_log_${input.providerMessageId}`
    : `wa_log_${input.workspaceId}_${input.leadId}_${Date.now()}`;

  const payload = {
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    to_phone: maskPhone(input.toPhone),
    trigger_kind: input.triggerKind,
    template_name: input.templateName,
    provider_message_id: input.providerMessageId || '',
    delivery_status: input.status,
    error: input.error || '',
    campaign_id: input.campaignId || '',
    sent_at: new Date().toISOString(),
  };

  await upsertWebhookLog({
    workspaceId: input.workspaceId,
    status: WA_MSG_LOG_STATUS,
    eventId,
    source: WA_CONFIG_SOURCE,
    payload,
    leadId: input.leadId,
    error: input.error || null,
  });
}

function parseSendJobPayload(raw: unknown): WhatsAppSendJobPayload | null {
  const obj = safeJsonParse(raw);
  if (!obj || obj.kind !== 'whatsapp_send_job') return null;

  const workspaceId = Number(obj.workspaceId || 0);
  const leadId = Number(obj.leadId || 0);
  const leadObj = obj.lead as Record<string, unknown> | undefined;

  if (!Number.isFinite(workspaceId) || workspaceId <= 0) return null;
  if (!Number.isFinite(leadId) || leadId <= 0) return null;
  if (!leadObj || !toTrimmedString(leadObj.name)) return null;

  return {
    kind: 'whatsapp_send_job',
    workspaceId,
    leadId,
    triggerKind: (toTrimmedString(obj.triggerKind) || 'new_lead') as WhatsAppTriggerKind,
    toPhone: toTrimmedString(obj.toPhone),
    toPhoneDigits: toTrimmedString(obj.toPhoneDigits),
    lead: {
      id: leadId,
      name: toTrimmedString(leadObj.name),
      phone: toTrimmedString(leadObj.phone),
      ...(toTrimmedString(leadObj.email) ? { email: toTrimmedString(leadObj.email) } : {}),
      ...(toTrimmedString(leadObj.source_old) ? { source_old: toTrimmedString(leadObj.source_old) } : {}),
    },
    ...(toTrimmedString(obj.campaignId) ? { campaignId: toTrimmedString(obj.campaignId) } : {}),
    attempts: Number(obj.attempts || 0),
    nextRunAt: toTrimmedString(obj.nextRunAt) || new Date().toISOString(),
    createdAt: toTrimmedString(obj.createdAt) || new Date().toISOString(),
    ...(toTrimmedString(obj.lastStartedAt) ? { lastStartedAt: toTrimmedString(obj.lastStartedAt) } : {}),
    ...(toTrimmedString(obj.lastCompletedAt) ? { lastCompletedAt: toTrimmedString(obj.lastCompletedAt) } : {}),
    ...(toTrimmedString(obj.providerMessageId) ? { providerMessageId: toTrimmedString(obj.providerMessageId) } : {}),
    ...(toTrimmedString(obj.workerClaimId) ? { workerClaimId: toTrimmedString(obj.workerClaimId) } : {}),
  };
}

async function findDuePendingJob(): Promise<WebhookLog | null> {
  const nowMs = Date.now();
  for (let page = 1; page <= WA_JOB_MAX_PAGES; page++) {
    const response = (await webhookLogsApi.getWebhookLogs({
      status: WA_MSG_JOB_PENDING,
      source: WA_SEND_JOB_SOURCE,
      page,
      limit: WA_JOB_FETCH_LIMIT,
      sort: 'id',
      order: 'asc',
      cache: 'no-store',
    })) as ApiResponse<WebhookLog[]>;

    if (response.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }

    const log = response.data.find((entry) => {
      const payload = safeJsonParse(entry.payload);
      const nextRunAtMs = payload?.nextRunAt ? Date.parse(String(payload.nextRunAt)) : nowMs;
      return Number.isFinite(nextRunAtMs) && nextRunAtMs <= nowMs;
    });

    if (log) return log;
    if (response.data.length < WA_JOB_FETCH_LIMIT) return null;
  }
  return null;
}

async function findStaleProcessingJob(): Promise<WebhookLog | null> {
  const nowMs = Date.now();
  for (let page = 1; page <= WA_JOB_MAX_PAGES; page++) {
    const response = (await webhookLogsApi.getWebhookLogs({
      status: WA_MSG_JOB_PROCESSING,
      source: WA_SEND_JOB_SOURCE,
      page,
      limit: WA_JOB_FETCH_LIMIT,
      sort: 'id',
      order: 'asc',
      cache: 'no-store',
    })) as ApiResponse<WebhookLog[]>;

    if (response.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }

    const log = response.data.find((entry) => {
      const payload = safeJsonParse(entry.payload);
      const lastStartedAt = payload?.lastStartedAt ? Date.parse(String(payload.lastStartedAt)) : NaN;
      return Number.isFinite(lastStartedAt) && nowMs - lastStartedAt > WA_JOB_STALE_MS;
    });

    if (log) return log;
    if (response.data.length < WA_JOB_FETCH_LIMIT) return null;
  }
  return null;
}

async function updateJobLog(
  log: WebhookLog,
  update: { payload?: string; status?: string; error?: string | null }
): Promise<void> {
  await webhookLogsApi.updateWebhookLog(Number(log.id), {
    workspace_id: log.workspace_id,
    lead_id: log.lead_id || 0,
    source: log.source || WA_SEND_JOB_SOURCE,
    source_old: log.source_old || WA_SEND_JOB_SOURCE,
    event_id: log.event_id,
    payload: update.payload ?? log.payload,
    status: update.status ?? log.status,
    error: update.error ?? null,
    created_at: log.created_at,
  });
}

async function incrementCampaignStats(
  campaignId: string,
  workspaceId: number,
  field: 'sent' | 'failed'
): Promise<void> {
  const log = await findWebhookLogByEvent(workspaceId, WA_CAMPAIGN_STATUS, campaignId, WA_CONFIG_SOURCE);
  if (!log?.payload) return;

  const payload = safeJsonParse(log.payload) as unknown as WhatsAppCampaignPayload;
  if (!payload || payload.kind !== 'whatsapp_campaign') return;

  const updated: WhatsAppCampaignPayload = {
    ...payload,
    sent: field === 'sent' ? payload.sent + 1 : payload.sent,
    failed: field === 'failed' ? payload.failed + 1 : payload.failed,
    updatedAt: new Date().toISOString(),
  };

  const totalProcessed = updated.sent + updated.failed;
  if (totalProcessed >= updated.totalRecipients) {
    updated.status = updated.failed > 0 && updated.sent === 0 ? 'failed' : 'completed';
  } else {
    updated.status = 'running';
  }

  await updateJobLog(log, { payload: JSON.stringify(updated), status: WA_CAMPAIGN_STATUS });
}

export async function processOneWhatsAppSendJob(workerId = `wa-${process.pid}`): Promise<boolean> {
  if (!WHATSAPP_JOB_POLL_ENABLED) return false;

  const staleLog = await findStaleProcessingJob();
  if (staleLog) {
    const stalePayload = parseSendJobPayload(staleLog.payload);
    if (stalePayload) {
      await updateJobLog(staleLog, {
        payload: JSON.stringify({ ...stalePayload, nextRunAt: new Date().toISOString() }),
        status: WA_MSG_JOB_PENDING,
        error: 'Requeued stale WhatsApp job',
      });
      return true;
    }
  }

  const log = await findDuePendingJob();
  if (!log) return false;

  const payload = parseSendJobPayload(log.payload);
  if (!payload) {
    await updateJobLog(log, { status: WA_MSG_JOB_FAILED, error: 'Invalid WhatsApp job payload' });
    return true;
  }

  const claimedPayload: WhatsAppSendJobPayload = {
    ...payload,
    lastStartedAt: new Date().toISOString(),
    workerClaimId: workerId,
    workerClaimedAt: new Date().toISOString(),
  };

  await updateJobLog(log, {
    payload: JSON.stringify(claimedPayload),
    status: WA_MSG_JOB_PROCESSING,
    error: null,
  });

  const workspaceId = payload.workspaceId;

  if (payload.campaignId) {
    const campaign = await getWhatsAppCampaign(workspaceId, payload.campaignId);
    if (campaign?.status === 'cancelled') {
      await updateJobLog(log, { status: WA_MSG_JOB_FAILED, error: 'Campaign cancelled' });
      return true;
    }
  }

  const config = await getWhatsAppConfig(workspaceId);
  const accessToken = config ? getDecryptedAccessToken(config) : '';

  if (!config?.enabled || !config.phone_number_id || !accessToken) {
    await updateJobLog(log, {
      status: WA_MSG_JOB_FAILED,
      error: 'WhatsApp not configured for workspace',
    });
    if (payload.campaignId) await incrementCampaignStats(payload.campaignId, workspaceId, 'failed');
    return true;
  }

  const template = await getWhatsAppTemplate(workspaceId, payload.triggerKind);
  if (!template.enabled || !template.meta_template_name) {
    await updateJobLog(log, {
      status: WA_MSG_JOB_FAILED,
      error: 'WhatsApp template not enabled',
    });
    if (payload.campaignId) await incrementCampaignStats(payload.campaignId, workspaceId, 'failed');
    return true;
  }

  const context = await buildTemplateContext(workspaceId, payload.lead);
  const bodyParameters = extractBodyParameters(template.body, context);

  const sendResult = await sendWhatsAppTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken,
    toPhoneE164Digits: payload.toPhoneDigits,
    templateName: template.meta_template_name,
    languageCode: template.language || 'en',
    bodyParameters,
  });

  if (!sendResult.success) {
    const attempts = Number(payload.attempts || 0) + 1;
    const terminal = attempts >= WA_JOB_MAX_ATTEMPTS;
    const retryPayload: WhatsAppSendJobPayload = {
      ...claimedPayload,
      attempts,
      lastErrorAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + computeBackoffMs(attempts)).toISOString(),
    };

    await updateJobLog(log, {
      payload: JSON.stringify(retryPayload),
      status: terminal ? WA_MSG_JOB_FAILED : WA_MSG_JOB_PENDING,
      error: String(sendResult.error || 'Send failed').slice(0, 1000),
    });

    if (terminal) {
      await createMessageLog({
        workspaceId,
        leadId: payload.leadId,
        toPhone: payload.toPhone,
        triggerKind: payload.triggerKind,
        templateName: template.meta_template_name,
        status: 'failed',
        error: sendResult.error,
        campaignId: payload.campaignId,
      });
    }

    if (terminal && payload.campaignId) {
      await incrementCampaignStats(payload.campaignId, workspaceId, 'failed');
    }
    return true;
  }

  const completedPayload: WhatsAppSendJobPayload = {
    ...claimedPayload,
    lastCompletedAt: new Date().toISOString(),
    providerMessageId: sendResult.messageId,
  };

  await updateJobLog(log, {
    payload: JSON.stringify(completedPayload),
    status: WA_MSG_JOB_COMPLETED,
    error: null,
  });

  await createMessageLog({
    workspaceId,
    leadId: payload.leadId,
    toPhone: payload.toPhone,
    triggerKind: payload.triggerKind,
    templateName: template.meta_template_name,
    providerMessageId: sendResult.messageId,
    status: 'sent',
    campaignId: payload.campaignId,
  });

  const bodyPreview = interpolateTemplate(template.body, context);
  await createWhatsAppActivity(
    payload.leadId,
    workspaceId,
    1,
    `WhatsApp sent to ${payload.lead.name}`,
    bodyPreview.slice(0, 500),
    {
      trigger: payload.triggerKind,
      phone: maskPhone(payload.toPhone),
      template: template.meta_template_name,
      message_id: sendResult.messageId || '',
    }
  );

  if (payload.campaignId) {
    await incrementCampaignStats(payload.campaignId, workspaceId, 'sent');
  }

  return true;
}

const META_SANDBOX_TEMPLATE = 'hello_world';
const META_SANDBOX_LANGUAGE = 'en_US';

export async function sendWhatsAppTestMessage(
  workspaceId: number,
  toPhone: string,
  triggerKind: WhatsAppTriggerKind = 'new_lead',
  options?: { usePlainText?: boolean; useSandboxTemplate?: boolean; messageBody?: string }
): Promise<{ success: boolean; message?: string; messageId?: string }> {
  const config = await getWhatsAppConfig(workspaceId);
  const accessToken = config ? getDecryptedAccessToken(config) : '';
  if (!config?.phone_number_id || !accessToken) {
    return { success: false, message: 'WhatsApp is not configured' };
  }

  const phoneValidation = validatePhone(toPhone, true);
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, message: phoneValidation.error || 'Invalid phone number' };
  }

  const toDigits = phoneValidation.normalized.replace(/\D/g, '');

  if (options?.useSandboxTemplate) {
    const result = await sendWhatsAppTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      toPhoneE164Digits: toDigits,
      templateName: META_SANDBOX_TEMPLATE,
      languageCode: META_SANDBOX_LANGUAGE,
    });

    if (!result.success) {
      return { success: false, message: result.error };
    }
    await createMessageLog({
      workspaceId,
      leadId: 0,
      toPhone: phoneValidation.normalized,
      triggerKind: 'new_lead',
      templateName: META_SANDBOX_TEMPLATE,
      providerMessageId: result.messageId,
      status: 'sent',
    });
    console.info('[WhatsApp Test] Sandbox template accepted by Meta', {
      workspaceId,
      to: maskPhone(phoneValidation.normalized),
      template: META_SANDBOX_TEMPLATE,
      messageId: result.messageId,
    });
    return {
      success: true,
      messageId: result.messageId,
      message:
        'Sent hello_world (same as Meta Developer Console). If nothing arrives within 1 minute, add this phone as a test recipient in Meta → WhatsApp → API Setup.',
    };
  }

  if (options?.usePlainText) {
    const body =
      String(options.messageBody || '').trim() ||
      'Hello from Scraft CRM — this is a WhatsApp connection test.';

    const result = await sendWhatsAppTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      toPhoneE164Digits: toDigits,
      body,
    });

    if (!result.success) {
      return { success: false, message: result.error };
    }
    await createMessageLog({
      workspaceId,
      leadId: 0,
      toPhone: phoneValidation.normalized,
      triggerKind: 'new_lead',
      templateName: '(plain text test)',
      providerMessageId: result.messageId,
      status: 'sent',
    });
    console.info('[WhatsApp Test] Plain text accepted by Meta', {
      workspaceId,
      to: maskPhone(phoneValidation.normalized),
      messageId: result.messageId,
    });
    return {
      success: true,
      messageId: result.messageId,
      message:
        'Meta accepted the message. If you do not receive it within 1 minute, add this number as a test recipient in Meta Developer Console and ensure it has messaged your business number in the last 24 hours.',
    };
  }

  const template = await getWhatsAppTemplate(workspaceId, triggerKind);
  const context = {
    lead: { id: 0, name: 'Test User', phone: phoneValidation.normalized, email: '', source_old: '' },
    workspace: { id: workspaceId, name: 'Test Workspace' },
  };
  const bodyParameters = extractBodyParameters(template.body, context);

  const result = await sendWhatsAppTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken,
    toPhoneE164Digits: phoneValidation.normalized.replace(/\D/g, ''),
    templateName: template.meta_template_name,
    languageCode: template.language || 'en',
    bodyParameters,
  });

  if (!result.success) {
    return { success: false, message: result.error };
  }
  await createMessageLog({
    workspaceId,
    leadId: 0,
    toPhone: phoneValidation.normalized,
    triggerKind,
    templateName: template.meta_template_name,
    providerMessageId: result.messageId,
    status: 'sent',
  });
  console.info('[WhatsApp Test] Template message accepted by Meta', {
    workspaceId,
    to: maskPhone(phoneValidation.normalized),
    template: template.meta_template_name,
    messageId: result.messageId,
  });
  return {
    success: true,
    messageId: result.messageId,
    message:
      'Production test accepted by Meta. Delivery can take up to a minute. If you get error #131030, your Meta account is still in sandbox — use a verified production phone number and long-lived token.',
  };
}

export async function maybeEnqueueWhatsAppOnStatusChange(input: {
  workspaceId: number;
  leadId: number;
  leadName: string;
  leadPhone: string;
  leadEmail?: string;
  oldStatusId: number | null;
  newStatusId: number | null;
  newStatus?: LeadStatus | null;
}): Promise<EnqueueWhatsAppResult> {
  const triggers = await getWhatsAppTriggerConfig(input.workspaceId);
  if (!triggers.lead_done) {
    return { queued: false, reason: 'lead_done_trigger_disabled' };
  }

  const newStatus = input.newStatus;
  if (!newStatus) {
    return { queued: false, reason: 'status_not_found' };
  }

  const matchesId = triggers.done_status_ids.includes(Number(newStatus.id));
  const matchesType = triggers.done_status_types.includes(newStatus.type as 'won' | 'closed' | 'lost' | 'open');

  if (!matchesId && !matchesType) {
    return { queued: false, reason: 'status_not_configured_as_done' };
  }

  return enqueueWhatsAppMessage({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    triggerKind: 'lead_done',
    leadName: input.leadName,
    leadPhone: input.leadPhone,
    leadEmail: input.leadEmail,
  });
}

export async function sendNoAnswerWhatsApp(input: {
  workspaceId: number;
  leadId: number;
  userId: number;
}): Promise<EnqueueWhatsAppResult & { activityLogged?: boolean }> {
  const leadRes = (await leadsApi.getLeadById(input.leadId)) as ApiResponse<Lead>;
  const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : leadRes.data;
  if (!lead || Number(lead.workspace_id) !== input.workspaceId) {
    return { queued: false, reason: 'lead_not_found' };
  }

  const result = await enqueueWhatsAppMessage({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    triggerKind: 'call_no_answer',
    leadName: lead.name,
    leadPhone: lead.phone,
    leadEmail: lead.email,
    leadSource: lead.source_old,
  });

  if (result.queued) {
    await createWhatsAppActivity(
      input.leadId,
      input.workspaceId,
      input.userId,
      `Call not answered — WhatsApp queued for ${lead.name}`,
      'Automated no-answer WhatsApp message queued',
      { trigger: 'call_no_answer', phone: maskPhone(lead.phone) }
    );
    return { ...result, activityLogged: true };
  }

  return result;
}

export async function resendWhatsAppForLead(input: {
  workspaceId: number;
  leadId: number;
  triggerKind: WhatsAppTriggerKind;
  userId: number;
}): Promise<EnqueueWhatsAppResult & { activityLogged?: boolean }> {
  const leadRes = (await leadsApi.getLeadById(input.leadId)) as ApiResponse<Lead>;
  const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : leadRes.data;
  if (!lead || Number(lead.workspace_id) !== input.workspaceId) {
    return { queued: false, reason: 'lead_not_found' };
  }

  if (!toTrimmedString(lead.phone)) {
    return { queued: false, reason: 'lead_missing_valid_phone' };
  }

  const phoneValidation = validatePhone(lead.phone, true);
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { queued: false, reason: phoneValidation.error || 'lead_missing_valid_phone' };
  }

  const result = await enqueueWhatsAppMessage({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    triggerKind: input.triggerKind,
    leadName: lead.name,
    leadPhone: phoneValidation.normalized,
    leadEmail: lead.email,
    leadSource: lead.source_old,
    forceResend: true,
  });

  if (result.queued) {
    await createWhatsAppActivity(
      input.leadId,
      input.workspaceId,
      input.userId,
      `WhatsApp resend queued for ${lead.name}`,
      `Manual resend (${input.triggerKind.replace(/_/g, ' ')})`,
      { trigger: input.triggerKind, phone: maskPhone(phoneValidation.normalized), resend: true }
    );
    return { ...result, activityLogged: true };
  }

  return result;
}

export interface CreateCampaignInput {
  workspaceId: number;
  name: string;
  templateKind: WhatsAppTriggerKind;
  leadIds?: number[];
  statusIds?: number[];
  sourceFilter?: string;
  createdByUserId?: number;
}

export async function createWhatsAppCampaign(input: CreateCampaignInput): Promise<{
  success: boolean;
  campaignId?: string;
  queued?: number;
  skipped?: number;
  message?: string;
}> {
  const workspaceId = input.workspaceId;
  const template = await getWhatsAppTemplate(workspaceId, input.templateKind);
  if (!template.enabled || !template.meta_template_name) {
    return { success: false, message: 'Marketing template is not enabled' };
  }

  const config = await getWhatsAppConfig(workspaceId);
  if (!config?.enabled) {
    return { success: false, message: 'WhatsApp integration is not enabled' };
  }

  let leads: Lead[] = [];

  if (input.leadIds && input.leadIds.length > 0) {
    for (const leadId of input.leadIds.slice(0, WA_CAMPAIGN_MAX_RECIPIENTS)) {
      const res = (await leadsApi.getLeadById(leadId)) as ApiResponse<Lead>;
      const lead = Array.isArray(res.data) ? res.data[0] : res.data;
      if (lead && Number(lead.workspace_id) === workspaceId && !lead.deleted_at) {
        leads.push(lead);
      }
    }
  } else {
    const res = (await leadsApi.getLeads({
      workspace_id: workspaceId,
      limit: WA_CAMPAIGN_MAX_RECIPIENTS,
    })) as ApiResponse<Lead[]>;
    leads = asArray<Lead>(res.data).filter((l) => !l.deleted_at);

    if (input.statusIds && input.statusIds.length > 0) {
      const statusSet = new Set(input.statusIds.map(Number));
      leads = leads.filter((l) => l.status_id && statusSet.has(Number(l.status_id)));
    }
    if (input.sourceFilter) {
      const src = input.sourceFilter.toLowerCase();
      leads = leads.filter((l) => String(l.source_old || '').toLowerCase().includes(src));
    }
  }

  const campaignId = `wa_campaign_${workspaceId}_${Date.now()}`;
  let queued = 0;
  let skipped = 0;
  const validLeadIds: number[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    if (!lead) continue;
    const phoneValidation = validatePhone(lead.phone || '', false);
    if (!phoneValidation.valid || !phoneValidation.normalized) {
      skipped += 1;
      continue;
    }

    validLeadIds.push(lead.id);

    const eventId = buildWhatsAppJobEventId(workspaceId, lead.id, 'bulk_marketing');
    const nextRunAt = new Date(Date.now() + Math.floor(i / WA_CAMPAIGN_RATE_PER_SECOND) * 1000).toISOString();

    const jobPayload: WhatsAppSendJobPayload = {
      kind: 'whatsapp_send_job',
      workspaceId,
      leadId: lead.id,
      triggerKind: 'bulk_marketing',
      toPhone: phoneValidation.normalized,
      toPhoneDigits: phoneValidation.normalized.replace(/\D/g, ''),
      lead: {
        id: lead.id,
        name: lead.name || 'there',
        phone: phoneValidation.normalized,
        email: lead.email,
        source_old: lead.source_old,
      },
      campaignId,
      attempts: 0,
      nextRunAt,
      createdAt: new Date().toISOString(),
    };

    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: lead.id,
      source: WA_SEND_JOB_SOURCE,
      source_old: WA_BULK_JOB_SOURCE,
      event_id: eventId,
      payload: JSON.stringify(jobPayload),
      status: WA_MSG_JOB_PENDING,
      created_at: formatMySqlDateTime(),
    });
    queued += 1;
  }

  const campaignPayload: WhatsAppCampaignPayload = {
    kind: 'whatsapp_campaign',
    campaignId,
    workspaceId,
    templateKind: input.templateKind,
    name: input.name || 'Bulk campaign',
    status: queued > 0 ? 'running' : 'failed',
    totalRecipients: queued,
    sent: 0,
    delivered: 0,
    failed: 0,
    skipped,
    leadIds: validLeadIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
  };

  await upsertWebhookLog({
    workspaceId,
    status: WA_CAMPAIGN_STATUS,
    eventId: campaignId,
    source: WA_CONFIG_SOURCE,
    payload: campaignPayload as unknown as Record<string, unknown>,
  });

  return {
    success: queued > 0,
    campaignId,
    queued,
    skipped,
    message: queued > 0 ? undefined : 'No valid recipients with phone numbers',
  };
}

export async function listWhatsAppCampaigns(workspaceId: number): Promise<WhatsAppCampaignPayload[]> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: WA_CAMPAIGN_STATUS,
    source: WA_CONFIG_SOURCE,
    limit: 50,
    sort: 'id',
    order: 'desc',
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return [];

  return asArray<WebhookLog>(response.data)
    .map((log) => safeJsonParse(log.payload) as unknown as WhatsAppCampaignPayload)
    .filter((p) => p && p.kind === 'whatsapp_campaign');
}

export async function getWhatsAppCampaign(
  workspaceId: number,
  campaignId: string
): Promise<WhatsAppCampaignPayload | null> {
  const log = await findWebhookLogByEvent(workspaceId, WA_CAMPAIGN_STATUS, campaignId, WA_CONFIG_SOURCE);
  if (!log?.payload) return null;
  const payload = safeJsonParse(log.payload) as unknown as WhatsAppCampaignPayload;
  return payload?.kind === 'whatsapp_campaign' ? payload : null;
}

export async function cancelWhatsAppCampaign(
  workspaceId: number,
  campaignId: string
): Promise<boolean> {
  const campaign = await getWhatsAppCampaign(workspaceId, campaignId);
  if (!campaign) return false;

  const updated: WhatsAppCampaignPayload = {
    ...campaign,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  };

  await upsertWebhookLog({
    workspaceId,
    status: WA_CAMPAIGN_STATUS,
    eventId: campaignId,
    source: WA_CONFIG_SOURCE,
    payload: updated as unknown as Record<string, unknown>,
  });

  return true;
}

export async function listWhatsAppMessages(
  workspaceId: number,
  options?: { leadId?: number; limit?: number; page?: number }
): Promise<Array<Record<string, unknown>>> {
  const params: Record<string, unknown> = {
    workspace_id: workspaceId,
    status: WA_MSG_LOG_STATUS,
    source: WA_CONFIG_SOURCE,
    limit: options?.limit || 50,
    page: options?.page || 1,
    sort: 'id',
    order: 'desc',
  };

  const response = (await webhookLogsApi.getWebhookLogs(params)) as ApiResponse<WebhookLog[]>;
  if (response.status !== 'success' || !response.data) return [];

  let logs = asArray<WebhookLog>(response.data);
  if (options?.leadId) {
    logs = logs.filter((log) => Number(log.lead_id) === Number(options.leadId));
  }

  return logs.map((log) => {
    const payload = safeJsonParse(log.payload) || {};
    return {
      id: log.id,
      lead_id: log.lead_id,
      workspace_id: log.workspace_id,
      created_at: log.created_at,
      ...payload,
    };
  });
}

export async function handleWhatsAppDeliveryWebhook(body: Record<string, unknown>): Promise<void> {
  const entries = asArray<Record<string, unknown>>(body.entry);
  for (const entry of entries) {
    const changes = asArray<Record<string, unknown>>(entry.changes);
    for (const change of changes) {
      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const statuses = asArray<Record<string, unknown>>(value.statuses);
      for (const statusObj of statuses) {
        const messageId = toTrimmedString(statusObj.id);
        const deliveryStatus = toTrimmedString(statusObj.status);
        if (!messageId) continue;

        const eventId = `wa_log_${messageId}`;
        const response = (await webhookLogsApi.getWebhookLogs({
          status: WA_MSG_LOG_STATUS,
          event_id: eventId,
          limit: 5,
        })) as ApiResponse<WebhookLog[]>;

        const log = asArray<WebhookLog>(response.data)[0];
        if (!log) continue;

        const payload = safeJsonParse(log.payload) || {};
        payload.delivery_status = deliveryStatus;
        if (deliveryStatus === 'delivered') payload.delivered_at = new Date().toISOString();
        if (deliveryStatus === 'read') payload.read_at = new Date().toISOString();
        if (deliveryStatus === 'failed') {
          const errors = asArray<Record<string, unknown>>(statusObj.errors);
          payload.error = errors[0]?.title ? String(errors[0].title) : 'Delivery failed';
        }

        await webhookLogsApi.updateWebhookLog(Number(log.id), {
          workspace_id: log.workspace_id,
          lead_id: log.lead_id || 0,
          source: log.source || WA_CONFIG_SOURCE,
          source_old: log.source_old || WA_CONFIG_SOURCE,
          event_id: log.event_id,
          payload: JSON.stringify(payload),
          status: WA_MSG_LOG_STATUS,
          error: deliveryStatus === 'failed' ? String(payload.error || '') : null,
          created_at: log.created_at,
        });

        if (deliveryStatus === 'delivered' && payload.campaign_id) {
          const campaignId = String(payload.campaign_id);
          const wsId = Number(log.workspace_id);
          const campaignLog = await findWebhookLogByEvent(wsId, WA_CAMPAIGN_STATUS, campaignId, WA_CONFIG_SOURCE);
          if (campaignLog?.payload) {
            const campaign = safeJsonParse(campaignLog.payload) as unknown as WhatsAppCampaignPayload;
            if (campaign?.kind === 'whatsapp_campaign') {
              const updated = {
                ...campaign,
                delivered: Number(campaign.delivered || 0) + 1,
                updatedAt: new Date().toISOString(),
              };
              await updateJobLog(campaignLog, { payload: JSON.stringify(updated) });
            }
          }
        }
      }
    }
  }
}

export async function sendWhatsAppTemplateFromAutomation(
  workspaceId: number,
  input: { toPhone: string; templateName: string; languageCode?: string; bodyParameters?: string[] }
): Promise<{ success: boolean; message?: string; messageId?: string }> {
  const config = await getWhatsAppConfig(workspaceId);
  const accessToken = config ? getDecryptedAccessToken(config) : '';
  if (!config?.enabled || !config.phone_number_id || !accessToken) {
    return { success: false, message: 'WhatsApp is not connected for this workspace' };
  }
  const phone = validatePhone(input.toPhone, true);
  if (!phone.valid || !phone.normalized) {
    return { success: false, message: phone.error || 'Lead has no valid phone number' };
  }
  const result = await sendWhatsAppTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken,
    toPhoneE164Digits: phone.normalized.replace(/\D/g, ''),
    templateName: input.templateName,
    languageCode: input.languageCode || 'en',
    bodyParameters: input.bodyParameters || [],
  });
  return result.success
    ? { success: true, messageId: (result as any).messageId }
    : { success: false, message: (result as any).error || 'WhatsApp send failed' };
}
