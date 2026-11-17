import { Router, Response } from 'express';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { authMiddleware } from '../middleware/auth.js';
import { getWorkspaceAccess, validDealAssignee } from '../services/workspacePermissions.js';
import { canViewDeal, canViewLead, hasPipelineAccess, isElevatedRole } from '../types/permissions.js';
import { dealDocumentUploadSchema } from '../utils/validation.js';
import {
  DEAL_DOCUMENT_ALLOWED_FORMATS,
  DEAL_DOCUMENT_MAX_BYTES,
  DEAL_DOCUMENT_MIME_EXTENSIONS,
  DEAL_DOCUMENT_STATUS,
  dealDocumentRow,
  documentPublicId,
  extensionForDocument,
  newDocumentId,
  normalizeDocumentKind,
  parseDealDocumentRow,
  parseDealDocuments,
  sanitizeDocumentName,
} from '../services/documents.js';
import type { DealDocument } from '../types/index.js';
import { dealsApi, dealPipelinesApi, dealStageHistoryApi, leadsApi, webhookLogsApi } from '../services/api.js';
import { ApiResponse, AuthenticatedRequest, AuthErrorResponse, DealCustomField, DealFieldValues, DealStageConfig } from '../types/index.js';
import { validate, createDealSchema, updateDealSchema, createPipelineSchema, updatePipelineSchema, updateDealStagesSchema, updateDealConfigurationSchema, dealStageSlug } from '../utils/validation.js';
import { DEAL_PRIORITIES, DEFAULT_PIPELINE_SLUG } from '../types/constants.js';
import { createDealRecord, deleteWorkspacePipeline, parseDealFromLog, parseJson, parsePipelineFromLog, renameWorkspacePipeline } from '../services/deals.js';
import {
  getDealStageConfiguration,
  saveDealStageConfiguration,
  getDealStageConfigurationForPipeline,
  saveDealStageConfigurationForPipeline,
  isWonStage,
} from '../services/dealStages.js';
import { dealFieldErrors } from '../lib/dealFields.js';
import { emitAutomationEvent } from '../services/automations/engine.js';

const router: Router = Router();

const PRIORITY_SLUGS = new Set<string>(DEAL_PRIORITIES);

function validateDealFields(res: Response, fields: DealCustomField[], values: DealFieldValues, stage: string, patch: DealFieldValues = {}): boolean {
  if (Object.keys(patch).some((id) => !fields.some((field) => field.id === id && !field.archived))) {
    res.status(400).json({ status: 'error', message: 'One or more custom fields are unavailable in this workspace. Reload the deal and try again.' });
    return false;
  }
  const errors = dealFieldErrors(fields, values, stage);
  if (Object.keys(errors).length) {
    res.status(422).json({ status: 'error', message: Object.values(errors).join('. '), field_errors: errors });
    return false;
  }
  return true;
}

async function getDealLogOrNull(id: number): Promise<{ log: any; workspaceId: number } | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  let existing: ApiResponse<any>;
  try {
    existing = (await dealsApi.getDealById(id)) as ApiResponse<any>;
  } catch (error: any) {
    if (Number(error?.status) === 404 || String(error?.message || '').toLowerCase().includes('not found')) return null;
    throw error;
  }
  const log = Array.isArray(existing.data) ? existing.data[0] : existing.data;
  const workspaceId = Number(log?.workspace_id);
  if (existing.status !== 'success' || !log || Number(log.id) !== id || String(log?.status || '') !== 'deal' || !Number.isFinite(workspaceId) || workspaceId <= 0) {
    return null;
  }
  return { log, workspaceId };
}

async function getDealDocumentRows(workspaceId: number, dealId?: number): Promise<any[]> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    ...(dealId !== undefined ? { lead_id: dealId } : {}),
    status: DEAL_DOCUMENT_STATUS,
    limit: 10000,
    bypassCache: true,
  })) as ApiResponse<any>;
  if (response.status !== 'success' || !response.data) return [];
  const rows = Array.isArray(response.data) ? response.data : [response.data];
  return rows.filter((row: any) =>
    Number(row?.workspace_id) === workspaceId &&
    String(row?.status || '') === DEAL_DOCUMENT_STATUS &&
    (dealId === undefined || Number(row?.lead_id) === dealId)
  );
}

function cloudinaryClient(): typeof cloudinary | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return cloudinary;
}

async function getDealDocuments(workspaceId: number, dealId: number, legacyPayload?: unknown): Promise<DealDocument[]> {
  const fromRows = (await getDealDocumentRows(workspaceId, dealId))
    .map((row) => parseDealDocumentRow(row))
    .filter((doc): doc is DealDocument => !!doc);
  const legacy = parseDealDocuments(legacyPayload);
  const seen = new Set(fromRows.map((doc) => doc.id));
  return [...fromRows, ...legacy.filter((doc) => !seen.has(doc.id))];
}

router.get(['/stages', '/configuration'], authMiddleware, async (req: AuthenticatedRequest, res: Response<ApiResponse<any> | AuthErrorResponse>): Promise<void> => {
  try {
    const workspaceId = Number(req.query.workspace_id);
    if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ status: 'error', message: 'workspace_id is required' });
      return;
    }
    const access = await getWorkspaceAccess(Number(req.user?.id || 0), workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }
    const pipelineSlug = req.query.pipeline_slug ? String(req.query.pipeline_slug).trim() : undefined;
    let configuration: { stages: any[]; fields: any[]; required_documents: string[] };
    if (pipelineSlug) {
      configuration = await getDealStageConfigurationForPipeline(workspaceId, pipelineSlug);
    } else {
      configuration = await getDealStageConfiguration(workspaceId);
    }
    res.json({ status: 'success', data: req.path === '/configuration' ? { stages: configuration.stages, fields: configuration.fields, required_documents: configuration.required_documents } : configuration.stages });
  } catch (error) {
    console.error('Error in GET /api/deals/stages:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load deal stages' });
  }
});

router.put(['/stages', '/configuration'], authMiddleware, (req, res, next) => validate(req.path === '/configuration' ? updateDealConfigurationSchema : updateDealStagesSchema)(req, res, next), async (
  req: AuthenticatedRequest<{}, {}, { workspace_id: number; pipeline_slug?: string; stages: Array<{ slug: string; name: string; color: string; counts_as_conversion: boolean }>; fields?: DealCustomField[]; required_documents?: string[] }>,
  res: Response<ApiResponse<any> | AuthErrorResponse>
): Promise<void> => {
  try {
    const workspaceId = Number(req.body.workspace_id);
    const access = await getWorkspaceAccess(Number(req.user?.id || 0), workspaceId);
    if (!access.hasAccess || access.role !== 'admin') {
      res.status(403).json({ status: 'error', message: 'Workspace admin access required' });
      return;
    }
    const stages = req.body.stages;
    const pipelineSlug = req.body.pipeline_slug ? String(req.body.pipeline_slug).trim() : undefined;
    const slugs = new Set(stages.map((stage) => stage.slug));
    const names = new Set(stages.map((stage) => stage.name.toLowerCase()));
    if (slugs.size !== stages.length || names.size !== stages.length) {
      res.status(400).json({ status: 'error', message: 'Stage names and IDs must be unique' });
      return;
    }
    const current = pipelineSlug
      ? await getDealStageConfigurationForPipeline(workspaceId, pipelineSlug)
      : await getDealStageConfiguration(workspaceId);
    if (req.body.fields && current.fields.some((field) => !req.body.fields!.some((next) => next.id === field.id && next.type === field.type))) {
      res.status(409).json({ status: 'error', message: 'Archive existing fields instead of deleting them. Create a new field to use a different type.' });
      return;
    }
    const removed = new Set(current.stages.map((stage) => stage.slug).filter((slug) => !slugs.has(slug)));
    if (removed.size > 0) {
      const response = await dealsApi.getDeals({ workspace_id: workspaceId, limit: 10000 }) as ApiResponse<any>;
      if (response.status !== 'success') throw new Error('Failed to check deals before removing stages');
      const logs = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
      const dealsInRemovedStage = logs
        .filter((log: any) => Number(log.workspace_id) === workspaceId && log.status === 'deal')
        .map(parseDealFromLog)
        .filter((deal) => removed.has(deal.stage))
        .filter((deal) => !pipelineSlug || String(deal.pipeline_slug || 'default') === pipelineSlug);
      if (dealsInRemovedStage.length > 0) {
        res.status(409).json({ status: 'error', message: 'Move deals out of a stage before removing it' });
        return;
      }
    }
    let saved: DealStageConfig[];
    const requiredDocuments = Array.isArray(req.body.required_documents)
      ? req.body.required_documents.map((kind) => String(kind || '').trim().toLowerCase()).filter(Boolean)
      : undefined;
    const resolvedRequiredDocuments = requiredDocuments ?? current.required_documents ?? [];
    if (pipelineSlug) {
      saved = await saveDealStageConfigurationForPipeline(workspaceId, pipelineSlug, stages, req.body.fields, resolvedRequiredDocuments);
    } else {
      saved = await saveDealStageConfiguration(workspaceId, stages, req.body.fields, resolvedRequiredDocuments);
    }
    res.json({ status: 'success', data: req.path === '/configuration' ? { stages: saved, fields: req.body.fields, required_documents: resolvedRequiredDocuments } : saved });
  } catch (error) {
    console.error('Error in PUT /api/deals/stages:', error);
    res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : 'Failed to save deal stages' });
  }
});

router.get(
  '/',
  authMiddleware,
  async (
    req: AuthenticatedRequest,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId = Number(req.query.workspace_id);
      const userId = Number(req.user?.id || 0);

      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: You do not have access to this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      const stage = req.query.stage ? String(req.query.stage) : undefined;
      if (stage && !dealStageSlug.safeParse(stage).success) {
        res.status(400).json({ status: 'error', message: 'Invalid stage' });
        return;
      }

      const pipelineSlug = req.query.pipeline_slug ? String(req.query.pipeline_slug).trim() : undefined;

      const rawResponse = (await dealsApi.getDeals({
        workspace_id: workspaceId,
        limit: req.query.limit ? Number(req.query.limit) : 10000,
        page: req.query.page ? Number(req.query.page) : undefined,
      })) as ApiResponse<any>;

      const logs: any[] = rawResponse?.status === 'success' && rawResponse.data
        ? (Array.isArray(rawResponse.data) ? rawResponse.data : [rawResponse.data])
        : [];

      const deals = logs
        .filter((log) => Number(log?.workspace_id) === workspaceId && String(log?.status || '') === 'deal')
        .map(parseDealFromLog)
        .filter((deal) => canViewDeal(access, deal.owner_id, deal.pipeline_slug || 'default'))
        .filter((deal) => Number.isFinite(deal.id) && deal.id > 0 && deal.name);

      const documentRows = await getDealDocumentRows(workspaceId);
      const documentsByDeal = new Map<number, DealDocument[]>();
      for (const row of documentRows) {
        const doc = parseDealDocumentRow(row);
        const ownerDealId = Number(row?.lead_id);
        if (!doc || !Number.isFinite(ownerDealId) || ownerDealId <= 0) continue;
        const list = documentsByDeal.get(ownerDealId) || [];
        list.push(doc);
        documentsByDeal.set(ownerDealId, list);
      }
      for (const deal of deals) {
        const rowDocs = documentsByDeal.get(Number(deal.id)) || [];
        const seen = new Set(rowDocs.map((doc) => doc.id));
        const legacy = (deal.documents || []).filter((doc) => !seen.has(doc.id));
        deal.documents = [...rowDocs, ...legacy];
      }

      const filteredByStage = stage ? deals.filter((d) => String(d.stage) === stage) : deals;
      const filtered =
        pipelineSlug && pipelineSlug.length > 0
          ? filteredByStage.filter((d) => String(d.pipeline_slug || 'default') === pipelineSlug)
          : filteredByStage;

      res.json({ status: 'success', data: filtered });
    } catch (error) {
      console.error('Error in GET /api/deals:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load deals' });
    }
  }
);

router.get(
  '/pipelines',
  authMiddleware,
  async (
    req: AuthenticatedRequest,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId = Number(req.query.workspace_id);
      const userId = Number(req.user?.id || 0);

      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: You do not have access to this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      const rawResponse = (await dealPipelinesApi.getPipelines({
        workspace_id: workspaceId,
        limit: req.query.limit ? Number(req.query.limit) : 10000,
        page: req.query.page ? Number(req.query.page) : undefined,
      })) as ApiResponse<any>;

      const logs: any[] =
        rawResponse?.status === 'success' && rawResponse.data
          ? Array.isArray(rawResponse.data)
            ? rawResponse.data
            : [rawResponse.data]
          : [];

      const pipelines = logs
        .filter(
          (log) =>
            Number(log?.workspace_id) === workspaceId && String(log?.status || '') === 'deal_pipeline'
        )
        .map(parsePipelineFromLog)
        .filter((p) => Number.isFinite(p.id) && p.id > 0 && p.slug && p.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      const withDefault =
        pipelines.some((p) => String(p.slug) === 'default')
          ? pipelines
          : [{ id: 0, workspace_id: workspaceId, slug: 'default', name: 'Default' }, ...pipelines];

      res.json({ status: 'success', data: withDefault.filter((p) => hasPipelineAccess(access, String(p.slug))) });
    } catch (error) {
      console.error('Error in GET /api/deals/pipelines:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load pipelines' });
    }
  }
);

router.post(
  '/pipelines',
  authMiddleware,
  validate(createPipelineSchema),
  async (
    req: AuthenticatedRequest<{}, {}, any>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const workspaceId = Number(req.body?.workspace_id);

      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: You do not have access to this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      if (access.role !== 'admin') { res.status(403).json({ status: 'error', message: 'Only workspace admins can manage pipelines' }); return; }

      const name = String(req.body?.name || '').trim();
      if (!name) {
        res.status(400).json({ status: 'error', message: 'name is required' });
        return;
      }

      const baseSlug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      const suffix = Math.random().toString(36).slice(2, 6);
      const slug = baseSlug ? `${baseSlug}_${suffix}` : `pipeline_${suffix}`;

      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const pipelinePayload = {
        workspace_id: workspaceId,
        name,
        slug,
        created_at: now,
        updated_at: now,
      };

      const pipelineEventId = `pipe_${crypto.randomUUID().replace(/-/g, '')}`;
      const createBody = {
        workspace_id: workspaceId,
        lead_id: 0,
        source: 'deal_pipeline',
        event_id: pipelineEventId,
        payload: JSON.stringify(pipelinePayload),
        status: 'deal_pipeline',
        created_at: now,
      };

      const createRes = (await dealPipelinesApi.createPipeline(createBody)) as ApiResponse<any>;
      const createdIdRaw = (createRes as any)?.id ?? (createRes as any)?.data?.id ?? (createRes as any)?.data?.[0]?.id;
      const createdId = Number(createdIdRaw);

      if (!Number.isFinite(createdId) || createdId <= 0) {
        res.status(500).json({ status: 'error', message: 'Failed to create pipeline' });
        return;
      }

      res.json({ status: 'success', data: { id: createdId, workspace_id: workspaceId, name, slug } });
    } catch (error) {
      console.error('Error in POST /api/deals/pipelines:', error);
      res.status(500).json({ status: 'error', message: 'Failed to create pipeline' });
    }
  }
);

router.put(
  '/pipelines/:slug',
  authMiddleware,
  validate(updatePipelineSchema),
  async (
    req: AuthenticatedRequest<{ slug: string }, {}, any>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const workspaceId = Number(req.body?.workspace_id);
      const slug = String(req.params.slug || '').trim();

      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }
      if (slug === DEFAULT_PIPELINE_SLUG) {
        res.status(400).json({ status: 'error', message: 'The default pipeline cannot be renamed' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        res.status(403).json({ success: false, status: 'error', error: 'Access denied: You do not have access to this workspace' });
        return;
      }
      if (access.role !== 'admin') {
        res.status(403).json({ status: 'error', message: 'Only workspace admins can manage pipelines' });
        return;
      }

      const name = String(req.body?.name || '').trim();
      if (!name) {
        res.status(400).json({ status: 'error', message: 'name is required' });
        return;
      }

      const renamed = await renameWorkspacePipeline(workspaceId, slug, name);
      if (!renamed) {
        res.status(404).json({ status: 'error', message: 'Pipeline not found' });
        return;
      }

      res.json({ status: 'success', data: { ...renamed, workspace_id: workspaceId } });
    } catch (error) {
      console.error('Error in PUT /api/deals/pipelines/:slug:', error);
      res.status(500).json({ status: 'error', message: 'Failed to rename pipeline' });
    }
  }
);

router.delete(
  '/pipelines/:slug',
  authMiddleware,
  async (
    req: AuthenticatedRequest<{ slug: string }>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const workspaceId = Number(req.query.workspace_id);
      const slug = String(req.params.slug || '').trim();

      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }
      if (slug === DEFAULT_PIPELINE_SLUG) {
        res.status(400).json({ status: 'error', message: 'The default pipeline cannot be deleted' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        res.status(403).json({ success: false, status: 'error', error: 'Access denied: You do not have access to this workspace' });
        return;
      }
      if (access.role !== 'admin') {
        res.status(403).json({ status: 'error', message: 'Only workspace admins can manage pipelines' });
        return;
      }

      const response = await dealsApi.getDeals({ workspace_id: workspaceId, limit: 10000 }) as ApiResponse<any>;
      if (response.status !== 'success') throw new Error('Failed to check deals before removing the pipeline');
      const logs = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
      const dealsInPipeline = logs
        .filter((log: any) => Number(log.workspace_id) === workspaceId && log.status === 'deal')
        .map(parseDealFromLog)
        .filter((deal) => String(deal.pipeline_slug || DEFAULT_PIPELINE_SLUG) === slug);
      if (dealsInPipeline.length > 0) {
        res.status(409).json({ status: 'error', message: 'Move or delete the deals in this pipeline before removing it' });
        return;
      }

      const deleted = await deleteWorkspacePipeline(workspaceId, slug);
      if (!deleted) {
        res.status(404).json({ status: 'error', message: 'Pipeline not found' });
        return;
      }

      res.json({ status: 'success', message: 'Pipeline deleted successfully' });
    } catch (error) {
      console.error('Error in DELETE /api/deals/pipelines/:slug:', error);
      res.status(500).json({ status: 'error', message: 'Failed to delete pipeline' });
    }
  }
);

router.post(
  '/',
  authMiddleware,
  validate(createDealSchema),
  async (
    req: AuthenticatedRequest<{}, {}, any>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);

      const workspaceId = Number(req.body?.workspace_id);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: You do not have access to this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      const name = String(req.body?.name || '').trim();
      if (!name) {
        res.status(400).json({ status: 'error', message: 'name is required' });
        return;
      }

      const valueRaw = req.body?.value;
      const value = valueRaw === '' || valueRaw === undefined || valueRaw === null ? 0 : Number(valueRaw);
      if (!Number.isFinite(value) || value < 0) {
        res.status(400).json({ status: 'error', message: 'value must be a valid number' });
        return;
      }

      if (access.permissions.deals !== 'edit') {
        res.status(403).json({ status: 'error', message: 'You have view-only deal access' }); return;
      }
      const ownerId = req.body.owner_id == null ? (isElevatedRole(access.role) ? null : userId) : Number(req.body.owner_id);
      if ((!isElevatedRole(access.role) && ownerId !== userId) || (ownerId !== null && !await validDealAssignee(workspaceId, ownerId))) {
        res.status(403).json({ status: 'error', message: 'Assign deals to an existing workspace member. Only admins and managers can assign another person.' }); return;
      }

      const pipelineSlug = req.body?.pipeline_slug ? String(req.body.pipeline_slug).trim() : 'default';
      if (!hasPipelineAccess(access, pipelineSlug)) {
        res.status(403).json({ status: 'error', message: 'Access denied: You do not have access to this pipeline' }); return;
      }
      const { stages, fields } = await getDealStageConfigurationForPipeline(workspaceId, pipelineSlug);
      const stage = req.body?.stage ? String(req.body.stage) : stages[0]?.slug;
      if (!stage || !stages.some((item) => item.slug === stage)) {
        res.status(400).json({ status: 'error', message: 'Invalid stage' });
        return;
      }

      const customFields: DealFieldValues = req.body.custom_fields ?? {};
      if (!validateDealFields(res, fields, customFields, stage, customFields)) return;
      const expectedCloseDateRaw = req.body?.expected_close_date;
      const expectedCloseDate =
        expectedCloseDateRaw === undefined || expectedCloseDateRaw === null
          ? undefined
          : String(expectedCloseDateRaw || '').trim() || undefined;
      const priorityRaw = req.body?.priority === undefined || req.body?.priority === null ? '' : String(req.body.priority);
      const priority = PRIORITY_SLUGS.has(priorityRaw.trim().toLowerCase())
        ? priorityRaw.trim().toLowerCase()
        : undefined;

      // Handle lead_id if provided
      let leadId = 0;
      if (req.body?.lead_id !== undefined && req.body?.lead_id !== null) {
        const providedLeadId = Number(req.body.lead_id);
        if (Number.isFinite(providedLeadId) && providedLeadId > 0) {
          // Validate that the lead exists and user has access to it
          try {
            const leadResponse = await leadsApi.getLeadById(providedLeadId) as ApiResponse<any>;
            if (leadResponse.status !== 'success' || !leadResponse.data) {
              res.status(404).json({ status: 'error', message: 'Lead not found' });
              return;
            }

            const lead: any = Array.isArray(leadResponse.data) ? leadResponse.data[0] : leadResponse.data;
            if (Number(lead.workspace_id) !== workspaceId) {
              res.status(403).json({ status: 'error', message: 'Lead does not belong to this workspace' });
              return;
            }

            // Verify user has access to the lead's workspace (already verified above, but double-check)
            const leadAccess = await getWorkspaceAccess(userId, Number(lead.workspace_id));
            if (!leadAccess.hasAccess || !canViewLead(leadAccess, (lead as any)?.user_id)) {
              res.status(403).json({ status: 'error', message: 'Access denied to lead' });
              return;
            }

            leadId = providedLeadId;
          } catch (leadError) {
            console.error('Error validating lead:', leadError);
            res.status(500).json({ status: 'error', message: 'Failed to validate lead' });
            return;
          }
        }
      }

      const { deal } = await createDealRecord({
        workspaceId,
        name,
        value,
        contact: String(req.body?.contact || '').trim(),
        ownerId,
        stage,
        pipelineSlug,
        expectedCloseDate,
        priority,
        leadId,
        tags: Array.isArray(req.body?.tags) ? req.body.tags : undefined,
        customFields,
        stages,
        activityUserId: userId,
      });

      res.json({ status: 'success', data: deal });
    } catch (error) {
      console.error('Error in POST /api/deals:', error);
      res.status(500).json({ status: 'error', message: 'Failed to create deal' });
    }
  }
);

router.put(
  '/:id',
  authMiddleware,
  validate(updateDealSchema),
  async (
    req: AuthenticatedRequest<{ id: string }, {}, any>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', message: 'Invalid deal id' });
        return;
      }

      const existing = (await dealsApi.getDealById(id)) as ApiResponse<any>;
      const existingLog = Array.isArray(existing.data) ? existing.data[0] : existing.data;
      const workspaceId = Number(existingLog?.workspace_id);

      if (existing.status !== 'success' || !existingLog || Number(existingLog.id) !== id || String(existingLog?.status || '') !== 'deal' || !Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }

      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: You do not have access to this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      const currentDeal = parseDealFromLog(existingLog);
      const effectivePipelineSlug = req.body?.pipeline_slug
        ? String(req.body.pipeline_slug).trim()
        : String(currentDeal.pipeline_slug || 'default');
      const { stages, fields, required_documents: requiredDealDocuments } = await getDealStageConfigurationForPipeline(workspaceId, effectivePipelineSlug);
      const nextStage = req.body?.stage ? String(req.body.stage) : undefined;
      if (nextStage && !stages.some((item) => item.slug === nextStage)) {
        res.status(400).json({ status: 'error', message: 'Invalid stage' });
        return;
      }
      if (!canViewDeal(access, currentDeal.owner_id, currentDeal.pipeline_slug || 'default') || access.permissions.deals !== 'edit') {
        res.status(403).json({ status: 'error', message: 'You can only edit deals assigned to you with edit access' }); return;
      }
      if (req.body.owner_id !== undefined && req.body.owner_id !== currentDeal.owner_id) {
        if (!isElevatedRole(access.role) || (req.body.owner_id !== null && !await validDealAssignee(workspaceId, Number(req.body.owner_id)))) {
          res.status(403).json({ status: 'error', message: 'Only admins and managers can reassign deals to workspace members' }); return;
        }
      }
      const targetPipelineSlug = req.body?.pipeline_slug !== undefined
        ? (String(req.body.pipeline_slug || 'default').trim() || 'default')
        : (currentDeal.pipeline_slug || 'default');
      if (!hasPipelineAccess(access, targetPipelineSlug)) {
        res.status(403).json({ status: 'error', message: 'Access denied: You do not have access to the target pipeline' }); return;
      }
      if (nextStage && nextStage !== currentDeal.stage) {
        const targetStage = stages.find((item) => item.slug === nextStage);
        const requiredKinds = requiredDealDocuments || [];
        if (targetStage?.counts_as_conversion && requiredKinds.length > 0) {
          const attachedKinds = new Set((await getDealDocuments(workspaceId, id, parseJson(existingLog?.payload))).map((doc) => String(doc.kind || '').toLowerCase()));
          const missing = requiredKinds.filter((kind) => !attachedKinds.has(kind));
          if (missing.length > 0) {
            res.status(422).json({ status: 'error', message: `Required documents missing for this stage: ${missing.join(', ')}` }); return;
          }
        }
      }
      const customFields: DealFieldValues = { ...currentDeal.custom_fields, ...req.body.custom_fields };
      if (!validateDealFields(res, fields, customFields, nextStage || currentDeal.stage, req.body.custom_fields)) return;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      const expectedCloseDateNext =
        req.body?.expected_close_date !== undefined
          ? req.body.expected_close_date === null
            ? undefined
            : String(req.body.expected_close_date || '').trim() || undefined
          : currentDeal.expected_close_date;
      const priorityNext =
        req.body?.priority !== undefined
          ? req.body.priority === null
            ? undefined
            : (() => {
                const normalized = String(req.body.priority || '').trim().toLowerCase();
                return PRIORITY_SLUGS.has(normalized) ? normalized : undefined;
              })()
          : currentDeal.priority;

      const nextPayload = {
        ...parseJson(existingLog?.payload),
        custom_fields: customFields,
        name: req.body?.name !== undefined ? String(req.body.name).trim() : currentDeal.name,
        value: req.body?.value !== undefined ? Number(req.body.value || 0) : currentDeal.value,
        contact: req.body?.contact !== undefined ? String(req.body.contact).trim() : currentDeal.contact,
        owner_id:
          req.body?.owner_id !== undefined
            ? (req.body.owner_id === null ? null : Number(req.body.owner_id))
            : currentDeal.owner_id,
        stage: nextStage ? nextStage : currentDeal.stage,
        tags: Array.isArray(req.body?.tags)
          ? [...new Set(req.body.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean))]
          : currentDeal.tags || [],
        pipeline_slug:
          req.body?.pipeline_slug !== undefined
            ? String(req.body.pipeline_slug || 'default').trim() || 'default'
            : currentDeal.pipeline_slug || 'default',
        expected_close_date: expectedCloseDateNext,
        priority: priorityNext,
        created_at: currentDeal.created_at || now,
        updated_at: now,
        won_at:
          isWonStage(stages, nextStage || currentDeal.stage)
            ? isWonStage(stages, currentDeal.stage)
              ? currentDeal.won_at || currentDeal.updated_at || currentDeal.created_at || now
              : now
            : undefined,
        converted_at: stages.some((item) => item.slug === (nextStage || currentDeal.stage) && item.counts_as_conversion)
          ? stages.some((item) => item.slug === currentDeal.stage && item.counts_as_conversion)
            ? String(parseJson(existingLog?.payload)?.converted_at || currentDeal.won_at || currentDeal.updated_at || currentDeal.created_at || now)
            : now
          : undefined,
      };

      const updateBody = {
        workspace_id: workspaceId,
        lead_id: Number(existingLog?.lead_id || 0) || 0,
        source: String(existingLog?.source || 'deal'),
        event_id: String(existingLog?.event_id || ''),
        payload: JSON.stringify(nextPayload),
        status: 'deal',
      };

      const response = (await dealsApi.updateDeal(id, updateBody)) as ApiResponse<any>;

      if (response?.status !== 'success') {
        res.status(500).json({ status: 'error', message: 'Failed to update deal' });
        return;
      }

      if (nextStage && String(currentDeal.stage || '') !== nextStage) {
        const historyEventId = `deal_hist_${crypto.randomUUID().replace(/-/g, '')}`;
        const historyBody = {
          workspace_id: workspaceId,
          lead_id: id,
          source: 'deal_stage_history',
          event_id: historyEventId,
          payload: JSON.stringify({
            deal_id: id,
            user_id: userId || null,
            old_stage: String(currentDeal.stage || ''),
            new_stage: nextStage,
            created_at: now,
          }),
          status: 'deal_stage_history',
          created_at: now,
        };
        try {
          await dealStageHistoryApi.createStageHistory(historyBody);
        } catch {}
      }

      const automationBase = {
        workspaceId,
        dealId: id,
        leadId: Number(currentDeal.lead_id || 0) || undefined,
        pipelineSlug: nextPayload.pipeline_slug,
        stage: String(nextPayload.stage || ''),
      };
      if (String(currentDeal.stage || '') !== String(nextPayload.stage || '')) {
        emitAutomationEvent({ ...automationBase, type: 'deal_moved', previousStage: String(currentDeal.stage || '') });
      }
      if ((currentDeal.owner_id ?? null) !== (nextPayload.owner_id ?? null)) {
        emitAutomationEvent({ ...automationBase, type: 'deal_owner_changed' });
      }

      res.json({ status: 'success', data: { ...currentDeal, ...nextPayload, documents: await getDealDocuments(workspaceId, id, nextPayload), id, workspace_id: workspaceId } });
    } catch (error) {
      console.error('Error in PUT /api/deals/:id:', error);
      res.status(500).json({ status: 'error', message: 'Failed to update deal' });
    }
  }
);

router.delete(
  '/:id',
  authMiddleware,
  async (
    req: AuthenticatedRequest<{ id: string }>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', message: 'Invalid deal id' });
        return;
      }

      // Verify deal exists and get workspace_id
      const existing = (await dealsApi.getDealById(id)) as ApiResponse<any>;
      const existingLog = Array.isArray(existing.data) ? existing.data[0] : existing.data;

      if (existing.status !== 'success' || !existingLog || Number(existingLog.id) !== id || String(existingLog?.status || '') !== 'deal') {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }

      const workspaceId = Number(existingLog?.workspace_id);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }

      // Verify workspace access
      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: You do not have access to this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      // Delete the deal
      if (!isElevatedRole(access.role)) { res.status(403).json({ status: 'error', message: 'Only workspace admins and managers can delete deals' }); return; }

      const deleteRes = (await dealsApi.deleteDeal(id)) as ApiResponse<any>;
      
      if (deleteRes?.status === 'success' || deleteRes?.status === 'failed') {
        const docRows = await getDealDocumentRows(workspaceId, id).catch(() => []);
        const cloud = cloudinaryClient();
        for (const docRow of docRows) {
          if (docRow?.id) await webhookLogsApi.deleteWebhookLog(Number(docRow.id)).catch(() => undefined);
          const removed = parseDealDocumentRow(docRow);
          if (removed?.storage_path && cloud) {
            await cloud.uploader.destroy(removed.storage_path, {
              resource_type: removed.resource_type === 'image' ? 'image' : 'raw',
              type: 'private',
            }).catch(() => undefined);
          }
        }
        res.json({ status: 'success', message: 'Deal deleted successfully' });
      } else {
        res.status(500).json({ status: 'error', message: 'Failed to delete deal' });
      }
    } catch (error) {
      console.error('Error in DELETE /api/deals/:id:', error);
      res.status(500).json({ status: 'error', message: 'Failed to delete deal' });
    }
  }
);

function canReadDealDocuments(access: { hasAccess: boolean; permissions: { deals: string } }, deal: { owner_id?: number | null; pipeline_slug?: string }): boolean {
  return access.hasAccess && canViewDeal(access as any, deal.owner_id, deal.pipeline_slug || 'default');
}

function canWriteDealDocuments(access: { hasAccess: boolean; permissions: { deals: string } }, deal: { owner_id?: number | null; pipeline_slug?: string }): boolean {
  return canReadDealDocuments(access, deal) && access.permissions.deals === 'edit';
}

router.post(
  '/:id/documents',
  authMiddleware,
  validate(dealDocumentUploadSchema),
  async (
    req: AuthenticatedRequest<{ id: string }, {}, any>,
    res: Response<ApiResponse<DealDocument> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const id = Number(req.params.id);
      const found = await getDealLogOrNull(id);
      if (!found) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }
      const access = await getWorkspaceAccess(userId, found.workspaceId);
      const currentDeal = parseDealFromLog(found.log);
      if (!canWriteDealDocuments(access, currentDeal)) {
        res.status(403).json({ status: 'error', message: 'Access denied: You do not have permission to add documents to this deal' });
        return;
      }
      const cloud = cloudinaryClient();
      if (!cloud) {
        res.status(503).json({ status: 'error', message: 'Document storage is not configured' });
        return;
      }
      const mime = String(req.body.mime || '').trim().toLowerCase();
      if (!DEAL_DOCUMENT_MIME_EXTENSIONS[mime]) {
        res.status(400).json({ status: 'error', message: 'File type not allowed. Upload a PDF, image, or Word document.' });
        return;
      }
      const data = String(req.body.data || '');
      const actualBytes = Buffer.byteLength(data, 'base64');
      if (actualBytes <= 0 || actualBytes > DEAL_DOCUMENT_MAX_BYTES || actualBytes !== Number(req.body.size)) {
        res.status(400).json({ status: 'error', message: 'File size is outside the allowed range' });
        return;
      }
      const docId = newDocumentId();
      const safeName = sanitizeDocumentName(req.body.name);
      const extension = extensionForDocument(mime, safeName);
      const resourceType = mime.startsWith('image/') ? 'image' : 'raw';
      const publicId = resourceType === 'raw'
        ? `${documentPublicId(found.workspaceId, id, docId)}.${extension}`
        : documentPublicId(found.workspaceId, id, docId);
      let uploaded: { resource_type?: string; bytes?: number };
      try {
        uploaded = await cloud.uploader.upload(`data:${mime};base64,${data}`, {
          public_id: publicId,
          resource_type: resourceType,
          type: 'private',
          format: resourceType === 'raw' ? extension : undefined,
          allowed_formats: DEAL_DOCUMENT_ALLOWED_FORMATS,
          overwrite: false,
          unique_filename: false,
        });
      } catch (uploadError) {
        console.error('Error in POST /api/deals/:id/documents: Cloudinary upload failed:', (uploadError as Error)?.message || uploadError);
        res.status(400).json({ status: 'error', message: 'File rejected by storage. Upload a PDF, image, or Word document.' });
        return;
      }
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const document: DealDocument = {
        id: docId,
        name: safeName,
        kind: normalizeDocumentKind(req.body.kind),
        mime,
        size: Number(uploaded.bytes) || actualBytes,
        storage_path: publicId,
        resource_type: String(uploaded.resource_type || resourceType),
        uploaded_by: userId || null,
        uploaded_at: now,
      };
      const createResponse = (await webhookLogsApi.createWebhookLog(dealDocumentRow(found.workspaceId, id, document, now))) as ApiResponse<any>;
      if (createResponse?.status !== 'success') {
        await cloud.uploader.destroy(publicId, { resource_type: document.resource_type }).catch(() => undefined);
        res.status(500).json({ status: 'error', message: 'Failed to save document' });
        return;
      }
      res.json({ status: 'success', data: document });
    } catch (error) {
      console.error('Error in POST /api/deals/:id/documents:', error);
      res.status(500).json({ status: 'error', message: 'Failed to upload document' });
    }
  }
);

router.get(
  '/:id/documents',
  authMiddleware,
  async (
    req: AuthenticatedRequest<{ id: string }>,
    res: Response<ApiResponse<DealDocument[]> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const id = Number(req.params.id);
      const found = await getDealLogOrNull(id);
      if (!found) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }
      const access = await getWorkspaceAccess(userId, found.workspaceId);
      const currentDeal = parseDealFromLog(found.log);
      if (!canReadDealDocuments(access, currentDeal)) {
        res.status(403).json({ status: 'error', message: 'Access denied: You do not have permission to view this deal' });
        return;
      }
      res.json({ status: 'success', data: await getDealDocuments(found.workspaceId, id, parseJson(found.log?.payload)) });
    } catch (error) {
      console.error('Error in GET /api/deals/:id/documents:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load documents' });
    }
  }
);

router.get(
  '/:id/documents/:docId/download',
  authMiddleware,
  async (
    req: AuthenticatedRequest<{ id: string; docId: string }>,
    res: Response | any
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const id = Number(req.params.id);
      const found = await getDealLogOrNull(id);
      if (!found) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }
      const access = await getWorkspaceAccess(userId, found.workspaceId);
      const currentDeal = parseDealFromLog(found.log);
      if (!canReadDealDocuments(access, currentDeal)) {
        res.status(403).json({ status: 'error', message: 'Access denied: You do not have permission to view this deal' });
        return;
      }
      const document = (await getDealDocuments(found.workspaceId, id, parseJson(found.log?.payload))).find((item) => item.id === req.params.docId);
      if (!document) {
        res.status(404).json({ status: 'error', message: 'Document not found' });
        return;
      }
      const cloud = cloudinaryClient();
      if (!cloud) {
        res.status(503).json({ status: 'error', message: 'Document storage is not configured' });
        return;
      }
      const resourceType = document.resource_type === 'image' ? 'image' : 'raw';
      let signedUrl: string | null = null;
      try {
        signedUrl = cloud.utils.private_download_url(
          document.storage_path,
          DEAL_DOCUMENT_MIME_EXTENSIONS[document.mime] || 'pdf',
          { resource_type: resourceType, expires_at: Math.floor(Date.now() / 1000) + 900 }
        );
      } catch {
        signedUrl = null;
      }
      if (!signedUrl) {
        res.status(404).json({ status: 'error', message: 'Document file is missing' });
        return;
      }
      res.redirect(signedUrl);
    } catch (error) {
      console.error('Error in GET /api/deals/:id/documents/:docId/download:', error);
      if (!(res as any).headersSent) {
        res.status(500).json({ status: 'error', message: 'Failed to download document' });
      }
    }
  }
);

router.delete(
  '/:id/documents/:docId',
  authMiddleware,
  async (
    req: AuthenticatedRequest<{ id: string; docId: string }>,
    res: Response<ApiResponse<{ deleted: boolean }> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      const id = Number(req.params.id);
      const found = await getDealLogOrNull(id);
      if (!found) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }
      const access = await getWorkspaceAccess(userId, found.workspaceId);
      const currentDeal = parseDealFromLog(found.log);
      if (!canWriteDealDocuments(access, currentDeal)) {
        res.status(403).json({ status: 'error', message: 'Access denied: You do not have permission to delete documents from this deal' });
        return;
      }
      const rows = await getDealDocumentRows(found.workspaceId, id);
      const row = rows.find((item: any) => String(item?.event_id) === req.params.docId);
      const legacy = parseDealDocuments(parseJson(found.log?.payload));
      const legacyDoc = legacy.find((item) => item.id === req.params.docId);
      if (!row && !legacyDoc) {
        res.status(404).json({ status: 'error', message: 'Document not found' });
        return;
      }
      if (row?.id) {
        const deleteResponse = (await webhookLogsApi.deleteWebhookLog(Number(row.id))) as ApiResponse<any>;
        if (deleteResponse?.status !== 'success') {
          res.status(500).json({ status: 'error', message: 'Failed to delete document' });
          return;
        }
      } else if (legacyDoc) {
        const remaining = legacy.filter((item) => item.id !== legacyDoc.id);
        const payload = { ...parseJson(found.log?.payload), documents: remaining };
        const updateResponse = (await dealsApi.updateDeal(id, {
          workspace_id: found.workspaceId,
          lead_id: Number(found.log?.lead_id || 0) || 0,
          source: String(found.log?.source || 'deal'),
          event_id: String(found.log?.event_id || ''),
          payload: JSON.stringify(payload),
          status: 'deal',
        })) as ApiResponse<any>;
        if (updateResponse?.status !== 'success') {
          res.status(500).json({ status: 'error', message: 'Failed to delete document' });
          return;
        }
      }
      const storedPath = row ? parseDealDocumentRow(row)?.storage_path || '' : legacyDoc?.storage_path || '';
      const storedResourceType = parseDealDocumentRow(row)?.resource_type === 'image' ? 'image' : 'raw';
      const cloud = cloudinaryClient();
      if (storedPath && cloud) {
        await cloud.uploader.destroy(storedPath, { resource_type: storedResourceType, type: 'private' }).catch(() => undefined);
      }
      res.json({ status: 'success', data: { deleted: true } });
    } catch (error) {
      console.error('Error in DELETE /api/deals/:id/documents/:docId:', error);
      res.status(500).json({ status: 'error', message: 'Failed to delete document' });
    }
  }
);

export default router;
