import crypto from 'crypto';
import { webhookLogsApi } from './api.js';
import { ApiResponse, DealStageConfig, StoredDealLog, DealCustomField } from '../types/index.js';
import {
  DEFAULT_PIPELINE_STATUS_TYPE,
  PIPELINE_STATUS_LOST,
  PIPELINE_STATUS_OPEN,
  PIPELINE_STATUS_WON,
  PipelineStatusType,
} from '../types/constants.js';
import { dealCustomFieldsSchema } from '../utils/validation.js';

const GLOBAL_STATUS = 'deal_stage_config';

const PIPELINE_STATUS = 'pipeline_stages';

export const DEFAULT_DEAL_STAGES: DealStageConfig[] = [
  { slug: 'new_lead', name: 'New Lead', color: '#111827', counts_as_conversion: false, status_type: PIPELINE_STATUS_OPEN },
  { slug: 'qualified', name: 'Qualified', color: '#059669', counts_as_conversion: false, status_type: PIPELINE_STATUS_OPEN },
  { slug: 'in_discussion', name: 'In Discussion', color: '#F59E0B', counts_as_conversion: false, status_type: PIPELINE_STATUS_OPEN },
  { slug: 'proposal', name: 'Proposal', color: '#4F46E5', counts_as_conversion: false, status_type: PIPELINE_STATUS_OPEN },
  { slug: 'negotiation', name: 'Negotiation', color: '#9333EA', counts_as_conversion: false, status_type: PIPELINE_STATUS_OPEN },
  { slug: 'won', name: 'Won', color: '#16A34A', counts_as_conversion: true, status_type: PIPELINE_STATUS_WON },
  { slug: 'lost', name: 'Lost', color: '#E11D48', counts_as_conversion: false, status_type: PIPELINE_STATUS_LOST },
];

export function stageStatusType(stage: DealStageConfig | undefined): PipelineStatusType {
  return stage?.status_type ?? DEFAULT_PIPELINE_STATUS_TYPE;
}

export function isWonStage(stages: DealStageConfig[] | undefined, slug: string): boolean {
  const stage = Array.isArray(stages) ? stages.find((item) => item.slug === slug) : undefined;
  return stageStatusType(stage) === PIPELINE_STATUS_WON;
}

function rows<T>(data: T | T[] | undefined): T[] {
  return Array.isArray(data) ? data : data ? [data] : [];
}

function payloadOf(log: StoredDealLog): unknown {
  try {
    return typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
  } catch {
    return null;
  }
}

function extractConfiguration(
  log: StoredDealLog,
): { id: number; stages: DealStageConfig[]; fields: DealCustomField[]; required_documents: string[]; pipelineSlug?: string } | null {
  const payload = payloadOf(log);
  if (!payload || typeof payload !== 'object') return null;
  const stages = (payload as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return null;
  const rawFields = (payload as { fields?: unknown }).fields;
  const fields = dealCustomFieldsSchema.parse(rawFields ?? []);
  const rawRequired = (payload as { required_documents?: unknown }).required_documents;
  const required_documents = Array.isArray(rawRequired)
    ? rawRequired.map((kind) => String(kind || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    id: Number(log.id),
    stages: stages as DealStageConfig[],
    fields,
    required_documents,
    pipelineSlug: (payload as { pipelineSlug?: string }).pipelineSlug,
  };
}

export async function loadWorkspaceDealLogs(workspaceId: number): Promise<StoredDealLog[]> {
  const response = await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    limit: 10000,
    bypassCache: true,
  }) as ApiResponse<StoredDealLog[]>;

  if (response.status !== 'success') throw new Error('Failed to load deal stages');

  return rows(response.data).filter((log) => Number(log.workspace_id) === workspaceId);
}

export async function getDealStageConfigurationForPipeline(
  workspaceId: number,
  pipelineSlug: string,
  preloadedLogs?: StoredDealLog[],
): Promise<{ id?: number; stages: DealStageConfig[]; fields: DealCustomField[]; required_documents: string[]; isGlobal: boolean }> {
  const all = preloadedLogs ?? await loadWorkspaceDealLogs(workspaceId);

  const pipelineLogs = all
    .filter((log) => log.status === PIPELINE_STATUS)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

  for (const log of pipelineLogs) {
    const config = extractConfiguration(log);
    if (config && config.pipelineSlug === pipelineSlug) {
      return { ...config, isGlobal: false };
    }
  }

  const globalLog = all
    .filter((log) => log.status === GLOBAL_STATUS)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

  if (globalLog) {
    const config = extractConfiguration(globalLog);
    if (config) return { ...config, isGlobal: true };
  }

  return {
    stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })),
    fields: [],
    required_documents: [],
    isGlobal: true,
  };
}

export async function saveDealStageConfigurationForPipeline(
  workspaceId: number,
  pipelineSlug: string,
  stages: DealStageConfig[],
  fields?: DealCustomField[],
  requiredDocuments?: string[],
): Promise<DealStageConfig[]> {
  const current = await getDealStageConfigurationForPipeline(workspaceId, pipelineSlug);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const resolvedFields = fields ?? current.fields.map((field) => ({
    ...field,
    required_in_stages: field.required_in_stages.filter((slug) => stages.some((stage) => stage.slug === slug)),
  }));
  const resolvedRequired = requiredDocuments ?? current.required_documents;

  const log = {
    workspace_id: workspaceId,
    lead_id: 0,
    source: PIPELINE_STATUS,
    event_id: `stg_${crypto.randomUUID().replace(/-/g, '')}`,
    status: PIPELINE_STATUS,
    payload: JSON.stringify({ pipelineSlug, stages, fields: resolvedFields, required_documents: resolvedRequired, updated_at: now }),
    created_at: now,
  };

  const pipelineSpecificId = current.isGlobal ? undefined : current.id;
  const response = pipelineSpecificId
    ? await webhookLogsApi.updateWebhookLog(pipelineSpecificId, log) as ApiResponse<unknown>
    : await webhookLogsApi.createWebhookLog(log) as ApiResponse<unknown>;

  if (response.status !== 'success') throw new Error(`Failed to save deal stages: ${(response as any).error || 'Unknown NoCodeBackend error'}`);
  return stages;
}

export async function getDealStageConfiguration(
  workspaceId: number,
): Promise<{ id?: number; stages: DealStageConfig[]; fields: DealCustomField[]; required_documents: string[] }> {
  const response = await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: GLOBAL_STATUS,
    limit: 10000,
    bypassCache: true,
  }) as ApiResponse<StoredDealLog[]>;
  if (response.status !== 'success') throw new Error('Failed to load deal stages');
  const latest = rows(response.data)
    .filter((log) => Number(log.workspace_id) === workspaceId && log.status === GLOBAL_STATUS)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  if (!latest) return { stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })), fields: [], required_documents: [] };
  const config = extractConfiguration(latest);
  if (!config) throw new Error('Invalid saved deal stages');
  return config;
}

export async function saveDealStageConfiguration(
  workspaceId: number,
  stages: DealStageConfig[],
  fields?: DealCustomField[],
  requiredDocuments?: string[],
): Promise<DealStageConfig[]> {
  const current = await getDealStageConfiguration(workspaceId);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const resolvedRequired = requiredDocuments ?? current.required_documents;
  const log = {
    workspace_id: workspaceId,
    lead_id: 0,
    source: GLOBAL_STATUS,
    event_id: `stgs_${crypto.randomUUID().replace(/-/g, '')}`,
    status: GLOBAL_STATUS,
    payload: JSON.stringify({ stages, fields: fields ?? current.fields.map((field) => ({
      ...field, required_in_stages: field.required_in_stages.filter((slug) => stages.some((stage) => stage.slug === slug)),
    })), required_documents: resolvedRequired, updated_at: now }),
    created_at: now,
  };
  const response = current.id
    ? await webhookLogsApi.updateWebhookLog(current.id, log) as ApiResponse<unknown>
    : await webhookLogsApi.createWebhookLog(log) as ApiResponse<unknown>;
  if (response.status !== 'success') throw new Error(`Failed to save deal stages: ${(response as any).error || 'Unknown NoCodeBackend error'}`);
  return stages;
}
