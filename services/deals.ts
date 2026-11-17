import crypto from 'crypto';
import { dealsApi, leadActivitiesApi, webhookLogsApi, workspacesApi } from './api.js';
import { parseDealDocuments } from './documents.js';
import {
  DEAL_PRIORITIES,
  DEAL_PIPELINE_STATUS,
  DEAL_SOURCE,
  DEAL_STAGE_WON,
  DEAL_STATUS,
  DEFAULT_DEAL_STAGE_SLUG,
  DEFAULT_PIPELINE_SLUG,
} from '../types/constants.js';
import type { ApiResponse, Deal, DealFieldValues, DealStageConfig, Workspace } from '../types/index.js';
import { formatWorkspaceCurrency } from '../utils/currency.js';
import { formatMySqlDateTimeUtc } from '../lib/validation.js';
import { emitAutomationEvent } from './automations/engine.js';

const PRIORITY_SLUGS = new Set<string>(DEAL_PRIORITIES);

export const parseJson = (value: unknown): any => {
  if (!value) return null;
  try {
    if (typeof value === 'string') return JSON.parse(value);
    return value;
  } catch {
    return null;
  }
};

export const parseDealFromLog = (log: any): Deal => {
  const payload = parseJson(log?.payload) || {};
  const createdAt = String(payload?.created_at || log?.created_at || '').trim() || undefined;
  const updatedAt = String(payload?.updated_at || log?.updated_at || createdAt || '').trim() || undefined;
  const wonAt = String(payload?.won_at || '').trim() || undefined;
  const expectedCloseDate =
    payload?.expected_close_date === undefined || payload?.expected_close_date === null
      ? undefined
      : String(payload?.expected_close_date || '').trim() || undefined;
  const priorityRaw = String(payload?.priority || '').trim().toLowerCase();
  const priority = PRIORITY_SLUGS.has(priorityRaw) ? priorityRaw : undefined;

  const leadIdFromPayload = payload?.lead_id !== undefined && payload?.lead_id !== null ? Number(payload.lead_id) : undefined;
  const leadIdFromLog = log?.lead_id !== undefined && log?.lead_id !== null ? Number(log.lead_id) : undefined;
  const leadId = (leadIdFromPayload !== undefined && leadIdFromPayload > 0) ? leadIdFromPayload :
                 (leadIdFromLog !== undefined && leadIdFromLog > 0) ? leadIdFromLog : undefined;

  return {
    custom_fields: payload.custom_fields && typeof payload.custom_fields === 'object' && !Array.isArray(payload.custom_fields)
      ? Object.fromEntries(Object.entries(payload.custom_fields).filter(([, value]) => typeof value === 'string')) as DealFieldValues
      : {},
    documents: parseDealDocuments(payload),
    id: Number(log?.id),
    workspace_id: Number(log?.workspace_id),
    name: String(payload?.name || '').trim(),
    value: Number(payload?.value || 0),
    contact: String(payload?.contact || '').trim(),
    owner_id:
      payload?.owner_id === undefined || payload?.owner_id === null || payload?.owner_id === ''
        ? null
        : Number(payload?.owner_id),
    stage: String(payload?.stage || DEFAULT_DEAL_STAGE_SLUG),
    tags: Array.isArray(payload?.tags) ? payload.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean) : [],
    pipeline_slug: String(payload?.pipeline_slug || DEFAULT_PIPELINE_SLUG),
    expected_close_date: expectedCloseDate,
    priority,
    lead_id: leadId,
    created_at: createdAt,
    updated_at: updatedAt,
    won_at: wonAt,
    converted_at: String(payload?.converted_at || '').trim() || undefined,
  };
};

export const parsePipelineFromLog = (log: any) => {
  const payload = parseJson(log?.payload) || {};
  const createdAt = String(payload?.created_at || log?.created_at || '').trim() || undefined;
  const updatedAt = String(payload?.updated_at || log?.updated_at || createdAt || '').trim() || undefined;

  return {
    id: Number(log?.id),
    workspace_id: Number(log?.workspace_id),
    slug: String(payload?.slug || payload?.pipeline_slug || log?.event_id || '').trim(),
    name: String(payload?.name || '').trim(),
    created_at: createdAt,
    updated_at: updatedAt,
  };
};

export async function listWorkspacePipelines(
  workspaceId: number,
): Promise<{ id: number; slug: string; name: string }[]> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: DEAL_PIPELINE_STATUS,
    limit: 10000,
    bypassCache: true,
  })) as ApiResponse<any[]>;

  if (response.status !== 'success' || !Array.isArray(response.data)) return [];

  const rows = response.data.filter(
    (log: any) => Number(log?.workspace_id) === Number(workspaceId) && String(log?.status || '') === DEAL_PIPELINE_STATUS,
  );

  return rows
    .map(parsePipelineFromLog)
    .filter((pipeline) => Number.isFinite(pipeline.id) && pipeline.id > 0 && pipeline.slug && pipeline.name)
    .map((pipeline) => ({ id: pipeline.id, slug: pipeline.slug, name: pipeline.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CreateDealRecordInput {
  workspaceId: number;
  name: string;
  value: number;
  contact?: string | null;
  ownerId?: number | null;
  stage: string;
  pipelineSlug?: string | null;
  expectedCloseDate?: string | null;
  priority?: string | null;
  leadId?: number | null;
  customFields?: DealFieldValues;
  eventId?: string | null;
  stages?: DealStageConfig[];
  skipReadBack?: boolean;
  activityUserId?: number | null;
  activityTitle?: string | null;
}

export interface CreateDealRecordResult {
  id: number;
  deal: Deal;
}

export async function createDealRecord(input: CreateDealRecordInput): Promise<CreateDealRecordResult> {
  const workspaceId = Number(input.workspaceId);
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
    throw new Error('workspace_id is required');
  }

  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Deal name is required');
  }

  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Deal value must be a non-negative number');
  }

  const pipelineSlug = String(input.pipelineSlug || DEFAULT_PIPELINE_SLUG).trim() || DEFAULT_PIPELINE_SLUG;
  const stage = String(input.stage || DEFAULT_DEAL_STAGE_SLUG).trim() || DEFAULT_DEAL_STAGE_SLUG;
  const customFields: DealFieldValues = input.customFields || {};
  const priorityRaw = String(input.priority || '').trim().toLowerCase();
  const priority = PRIORITY_SLUGS.has(priorityRaw) ? priorityRaw : undefined;
  const expectedCloseDate = input.expectedCloseDate ? String(input.expectedCloseDate).trim() || undefined : undefined;
  const leadId = Number(input.leadId) > 0 ? Number(input.leadId) : 0;
  const ownerId = input.ownerId === undefined || input.ownerId === null ? null : Number(input.ownerId);
  const countsAsConversion = Array.isArray(input.stages)
    ? input.stages.some((item) => item.slug === stage && item.counts_as_conversion)
    : false;

  const now = formatMySqlDateTimeUtc(new Date());

  const dealPayload = {
    custom_fields: customFields,
    workspace_id: workspaceId,
    name,
    value,
    contact: String(input.contact || '').trim(),
    owner_id: ownerId,
    stage,
    pipeline_slug: pipelineSlug,
    expected_close_date: expectedCloseDate,
    priority,
    lead_id: leadId > 0 ? leadId : undefined,
    tags: [] as string[],
    created_at: now,
    updated_at: now,
    won_at: stage === DEAL_STAGE_WON ? now : undefined,
    converted_at: countsAsConversion ? now : undefined,
  };

  const dealEventId = String(input.eventId || '').trim() || `deal_${crypto.randomUUID().replace(/-/g, '')}`;

  const createBody = {
    workspace_id: workspaceId,
    lead_id: leadId,
    source: DEAL_SOURCE,
    event_id: dealEventId,
    payload: JSON.stringify(dealPayload),
    status: DEAL_STATUS,
    created_at: now,
  };

  const createRes = (await dealsApi.createDeal(createBody)) as ApiResponse<any>;
  const createdIdRaw = (createRes as any)?.id ?? (createRes as any)?.data?.id ?? (createRes as any)?.data?.[0]?.id;
  const createdId = Number(createdIdRaw);

  if (createRes.status !== 'success' || !Number.isFinite(createdId) || createdId <= 0) {
    throw new Error('Failed to create deal');
  }

  const readRes = input.skipReadBack
    ? null
    : (await dealsApi.getDealById(createdId)) as ApiResponse<any>;
  const log = readRes && Array.isArray(readRes.data) ? readRes.data[0] : readRes?.data;
  const deal = log ? parseDealFromLog(log) : ({ ...dealPayload, id: createdId } as Deal);

  if (leadId > 0) {
    try {
      const workspaceResponse = await workspacesApi.getWorkspaceById(workspaceId) as ApiResponse<Workspace>;
      const workspace = Array.isArray(workspaceResponse.data) ? workspaceResponse.data[0] : workspaceResponse.data;
      const workspaceOwnerId = Number(workspace?.owner_id);
      const activityUserId = Number(input.activityUserId) > 0
        ? Number(input.activityUserId)
        : workspaceOwnerId > 0
          ? workspaceOwnerId
          : null;
      const activityMetadata = {
        deal_id: createdId,
        deal_name: name,
        deal_value: value,
        deal_stage: stage,
      };

      await leadActivitiesApi.createActivity({
        lead_id: leadId,
        workspace_id: workspaceId,
        user_id: activityUserId,
        assignee_id: ownerId,
        type: 'deal_created',
        title: input.activityTitle || 'Deal created from lead',
        description: `Deal "${name}" (${formatWorkspaceCurrency(value, workspace?.currency)}) created and placed in ${stage} stage`,
        metadata: JSON.stringify(activityMetadata),
        created_at: now,
      } as any);
    } catch (activityError) {
      console.error('Error creating deal_created activity:', activityError);
    }
  }

  emitAutomationEvent({ workspaceId, type: 'deal_created', dealId: createdId, leadId, pipelineSlug, stage });

  return { id: createdId, deal };
}
