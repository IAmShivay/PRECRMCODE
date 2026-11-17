import {
  DEAL_PRIORITIES,
  DEAL_STATUS,
  DEFAULT_PIPELINE_SLUG,
  WEB_FORM_DEAL_EVENT_PREFIX,
  WEB_FORM_DEAL_LOG_STATUS,
  WEB_FORM_FIELD_LEAD_EMAIL,
  WEB_FORM_FIELD_LEAD_NAME,
  WEB_FORM_FIELD_LEAD_PHONE,
  WEB_FORM_MAPPING_EVENT_PREFIX,
  WEB_FORM_MAPPING_STATUS,
} from '../types/constants.js';
import type { ApiResponse, DealFieldValues } from '../types/index.js';
import type { DealCustomField } from '../types/dealFields.js';
import type { WebFormDealMapping, WebFormDealOutcome } from '../types/webFormDeals.js';
import { webhookLogsApi } from './api.js';
import { createDealRecord } from './deals.js';
import { getDealStageConfigurationForPipeline, loadWorkspaceDealLogs } from './dealStages.js';
import { dealFieldErrors } from '../lib/dealFields.js';
import { formatMySqlDateTimeUtc } from '../lib/validation.js';

export interface WebFormLead {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
}

export interface WebFormDealDraft {
  name: string;
  value: number;
  contact: string;
  priority?: string;
  expected_close_date?: string;
  custom_fields: DealFieldValues;
}

export interface WebFormDealDraftResult {
  draft: WebFormDealDraft;
  errors: string[];
}

const PRIORITY_SLUGS = new Set<string>(DEAL_PRIORITIES);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function coerceValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => coerceValue(item))
      .filter((item): item is string => item !== null);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  const text = String(value).trim();
  return text ? text : null;
}

function readPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const direct = coerceValue(payload?.[key]);
  if (direct !== null) return direct;

  const target = normalizeKey(key);
  if (!target) return null;

  for (const [payloadKey, payloadValue] of Object.entries(payload || {})) {
    if (normalizeKey(payloadKey) !== target) continue;
    const value = coerceValue(payloadValue);
    if (value !== null) return value;
  }
  return null;
}

function parseNumericValue(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeDateString(raw: string): string | undefined {
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const date = new Date(`${candidate}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate) return candidate;
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export function resolveWebFormValue(
  payload: Record<string, unknown>,
  key: string | undefined,
  lead: WebFormLead,
): string | null {
  const trimmed = String(key || '').trim();
  if (!trimmed) return null;
  if (trimmed === WEB_FORM_FIELD_LEAD_NAME) return String(lead?.name || '').trim() || null;
  if (trimmed === WEB_FORM_FIELD_LEAD_EMAIL) return String(lead?.email || '').trim() || null;
  if (trimmed === WEB_FORM_FIELD_LEAD_PHONE) return String(lead?.phone || '').trim() || null;
  return readPayloadValue(payload || {}, trimmed);
}

export function webFormMappingEventId(workspaceId: number, sourceId: string): string {
  return `${WEB_FORM_MAPPING_EVENT_PREFIX}${workspaceId}_${sourceId}`.slice(0, 180);
}

export function webFormDealEventId(sourceRef: string): string {
  return `${WEB_FORM_DEAL_EVENT_PREFIX}${sourceRef}`.slice(0, 180);
}

interface MappingCacheEntry {
  id: number | null;
  mapping: WebFormDealMapping | null;
  expiresAt: number;
}

const MAPPING_CACHE_TTL_MS = Math.max(0, Number(process.env.WEB_FORM_MAPPING_CACHE_TTL_MS) || 15000);
export const MAPPING_LOOKUP_ATTEMPTS = 5;
const MAPPING_LOOKUP_DELAY_MS = 400;

const mappingCache = new Map<string, MappingCacheEntry>();

function mappingCacheKey(workspaceId: number, sourceId: string): string {
  return `${workspaceId}:${sourceId}`;
}

function readMappingCache(workspaceId: number, sourceId: string): MappingCacheEntry | undefined {
  const key = mappingCacheKey(workspaceId, sourceId);
  const entry = mappingCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    mappingCache.delete(key);
    return undefined;
  }
  return entry;
}

function writeMappingCache(
  workspaceId: number,
  sourceId: string,
  id: number | null,
  mapping: WebFormDealMapping | null,
): void {
  if (MAPPING_CACHE_TTL_MS <= 0) return;
  mappingCache.set(mappingCacheKey(workspaceId, sourceId), {
    id,
    mapping,
    expiresAt: Date.now() + MAPPING_CACHE_TTL_MS,
  });
}

async function fetchMappingRow(
  workspaceId: number,
  sourceId: string,
): Promise<{ id: number; mapping: WebFormDealMapping } | null> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: WEB_FORM_MAPPING_STATUS,
    event_id: webFormMappingEventId(workspaceId, sourceId),
    limit: 10,
    bypassCache: true,
  })) as ApiResponse<any[]>;

  if (response.status !== 'success' || !Array.isArray(response.data)) return null;

  const row = response.data.find(
    (item) => Number(item?.workspace_id) === workspaceId && String(item?.status || '') === WEB_FORM_MAPPING_STATUS,
  );
  if (!row) return null;

  try {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!payload || typeof payload !== 'object') return null;
    return {
      id: Number(row.id),
      mapping: {
        ...payload,
        workspace_id: workspaceId,
        source_id: sourceId,
      } as WebFormDealMapping,
    };
  } catch {
    return null;
  }
}

async function findMappingRow(
  workspaceId: number,
  sourceId: string,
  attempts: number,
): Promise<{ id: number; mapping: WebFormDealMapping } | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const row = await fetchMappingRow(workspaceId, sourceId);
    if (row) return row;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, MAPPING_LOOKUP_DELAY_MS));
    }
  }
  return null;
}

export async function getWebFormDealMapping(
  workspaceId: number,
  sourceId: string,
  attempts: number = 1,
): Promise<WebFormDealMapping | null> {
  const trimmedSourceId = String(sourceId || '').trim();
  if (!trimmedSourceId) return null;

  const cached = readMappingCache(workspaceId, trimmedSourceId);
  if (cached) return cached.mapping;

  const row = await findMappingRow(workspaceId, trimmedSourceId, attempts);
  const mapping = row?.mapping ?? null;
  writeMappingCache(workspaceId, trimmedSourceId, row?.id ?? null, mapping);
  return mapping;
}

export async function saveWebFormDealMapping(mapping: WebFormDealMapping): Promise<WebFormDealMapping> {
  const workspaceId = Number(mapping.workspace_id);
  const sourceId = String(mapping.source_id || '').trim();
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) throw new Error('workspace_id is required');
  if (!sourceId) throw new Error('source_id is required');

  const now = formatMySqlDateTimeUtc(new Date());
  const existing = await findMappingRow(workspaceId, sourceId, 1);

  const payload: WebFormDealMapping = {
    workspace_id: workspaceId,
    source_id: sourceId,
    enabled: Boolean(mapping.enabled),
    pipeline_slug: String(mapping.pipeline_slug || DEFAULT_PIPELINE_SLUG).trim() || DEFAULT_PIPELINE_SLUG,
    stage: String(mapping.stage || '').trim(),
    owner_user_id: mapping.owner_user_id ? Number(mapping.owner_user_id) : null,
    fields: mapping.fields || {},
    deal_custom_fields: mapping.deal_custom_fields || {},
    updated_at: now,
  };

  const log = {
    workspace_id: workspaceId,
    lead_id: 0,
    source: WEB_FORM_MAPPING_STATUS,
    event_id: webFormMappingEventId(workspaceId, sourceId),
    payload: JSON.stringify(payload),
    status: WEB_FORM_MAPPING_STATUS,
    created_at: now,
  };

  const response = existing
    ? await webhookLogsApi.updateWebhookLog(existing.id, log) as ApiResponse<unknown>
    : await webhookLogsApi.createWebhookLog(log) as ApiResponse<unknown>;

  if (response.status !== 'success') {
    throw new Error(
      `Failed to save the deal mapping: ${(response as any)?.error || 'Unknown NoCodeBackend error'}`,
    );
  }

  const createdId = Number((response as any)?.id ?? (response as any)?.data?.id ?? existing?.id ?? 0) || null;
  writeMappingCache(workspaceId, sourceId, createdId, payload);

  return payload;
}

export function buildWebFormDealDraft(
  mapping: WebFormDealMapping,
  payload: Record<string, unknown>,
  lead: WebFormLead,
  stage: string,
  dealFields: DealCustomField[],
): WebFormDealDraftResult {
  const errors: string[] = [];
  const fields = mapping.fields || {};

  const mappedName = resolveWebFormValue(payload, fields.name, lead);
  const name = mappedName || String(lead?.name || '').trim() || String(lead?.email || '').trim() || '';
  if (!name) errors.push('A deal name could not be resolved from the form submission');

  const mappedValue = resolveWebFormValue(payload, fields.value, lead);
  let value = 0;
  if (mappedValue) {
    const parsed = parseNumericValue(mappedValue);
    if (parsed === null) {
      errors.push(`The mapped deal value "${mappedValue}" is not a number`);
    } else if (parsed < 0) {
      errors.push(`The mapped deal value "${mappedValue}" cannot be negative`);
    } else {
      value = parsed;
    }
  }

  const mappedContact = resolveWebFormValue(payload, fields.contact, lead);
  const contact = mappedContact || String(lead?.email || '').trim() || String(lead?.phone || '').trim() || '';

  let priority: string | undefined;
  const mappedPriority = resolveWebFormValue(payload, fields.priority, lead);
  if (mappedPriority) {
    const normalized = mappedPriority.trim().toLowerCase();
    if (PRIORITY_SLUGS.has(normalized)) priority = normalized;
  }

  let expectedCloseDate: string | undefined;
  const mappedCloseDate = resolveWebFormValue(payload, fields.expected_close_date, lead);
  if (mappedCloseDate) {
    expectedCloseDate = normalizeDateString(mappedCloseDate);
  }

  const customFields: DealFieldValues = {};
  for (const [dealFieldId, payloadKey] of Object.entries(mapping.deal_custom_fields || {})) {
    const field = dealFields.find((item) => item.id === dealFieldId);
    if (!field) {
      errors.push(`The deal field "${dealFieldId}" is no longer available in this workspace`);
      continue;
    }
    if (field.archived) continue;
    const resolved = resolveWebFormValue(payload, payloadKey, lead);
    if (resolved) customFields[dealFieldId] = resolved;
  }

  for (const message of Object.values(dealFieldErrors(dealFields, customFields, stage))) {
    errors.push(message);
  }

  return {
    draft: {
      name,
      value,
      contact,
      priority,
      expected_close_date: expectedCloseDate,
      custom_fields: customFields,
    },
    errors,
  };
}

export interface EnsureWebFormDealParams {
  workspaceId: number;
  sourceId: string | null;
  lead: WebFormLead;
  payload: Record<string, unknown>;
  sourceRef: string;
}

export async function ensureDealForLead(params: EnsureWebFormDealParams): Promise<WebFormDealOutcome> {
  const workspaceId = Number(params.workspaceId);
  const sourceId = String(params.sourceId || '').trim();
  if (!sourceId) return { status: 'skipped', reason: 'The submission is not linked to a source' };

  const mapping = await getWebFormDealMapping(workspaceId, sourceId);
  if (!mapping) return { status: 'skipped', reason: 'No deal automation is configured for this source' };
  if (!mapping.enabled) return { status: 'skipped', reason: 'Deal automation is disabled for this source' };

  const pipelineSlug = String(mapping.pipeline_slug || DEFAULT_PIPELINE_SLUG).trim() || DEFAULT_PIPELINE_SLUG;
  const logs = await loadWorkspaceDealLogs(workspaceId);
  const { stages, fields } = await getDealStageConfigurationForPipeline(workspaceId, pipelineSlug, logs);
  const requestedStage = String(mapping.stage || '').trim();
  const stage = stages.some((item) => item.slug === requestedStage) ? requestedStage : stages[0]?.slug;
  if (!stage) return { status: 'skipped', reason: 'No deal stages are configured for this workspace' };

  const eventId = webFormDealEventId(params.sourceRef);
  const existingDeal = logs.find(
    (log) => String(log?.status || '') === DEAL_STATUS && String(log?.event_id || '') === eventId,
  );

  if (existingDeal) {
    return {
      status: 'skipped',
      dealId: Number(existingDeal.id) || undefined,
      reason: 'A deal already exists for this submission',
    };
  }

  const { draft, errors } = buildWebFormDealDraft(
    mapping,
    params.payload || {},
    params.lead,
    stage,
    fields,
  );
  if (errors.length) return { status: 'skipped', reason: errors.join('. ') };

  const result = await createDealRecord({
    workspaceId,
    name: draft.name,
    value: draft.value,
    contact: draft.contact,
    ownerId: mapping.owner_user_id ?? null,
    stage,
    pipelineSlug,
    expectedCloseDate: draft.expected_close_date ?? null,
    priority: draft.priority ?? null,
    leadId: params.lead.id,
    customFields: draft.custom_fields,
    eventId,
    stages,
    skipReadBack: true,
    activityUserId: mapping.owner_user_id ?? null,
    activityTitle: 'Deal created from website form',
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to create deal';
    console.error('[WebFormDeals] Failed to create the deal:', message);
    return null;
  });

  if (!result) {
    return { status: 'skipped', reason: 'Failed to create the deal' };
  }

  return { status: 'created', dealId: result.id };
}

export async function logWebFormDealOutcome(params: {
  workspaceId: number;
  leadId: number;
  sourceId: string | null;
  sourceRef: string;
  source: string;
  outcome: WebFormDealOutcome;
}): Promise<void> {
  const now = formatMySqlDateTimeUtc(new Date());
  await webhookLogsApi.createWebhookLog({
    workspace_id: params.workspaceId,
    lead_id: params.leadId,
    source: params.source,
    source_old: params.source,
    event_id: params.sourceRef,
    payload: JSON.stringify({
      deal_id: params.outcome.dealId ?? null,
      outcome: params.outcome.status,
      reason: params.outcome.reason ?? null,
      source_id: params.sourceId,
    }),
    status: WEB_FORM_DEAL_LOG_STATUS,
    error: params.outcome.status === 'skipped' ? params.outcome.reason ?? null : null,
    created_at: now,
  });
}
