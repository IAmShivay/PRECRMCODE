import nodemailer from 'nodemailer';
import { webhookLogsApi } from './api.js';
import { ApiResponse, WebhookLog } from '../types/index.js';
import { decryptConfigSecret, encryptConfigSecret } from './secureConfigCrypto.js';
import { maskEmail } from '../utils/logger.js';

export const WORKSPACE_SMTP_CONFIG_STATUS = 'ws_smtp_config';
export const LEAD_AUTOREPLY_TEMPLATE_STATUS = 'autoreply_tpl';
export const LEAD_NOTIFICATION_TEMPLATE_STATUS = 'lead_notify_tpl';
export const LEAD_ASSIGNMENT_TEMPLATE_STATUS = 'lead_assign_tpl';

export const LEAD_EMAIL_JOB_PENDING = 'lead_email_pending';
export const LEAD_EMAIL_JOB_PROCESSING = 'lead_email_proc';
export const LEAD_EMAIL_JOB_COMPLETED = 'lead_email_done';
export const LEAD_EMAIL_JOB_FAILED = 'lead_email_failed';

const SMTP_CONFIG_SOURCE = 'workspace_smtp';
const LEAD_AUTOREPLY_SOURCE = 'lead_autoreply';
const LEAD_NOTIFICATION_SOURCE = 'lead_notify';
const LEAD_ASSIGNMENT_SOURCE = 'lead_assign';
const LEAD_EMAIL_JOB_SOURCE = 'lead_autoreply';

const LEAD_EMAIL_JOB_MAX_ATTEMPTS = toBoundedInt(process.env.LEAD_EMAIL_JOB_MAX_ATTEMPTS, 6, 1, 20);
const LEAD_EMAIL_JOB_FETCH_LIMIT = toBoundedInt(process.env.LEAD_EMAIL_JOB_FETCH_LIMIT, 25, 1, 100);
const LEAD_EMAIL_JOB_MAX_PAGES = toBoundedInt(process.env.LEAD_EMAIL_JOB_MAX_PAGES, 20, 1, 50);
const LEAD_EMAIL_JOB_STALE_MS = toBoundedInt(
  process.env.LEAD_EMAIL_JOB_STALE_MS,
  10 * 60 * 1000,
  10 * 1000,
  60 * 60 * 1000
);
const LEAD_EMAIL_JOB_POLL_ENABLED = String(process.env.LEAD_EMAIL_JOB_POLL_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';
const WORKSPACE_AUTOREPLY_READY_CACHE_TTL_MS = toBoundedInt(
  process.env.LEAD_EMAIL_WORKSPACE_READY_CACHE_TTL_MS,
  30000,
  1000,
  5 * 60 * 1000
);

interface WorkspaceAutoReplyReadyCacheEntry {
  enabled: boolean;
  expiresAtMs: number;
}

const workspaceAutoReplyReadyCache = new Map<number, WorkspaceAutoReplyReadyCacheEntry>();

const SMTP_CONNECTION_TIMEOUT_MS = toBoundedInt(
  process.env.LEAD_EMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  15000,
  1000,
  120000
);
const SMTP_SOCKET_TIMEOUT_MS = toBoundedInt(
  process.env.LEAD_EMAIL_SMTP_SOCKET_TIMEOUT_MS,
  20000,
  1000,
  180000
);

const ATTACHMENT_MAX_COUNT = toBoundedInt(process.env.LEAD_EMAIL_ATTACHMENT_MAX_COUNT, 3, 0, 10);
const ATTACHMENT_MAX_BYTES = toBoundedInt(
  process.env.LEAD_EMAIL_ATTACHMENT_MAX_BYTES,
  3 * 1024 * 1024,
  32 * 1024,
  15 * 1024 * 1024
);
const ATTACHMENT_TOTAL_MAX_BYTES = toBoundedInt(
  process.env.LEAD_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES,
  6 * 1024 * 1024,
  ATTACHMENT_MAX_BYTES,
  20 * 1024 * 1024
);
const ATTACHMENT_TIMEOUT_MS = toBoundedInt(
  process.env.LEAD_EMAIL_ATTACHMENT_TIMEOUT_MS,
  7000,
  1000,
  30000
);

const DEFAULT_ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
];
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(
  String(process.env.LEAD_EMAIL_ATTACHMENT_ALLOWED_MIME_TYPES || DEFAULT_ALLOWED_ATTACHMENT_MIME_TYPES.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const DEFAULT_LEAD_AUTOREPLY_SUBJECT = 'Thanks {{lead.name}} - we got your request';
const DEFAULT_LEAD_AUTOREPLY_HTML =
  '<p>Hi {{lead.name}},</p><p>Thanks for contacting us. Our team will get back to you shortly.</p>';
const DEFAULT_LEAD_AUTOREPLY_TEXT =
  'Hi {{lead.name}}, Thanks for contacting us. Our team will get back to you shortly.';
const DEFAULT_LEAD_NOTIFICATION_SUBJECT =
  'New lead received: {{lead.name}} (ID {{lead.id}})';
const DEFAULT_LEAD_NOTIFICATION_HTML =
  '<p>A new lead has been captured in your workspace.</p>' +
  '<ul>' +
  '<li><strong>Lead ID:</strong> {{lead.id}}</li>' +
  '<li><strong>Name:</strong> {{lead.name}}</li>' +
  '<li><strong>Email:</strong> {{lead.email}}</li>' +
  '<li><strong>Phone:</strong> {{lead.phone}}</li>' +
  '<li><strong>Source:</strong> {{lead.source_old}}</li>' +
  '<li><strong>Source Ref:</strong> {{lead.source_ref}}</li>' +
  '<li><strong>Created At:</strong> {{lead.created_at}}</li>' +
  '<li><strong>Workspace ID:</strong> {{workspace.id}}</li>' +
  '</ul>';
const DEFAULT_LEAD_NOTIFICATION_TEXT =
  'A new lead has been captured in your workspace.\n' +
  'Lead ID: {{lead.id}}\n' +
  'Name: {{lead.name}}\n' +
  'Email: {{lead.email}}\n' +
  'Phone: {{lead.phone}}\n' +
  'Source: {{lead.source_old}}\n' +
  'Source Ref: {{lead.source_ref}}\n' +
  'Created At: {{lead.created_at}}\n' +
  'Workspace ID: {{workspace.id}}';

const DEFAULT_LEAD_ASSIGNMENT_SUBJECT =
  'Lead assigned to you: {{lead.name}} (ID {{lead.id}})';
const DEFAULT_LEAD_ASSIGNMENT_HTML =
  '<p>Hi {{assignee.name}},</p>' +
  '<p>A lead has been assigned to you.</p>' +
  '<ul>' +
  '<li><strong>Lead ID:</strong> {{lead.id}}</li>' +
  '<li><strong>Name:</strong> {{lead.name}}</li>' +
  '<li><strong>Email:</strong> {{lead.email}}</li>' +
  '<li><strong>Phone:</strong> {{lead.phone}}</li>' +
  '<li><strong>Assigned by:</strong> {{assigner.name}}</li>' +
  '</ul>';
const DEFAULT_LEAD_ASSIGNMENT_TEXT =
  'Hi {{assignee.name}},\n\n' +
  'A lead has been assigned to you.\n\n' +
  'Lead ID: {{lead.id}}\n' +
  'Name: {{lead.name}}\n' +
  'Email: {{lead.email}}\n' +
  'Phone: {{lead.phone}}\n' +
  'Assigned by: {{assigner.name}}';

interface StoredRecordResult<T> {
  value: T | null;
  logId?: number;
  eventId?: string;
}

export interface WorkspaceSmtpConfig {
  workspace_id: number;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password_enc: string;
  from_name: string;
  from_email: string;
  reply_to?: string;
  created_at?: string;
  updated_at: string;
}

export interface WorkspaceSmtpConfigMasked {
  workspace_id: number;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_name: string;
  from_email: string;
  reply_to?: string;
  password_set: boolean;
  password_masked: string;
  created_at?: string;
  updated_at: string;
}

export interface WorkspaceSmtpConfigInput {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string;
}

export interface LeadAutoReplyTemplateAttachment {
  filename: string;
  url: string;
}

export interface LeadAutoReplyTemplate {
  workspace_id: number;
  enabled: boolean;
  subject: string;
  html: string;
  text: string;
  attachments: LeadAutoReplyTemplateAttachment[];
  created_at?: string;
  updated_at: string;
}

export interface LeadAutoReplyTemplateInput {
  enabled?: boolean;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: Array<Partial<LeadAutoReplyTemplateAttachment>>;
}

export interface LeadNotificationTemplate {
  workspace_id: number;
  enabled: boolean;
  recipient_email: string;
  additional_recipients: string[];
  subject: string;
  html: string;
  text: string;
  created_at?: string;
  updated_at: string;
}

export interface LeadNotificationTemplateInput {
  enabled?: boolean;
  recipient_email?: string;
  additional_recipients?: string[];
  subject?: string;
  html?: string;
  text?: string;
}

export interface LeadAssignmentTemplate {
  workspace_id: number;
  enabled: boolean;
  subject: string;
  html: string;
  text: string;
  created_at?: string;
  updated_at: string;
}

export interface LeadAssignmentTemplateInput {
  enabled?: boolean;
  subject?: string;
  html?: string;
  text?: string;
}

export interface LeadAutoReplyQueueInput {
  workspaceId: number;
  leadId: number;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadSource?: string;
  leadSourceRef?: string;
  leadCreatedAt?: string;
}

interface LeadAutoReplyJobPayload {
  kind: 'lead_autoreply_email_job';
  workspaceId: number;
  leadId: number;
  toEmail: string;
  lead: {
    id: number;
    name: string;
    email: string;
    phone?: string;
    source_old?: string;
    source_ref?: string;
    created_at?: string;
  };
  attempts: number;
  nextRunAt: string;
  createdAt: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastErrorAt?: string;
  messageId?: string;
  workerClaimId?: string;
  workerClaimedAt?: string;
}

export interface EnqueueLeadAutoReplyResult {
  queued: boolean;
  reason?: string;
  eventId: string;
}

interface LeadAutoReplyLeadContext {
  id: number;
  name: string;
  email: string;
  phone?: string;
  source_old?: string;
  source_ref?: string;
  created_at?: string;
}

interface SendLeadAutoReplyEmailOptions {
  workspaceId: number;
  toEmail: string;
  lead: LeadAutoReplyLeadContext;
  bypassEnabledCheck?: boolean;
  templateOverride?: LeadAutoReplyTemplate | null;
  subjectOverride?: string;
  htmlOverride?: string;
  textOverride?: string;
}

export interface SendLeadAutoReplyEmailResult {
  messageId?: string;
}

interface SendLeadNotificationEmailOptions {
  workspaceId: number;
  lead: LeadAutoReplyLeadContext;
  recipientOverride?: string;
  bypassEnabledCheck?: boolean;
  templateOverride?: LeadNotificationTemplate | null;
}

export interface LeadNotificationDispatchInput {
  workspaceId: number;
  leadId: number;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadSource?: string;
  leadSourceRef?: string;
  leadCreatedAt?: string;
}

export interface LeadNotificationDispatchResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export interface LeadAssignmentNotificationInput {
  workspaceId: number;
  leadId: number;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  assigneeEmail: string;
  assigneeName: string;
  assignerName: string;
}

export type LeadAssignmentNotificationResult = LeadNotificationDispatchResult;

interface PreparedAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

class LeadEmailError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'LeadEmailError';
    this.retryable = retryable;
  }
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function safeJsonParse(value: unknown): any {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return null;
  }
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toLowerTrimmedString(value: unknown): string {
  return toTrimmedString(value).toLowerCase();
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return fallback;
}

function normalizePort(value: unknown, fallback = 587): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  if (intValue < 1 || intValue > 65535) return fallback;
  return intValue;
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmailList(value: unknown, fieldName: string): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of rawItems) {
    const email = toLowerTrimmedString(item);
    if (!email) continue;
    if (!isValidEmailAddress(email)) {
      throw new LeadEmailError(`${fieldName} contains an invalid email: ${email}`, false);
    }
    if (!seen.has(email)) {
      seen.add(email);
      normalized.push(email);
    }
  }

  return normalized;
}

function isMaskedPasswordInput(value: string): boolean {
  const normalized = String(value || '').trim();
  return normalized.includes('*');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHtmlTags(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolvePathValue(context: Record<string, any>, path: string): string {
  const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  let cursor: any = context;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return '';
    }
    cursor = cursor[part];
  }

  if (cursor === null || cursor === undefined) return '';
  return String(cursor);
}

function interpolateTemplate(
  template: string,
  context: Record<string, any>,
  options?: { escapeHtmlValues?: boolean }
): string {
  const source = String(template || '');
  const escapeValues = options?.escapeHtmlValues === true;
  return source.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = resolvePathValue(context, key);
    return escapeValues ? escapeHtml(resolved) : resolved;
  });
}

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim();
  const stripped = trimmed.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_');
  if (!stripped) return fallback;
  return stripped.slice(0, 200);
}

function eventIdForWorkspaceSmtpConfig(workspaceId: number): string {
  return `smtp_ws_${workspaceId}`;
}

function eventIdForLeadTemplate(workspaceId: number): string {
  return `lead_autoreply_ws_${workspaceId}`;
}

function eventIdForLeadNotificationTemplate(workspaceId: number): string {
  return `lead_notify_ws_${workspaceId}`;
}

function eventIdForLeadAssignmentTemplate(workspaceId: number): string {
  return `lead_assign_ws_${workspaceId}`;
}

export function buildLeadEmailJobEventId(workspaceId: number, leadId: number): string {
  return `lead_email_ws${workspaceId}_lead${leadId}`;
}

function normalizeSmtpConfigPayload(payload: any, workspaceId: number): WorkspaceSmtpConfig | null {
  if (!payload || typeof payload !== 'object') return null;

  const normalizedWorkspaceId = Number(payload.workspace_id || workspaceId);
  if (!Number.isFinite(normalizedWorkspaceId) || normalizedWorkspaceId <= 0) return null;

  const fromEmail = toLowerTrimmedString(payload.from_email);
  const replyTo = toLowerTrimmedString(payload.reply_to);
  const passwordEnc = toTrimmedString(payload.password_enc || payload.password || '');
  const nowIso = new Date().toISOString();

  return {
    workspace_id: normalizedWorkspaceId,
    enabled: toBoolean(payload.enabled, false),
    host: toTrimmedString(payload.host),
    port: normalizePort(payload.port, 587),
    secure: toBoolean(payload.secure, false),
    username: toTrimmedString(payload.username),
    password_enc: passwordEnc,
    from_name: toTrimmedString(payload.from_name),
    from_email: fromEmail,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(toTrimmedString(payload.created_at) ? { created_at: toTrimmedString(payload.created_at) } : {}),
    updated_at: toTrimmedString(payload.updated_at) || nowIso,
  };
}

function maskSmtpConfig(config: WorkspaceSmtpConfig): WorkspaceSmtpConfigMasked {
  return {
    workspace_id: config.workspace_id,
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    from_name: config.from_name,
    from_email: config.from_email,
    ...(config.reply_to ? { reply_to: config.reply_to } : {}),
    password_set: Boolean(config.password_enc),
    password_masked: config.password_enc ? '********' : '',
    ...(config.created_at ? { created_at: config.created_at } : {}),
    updated_at: config.updated_at,
  };
}

function validateSmtpConfig(config: WorkspaceSmtpConfig, requireSecrets: boolean): void {
  if (!config.host) {
    throw new LeadEmailError('SMTP host is required', false);
  }
  if (!config.username) {
    throw new LeadEmailError('SMTP username is required', false);
  }
  if (!config.from_email || !isValidEmailAddress(config.from_email)) {
    throw new LeadEmailError('A valid from_email is required', false);
  }
  if (config.reply_to && !isValidEmailAddress(config.reply_to)) {
    throw new LeadEmailError('reply_to must be a valid email address', false);
  }
  if (!Number.isFinite(config.port) || config.port < 1 || config.port > 65535) {
    throw new LeadEmailError('SMTP port must be between 1 and 65535', false);
  }
  if (requireSecrets && !config.password_enc) {
    throw new LeadEmailError('SMTP password is required', false);
  }
}

function normalizeTemplateAttachments(
  attachments: Array<Partial<LeadAutoReplyTemplateAttachment>> | undefined,
  fallback: LeadAutoReplyTemplateAttachment[]
): LeadAutoReplyTemplateAttachment[] {
  const source = Array.isArray(attachments) ? attachments : fallback;
  const normalized = source
    .map((item, index) => {
      const rawUrl = toTrimmedString(item?.url);
      if (!rawUrl) return null;
      const rawFilename = toTrimmedString(item?.filename);
      const fallbackName = `attachment_${index + 1}`;
      return {
        filename: sanitizeFilename(rawFilename || filenameFromUrl(rawUrl) || fallbackName, fallbackName),
        url: rawUrl,
      };
    })
    .filter((item): item is LeadAutoReplyTemplateAttachment => Boolean(item));

  if (normalized.length > ATTACHMENT_MAX_COUNT) {
    throw new LeadEmailError(
      `A maximum of ${ATTACHMENT_MAX_COUNT} attachment URLs is supported`,
      false
    );
  }

  for (const attachment of normalized) {
    ensureHttpsAttachmentUrl(attachment.url);
  }

  return normalized;
}

function normalizeLeadAutoReplyTemplatePayload(
  payload: any,
  workspaceId: number
): LeadAutoReplyTemplate | null {
  if (!payload || typeof payload !== 'object') return null;

  const normalizedWorkspaceId = Number(payload.workspace_id || workspaceId);
  if (!Number.isFinite(normalizedWorkspaceId) || normalizedWorkspaceId <= 0) return null;

  const nowIso = new Date().toISOString();
  const attachmentsInput = Array.isArray(payload.attachments)
    ? payload.attachments
    : [];

  return {
    workspace_id: normalizedWorkspaceId,
    enabled: toBoolean(payload.enabled, false),
    subject: toTrimmedString(payload.subject) || DEFAULT_LEAD_AUTOREPLY_SUBJECT,
    html: toTrimmedString(payload.html) || DEFAULT_LEAD_AUTOREPLY_HTML,
    text: toTrimmedString(payload.text) || DEFAULT_LEAD_AUTOREPLY_TEXT,
    attachments: normalizeTemplateAttachments(attachmentsInput, []),
    ...(toTrimmedString(payload.created_at) ? { created_at: toTrimmedString(payload.created_at) } : {}),
    updated_at: toTrimmedString(payload.updated_at) || nowIso,
  };
}

function validateLeadAutoReplyTemplate(template: LeadAutoReplyTemplate): void {
  if (!template.subject) {
    throw new LeadEmailError('Template subject is required', false);
  }
  if (!template.html && !template.text) {
    throw new LeadEmailError('Template must include html or text content', false);
  }
  if (template.attachments.length > ATTACHMENT_MAX_COUNT) {
    throw new LeadEmailError(
      `Template supports at most ${ATTACHMENT_MAX_COUNT} attachment URLs`,
      false
    );
  }
  for (const attachment of template.attachments) {
    ensureHttpsAttachmentUrl(attachment.url);
  }
}

function normalizeLeadNotificationTemplatePayload(
  payload: any,
  workspaceId: number
): LeadNotificationTemplate | null {
  if (!payload || typeof payload !== 'object') return null;

  const normalizedWorkspaceId = Number(payload.workspace_id || workspaceId);
  if (!Number.isFinite(normalizedWorkspaceId) || normalizedWorkspaceId <= 0) return null;

  const nowIso = new Date().toISOString();
  const recipientEmail = toLowerTrimmedString(payload.recipient_email);
  const additionalRecipients = normalizeEmailList(payload.additional_recipients, 'additional_recipients')
    .filter((email) => email !== recipientEmail);

  return {
    workspace_id: normalizedWorkspaceId,
    enabled: toBoolean(payload.enabled, false),
    recipient_email: recipientEmail,
    additional_recipients: additionalRecipients,
    subject: toTrimmedString(payload.subject) || DEFAULT_LEAD_NOTIFICATION_SUBJECT,
    html: toTrimmedString(payload.html) || DEFAULT_LEAD_NOTIFICATION_HTML,
    text: toTrimmedString(payload.text) || DEFAULT_LEAD_NOTIFICATION_TEXT,
    ...(toTrimmedString(payload.created_at) ? { created_at: toTrimmedString(payload.created_at) } : {}),
    updated_at: toTrimmedString(payload.updated_at) || nowIso,
  };
}

function validateLeadNotificationTemplate(template: LeadNotificationTemplate): void {
  if (!template.subject) {
    throw new LeadEmailError('Lead notification subject is required', false);
  }
  if (!template.html && !template.text) {
    throw new LeadEmailError('Lead notification template must include html or text content', false);
  }
  if (!Array.isArray(template.additional_recipients)) {
    throw new LeadEmailError('Lead notification additional_recipients must be an array', false);
  }
  if (template.recipient_email && !isValidEmailAddress(template.recipient_email)) {
    throw new LeadEmailError('Lead notification recipient_email must be a valid email address', false);
  }
  for (const email of template.additional_recipients) {
    if (!isValidEmailAddress(email)) {
      throw new LeadEmailError('Lead notification additional_recipients contains an invalid email', false);
    }
  }
  if (template.enabled && !template.recipient_email) {
    throw new LeadEmailError('Lead notification recipient_email is required when enabled', false);
  }
}

function normalizeLeadAssignmentTemplatePayload(
  payload: any,
  workspaceId: number
): LeadAssignmentTemplate | null {
  if (!payload || typeof payload !== 'object') return null;
  const normalizedWorkspaceId = Number(payload.workspace_id || workspaceId);
  if (!normalizedWorkspaceId) return null;
  const nowIso = new Date().toISOString();

  return {
    workspace_id: normalizedWorkspaceId,
    enabled: toBoolean(payload.enabled, false),
    subject: toTrimmedString(payload.subject) || DEFAULT_LEAD_ASSIGNMENT_SUBJECT,
    html: toTrimmedString(payload.html) || DEFAULT_LEAD_ASSIGNMENT_HTML,
    text: toTrimmedString(payload.text) || DEFAULT_LEAD_ASSIGNMENT_TEXT,
    ...(toTrimmedString(payload.created_at) ? { created_at: toTrimmedString(payload.created_at) } : {}),
    updated_at: toTrimmedString(payload.updated_at) || nowIso,
  };
}

function validateLeadAssignmentTemplate(template: LeadAssignmentTemplate): void {
  if (!template.subject) {
    throw new LeadEmailError('Lead assignment notification subject is required', false);
  }
  if (!template.html && !template.text) {
    throw new LeadEmailError('Lead assignment notification template must include html or text content', false);
  }
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '';
    const candidate = pathname.split('/').pop() || '';
    return decodeURIComponent(candidate);
  } catch {
    return '';
  }
}

function ensureHttpsAttachmentUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LeadEmailError(`Invalid attachment URL: ${url}`, false);
  }

  if (parsed.protocol !== 'https:') {
    throw new LeadEmailError(`Attachment URL must use HTTPS: ${url}`, false);
  }

  const hostname = String(parsed.hostname || '').toLowerCase();
  if (!hostname) {
    throw new LeadEmailError(`Attachment URL hostname is invalid: ${url}`, false);
  }
  if (isLocalOrPrivateHostname(hostname)) {
    throw new LeadEmailError(`Attachment URL host is not allowed: ${url}`, false);
  }
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local')) return true;

  const ipv4Match = host.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4Match) {
    const parts = host.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) return true;
    const first = parts[0];
    const second = parts[1];
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && typeof second === 'number' && second >= 16 && second <= 31) return true;
    if (first === 169 && second === 254) return true;
  }

  return false;
}

function inferMimeFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.txt')) return 'text/plain';
  return null;
}

function isRetryableNetworkError(error: unknown): boolean {
  const anyError = error as any;
  const code = anyError?.cause?.code || anyError?.code;
  if (!code) return false;
  return (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'ECONNREFUSED' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH'
  );
}

function toLeadEmailError(error: unknown, fallbackRetryable = true): LeadEmailError {
  if (error instanceof LeadEmailError) return error;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Lead email processing failed';
  const retryable = isRetryableNetworkError(error) || fallbackRetryable;
  return new LeadEmailError(message, retryable);
}

function computeBackoffMs(attempts: number): number {
  const base = 5000;
  const cappedAttempts = Math.max(0, Math.min(10, attempts));
  const ms = base * Math.pow(2, cappedAttempts);
  return Math.min(ms, 5 * 60 * 1000);
}

function buildLeadJobLogUpdate(log: any, overrides: Record<string, unknown>): Record<string, unknown> {
  const payload =
    overrides.payload !== undefined ? String(overrides.payload || '{}') : String(log.payload || '{}');
  const status =
    overrides.status !== undefined ? String(overrides.status || LEAD_EMAIL_JOB_PENDING) : String(log.status || LEAD_EMAIL_JOB_PENDING);

  return {
    workspace_id: Number(log.workspace_id || 0),
    lead_id: Number(log.lead_id || 0),
    source: String(log.source || LEAD_EMAIL_JOB_SOURCE),
    source_old: String(log.source_old || log.source || LEAD_EMAIL_JOB_SOURCE),
    event_id: String(log.event_id || ''),
    payload,
    status,
    error: overrides.error !== undefined ? (overrides.error as any) : log.error || null,
  };
}

async function getLatestWebhookLog(
  params: { workspaceId: number; status: string; eventId: string; source?: string }
): Promise<any | null> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: params.workspaceId,
    status: params.status,
    event_id: params.eventId,
    ...(params.source ? { source: params.source } : {}),
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return null;
  const entries = asArray(response.data)
    .filter(Boolean)
    .sort((a: any, b: any) => Number(b?.id || 0) - Number(a?.id || 0));
  return entries[0] || null;
}

async function getStoredWorkspaceSmtpConfig(
  workspaceId: number
): Promise<StoredRecordResult<WorkspaceSmtpConfig>> {
  const eventId = eventIdForWorkspaceSmtpConfig(workspaceId);
  const log = await getLatestWebhookLog({
    workspaceId,
    status: WORKSPACE_SMTP_CONFIG_STATUS,
    eventId,
    source: SMTP_CONFIG_SOURCE,
  });

  if (!log) return { value: null };

  const parsed = safeJsonParse(log.payload);
  const payload = parsed?.config ?? parsed;
  const config = normalizeSmtpConfigPayload(payload, workspaceId);

  if (!config) return { value: null };
  return {
    value: config,
    logId: Number(log.id || 0) || undefined,
    eventId: typeof log.event_id === 'string' ? log.event_id : eventId,
  };
}

async function getStoredLeadAutoReplyTemplate(
  workspaceId: number
): Promise<StoredRecordResult<LeadAutoReplyTemplate>> {
  const eventId = eventIdForLeadTemplate(workspaceId);
  const log = await getLatestWebhookLog({
    workspaceId,
    status: LEAD_AUTOREPLY_TEMPLATE_STATUS,
    eventId,
    source: LEAD_AUTOREPLY_SOURCE,
  });

  if (!log) return { value: null };

  const parsed = safeJsonParse(log.payload);
  const payload = parsed?.template ?? parsed;
  const template = normalizeLeadAutoReplyTemplatePayload(payload, workspaceId);

  if (!template) return { value: null };
  return {
    value: template,
    logId: Number(log.id || 0) || undefined,
    eventId: typeof log.event_id === 'string' ? log.event_id : eventId,
  };
}

async function getStoredLeadNotificationTemplate(
  workspaceId: number
): Promise<StoredRecordResult<LeadNotificationTemplate>> {
  const eventId = eventIdForLeadNotificationTemplate(workspaceId);
  const log = await getLatestWebhookLog({
    workspaceId,
    status: LEAD_NOTIFICATION_TEMPLATE_STATUS,
    eventId,
    source: LEAD_NOTIFICATION_SOURCE,
  });

  if (!log) return { value: null };

  const parsed = safeJsonParse(log.payload);
  const payload = parsed?.template ?? parsed;
  const template = normalizeLeadNotificationTemplatePayload(payload, workspaceId);

  if (!template) return { value: null };
  return {
    value: template,
    logId: Number(log.id || 0) || undefined,
    eventId: typeof log.event_id === 'string' ? log.event_id : eventId,
  };
}

async function getStoredLeadAssignmentTemplate(
  workspaceId: number
): Promise<StoredRecordResult<LeadAssignmentTemplate>> {
  const eventId = eventIdForLeadAssignmentTemplate(workspaceId);
  const log = await getLatestWebhookLog({
    workspaceId,
    status: LEAD_ASSIGNMENT_TEMPLATE_STATUS,
    eventId,
    source: LEAD_ASSIGNMENT_SOURCE,
  });

  if (!log) return { value: null };

  const parsed = safeJsonParse(log.payload);
  const payload = parsed?.template ?? parsed;
  const template = normalizeLeadAssignmentTemplatePayload(payload, workspaceId);

  if (!template) return { value: null };
  return {
    value: template,
    logId: Number(log.id || 0) || undefined,
    eventId: typeof log.event_id === 'string' ? log.event_id : eventId,
  };
}

function readWorkspaceAutoReplyReadyCache(workspaceId: number): boolean | null {
  const entry = workspaceAutoReplyReadyCache.get(workspaceId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAtMs) {
    workspaceAutoReplyReadyCache.delete(workspaceId);
    return null;
  }
  return entry.enabled;
}

function writeWorkspaceAutoReplyReadyCache(workspaceId: number, enabled: boolean): void {
  workspaceAutoReplyReadyCache.set(workspaceId, {
    enabled,
    expiresAtMs: Date.now() + WORKSPACE_AUTOREPLY_READY_CACHE_TTL_MS,
  });
}

async function isWorkspaceAutoReplyReady(workspaceId: number): Promise<boolean> {
  const cached = readWorkspaceAutoReplyReadyCache(workspaceId);
  if (cached !== null) return cached;

  const [smtpConfig, template] = await Promise.all([
    getStoredWorkspaceSmtpConfig(workspaceId),
    getStoredLeadAutoReplyTemplate(workspaceId),
  ]);

  const enabled = Boolean(
    smtpConfig.value &&
      template.value &&
      smtpConfig.value.enabled &&
      template.value.enabled
  );
  writeWorkspaceAutoReplyReadyCache(workspaceId, enabled);
  return enabled;
}

export async function getWorkspaceSmtpConfigMasked(
  workspaceId: number
): Promise<WorkspaceSmtpConfigMasked | null> {
  const stored = await getStoredWorkspaceSmtpConfig(workspaceId);
  if (!stored.value) return null;
  return maskSmtpConfig(stored.value);
}

export async function upsertWorkspaceSmtpConfig(
  workspaceId: number,
  input: WorkspaceSmtpConfigInput
): Promise<WorkspaceSmtpConfigMasked> {
  const stored = await getStoredWorkspaceSmtpConfig(workspaceId);
  const existing = stored.value;
  const nowIso = new Date().toISOString();

  const host = toTrimmedString(input.host) || existing?.host || '';
  const username = toTrimmedString(input.username) || existing?.username || '';
  const fromName = toTrimmedString(input.from_name) || existing?.from_name || '';
  const fromEmail = toLowerTrimmedString(input.from_email) || existing?.from_email || '';
  const replyTo =
    toLowerTrimmedString(input.reply_to) ||
    toLowerTrimmedString(existing?.reply_to) ||
    '';

  let passwordEnc = existing?.password_enc || '';
  const incomingPassword = typeof input.password === 'string' ? input.password.trim() : undefined;
  if (incomingPassword !== undefined) {
    if (incomingPassword && !isMaskedPasswordInput(incomingPassword)) {
      passwordEnc = encryptConfigSecret(incomingPassword);
    }
  }

  const normalized: WorkspaceSmtpConfig = {
    workspace_id: workspaceId,
    enabled:
      input.enabled !== undefined
        ? Boolean(input.enabled)
        : existing?.enabled ?? false,
    host,
    port: normalizePort(input.port, existing?.port ?? 587),
    secure:
      input.secure !== undefined
        ? Boolean(input.secure)
        : existing?.secure ?? false,
    username,
    password_enc: passwordEnc,
    from_name: fromName,
    from_email: fromEmail,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(existing?.created_at ? { created_at: existing.created_at } : { created_at: nowIso }),
    updated_at: nowIso,
  };

  // Validate structural fields always (except password which is optional while disabled).
  validateSmtpConfig(normalized, normalized.enabled);

  const eventId = stored.eventId || eventIdForWorkspaceSmtpConfig(workspaceId);
  const payload = JSON.stringify(normalized);

  if (stored.logId) {
    await webhookLogsApi.updateWebhookLog(stored.logId, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: SMTP_CONFIG_SOURCE,
      source_old: SMTP_CONFIG_SOURCE,
      event_id: eventId,
      payload,
      status: WORKSPACE_SMTP_CONFIG_STATUS,
    });
  } else {
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: SMTP_CONFIG_SOURCE,
      source_old: SMTP_CONFIG_SOURCE,
      event_id: eventId,
      payload,
      status: WORKSPACE_SMTP_CONFIG_STATUS,
      created_at: nowIso,
    });
  }

  workspaceAutoReplyReadyCache.delete(workspaceId);

  return maskSmtpConfig(normalized);
}

export async function getLeadAutoReplyTemplate(
  workspaceId: number
): Promise<LeadAutoReplyTemplate | null> {
  const stored = await getStoredLeadAutoReplyTemplate(workspaceId);
  return stored.value;
}

export async function upsertLeadAutoReplyTemplate(
  workspaceId: number,
  input: LeadAutoReplyTemplateInput
): Promise<LeadAutoReplyTemplate> {
  const stored = await getStoredLeadAutoReplyTemplate(workspaceId);
  const existing = stored.value;
  const nowIso = new Date().toISOString();

  const normalized: LeadAutoReplyTemplate = {
    workspace_id: workspaceId,
    enabled:
      input.enabled !== undefined
        ? Boolean(input.enabled)
        : existing?.enabled ?? false,
    subject:
      toTrimmedString(input.subject) || existing?.subject || DEFAULT_LEAD_AUTOREPLY_SUBJECT,
    html:
      toTrimmedString(input.html) || existing?.html || DEFAULT_LEAD_AUTOREPLY_HTML,
    text:
      toTrimmedString(input.text) || existing?.text || DEFAULT_LEAD_AUTOREPLY_TEXT,
    attachments: normalizeTemplateAttachments(input.attachments, existing?.attachments || []),
    ...(existing?.created_at ? { created_at: existing.created_at } : { created_at: nowIso }),
    updated_at: nowIso,
  };

  validateLeadAutoReplyTemplate(normalized);

  const eventId = stored.eventId || eventIdForLeadTemplate(workspaceId);
  const payload = JSON.stringify(normalized);

  if (stored.logId) {
    await webhookLogsApi.updateWebhookLog(stored.logId, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: LEAD_AUTOREPLY_SOURCE,
      source_old: LEAD_AUTOREPLY_SOURCE,
      event_id: eventId,
      payload,
      status: LEAD_AUTOREPLY_TEMPLATE_STATUS,
    });
  } else {
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: LEAD_AUTOREPLY_SOURCE,
      source_old: LEAD_AUTOREPLY_SOURCE,
      event_id: eventId,
      payload,
      status: LEAD_AUTOREPLY_TEMPLATE_STATUS,
      created_at: nowIso,
    });
  }

  workspaceAutoReplyReadyCache.delete(workspaceId);

  return normalized;
}

export async function getLeadNotificationTemplate(
  workspaceId: number
): Promise<LeadNotificationTemplate | null> {
  const stored = await getStoredLeadNotificationTemplate(workspaceId);
  return stored.value;
}

export async function upsertLeadNotificationTemplate(
  workspaceId: number,
  input: LeadNotificationTemplateInput
): Promise<LeadNotificationTemplate> {
  const stored = await getStoredLeadNotificationTemplate(workspaceId);
  const existing = stored.value;
  const nowIso = new Date().toISOString();

  const hasRecipientEmail = Object.prototype.hasOwnProperty.call(input, 'recipient_email');
  const normalizedRecipientEmail = hasRecipientEmail
    ? toLowerTrimmedString(input.recipient_email)
    : toLowerTrimmedString(existing?.recipient_email);
  const hasAdditionalRecipients = Object.prototype.hasOwnProperty.call(input, 'additional_recipients');
  const normalizedAdditionalRecipients = hasAdditionalRecipients
    ? normalizeEmailList(input.additional_recipients, 'additional_recipients')
    : normalizeEmailList(existing?.additional_recipients || [], 'additional_recipients');
  const additionalRecipients = normalizedAdditionalRecipients.filter(
    (email) => email !== normalizedRecipientEmail
  );

  const normalized: LeadNotificationTemplate = {
    workspace_id: workspaceId,
    enabled:
      input.enabled !== undefined
        ? Boolean(input.enabled)
        : existing?.enabled ?? false,
    recipient_email: normalizedRecipientEmail,
    additional_recipients: additionalRecipients,
    subject:
      toTrimmedString(input.subject) || existing?.subject || DEFAULT_LEAD_NOTIFICATION_SUBJECT,
    html:
      toTrimmedString(input.html) || existing?.html || DEFAULT_LEAD_NOTIFICATION_HTML,
    text:
      toTrimmedString(input.text) || existing?.text || DEFAULT_LEAD_NOTIFICATION_TEXT,
    ...(existing?.created_at ? { created_at: existing.created_at } : { created_at: nowIso }),
    updated_at: nowIso,
  };

  validateLeadNotificationTemplate(normalized);

  const eventId = stored.eventId || eventIdForLeadNotificationTemplate(workspaceId);
  const payload = JSON.stringify(normalized);

  if (stored.logId) {
    await webhookLogsApi.updateWebhookLog(stored.logId, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: LEAD_NOTIFICATION_SOURCE,
      source_old: LEAD_NOTIFICATION_SOURCE,
      event_id: eventId,
      payload,
      status: LEAD_NOTIFICATION_TEMPLATE_STATUS,
    });
  } else {
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: LEAD_NOTIFICATION_SOURCE,
      source_old: LEAD_NOTIFICATION_SOURCE,
      event_id: eventId,
      payload,
      status: LEAD_NOTIFICATION_TEMPLATE_STATUS,
      created_at: nowIso,
    });
  }

  return normalized;
}

export async function getLeadAssignmentTemplate(
  workspaceId: number
): Promise<LeadAssignmentTemplate | null> {
  const stored = await getStoredLeadAssignmentTemplate(workspaceId);
  return stored.value;
}

export async function upsertLeadAssignmentTemplate(
  workspaceId: number,
  input: LeadAssignmentTemplateInput
): Promise<LeadAssignmentTemplate> {
  const stored = await getStoredLeadAssignmentTemplate(workspaceId);
  const existing = stored.value;
  const nowIso = new Date().toISOString();

  const normalized: LeadAssignmentTemplate = {
    workspace_id: workspaceId,
    enabled:
      input.enabled !== undefined
        ? Boolean(input.enabled)
        : existing?.enabled ?? false,
    subject:
      toTrimmedString(input.subject) || existing?.subject || DEFAULT_LEAD_ASSIGNMENT_SUBJECT,
    html:
      toTrimmedString(input.html) || existing?.html || DEFAULT_LEAD_ASSIGNMENT_HTML,
    text:
      toTrimmedString(input.text) || existing?.text || DEFAULT_LEAD_ASSIGNMENT_TEXT,
    ...(existing?.created_at ? { created_at: existing.created_at } : { created_at: nowIso }),
    updated_at: nowIso,
  };

  validateLeadAssignmentTemplate(normalized);

  const eventId = stored.eventId || eventIdForLeadAssignmentTemplate(workspaceId);
  const payload = JSON.stringify(normalized);

  if (stored.logId) {
    await webhookLogsApi.updateWebhookLog(stored.logId, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: LEAD_ASSIGNMENT_SOURCE,
      source_old: LEAD_ASSIGNMENT_SOURCE,
      event_id: eventId,
      payload,
      status: LEAD_ASSIGNMENT_TEMPLATE_STATUS,
    });
  } else {
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: 0,
      source: LEAD_ASSIGNMENT_SOURCE,
      source_old: LEAD_ASSIGNMENT_SOURCE,
      event_id: eventId,
      payload,
      status: LEAD_ASSIGNMENT_TEMPLATE_STATUS,
      created_at: nowIso,
    });
  }

  return normalized;
}

async function fetchAttachmentWithLimits(
  attachment: LeadAutoReplyTemplateAttachment
): Promise<PreparedAttachment> {
  ensureHttpsAttachmentUrl(attachment.url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ATTACHMENT_TIMEOUT_MS);

  let response: globalThis.Response;
  try {
    response = await fetch(attachment.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (isRetryableNetworkError(error)) {
      throw new LeadEmailError('Attachment fetch failed due to network error', true);
    }
    throw new LeadEmailError('Attachment fetch failed', false);
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new LeadEmailError(
      `Attachment URL returned ${response.status} for ${attachment.filename}`,
      retryable
    );
  }

  const contentLengthHeader = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLengthHeader) && contentLengthHeader > ATTACHMENT_MAX_BYTES) {
    throw new LeadEmailError(
      `Attachment ${attachment.filename} exceeds max size of ${ATTACHMENT_MAX_BYTES} bytes`,
      false
    );
  }

  const body = response.body;
  if (!body) {
    throw new LeadEmailError(`Attachment ${attachment.filename} returned an empty response body`, false);
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > ATTACHMENT_MAX_BYTES) {
        throw new LeadEmailError(
          `Attachment ${attachment.filename} exceeds max size of ${ATTACHMENT_MAX_BYTES} bytes`,
          false
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof LeadEmailError) {
      throw error;
    }
    throw new LeadEmailError(`Attachment download failed for ${attachment.filename}`, true);
  } finally {
    reader.releaseLock();
  }

  const contentTypeHeader =
    String(response.headers.get('content-type') || '')
      .split(';')
      .at(0)
      ?.trim()
      .toLowerCase() || '';
  const inferredMime = inferMimeFromFilename(attachment.filename);
  const contentType = contentTypeHeader || inferredMime || undefined;

  if (!contentType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(contentType)) {
    throw new LeadEmailError(
      `Attachment ${attachment.filename} has unsupported MIME type (${contentType || 'unknown'})`,
      false
    );
  }

  return {
    filename: attachment.filename,
    content: Buffer.concat(chunks),
    contentType,
  };
}

async function resolveTemplateAttachments(
  attachments: LeadAutoReplyTemplateAttachment[]
): Promise<PreparedAttachment[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  if (attachments.length > ATTACHMENT_MAX_COUNT) {
    throw new LeadEmailError(
      `A maximum of ${ATTACHMENT_MAX_COUNT} attachment URLs is supported`,
      false
    );
  }

  const prepared: PreparedAttachment[] = [];
  let totalBytes = 0;

  for (const attachment of attachments) {
    const item = await fetchAttachmentWithLimits(attachment);
    totalBytes += item.content.byteLength;
    if (totalBytes > ATTACHMENT_TOTAL_MAX_BYTES) {
      throw new LeadEmailError(
        `Total attachment bytes exceed ${ATTACHMENT_TOTAL_MAX_BYTES} bytes`,
        false
      );
    }
    prepared.push(item);
  }

  return prepared;
}

async function resolveWorkspaceSmtpForSend(workspaceId: number): Promise<WorkspaceSmtpConfig> {
  const stored = await getStoredWorkspaceSmtpConfig(workspaceId);
  if (!stored.value) {
    throw new LeadEmailError('Workspace SMTP configuration is not set', false);
  }
  validateSmtpConfig(stored.value, true);
  return stored.value;
}

function createFromAddress(config: WorkspaceSmtpConfig): string {
  const fromEmail = config.from_email;
  const fromName = toTrimmedString(config.from_name);
  if (!fromName) return fromEmail;
  const escapedName = fromName.replace(/"/g, '\\"');
  return `"${escapedName}" <${fromEmail}>`;
}

async function sendWithWorkspaceSmtp(
  config: WorkspaceSmtpConfig,
  params: {
    to: string;
    cc?: string[];
    subject: string;
    html: string;
    text: string;
    attachments?: PreparedAttachment[];
  }
): Promise<SendLeadAutoReplyEmailResult> {
  let decryptedPassword = '';
  try {
    decryptedPassword = decryptConfigSecret(config.password_enc);
  } catch {
    throw new LeadEmailError('Failed to decrypt SMTP password for this workspace', false);
  }

  if (!decryptedPassword) {
    throw new LeadEmailError('SMTP password is missing', false);
  }

  console.log(`[SMTP Debug] Connecting to ${config.host}:${config.port} (secure: ${config.secure}, user: ${config.username}, from: ${config.from_email})`);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: decryptedPassword,
    },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });

  try {
    const info = await transporter.sendMail({
      from: createFromAddress(config),
      to: params.to,
      ...(params.cc && params.cc.length > 0 ? { cc: params.cc } : {}),
      ...(config.reply_to ? { replyTo: config.reply_to } : {}),
      subject: params.subject,
      html: params.html,
      text: params.text,
      ...(params.attachments && params.attachments.length > 0
        ? {
            attachments: params.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
            })),
          }
        : {}),
    });

    return {
      messageId: String(info?.messageId || ''),
    };
  } catch (error) {
    throw new LeadEmailError(
      error instanceof Error ? error.message : 'SMTP send failed',
      true
    );
  } finally {
    transporter.close();
  }
}

export async function sendLeadAutoReplyEmail(
  options: SendLeadAutoReplyEmailOptions
): Promise<SendLeadAutoReplyEmailResult> {
  const workspaceId = Number(options.workspaceId || 0);
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
    throw new LeadEmailError('workspaceId is required', false);
  }

  const recipientEmail = toLowerTrimmedString(options.toEmail);
  if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
    throw new LeadEmailError('A valid recipient email is required', false);
  }

  const smtpConfig = await resolveWorkspaceSmtpForSend(workspaceId);
  const template = options.templateOverride ?? (await getLeadAutoReplyTemplate(workspaceId));

  if (!template) {
    throw new LeadEmailError('Lead auto-reply template is not configured', false);
  }

  if (!options.bypassEnabledCheck) {
    if (!smtpConfig.enabled) {
      throw new LeadEmailError('Workspace SMTP config is disabled', false);
    }
    if (!template.enabled) {
      throw new LeadEmailError('Lead auto-reply template is disabled', false);
    }
  }

  const lead = {
    id: Number(options.lead.id || 0),
    name: toTrimmedString(options.lead.name) || 'there',
    email: toLowerTrimmedString(options.lead.email) || recipientEmail,
    ...(toTrimmedString(options.lead.phone) ? { phone: toTrimmedString(options.lead.phone) } : {}),
    ...(toTrimmedString(options.lead.source_old)
      ? { source_old: toTrimmedString(options.lead.source_old) }
      : {}),
    ...(toTrimmedString(options.lead.source_ref)
      ? { source_ref: toTrimmedString(options.lead.source_ref) }
      : {}),
    ...(toTrimmedString(options.lead.created_at)
      ? { created_at: toTrimmedString(options.lead.created_at) }
      : {}),
  };

  const context = {
    lead,
    workspace: {
      id: workspaceId,
    },
    now: new Date().toISOString(),
  };

  const subjectTemplate = toTrimmedString(options.subjectOverride) || template.subject;
  const htmlTemplate =
    options.htmlOverride !== undefined ? String(options.htmlOverride) : template.html;
  const textTemplate =
    options.textOverride !== undefined ? String(options.textOverride) : template.text;

  const subject = interpolateTemplate(subjectTemplate, context).trim();
  const html = htmlTemplate
    ? interpolateTemplate(htmlTemplate, context, { escapeHtmlValues: true })
    : '';
  const textSource = textTemplate || stripHtmlTags(htmlTemplate || '');
  const text = textSource ? interpolateTemplate(textSource, context) : '';

  if (!subject) {
    throw new LeadEmailError('Email subject is empty after rendering', false);
  }
  if (!html && !text) {
    throw new LeadEmailError('Email content is empty after rendering', false);
  }

  const preparedAttachments = await resolveTemplateAttachments(template.attachments || []);

  return sendWithWorkspaceSmtp(smtpConfig, {
    to: recipientEmail,
    subject,
    html,
    text,
    attachments: preparedAttachments,
  });
}

export async function sendWorkspaceSmtpTestEmail(
  workspaceId: number,
  toEmail: string
): Promise<SendLeadAutoReplyEmailResult> {
  const smtpConfig = await resolveWorkspaceSmtpForSend(workspaceId);
  const recipient = toLowerTrimmedString(toEmail);
  if (!recipient || !isValidEmailAddress(recipient)) {
    throw new LeadEmailError('A valid test email recipient is required', false);
  }

  return sendWithWorkspaceSmtp(smtpConfig, {
    to: recipient,
    subject: `SMTP test successful (${workspaceId})`,
    html:
      `<p>This is a test email from your workspace SMTP configuration.</p>` +
      `<p>Workspace ID: ${workspaceId}</p>` +
      `<p>Sent at: ${new Date().toISOString()}</p>`,
    text:
      `This is a test email from your workspace SMTP configuration. ` +
      `Workspace ID: ${workspaceId}. Sent at: ${new Date().toISOString()}.`,
  });
}

export async function sendLeadAutoReplyTemplateTestEmail(
  workspaceId: number,
  toEmail: string,
  testLead?: Partial<LeadAutoReplyLeadContext>
): Promise<SendLeadAutoReplyEmailResult> {
  const template = await getLeadAutoReplyTemplate(workspaceId);
  if (!template) {
    throw new LeadEmailError('Lead auto-reply template is not configured', false);
  }

  const recipient = toLowerTrimmedString(toEmail);
  if (!recipient || !isValidEmailAddress(recipient)) {
    throw new LeadEmailError('A valid test email recipient is required', false);
  }

  const sampleLead: LeadAutoReplyLeadContext = {
    id: Number(testLead?.id || 0),
    name: toTrimmedString(testLead?.name) || 'Sample Lead',
    email: toLowerTrimmedString(testLead?.email) || recipient,
    ...(toTrimmedString(testLead?.phone) ? { phone: toTrimmedString(testLead?.phone) } : {}),
    ...(toTrimmedString(testLead?.source_old)
      ? { source_old: toTrimmedString(testLead?.source_old) }
      : { source_old: 'MANUAL' }),
    ...(toTrimmedString(testLead?.source_ref)
      ? { source_ref: toTrimmedString(testLead?.source_ref) }
      : { source_ref: 'preview-test' }),
  };

  return sendLeadAutoReplyEmail({
    workspaceId,
    toEmail: recipient,
    lead: sampleLead,
    templateOverride: template,
    bypassEnabledCheck: true,
  });
}

async function sendLeadNotificationEmail(
  options: SendLeadNotificationEmailOptions
): Promise<SendLeadAutoReplyEmailResult> {
  const workspaceId = Number(options.workspaceId || 0);
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
    throw new LeadEmailError('workspaceId is required', false);
  }

  const smtpConfig = await resolveWorkspaceSmtpForSend(workspaceId);
  const template = options.templateOverride ?? (await getLeadNotificationTemplate(workspaceId));

  if (!template) {
    throw new LeadEmailError('Lead notification template is not configured', false);
  }

  const recipient = toLowerTrimmedString(options.recipientOverride) || toLowerTrimmedString(template.recipient_email);
  if (!recipient || !isValidEmailAddress(recipient)) {
    throw new LeadEmailError('Lead notification recipient_email is missing or invalid', false);
  }
  const ccRecipients = normalizeEmailList(template.additional_recipients || [], 'additional_recipients')
    .filter((email) => email !== recipient);

  if (!options.bypassEnabledCheck) {
    if (!smtpConfig.enabled) {
      throw new LeadEmailError('Workspace SMTP config is disabled', false);
    }
    if (!template.enabled) {
      throw new LeadEmailError('Lead notification template is disabled', false);
    }
  }

  const leadEmail = toLowerTrimmedString(options.lead.email);
  const fallbackLeadName = leadEmail ? leadEmail.split('@')[0] : `lead-${Date.now()}`;
  const lead = {
    id: Number(options.lead.id || 0),
    name: toTrimmedString(options.lead.name) || fallbackLeadName,
    email: leadEmail,
    ...(toTrimmedString(options.lead.phone) ? { phone: toTrimmedString(options.lead.phone) } : {}),
    ...(toTrimmedString(options.lead.source_old)
      ? { source_old: toTrimmedString(options.lead.source_old) }
      : {}),
    ...(toTrimmedString(options.lead.source_ref)
      ? { source_ref: toTrimmedString(options.lead.source_ref) }
      : {}),
    ...(toTrimmedString(options.lead.created_at)
      ? { created_at: toTrimmedString(options.lead.created_at) }
      : {}),
  };

  const context = {
    lead,
    workspace: {
      id: workspaceId,
    },
    now: new Date().toISOString(),
  };

  const subjectTemplate = toTrimmedString(template.subject) || DEFAULT_LEAD_NOTIFICATION_SUBJECT;
  const htmlTemplate = template.html || DEFAULT_LEAD_NOTIFICATION_HTML;
  const textTemplate = template.text || DEFAULT_LEAD_NOTIFICATION_TEXT;

  const subject = interpolateTemplate(subjectTemplate, context).trim();
  const html = htmlTemplate
    ? interpolateTemplate(htmlTemplate, context, { escapeHtmlValues: true })
    : '';
  const textSource = textTemplate || stripHtmlTags(htmlTemplate || '');
  const text = textSource ? interpolateTemplate(textSource, context) : '';

  if (!subject) {
    throw new LeadEmailError('Lead notification subject is empty after rendering', false);
  }
  if (!html && !text) {
    throw new LeadEmailError('Lead notification content is empty after rendering', false);
  }

  return sendWithWorkspaceSmtp(smtpConfig, {
    to: recipient,
    cc: ccRecipients,
    subject,
    html,
    text,
  });
}

export async function sendLeadNotificationForNewLead(
  input: LeadNotificationDispatchInput
): Promise<LeadNotificationDispatchResult> {
  const workspaceId = Number(input.workspaceId || 0);
  const leadId = Number(input.leadId || 0);

  if (!Number.isFinite(workspaceId) || workspaceId <= 0 || !Number.isFinite(leadId) || leadId <= 0) {
    return {
      sent: false,
      reason: 'invalid_workspace_or_lead_id',
    };
  }

  const normalizedLeadEmail = toLowerTrimmedString(input.leadEmail);
  const leadName = toTrimmedString(input.leadName) || normalizedLeadEmail.split('@')[0] || `Lead ${leadId}`;

  try {
    const result = await sendLeadNotificationEmail({
      workspaceId,
      lead: {
        id: leadId,
        name: leadName,
        email: normalizedLeadEmail,
        ...(toTrimmedString(input.leadPhone) ? { phone: toTrimmedString(input.leadPhone) } : {}),
        ...(toTrimmedString(input.leadSource)
          ? { source_old: toTrimmedString(input.leadSource) }
          : {}),
        ...(toTrimmedString(input.leadSourceRef)
          ? { source_ref: toTrimmedString(input.leadSourceRef) }
          : {}),
        ...(toTrimmedString(input.leadCreatedAt)
          ? { created_at: toTrimmedString(input.leadCreatedAt) }
          : {}),
      },
    });

    return {
      sent: true,
      ...(result.messageId ? { messageId: result.messageId } : {}),
    };
  } catch (error) {
    const normalizedError = toLeadEmailError(error, false);
    return {
      sent: false,
      reason: String(normalizedError.message || 'lead_notification_send_failed'),
    };
  }
}

export async function sendLeadAssignmentNotification(
  input: LeadAssignmentNotificationInput
): Promise<LeadAssignmentNotificationResult> {
  const workspaceId = Number(input.workspaceId || 0);
  const leadId = Number(input.leadId || 0);

  if (!Number.isFinite(workspaceId) || workspaceId <= 0 || !Number.isFinite(leadId) || leadId <= 0) {
    return { sent: false, reason: 'invalid_workspace_or_lead_id' };
  }

  const assigneeEmail = toLowerTrimmedString(input.assigneeEmail);
  if (!assigneeEmail || !isValidEmailAddress(assigneeEmail)) {
    return { sent: false, reason: 'invalid_assignee_email' };
  }

  try {
    const smtpConfig = await resolveWorkspaceSmtpForSend(workspaceId);
    if (!smtpConfig.enabled) {
      return { sent: false, reason: 'smtp_disabled' };
    }

    const template = await getLeadAssignmentTemplate(workspaceId);
    if (!template || !template.enabled) {
      return { sent: false, reason: 'assignment_template_disabled' };
    }

    const assigneeName = toTrimmedString(input.assigneeName) || assigneeEmail.split('@')[0];
    const assignerName = toTrimmedString(input.assignerName) || 'Someone';
    const leadName = toTrimmedString(input.leadName) || `Lead ${leadId}`;
    const leadEmail = toLowerTrimmedString(input.leadEmail);
    const leadPhone = toTrimmedString(input.leadPhone);

    const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');

    const context: Record<string, any> = {
      lead: {
        id: leadId,
        name: leadName,
        email: leadEmail,
        phone: leadPhone,
      },
      assignee: { name: assigneeName, email: assigneeEmail },
      assigner: { name: assignerName },
      workspace: { id: workspaceId },
    };

    const subjectTemplate = template?.subject || DEFAULT_LEAD_ASSIGNMENT_SUBJECT;
    const htmlTemplate = template?.html || DEFAULT_LEAD_ASSIGNMENT_HTML;
    const textTemplate = template?.text || DEFAULT_LEAD_ASSIGNMENT_TEXT;

    let htmlBody = interpolateTemplate(htmlTemplate, context, { escapeHtmlValues: true });
    if (appUrl) {
      htmlBody += `<p><a href="${escapeHtml(appUrl)}/leads/${leadId}">View lead</a></p>`;
    }

    const subject = interpolateTemplate(subjectTemplate, context).trim();
    const text = interpolateTemplate(textTemplate, context);

    const result = await sendWithWorkspaceSmtp(smtpConfig, {
      to: assigneeEmail,
      subject,
      html: htmlBody,
      text,
    });

    return {
      sent: true,
      ...(result.messageId ? { messageId: result.messageId } : {}),
    };
  } catch (error) {
    const normalizedError = toLeadEmailError(error, false);
    return {
      sent: false,
      reason: String(normalizedError.message || 'assignment_notification_send_failed'),
    };
  }
}

async function hasAnyLeadEmailJobLog(workspaceId: number, eventId: string): Promise<boolean> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    event_id: eventId,
    source: LEAD_EMAIL_JOB_SOURCE,
    limit: 10,
    sort: 'id',
    order: 'desc',
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return false;
  const logs = asArray(response.data);
  return logs.length > 0;
}

async function hasCompletedLeadEmailJob(
  workspaceId: number,
  eventId: string,
  excludeLogId: number
): Promise<boolean> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: LEAD_EMAIL_JOB_COMPLETED,
    event_id: eventId,
    source: LEAD_EMAIL_JOB_SOURCE,
    limit: 10,
    sort: 'id',
    order: 'desc',
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return false;
  const logs = asArray(response.data);
  return logs.some((log) => Number((log as any)?.id || 0) !== excludeLogId);
}

export async function enqueueLeadAutoReplyEmailJob(
  input: LeadAutoReplyQueueInput
): Promise<EnqueueLeadAutoReplyResult> {
  const workspaceId = Number(input.workspaceId || 0);
  const leadId = Number(input.leadId || 0);
  const eventId = buildLeadEmailJobEventId(workspaceId, leadId);

  if (!LEAD_EMAIL_JOB_POLL_ENABLED) {
    return {
      queued: false,
      reason: 'lead_email_worker_disabled',
      eventId,
    };
  }

  if (!Number.isFinite(workspaceId) || workspaceId <= 0 || !Number.isFinite(leadId) || leadId <= 0) {
    return {
      queued: false,
      reason: 'invalid_workspace_or_lead_id',
      eventId,
    };
  }

  const recipientEmail = toLowerTrimmedString(input.leadEmail);
  if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
    return {
      queued: false,
      reason: 'lead_missing_valid_email',
      eventId,
    };
  }

  const isReady = await isWorkspaceAutoReplyReady(workspaceId);
  if (!isReady) {
    return {
      queued: false,
      reason: 'smtp_or_template_not_ready',
      eventId,
    };
  }

  const alreadyExists = await hasAnyLeadEmailJobLog(workspaceId, eventId);
  if (alreadyExists) {
    return {
      queued: false,
      reason: 'job_already_exists',
      eventId,
    };
  }

  const nowIso = new Date().toISOString();
  const payload: LeadAutoReplyJobPayload = {
    kind: 'lead_autoreply_email_job',
    workspaceId,
    leadId,
    toEmail: recipientEmail,
    lead: {
      id: leadId,
      name: toTrimmedString(input.leadName) || recipientEmail.split('@')[0] || 'there',
      email: recipientEmail,
      ...(toTrimmedString(input.leadPhone) ? { phone: toTrimmedString(input.leadPhone) } : {}),
      ...(toTrimmedString(input.leadSource)
        ? { source_old: toTrimmedString(input.leadSource) }
        : {}),
      ...(toTrimmedString(input.leadSourceRef)
        ? { source_ref: toTrimmedString(input.leadSourceRef) }
        : {}),
      ...(toTrimmedString(input.leadCreatedAt)
        ? { created_at: toTrimmedString(input.leadCreatedAt) }
        : {}),
    },
    attempts: 0,
    nextRunAt: nowIso,
    createdAt: nowIso,
  };

  await webhookLogsApi.createWebhookLog({
    workspace_id: workspaceId,
    lead_id: leadId,
    source: LEAD_EMAIL_JOB_SOURCE,
    source_old: LEAD_EMAIL_JOB_SOURCE,
    event_id: eventId,
    payload: JSON.stringify(payload),
    status: LEAD_EMAIL_JOB_PENDING,
    created_at: nowIso,
  });

  return {
    queued: true,
    eventId,
  };
}

async function findDuePendingLeadEmailJobLog(): Promise<any | null> {
  const nowMs = Date.now();

  for (let page = 1; page <= LEAD_EMAIL_JOB_MAX_PAGES; page++) {
    const response = (await webhookLogsApi.getWebhookLogs({
      status: LEAD_EMAIL_JOB_PENDING,
      source: LEAD_EMAIL_JOB_SOURCE,
      page,
      limit: LEAD_EMAIL_JOB_FETCH_LIMIT,
      sort: 'id',
      order: 'asc',
      cache: 'no-store',
    })) as ApiResponse<WebhookLog[]>;

    if (response.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }

    const log = response.data.find((entry: any) => {
      const payload = safeJsonParse(entry?.payload);
      const nextRunAtMs = payload?.nextRunAt ? Date.parse(payload.nextRunAt) : nowMs;
      return Number.isFinite(nextRunAtMs) && nextRunAtMs <= nowMs;
    });

    if (log) return log;
    if (response.data.length < LEAD_EMAIL_JOB_FETCH_LIMIT) return null;
  }

  return null;
}

async function findStaleProcessingLeadEmailJobLog(): Promise<any | null> {
  const nowMs = Date.now();

  for (let page = 1; page <= LEAD_EMAIL_JOB_MAX_PAGES; page++) {
    const response = (await webhookLogsApi.getWebhookLogs({
      status: LEAD_EMAIL_JOB_PROCESSING,
      source: LEAD_EMAIL_JOB_SOURCE,
      page,
      limit: LEAD_EMAIL_JOB_FETCH_LIMIT,
      sort: 'id',
      order: 'asc',
      cache: 'no-store',
    })) as ApiResponse<WebhookLog[]>;

    if (response.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }

    const log = response.data.find((entry: any) => {
      const payload = safeJsonParse(entry?.payload);
      const lastStartedAt = payload?.lastStartedAt ? Date.parse(payload.lastStartedAt) : NaN;
      return Number.isFinite(lastStartedAt) && nowMs - lastStartedAt > LEAD_EMAIL_JOB_STALE_MS;
    });

    if (log) return log;
    if (response.data.length < LEAD_EMAIL_JOB_FETCH_LIMIT) return null;
  }

  return null;
}

function parseLeadAutoReplyJobPayload(payloadRaw: unknown): LeadAutoReplyJobPayload | null {
  const payload = safeJsonParse(payloadRaw);
  if (!payload || typeof payload !== 'object') return null;

  const workspaceId = Number(payload.workspaceId || 0);
  const leadId = Number(payload.leadId || 0);
  const toEmail = toLowerTrimmedString(payload.toEmail);
  const leadObj = payload.lead && typeof payload.lead === 'object' ? payload.lead : null;
  const leadName = toTrimmedString(leadObj?.name);

  if (!Number.isFinite(workspaceId) || workspaceId <= 0) return null;
  if (!Number.isFinite(leadId) || leadId <= 0) return null;
  if (!toEmail || !isValidEmailAddress(toEmail)) return null;
  if (!leadObj || !leadName) return null;

  const attempts = Number(payload.attempts || 0);
  const normalizedAttempts = Number.isFinite(attempts) && attempts >= 0 ? Math.floor(attempts) : 0;

  return {
    kind: 'lead_autoreply_email_job',
    workspaceId,
    leadId,
    toEmail,
    lead: {
      id: leadId,
      name: leadName,
      email: toLowerTrimmedString(leadObj?.email) || toEmail,
      ...(toTrimmedString(leadObj?.phone) ? { phone: toTrimmedString(leadObj.phone) } : {}),
      ...(toTrimmedString(leadObj?.source_old)
        ? { source_old: toTrimmedString(leadObj.source_old) }
        : {}),
      ...(toTrimmedString(leadObj?.source_ref)
        ? { source_ref: toTrimmedString(leadObj.source_ref) }
        : {}),
      ...(toTrimmedString(leadObj?.created_at)
        ? { created_at: toTrimmedString(leadObj.created_at) }
        : {}),
    },
    attempts: normalizedAttempts,
    nextRunAt: toTrimmedString(payload.nextRunAt) || new Date().toISOString(),
    createdAt: toTrimmedString(payload.createdAt) || new Date().toISOString(),
    ...(toTrimmedString(payload.lastStartedAt)
      ? { lastStartedAt: toTrimmedString(payload.lastStartedAt) }
      : {}),
    ...(toTrimmedString(payload.lastCompletedAt)
      ? { lastCompletedAt: toTrimmedString(payload.lastCompletedAt) }
      : {}),
    ...(toTrimmedString(payload.lastErrorAt)
      ? { lastErrorAt: toTrimmedString(payload.lastErrorAt) }
      : {}),
    ...(toTrimmedString(payload.messageId) ? { messageId: toTrimmedString(payload.messageId) } : {}),
    ...(toTrimmedString(payload.workerClaimId)
      ? { workerClaimId: toTrimmedString(payload.workerClaimId) }
      : {}),
    ...(toTrimmedString(payload.workerClaimedAt)
      ? { workerClaimedAt: toTrimmedString(payload.workerClaimedAt) }
      : {}),
  };
}

function logLeadEmailWorkerInfo(message: string, context?: Record<string, unknown>): void {
  if (context && Object.keys(context).length > 0) {
    console.info(`[Lead Email Worker] ${message}`, context);
    return;
  }
  console.info(`[Lead Email Worker] ${message}`);
}

async function findLeadEmailJobLogByIdAndStatus(log: any, status: string): Promise<any | null> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: Number(log.workspace_id || 0),
    status,
    event_id: String(log.event_id || ''),
    source: LEAD_EMAIL_JOB_SOURCE,
    limit: 10,
    sort: 'id',
    order: 'desc',
    cache: 'no-store',
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !Array.isArray(response.data)) return null;
  return response.data.find((entry) => Number((entry as any)?.id) === Number(log.id)) || null;
}

async function claimLeadEmailJobLog(
  log: any,
  claimedPayload: LeadAutoReplyJobPayload,
  workerId: string
): Promise<boolean> {
  await webhookLogsApi.updateWebhookLog(
    Number(log.id),
    buildLeadJobLogUpdate(log, {
      payload: JSON.stringify(claimedPayload),
      status: LEAD_EMAIL_JOB_PROCESSING,
      error: null,
    })
  );

  const claimed = await findLeadEmailJobLogByIdAndStatus(log, LEAD_EMAIL_JOB_PROCESSING);
  const verifiedPayload = parseLeadAutoReplyJobPayload(claimed?.payload);
  return verifiedPayload?.workerClaimId === workerId;
}

export async function processOneLeadAutoReplyEmailJob(workerId = `local-${process.pid}`): Promise<boolean> {
  if (!LEAD_EMAIL_JOB_POLL_ENABLED) return false;

  const staleLog = await findStaleProcessingLeadEmailJobLog();
  if (staleLog) {
    const stalePayload = parseLeadAutoReplyJobPayload(staleLog.payload);
    if (stalePayload) {
      const requeuedPayload: LeadAutoReplyJobPayload = {
        ...stalePayload,
        nextRunAt: new Date().toISOString(),
        lastErrorAt: new Date().toISOString(),
      };

      await webhookLogsApi.updateWebhookLog(
        Number(staleLog.id),
        buildLeadJobLogUpdate(staleLog, {
          payload: JSON.stringify(requeuedPayload),
          status: LEAD_EMAIL_JOB_PENDING,
          error: 'Requeued stale lead email job',
        })
      );

      logLeadEmailWorkerInfo('Requeued stale job', {
        logId: staleLog.id,
        eventId: staleLog.event_id,
      });
      return true;
    }
  }

  const log = await findDuePendingLeadEmailJobLog();
  if (!log) return false;

  const payload = parseLeadAutoReplyJobPayload(log.payload);
  if (!payload) {
    await webhookLogsApi.updateWebhookLog(
      Number(log.id),
      buildLeadJobLogUpdate(log, {
        status: LEAD_EMAIL_JOB_FAILED,
        error: 'Invalid lead email job payload',
      })
    );
    return true;
  }

  const claimedPayload: LeadAutoReplyJobPayload = {
    ...payload,
    attempts: Number(payload.attempts || 0),
    lastStartedAt: new Date().toISOString(),
    workerClaimId: workerId,
    workerClaimedAt: new Date().toISOString(),
  };

  const claimed = await claimLeadEmailJobLog(log, claimedPayload, workerId);
  if (!claimed) {
    logLeadEmailWorkerInfo('Skipped job after claim verification failed', {
      logId: log.id,
      eventId: log.event_id,
      workerId,
    });
    return true;
  }

  const logId = Number(log.id || 0);
  const workspaceId = Number(log.workspace_id || payload.workspaceId);
  const eventId = String(log.event_id || buildLeadEmailJobEventId(workspaceId, payload.leadId));

  try {
    const alreadyDone = await hasCompletedLeadEmailJob(workspaceId, eventId, logId);
    if (alreadyDone) {
      const completedPayload: LeadAutoReplyJobPayload = {
        ...claimedPayload,
        lastCompletedAt: new Date().toISOString(),
      };

      await webhookLogsApi.updateWebhookLog(
        logId,
        buildLeadJobLogUpdate(log, {
          payload: JSON.stringify(completedPayload),
          status: LEAD_EMAIL_JOB_COMPLETED,
          error: 'Skipped duplicate job',
        })
      );
      return true;
    }

    const sendResult = await sendLeadAutoReplyEmail({
      workspaceId: payload.workspaceId,
      toEmail: payload.toEmail,
      lead: payload.lead,
    });

    const completedPayload: LeadAutoReplyJobPayload = {
      ...claimedPayload,
      lastCompletedAt: new Date().toISOString(),
      ...(sendResult.messageId ? { messageId: sendResult.messageId } : {}),
    };

    await webhookLogsApi.updateWebhookLog(
      logId,
      buildLeadJobLogUpdate(log, {
        payload: JSON.stringify(completedPayload),
        status: LEAD_EMAIL_JOB_COMPLETED,
        error: null,
      })
    );

    logLeadEmailWorkerInfo('Lead auto-reply sent', {
      logId,
      eventId,
      workspaceId: payload.workspaceId,
      leadId: payload.leadId,
      to: maskEmail(payload.toEmail),
      messageId: sendResult.messageId || null,
    });
  } catch (error) {
    const normalizedError = toLeadEmailError(error, true);
    const attempts = Number(claimedPayload.attempts || 0) + 1;
    const nextRunAt = new Date(Date.now() + computeBackoffMs(attempts)).toISOString();
    const retryPayload: LeadAutoReplyJobPayload = {
      ...claimedPayload,
      attempts,
      nextRunAt,
      lastErrorAt: new Date().toISOString(),
    };

    const terminal = !normalizedError.retryable || attempts >= LEAD_EMAIL_JOB_MAX_ATTEMPTS;

    await webhookLogsApi.updateWebhookLog(
      logId,
      buildLeadJobLogUpdate(log, {
        payload: JSON.stringify(retryPayload),
        status: terminal ? LEAD_EMAIL_JOB_FAILED : LEAD_EMAIL_JOB_PENDING,
        error: String(normalizedError.message || 'Lead email job failed').slice(0, 1000),
      })
    );

    console.error('[Lead Email Worker] Lead auto-reply job failed', {
      logId,
      eventId,
      workspaceId: payload.workspaceId,
      leadId: payload.leadId,
      to: maskEmail(payload.toEmail),
      attempts,
      retryable: normalizedError.retryable,
      terminal,
      nextRunAt: terminal ? null : nextRunAt,
      error: String(normalizedError.message || 'Lead email job failed').slice(0, 1000),
    });
  }

  return true;
}

export async function sendWorkspaceEmail(
  workspaceId: number,
  params: { to: string; subject: string; html: string; text: string }
): Promise<SendLeadAutoReplyEmailResult> {
  const config = await resolveWorkspaceSmtpForSend(workspaceId);
  return sendWithWorkspaceSmtp(config, params);
}
