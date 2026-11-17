import { Router, Response } from 'express';
import { emitAutomationEvent } from '../services/automations/engine.js';
import {
  leadsApi,
  leadStatusesApi,
  leadActivitiesApi,
  usersApi,
  customFieldsApi,
  customFieldValuesApi,
  notificationsApi,
} from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { verifyWorkspaceAccess } from '../utils/workspaceHelpers.js';
import { canViewLead, canEditLead, isElevatedRole } from '../types/permissions.js';
import type { WorkspaceAccess } from '../types/permissions.js';
import { validDealAssignee } from '../services/workspacePermissions.js';
import { getDefaultStatusIdForWorkspace, extractCustomFieldValuesFromPayload } from '../utils/leadHelpers.js';
import { generateEventId } from '../utils/authHelpers.js';
import { SourceRegistry } from '../services/sourceRegistry.js';
import { verifyEmail as verifyEmailAPI, isEmailValid } from '../services/emailVerifier.js';
import {
  enqueueLeadAutoReplyEmailJob,
  sendLeadNotificationForNewLead,
  sendLeadAssignmentNotification,
} from '../services/leadAutoReplyEmail.js';
import {
  enqueueWhatsAppMessage,
  maybeEnqueueWhatsAppOnStatusChange,
} from '../services/whatsapp.js';
import { normalizeSourceString } from '../types/sources.js';
import { validatePhone, formatMySqlDateTimeUtc, normalizeMySqlDateTime } from '../lib/validation.js';
import {
  ApiResponse,
  Lead,
  LeadCreateData,
  LeadUpdateData,
  CustomField,
  CustomFieldValue,
  LeadStatus,
  AuthenticatedRequest,
  LeadsQuery,
  AuthErrorResponse
} from '../types/index.js';
import { validate, createLeadSchema, updateLeadSchema, bulkImportSchema } from '../utils/validation.js';

const router: Router = Router();

function toFlagInt(value: unknown): 0 | 1 {
  return Number(value) === 1 ? 1 : 0;
}

function toNullableUserId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value === '' || value === 'null' || value === 'undefined') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toBoundedPositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = toPositiveInt(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

const LEADS_LIST_FETCH_PAGE_SIZE = toBoundedPositiveInt(
  process.env.LEADS_LIST_FETCH_PAGE_SIZE,
  500,
  50,
  1000
);
const LEADS_LIST_MAX_PAGES = toBoundedPositiveInt(
  process.env.LEADS_LIST_MAX_PAGES,
  100,
  1,
  500
);
const LEADS_LIST_MAX_LIMIT = toBoundedPositiveInt(
  process.env.LEADS_LIST_MAX_LIMIT,
  10000,
  1,
  50000
);
// Per-workspace in-process cache so the sidebar badge count never triggers a
// full NoCodeBackend scan more than once per TTL window, even across multiple
// open tabs that all poll every 60 s.
const leadCountCache = new Map<string, { count: number; expiresAt: number }>();
const LEAD_COUNT_CACHE_TTL_MS = 30_000;

function invalidateLeadCountCache(workspaceId: number): void {
  for (const key of leadCountCache.keys()) {
    if (key === String(workspaceId) || key.startsWith(`${workspaceId}_`)) {
      leadCountCache.delete(key);
    }
  }
}

const ALLOWED_LEAD_LIST_SORT_FIELDS = new Set([
  'id',
  'name',
  'email',
  'phone',
  'status_id',
  'source',
  'source_old',
  'source_ref',
  'source_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'user_id',
  'assignee_id',
]);

function normalizeLeadListSort(value: unknown): string | null {
  const sortField = typeof value === 'string' ? value.trim() : '';
  return ALLOWED_LEAD_LIST_SORT_FIELDS.has(sortField) ? sortField : null;
}

function normalizeSortOrder(value: unknown): 'asc' | 'desc' | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'asc' || normalized === 'desc') return normalized;
  return null;
}

function isLeadSoftDeleted(lead: Lead): boolean {
  const deletedAtStr = lead.deleted_at ? String(lead.deleted_at).trim() : '';
  return deletedAtStr !== '' && deletedAtStr !== 'null' && deletedAtStr !== 'undefined';
}

function normalizeLeadForResponse(lead: Lead): Lead {
  return {
    ...lead,
    user_id: toNullableUserId((lead as any).user_id),
    email_valid: toFlagInt((lead as any).email_valid) as any,
    phone_valid: toFlagInt((lead as any).phone_valid) as any,
  };
}


const ALLOWED_LEAD_UPDATE_FIELDS = new Set<string>([
  'workspace_id',
  'status_id',
  'name',
  'email',
  'phone',
  'source_old',
  'source_ref',
  'source_id',
  'email_valid',
  'phone_valid',
  'email_verified_at',
  'email_verification_status',
  'deleted_at',
  'user_id',
]);

function sanitizeLeadUpdatePayload(payload: Record<string, any>): Record<string, any> {
  const safe: Record<string, any> = {};
  for (const key of Object.keys(payload || {})) {
    if (!ALLOWED_LEAD_UPDATE_FIELDS.has(key)) continue;
    const value = payload[key];
    if (value === undefined) continue;
    if (key === 'email_verified_at') {
      const normalized = normalizeMySqlDateTime(value);
      if (normalized === undefined) continue;
      safe[key] = normalized;
      continue;
    }
    safe[key] = value;
  }
  return safe;
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
    // Power mode can fail depending on plan/credits; fall back to quick so we still set email_valid.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Leads Route] Power email verification failed, falling back to quick:`, (powerError as Error).message || powerError);
    }
    const verification = await verifyEmailAPI(email, 'quick');
    const emailValidFlag = toLeadEmailValidFlag(verification, 'quick');
    return { verification, mode: 'quick', emailValidFlag };
  }
}

function resolveEmailVerificationStatus(
  verification: any,
  emailValidFlag: 0 | 1
): string {
  const status =
    typeof verification?.status === 'string' ? verification.status.trim().toLowerCase() : '';
  if (status) return status;
  return emailValidFlag === 1 ? 'valid' : 'invalid';
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
    } as any);
  } catch (richUpdateError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[Leads Route] Failed to persist full email verification payload for lead ${leadId}, retrying with email_valid only:`,
        (richUpdateError as Error).message || richUpdateError
      );
    }
    await leadsApi.updateLead(leadId, { email_valid: payload.emailValidFlag } as any);
  }
}

/**
 * Validate and normalize a source value.
 * Ensures source is a valid SourceType and normalizes it if it's a legacy string.
 * Also optionally registers the source in the registry.
 * 
 * @param source - Incoming source value (string)
 * @param workspaceId - Workspace ID for context
 * @returns Normalized source string and optional source ID
 */
async function validateAndNormalizeSource(source: string, workspaceId: number): Promise<{ normalized: string; sourceId: string | null }> {
  console.log(`[Source Validation] Input source: "${source}", workspaceId: ${workspaceId}`);
  
  if (!source) {
    console.log(`[Source Validation] No source provided, defaulting to MANUAL`);
    return { normalized: 'MANUAL', sourceId: null }; // Default to manual if no source provided
  }

  const raw = String(source).trim();
  const normalizedType = normalizeSourceString(raw);
  const normalizedKey = raw.toLowerCase().replace(/[-\s]+/g, '_');
  const shouldPreserveCustom = normalizedType === 'OTHER' && normalizedKey !== 'other';
  const normalized = shouldPreserveCustom ? raw : normalizedType;
  console.log(`[Source Validation] Normalized: "${source}" -> "${normalized}"`);
  
  let sourceId: string | null = null;

  // Optionally register the source if it's not already in registry
  try {
    const registry = new SourceRegistry(workspaceId);
    const registeredSource = await registry.mapIncomingSource(shouldPreserveCustom ? normalizedType : raw);
    
    if (registeredSource) {
      sourceId = registeredSource.sourceId;
      console.log(`[Source Validation] ✅ Source registered successfully! Normalized: "${normalized}", sourceId: "${registeredSource.sourceId}"`);
    } else {
      console.log(`[Source Validation] ⚠️  mapIncomingSource returned null for source "${source}"`);
    }
  } catch (error) {
    console.error(`[Source Validation] ❌ Error registering source "${source}":`, error);
  }

  // Return normalized source even if registration failed
  console.log(`[Source Validation] Returning: normalized="${normalized}", sourceId="${sourceId}"`);
  return { normalized, sourceId };
}

type BulkImportMode = 'create' | 'upsert_email';

type BulkImportRowResult = {
  row_index: number;
  action: 'created' | 'updated' | 'failed';
  lead_id?: number;
  error?: string;
  warnings?: string[];
};

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = new Array(Math.min(safeConcurrency, items.length)).fill(null).map(async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) return;
      const item = items[currentIndex] as T;
      results[currentIndex] = await worker(item, currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

async function resolveStatusIdForImportRow(options: {
  row: Record<string, any>;
  workspaceId: number;
  defaultStatusId: number | null;
  statuses: LeadStatus[];
}): Promise<number | null> {
  const { row, defaultStatusId, statuses } = options;

  const explicitStatusId = parseOptionalNumber(row.status_id);
  if (explicitStatusId !== null) return explicitStatusId;

  const statusRaw = normalizeNullableString(row.status);
  if (!statusRaw) return defaultStatusId;

  const lowered = statusRaw.toLowerCase();
  const matched = statuses.find((s) => s.slug?.toLowerCase() === lowered || s.name?.toLowerCase() === lowered);
  return matched?.id ?? defaultStatusId;
}

async function upsertCustomFieldValuesForLead(options: {
  leadId: number;
  extractedValues: { field_id: number; value: string }[];
}): Promise<{ saved: number; errors: string[] }> {
  const { leadId, extractedValues } = options;
  if (extractedValues.length === 0) return { saved: 0, errors: [] };

  const errors: string[] = [];
  let saved = 0;

  let existingByFieldId = new Map<number, CustomFieldValue>();
  try {
    const existingResponse = await customFieldValuesApi.getCustomFieldValues(leadId) as ApiResponse<CustomFieldValue[]>;
    if (existingResponse.status === 'success' && Array.isArray(existingResponse.data)) {
      existingByFieldId = new Map(existingResponse.data.map((v) => [v.field_id, v]));
    }
  } catch (error) {
    errors.push((error as Error).message || 'Failed to load existing custom field values');
  }

  for (const field of extractedValues) {
    try {
      const existing = existingByFieldId.get(field.field_id);
      if (existing?.id) {
        await customFieldValuesApi.updateCustomFieldValue(existing.id, { value: field.value });
      } else {
        await customFieldValuesApi.createCustomFieldValue({
          lead_id: leadId,
          field_id: field.field_id,
          value: field.value,
        });
      }
      saved++;
    } catch (error) {
      errors.push((error as Error).message || `Failed to save custom field ${field.field_id}`);
    }
  }

  return { saved, errors };
}

router.get('/', authMiddleware, async (req: AuthenticatedRequest<{}, LeadsQuery>, res: Response<ApiResponse<Lead[]>>): Promise<void> => {
  try {
    const { workspace_id, status_id, page, limit, sort, order, deleted, search } = req.query || {};

    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const workspaceId: number = Number(workspace_id);
    const userId: number = Number(req.user?.id || 0);

    const access = await verifyWorkspaceAccess(userId, workspaceId);

    if (!access.hasAccess) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have access to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    let response: ApiResponse<Lead[]>;
    try {
      const requestedPage = toPositiveInt(page, 1);
      const limitValue = Number(limit);
      const hasLimit = Number.isFinite(limitValue) && limitValue > 0;
      const requestedLimit = hasLimit
        ? Math.min(Math.max(Math.floor(limitValue), 1), LEADS_LIST_MAX_LIMIT)
        : null;
      const requestedEndIndex = requestedLimit ? requestedPage * requestedLimit : 0;
      const statusIdFilter = status_id ? Number(status_id) : null;
      const hasStatusFilter = Number.isFinite(statusIdFilter);
      const rawSearch = typeof search === 'string' ? search.trim() : '';
      const normalizedSearch = rawSearch.toLowerCase();
      const fetchAllFilteredRows = req.query.includeTotal === 'true' || !requestedLimit;
      const normalizedSort = normalizeLeadListSort(sort);
      const normalizedOrder = normalizeSortOrder(order);

      const filteredLeads: Lead[] = [];
      let sourcePage = 1;
      let sourceHasMore = true;
      let sourcePagesFetched = 0;

      do {
        const fetchParams: any = {
          workspace_id: workspaceId,
          page: sourcePage,
          limit: LEADS_LIST_FETCH_PAGE_SIZE,
        };
        if (hasStatusFilter) fetchParams.status_id = statusIdFilter;
        if (normalizedSort) fetchParams.sort = normalizedSort;
        if (normalizedOrder) fetchParams.order = normalizedOrder;

        response = await leadsApi.getLeads(fetchParams) as ApiResponse<Lead[]>;
        if (response.status !== 'success' || !Array.isArray(response.data)) {
          break;
        }

        const pageRows = response.data;
        sourcePagesFetched++;

        const pageFiltered = pageRows
          .filter((lead: Lead) => Number(lead.workspace_id) === workspaceId)
          .filter((lead: Lead) => canViewLead(access, lead.user_id))
          .filter((lead: Lead) => {
            const leadDeleted = isLeadSoftDeleted(lead);
            return deleted === 'true' ? leadDeleted : !leadDeleted;
          })
          .filter((lead: Lead) => {
            if (!hasStatusFilter) return true;
            return Number(lead.status_id) === statusIdFilter;
          })
          .filter((lead: Lead) => {
            if (rawSearch.length === 0) return true;
            const name = String(lead.name || '').toLowerCase();
            const email = String(lead.email || '').toLowerCase();
            const phone = String(lead.phone || '');
            return name.includes(normalizedSearch)
              || email.includes(normalizedSearch)
              || phone.includes(rawSearch);
          })
          .map(normalizeLeadForResponse);

        filteredLeads.push(...pageFiltered);

        sourceHasMore =
          response.metadata?.hasMore === true || pageRows.length === LEADS_LIST_FETCH_PAGE_SIZE;
        sourcePage++;
      } while (
        sourceHasMore &&
        sourcePagesFetched < LEADS_LIST_MAX_PAGES &&
        (fetchAllFilteredRows || filteredLeads.length <= requestedEndIndex)
      );

      if (response.status !== 'success') {
        console.error(`[Leads Route] API returned error:`, response);
        res.json(response);
        return;
      }

      const pageStartIndex = requestedLimit ? (requestedPage - 1) * requestedLimit : 0;
      const pageEndIndex = requestedLimit ? pageStartIndex + requestedLimit : filteredLeads.length;
      const pagedLeads = requestedLimit
        ? filteredLeads.slice(pageStartIndex, pageEndIndex)
        : filteredLeads;
      const stoppedBeforeSourceEnd = sourceHasMore && sourcePagesFetched >= LEADS_LIST_MAX_PAGES;
      const hasMore =
        requestedLimit !== null &&
        (filteredLeads.length > pageEndIndex || stoppedBeforeSourceEnd);

      response.data = pagedLeads;
      response.metadata = {
        ...(response.metadata || {}),
        hasMore,
        ...(stoppedBeforeSourceEnd ? { truncated: true } : {}),
      };

      if (req.query.includeTotal === 'true' && response.status === 'success') {
        response.metadata.total = filteredLeads.length;
      }
      res.json(response);
    } catch (apiError) {
      console.error('Error calling leadsApi.getLeads:', apiError);
      throw apiError;
    }
  } catch (error) {
    console.error('Error in /api/leads:', error);
    console.error('Error details:', {
      message: (error as Error).message,
      stack: (error as Error).stack,
      cause: (error as any).cause
    });
    const errorResponse: ApiResponse<Lead[]> = {
      status: 'error',
      message: (error as Error).message || 'Failed to load leads from NoCodeBackend',
    };
    res.status(500).json(errorResponse);
  }
});

// Lightweight count endpoint — returns only the number of active (non-deleted)
// leads for a workspace. The result is cached server-side for LEAD_COUNT_CACHE_TTL_MS
// so the sidebar can poll without hammering NoCodeBackend on every tab / focus event.
router.get('/count', authMiddleware, async (
  req: AuthenticatedRequest<{}, { workspace_id?: string }>,
  res: Response<ApiResponse<{ count: number }>>
): Promise<void> => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      res.status(400).json({ status: 'error', message: 'workspace_id is required' });
      return;
    }

    const workspaceId = Number(workspace_id);
    const userId = Number(req.user?.id || 0);

    const access = await verifyWorkspaceAccess(userId, workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }

    const cacheKey = access.permissions.deals_scope === 'all' ? String(workspaceId) : `${workspaceId}_${userId}`;
    const cached = leadCountCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.json({ status: 'success', data: { count: cached.count } });
      return;
    }

    let count = 0;
    let page = 1;
    let hasMore = true;
    let pagesFetched = 0;

    while (hasMore && pagesFetched < LEADS_LIST_MAX_PAGES) {
      const pageResponse = await leadsApi.getLeads({
        workspace_id: workspaceId,
        page,
        limit: LEADS_LIST_FETCH_PAGE_SIZE,
      }) as ApiResponse<Lead[]>;

      if (pageResponse.status !== 'success' || !Array.isArray(pageResponse.data)) break;

      const rows = pageResponse.data;
      pagesFetched++;

      count += rows.filter(
        (lead: Lead) =>
          Number(lead.workspace_id) === workspaceId && !isLeadSoftDeleted(lead) && canViewLead(access, lead.user_id)
      ).length;

      hasMore =
        pageResponse.metadata?.hasMore === true ||
        rows.length === LEADS_LIST_FETCH_PAGE_SIZE;
      page++;
    }

    leadCountCache.set(cacheKey, { count, expiresAt: Date.now() + LEAD_COUNT_CACHE_TTL_MS });

    res.json({ status: 'success', data: { count } });
  } catch (error) {
    console.error('Error in GET /api/leads/count:', error);
    res.status(500).json({ status: 'error', message: 'Failed to get lead count' });
  }
});

router.get('/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse<Lead>>): Promise<void> => {
  try {
    const { id } = req.params;
    const userId: number = Number(req.user?.id || 0);
    const { includeDeleted } = req.query;

    const leadResponse = await leadsApi.getLeadById(Number(id)) as ApiResponse<Lead>;
    if (leadResponse.status !== 'success' || !leadResponse.data) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    const lead: Lead = Array.isArray(leadResponse.data) 
      ? leadResponse.data[0] 
      : leadResponse.data;

    // Normalize validation flags to 0/1 for consistent frontend rendering
    (lead as any).user_id = toNullableUserId((lead as any).user_id);
    (lead as any).email_valid = toFlagInt((lead as any).email_valid);
    (lead as any).phone_valid = toFlagInt((lead as any).phone_valid);
    
    console.log(`[Get Lead] Lead ${id} fetched:`, {
      id: lead.id,
      name: lead.name,
      deleted_at: lead.deleted_at,
      hasDeletedAt: 'deleted_at' in lead,
      allFields: Object.keys(lead)
    });
    
    // Check if lead is deleted (soft delete) - but allow if includeDeleted=true
    if (lead.deleted_at && includeDeleted !== 'true') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead not found',
      };
      res.status(404).json(errorResponse);
      return;
    }
    
    const workspaceId: number = lead.workspace_id;

    const access = await verifyWorkspaceAccess(userId, workspaceId);

    if (!access.hasAccess || !canViewLead(access, lead.user_id)) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have access to this lead',
      };
      res.status(403).json(errorResponse);
      return;
    }

    res.json(leadResponse);
  } catch (error) {
    const status = (error as any)?.status;
    if (status === 404) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    console.error('Error in GET /api/leads/:id:', error);
    
    let errorMessage: string = 'Failed to load lead from NoCodeBackend';
    if ((error as Error).message?.includes('timeout') || (error as Error).message?.includes('Unable to connect')) {
      errorMessage = 'Connection timeout: Unable to reach the database. Please check your internet connection and try again.';
    } else if ((error as Error).message) {
      errorMessage = (error as Error).message;
    }
    
    const errorResponse: ApiResponse<Lead> = {
      status: 'error',
      message: errorMessage,
    };
    res.status(500).json(errorResponse);
  }
});

router.post('/bulk-import', authMiddleware, validate(bulkImportSchema), async (req: AuthenticatedRequest<{}, {}, any>, res: Response<ApiResponse<any>>): Promise<void> => {
  try {
    const body: any = req.body || {};
    const workspaceId = parseOptionalNumber(body.workspace_id);
    const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
    const mode: BulkImportMode = body.mode === 'upsert_email' ? 'upsert_email' : 'create';
    const verifyEmails: boolean = body.verify_emails === true;
    const requestedConcurrency = parseOptionalNumber(body.concurrency);
    const concurrency = Math.min(5, Math.max(1, requestedConcurrency ?? 2));

    if (!workspaceId) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (rows.length === 0) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'rows must be a non-empty array',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (rows.length > 5000) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'rows exceeds limit (5000)',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const userId: number = Number(req.user?.id || 0);
    const access: WorkspaceAccess = await verifyWorkspaceAccess(userId, workspaceId);
    if (!access.hasAccess) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have access to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    if (access.permissions.deals !== 'edit') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have permission to import leads',
      };
      res.status(403).json(errorResponse);
      return;
    }

    let defaultStatusId: number | null = null;
    try {
      defaultStatusId = await getDefaultStatusIdForWorkspace(workspaceId);
    } catch (error) {
      defaultStatusId = null;
    }

    let statuses: LeadStatus[] = [];
    try {
      const statusesResponse = await leadStatusesApi.getStatuses(workspaceId) as ApiResponse<LeadStatus[]>;
      if (statusesResponse.status === 'success' && Array.isArray(statusesResponse.data)) {
        statuses = statusesResponse.data.filter((s) => s.is_active === 1);
      }
    } catch (error) {
      statuses = [];
    }

    let customFields: CustomField[] = [];
    try {
      const customFieldsResponse = await customFieldsApi.getCustomFields(workspaceId) as ApiResponse<CustomField[]>;
      if (customFieldsResponse.status === 'success' && Array.isArray(customFieldsResponse.data)) {
        customFields = customFieldsResponse.data.filter((field) => field.is_active === 1);
      }
    } catch (error) {
      customFields = [];
    }

    const results = await runWithConcurrency(rows, concurrency, async (row: any, rowIndex: number): Promise<BulkImportRowResult> => {
      const warnings: string[] = [];
      try {
        const rowObject: Record<string, any> = row && typeof row === 'object' ? row : {};

        const email = normalizeNullableString(rowObject.email);
        const rawPhone = normalizeNullableString(rowObject.phone);
        const name = normalizeNullableString(rowObject.name);

        if (!email && !rawPhone && !name) {
          return {
            row_index: rowIndex,
            action: 'failed',
            error: 'Row is missing name, email, and phone',
          };
        }

        // Normalize phone for uniform storage (+91...)
        let phone: string | null = null;
        let phoneValid: 0 | 1 = 0;
        if (rawPhone) {
          const phoneValidation = validatePhone(rawPhone, false);
          if (phoneValidation.valid && phoneValidation.normalized) {
            phone = phoneValidation.normalized;
            phoneValid = 1;
          } else {
            phone = rawPhone; // keep original, mark invalid
            phoneValid = 0;
          }
        }

        const incomingSource = normalizeNullableString(rowObject.source_old ?? rowObject.source) ?? 'manual';
        const { normalized: normalizedSource, sourceId: sourceRegistryId } = await validateAndNormalizeSource(incomingSource, workspaceId);

        const statusId = await resolveStatusIdForImportRow({
          row: rowObject,
          workspaceId,
          defaultStatusId,
          statuses,
        });

        const sourceRef = normalizeNullableString(rowObject.source_ref ?? rowObject.id) ?? generateEventId();

        const leadPayloadBase: any = {
          workspace_id: workspaceId,
          ...(statusId !== null && { status_id: statusId }),
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone, phone_valid: phoneValid } : {}),
          source_old: normalizedSource,
          source_ref: sourceRef,
          email_verification_status: 'pending',
          ...(sourceRegistryId ? { source_id: sourceRegistryId } : {}),
        };

        const extractedCustomFields = extractCustomFieldValuesFromPayload(rowObject, customFields);
        const extractedCustomFieldsMinimal = extractedCustomFields.map((f) => ({ field_id: f.field_id, value: f.value }));

        const shouldUpsert = mode === 'upsert_email' && !!email;
        let leadId: number | null = null;
        let action: BulkImportRowResult['action'] = 'created';

        if (shouldUpsert && email) {
          const searchResponse = await leadsApi.searchLeads({ workspace_id: workspaceId, email }) as ApiResponse<Lead[]>;
          const existing = searchResponse.status === 'success' && Array.isArray(searchResponse.data) ? searchResponse.data[0] : null;
          if (existing?.id) {
            if (!canEditLead(access, toNullableUserId((existing as any)?.user_id))) {
              return {
                row_index: rowIndex,
                action: 'failed',
                error: 'Access denied: You do not have permission to update this lead',
              };
            }
            const updatePayload: any = {
              ...(statusId !== null && { status_id: statusId }),
              ...(name ? { name } : {}),
              ...(phone ? { phone, phone_valid: phoneValid } : {}),
              source_old: normalizedSource,
              source_ref: sourceRef,
              ...(sourceRegistryId ? { source_id: sourceRegistryId } : {}),
            };

            const updateResponse = await leadsApi.updateLead(existing.id, updatePayload) as ApiResponse<Lead>;
            if (updateResponse.status !== 'success') {
              throw new Error(updateResponse.message || updateResponse.error || 'Failed to update lead');
            }

            leadId = existing.id;
            action = 'updated';
          }
        }

        if (!leadId) {
          const leadResponse = await leadsApi.createLead(leadPayloadBase) as ApiResponse<Lead>;
          const isClearlySuccess: boolean =
            leadResponse.status === 'success' ||
            (leadResponse.status === 'failed' &&
              (leadResponse.message === 'Record created successfully' || leadResponse.error === 'Record created successfully'));

          if (!isClearlySuccess) {
            throw new Error(leadResponse.message || leadResponse.error || 'Failed to create lead');
          }

          if (leadResponse.data) {
            leadId = (leadResponse.data as any).id || (leadResponse.data as any);
          } else if (leadResponse.id) {
            leadId = leadResponse.id;
          }

          if (!leadId) {
            const searchResponse = await leadsApi.searchLeads({
              workspace_id: workspaceId,
              source_ref: sourceRef,
            }) as ApiResponse<Lead[]>;

            if (searchResponse.status === 'success' && Array.isArray(searchResponse.data) && searchResponse.data.length > 0) {
              leadId = searchResponse.data[0]?.id ?? null;
            }
          }

          if (!leadId) {
            throw new Error('Lead creation succeeded but no ID was returned');
          }

          action = 'created';
        }

        if (leadId && extractedCustomFieldsMinimal.length > 0) {
          const { errors } = await upsertCustomFieldValuesForLead({
            leadId,
            extractedValues: extractedCustomFieldsMinimal,
          });
          if (errors.length > 0) {
            warnings.push(...errors);
          }
        }

        if (verifyEmails && leadId && email) {
          try {
            const { verification, emailValidFlag } = await verifyEmailForLead(email);
            await persistLeadEmailVerification(leadId, { verification, emailValidFlag });
          } catch (error) {
            warnings.push((error as Error).message || 'Email verification failed');
          }
        }

        if (action === 'created' && leadId) {
          try {
            await enqueueLeadAutoReplyEmailJob({
              workspaceId,
              leadId,
              leadName: name || undefined,
              leadEmail: email || undefined,
              leadPhone: phone || undefined,
              leadSource: normalizedSource,
              leadSourceRef: sourceRef,
            });
          } catch (queueError) {
            console.error(
              `[Leads Route] Failed to enqueue lead auto-reply for imported lead ${leadId}:`,
              (queueError as Error).message || queueError
            );
          }

          void sendLeadNotificationForNewLead({
            workspaceId,
            leadId,
            leadName: name || undefined,
            leadEmail: email || undefined,
            leadPhone: phone || undefined,
            leadSource: normalizedSource,
            leadSourceRef: sourceRef,
          }).then((notificationResult) => {
            if (!notificationResult.sent && notificationResult.reason) {
              console.warn(
                `[Leads Route] Lead notification email not sent for imported lead ${leadId}. Reason: ${notificationResult.reason}`
              );
            }
          }).catch((notificationError) => {
            console.error(
              `[Leads Route] Failed to send lead notification for imported lead ${leadId}:`,
              (notificationError as Error).message || notificationError
            );
          });

          void enqueueWhatsAppMessage({
            workspaceId,
            leadId,
            triggerKind: 'new_lead',
            leadName: name || undefined,
            leadPhone: phone || undefined,
            leadEmail: email || undefined,
            leadSource: normalizedSource,
          }).then((waResult) => {
            if (!waResult.queued && waResult.reason) {
              console.warn(
                `[Leads Route] WhatsApp NOT queued for imported lead ${leadId}. Reason: ${waResult.reason}`
              );
            }
          }).catch((waError) => {
            console.error(
              `[Leads Route] Failed to enqueue WhatsApp for imported lead ${leadId}:`,
              (waError as Error).message || waError
            );
          });
        }

        return {
          row_index: rowIndex,
          action,
          lead_id: leadId ?? undefined,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      } catch (error) {
        return {
          row_index: rowIndex,
          action: 'failed',
          error: (error as Error).message || 'Import failed',
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      }
    });

    const summary = results.reduce(
      (acc, r) => {
        acc.total++;
        if (r.action === 'created') acc.created++;
        else if (r.action === 'updated') acc.updated++;
        else acc.failed++;
        return acc;
      },
      { total: 0, created: 0, updated: 0, failed: 0 }
    );

    const response: ApiResponse<any> = {
      status: 'success',
      data: {
        ...summary,
        results,
      },
    };
    if (summary.created > 0) invalidateLeadCountCache(workspaceId);
    res.json(response);
  } catch (error) {
    const errorResponse: ApiResponse<any> = {
      status: 'error',
      message: (error as Error).message || 'Bulk import failed',
    };
    res.status(500).json(errorResponse);
  }
});

router.post('/', authMiddleware, validate(createLeadSchema), async (req: AuthenticatedRequest<{}, {}, LeadCreateData>, res: Response<ApiResponse<Lead>>): Promise<void> => {
  try {
    const body: any = req.body || {};
    
    // Debug log incoming request body
    console.log('[Leads Route] POST /api/leads - Request body:', JSON.stringify(body, null, 2));

    if (!body.workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required to create a lead',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const workspaceId: number = Number(body.workspace_id);
    const userId: number = Number(req.user?.id || 0);

    const access: WorkspaceAccess = await verifyWorkspaceAccess(userId, workspaceId);

    if (!access.hasAccess) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have access to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    if (access.permissions.deals !== 'edit') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have permission to create leads',
      };
      res.status(403).json(errorResponse);
      return;
    }

    let statusId: number | null = body.status_id !== undefined ? Number(body.status_id) : null;
    if (statusId === null || Number.isNaN(statusId)) {
      try {
        statusId = await getDefaultStatusIdForWorkspace(workspaceId);
      } catch (statusError) {
        console.error('Error resolving default status for /api/leads:', statusError);
      }
    }

    // Validate and normalize source and get source ID from registry
    // Check for both 'source' (new format) and 'source_old' (legacy format)
    const incomingSource = body.source_old || body.source || 'manual';
    const { normalized: normalizedSource, sourceId: sourceRegistryId } = await validateAndNormalizeSource(incomingSource, workspaceId);

    // Validate and normalize phone number if provided
    let normalizedPhone: string | undefined = undefined;
    let phoneValid: boolean = false;
    if (body.phone && body.phone.trim()) {
      const phoneValidation = validatePhone(body.phone.trim(), false);
      if (phoneValidation.valid && phoneValidation.normalized) {
        normalizedPhone = phoneValidation.normalized;
        phoneValid = true;
      } else {
        // Log warning but don't fail - phone is optional
        console.warn(`[Leads Route] Invalid phone number provided: ${body.phone.trim()}. Error: ${phoneValidation.error || 'Invalid format'}`);
        // Still include the original phone, but mark as invalid
        normalizedPhone = body.phone.trim();
        phoneValid = false;
      }
    }

    const leadData: any = {
      workspace_id: workspaceId,
      ...(statusId !== null && statusId !== undefined && { status_id: statusId }),
      name: body.name || (body.email ? String(body.email).split('@')[0] : 'Unknown'),
      ...(body.email && body.email.trim() ? { email: body.email.trim() } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      source_old: normalizedSource, // Use source_old (not source) to avoid UNIQUE constraint
      source_ref: body.source_ref || body.id || generateEventId(),
      email_verification_status: 'pending', // REQUIRED: NOT NULL field - will be updated after verification
      // Include source_id from registry if available
      ...(sourceRegistryId && { source_id: sourceRegistryId }),
      // Set phone_valid based on validation
      ...(normalizedPhone !== undefined ? { phone_valid: phoneValid ? 1 : 0 } : {}),
      // NOTE: email_valid will be set after successful creation via email verification
    };

    Object.keys(leadData).forEach((key: string) => {
      if ((leadData as any)[key] === undefined || (leadData as any)[key] === '') {
        delete (leadData as any)[key];
      }
    });

    // Debug log to see what we're sending
    console.log('[Leads Route] Creating lead with data:', JSON.stringify(leadData, null, 2));

    const leadResponse = await leadsApi.createLead(leadData) as ApiResponse<Lead>;

    const isClearlySuccess: boolean =
      leadResponse.status === 'success' ||
      (leadResponse.status === 'failed' &&
        (leadResponse.message === 'Record created successfully' ||
          leadResponse.error === 'Record created successfully'));

    if (!isClearlySuccess) {
      throw new Error(leadResponse.message || leadResponse.error || 'Failed to create lead');
    }

    let leadId: number | null = null;
    if (leadResponse.data) {
      leadId = (leadResponse.data as any).id || leadResponse.data as any;
    } else if (leadResponse.id) {
      leadId = leadResponse.id;
    } else if (leadResponse.message && leadResponse.message.includes('created successfully')) {
      try {
        const searchResponse = await leadsApi.searchLeads({
          workspace_id: workspaceId,
          ...(leadData.source_ref ? { source_ref: leadData.source_ref } : {}),
        }) as ApiResponse<Lead[]>;
        if (searchResponse.status === 'success' && searchResponse.data && searchResponse.data.length > 0) {
          leadId = searchResponse.data[0]?.id ?? null;
        } else {
          throw new Error('Lead was created but could not retrieve its ID');
        }
      } catch (searchError) {
        console.error('Failed to query for created lead from /api/leads:', searchError);
        throw new Error('Lead was created but could not retrieve its ID');
      }
    }

    if (!leadId) {
      throw new Error('Lead creation succeeded but no ID was returned');
    }

    let customFields: CustomField[] = [];
    try {
      const customFieldsResponse = await customFieldsApi.getCustomFields(workspaceId) as ApiResponse<CustomField[]>;
      if (customFieldsResponse.status === 'success' && customFieldsResponse.data) {
        customFields = customFieldsResponse.data.filter((field: CustomField) => field.is_active === 1);
      }
    } catch (cfError) {
      console.error('Error fetching custom fields for /api/leads:', cfError);
    }

    const extraFields: any[] = extractCustomFieldValuesFromPayload(body, customFields);
    let customFieldsSaved: number = 0;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Leads Route] Extracted ${extraFields.length} custom field values for lead ${leadId}:`, extraFields.map(f => ({ field_id: f.field_id, field_label: f.field_label, value: f.value })));
    }

    if (extraFields.length > 0) {
      for (const field of extraFields) {
        try {
          // Only save non-empty values (except for checkbox which can be '0')
          if (field.value !== undefined && field.value !== null && (field.value !== '' || field.field_type === 'checkbox')) {
            await customFieldValuesApi.createCustomFieldValue({
              lead_id: leadId,
              field_id: field.field_id,
              value: field.value,
            });
            customFieldsSaved++;
            if (process.env.NODE_ENV !== 'production') {
              console.log(`[Leads Route] Saved custom field value for field "${field.field_label}" (${field.field_id}): "${field.value}"`);
            }
          } else {
            if (process.env.NODE_ENV !== 'production') {
              console.log(`[Leads Route] Skipping empty custom field value for field "${field.field_label}" (${field.field_id})`);
            }
          }
        } catch (error) {
          console.error(
            `Failed to save custom field value for field "${field.field_label}" on /api/leads:`,
            (error as Error).message || error
          );
        }
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Leads Route] No custom field values extracted from payload for lead ${leadId}`);
        console.log(`[Leads Route] Available custom fields:`, customFields.map(f => ({ id: f.id, slug: f.slug, label: f.label })));
        console.log(`[Leads Route] Payload keys:`, Object.keys(body));
      }
    }

    // Auto-verify email if provided
    let emailVerificationResult: any = null;
    if (body.email && typeof body.email === 'string' && body.email.trim() !== '') {
      try {
        const trimmedEmail = body.email.trim();
        console.log(`[Leads Route] Auto-verifying email for lead ${leadId}: ${trimmedEmail}`);

        const { verification, mode, emailValidFlag } = await verifyEmailForLead(trimmedEmail);

        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Leads Route] Email verification (${mode}) result:`, JSON.stringify({
            status: verification?.status,
            email_valid: emailValidFlag,
          }, null, 2));
        }

        emailVerificationResult = {
          verified: true,
          status: resolveEmailVerificationStatus(verification, emailValidFlag),
          mode,
          email_valid: emailValidFlag,
        };

        // Try to update lead with verification status
        // This may fail if email_valid field doesn't exist in database schema
        if (leadId) {
          try {
            await persistLeadEmailVerification(Number(leadId), { verification, emailValidFlag });

            console.log(`[Leads Route] Updated lead ${leadId} email_valid to ${emailValidFlag}`);
          } catch (updateError) {
            console.error(`[Leads Route] Failed to update lead ${leadId} with email verification status:`, updateError);
            // Continue anyway - lead was created successfully
            // The database schema might not have email_valid field
          }
        }
      } catch (verifyError) {
        console.error(`[Leads Route] Email verification failed for ${body.email}:`, verifyError);
        emailVerificationResult = {
          verified: false,
          error: (verifyError as Error).message,
        };
        // Don't fail lead creation if verification fails
      }
    }

    emitAutomationEvent({ workspaceId: Number(workspaceId), type: 'lead_created', leadId: Number(leadId) });

    let autoReplyResult: { queued: boolean; reason?: string; eventId?: string } = { queued: false, reason: 'not_attempted' };
    try {
      autoReplyResult = await enqueueLeadAutoReplyEmailJob({
        workspaceId,
        leadId,
        leadName: leadData.name || body.name,
        leadEmail: body.email,
        leadPhone: normalizedPhone,
        leadSource: normalizedSource,
        leadSourceRef: leadData.source_ref,
      });
      if (autoReplyResult.queued) {
        console.log(`[Leads Route] Auto-reply email queued for lead ${leadId} (event: ${autoReplyResult.eventId})`);
      } else {
        console.warn(`[Leads Route] Auto-reply email NOT queued for lead ${leadId}. Reason: ${autoReplyResult.reason}`);
      }
    } catch (queueError) {
      console.error(
        `[Leads Route] Failed to enqueue lead auto-reply for lead ${leadId}:`,
        (queueError as Error).message || queueError
      );
      autoReplyResult = { queued: false, reason: `error: ${(queueError as Error).message}` };
    }

    void sendLeadNotificationForNewLead({
      workspaceId,
      leadId,
      leadName: leadData.name || body.name,
      leadEmail: body.email,
      leadPhone: normalizedPhone,
      leadSource: normalizedSource,
      leadSourceRef: leadData.source_ref,
    }).then((notificationResult) => {
      if (!notificationResult.sent && notificationResult.reason) {
        console.warn(
          `[Leads Route] Lead notification email not sent for lead ${leadId}. Reason: ${notificationResult.reason}`
        );
      }
    }).catch((notificationError) => {
      console.error(
        `[Leads Route] Failed to send lead notification for lead ${leadId}:`,
        (notificationError as Error).message || notificationError
      );
    });

    if (normalizedPhone && phoneValid) {
      void enqueueWhatsAppMessage({
        workspaceId,
        leadId,
        triggerKind: 'new_lead',
        leadName: leadData.name || body.name,
        leadPhone: normalizedPhone,
        leadEmail: body.email,
        leadSource: normalizedSource,
      }).then((waResult) => {
        if (waResult.queued) {
          console.log(`[Leads Route] WhatsApp queued for lead ${leadId} (event: ${waResult.eventId})`);
        } else if (waResult.reason) {
          console.warn(`[Leads Route] WhatsApp NOT queued for lead ${leadId}. Reason: ${waResult.reason}`);
        }
      }).catch((waError) => {
        console.error(
          `[Leads Route] Failed to enqueue WhatsApp for lead ${leadId}:`,
          (waError as Error).message || waError
        );
      });
    } else if (normalizedPhone && !phoneValid) {
      console.warn(
        `[Leads Route] WhatsApp NOT queued for lead ${leadId}. Reason: lead phone failed validation (${normalizedPhone})`
      );
    }

    const successResponse = {
      ...leadResponse,
      data: leadResponse.data || { id: leadId } as Lead,
      custom_fields_saved: customFieldsSaved,
      email_verification: emailVerificationResult,
      auto_reply: autoReplyResult,
    } as ApiResponse<Lead>;
    invalidateLeadCountCache(workspaceId);
    res.json(successResponse);
  } catch (error) {
    console.error('Error in POST /api/leads:', error);
    const errorResponse: ApiResponse<Lead> = {
      status: 'error',
      message: (error as Error).message || 'Failed to create lead in NoCodeBackend',
    };
    res.status(500).json(errorResponse);
  }
});

router.put('/:id', authMiddleware, validate(updateLeadSchema), async (req: AuthenticatedRequest<{ id: string }, {}, LeadUpdateData>, res: Response<ApiResponse<Lead>>): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData: any = req.body || {};
    const userId: number = Number(req.user?.id || 0);
    
    let oldLead: Lead | null = null;
    let oldStatusId: number | null = null;
    let oldAssigneeId: number | null = null;
    let leadAccess: WorkspaceAccess | null = null;
    try {
      const oldLeadResponse = await leadsApi.getLeadById(Number(id)) as ApiResponse<Lead>;
      if (oldLeadResponse.status === 'success' && oldLeadResponse.data) {
        oldLead = Array.isArray(oldLeadResponse.data)
          ? oldLeadResponse.data[0]
          : oldLeadResponse.data;
        oldStatusId = oldLead?.status_id ?? null;
        oldAssigneeId = toNullableUserId((oldLead as any)?.user_id);

        const workspaceId: number = oldLead!.workspace_id;
        const access = await verifyWorkspaceAccess(userId, workspaceId);
        leadAccess = access;

        if (!access.hasAccess || !canEditLead(access, oldAssigneeId)) {
          const errorResponse: AuthErrorResponse = {
            success: false,
            status: 'error',
            error: 'Access denied: You do not have permission to edit this lead',
          };
          res.status(403).json(errorResponse);
          return;
        }
      } else {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Lead not found',
        };
        res.status(404).json(errorResponse);
        return;
      }
    } catch (err) {
      const status = (err as any)?.status;
      if (status === 404) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Lead not found',
        };
        res.status(404).json(errorResponse);
        return;
      }

      console.error('Error fetching old lead data:', err);
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Failed to verify lead access',
      };
      res.status(500).json(errorResponse);
      return;
    }
    
    const actorUserIdRaw: unknown =
      updateData.updated_by_user_id ??
      updateData.user_id ??
      req.user?.id;
    const userIdForActivity: number = Number(actorUserIdRaw || 1);
    delete updateData.updated_by_user_id;
    delete updateData.user_id;

    const assigneeRaw: unknown =
      updateData.assignee_id ??
      updateData.assigned_to_user_id ??
      updateData.assigned_user_id ??
      updateData.assigned_to;
    const assignmentUpdateRequested: boolean = assigneeRaw !== undefined;
    let newAssigneeId: number | null | undefined = undefined;
    if (assignmentUpdateRequested) {
      if (assigneeRaw === null || assigneeRaw === '' || assigneeRaw === 'unassigned') {
        newAssigneeId = null;
      } else {
        const parsed = Number(assigneeRaw);
        newAssigneeId = Number.isFinite(parsed) ? parsed : null;
      }
    }
    delete updateData.assignee_id;
    delete updateData.assigned_to_user_id;
    delete updateData.assigned_user_id;
    delete updateData.assigned_to;

    const statusUpdateRequested: boolean = updateData.status_id !== undefined;
    const newStatusId: number | null | undefined = statusUpdateRequested
      ? (updateData.status_id === null ? null : Number(updateData.status_id))
      : undefined;

    const assignmentChanged: boolean =
      assignmentUpdateRequested &&
      (oldAssigneeId ?? null) !== (newAssigneeId ?? null);

    if (assignmentUpdateRequested) {
      updateData.user_id = newAssigneeId;
    }

    if (assignmentChanged) {
      if (!leadAccess || !isElevatedRole(leadAccess.role)) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: Only workspace admins and managers can reassign leads',
        };
        res.status(403).json(errorResponse);
        return;
      }
      if (newAssigneeId !== null && newAssigneeId !== undefined && !(await validDealAssignee(oldLead!.workspace_id, newAssigneeId))) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Access denied: Assignee must be a member of this workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }
    }

    // Normalize validation flags to 0/1 for consistent storage/rendering
    if ('email_valid' in updateData) {
      updateData.email_valid = toFlagInt(updateData.email_valid);
    }
    if ('phone_valid' in updateData) {
      updateData.phone_valid = toFlagInt(updateData.phone_valid);
    }

    // Normalize phone number on update so all stored phones are uniform (+91...)
    if (updateData.phone && typeof updateData.phone === 'string' && updateData.phone.trim()) {
      const phoneValidation = validatePhone(updateData.phone.trim(), false);
      if (phoneValidation.valid && phoneValidation.normalized) {
        updateData.phone = phoneValidation.normalized;
        // Auto-set phone_valid unless caller explicitly provided it
        if (!('phone_valid' in updateData)) {
          updateData.phone_valid = 1;
        }
      } else {
        console.warn(`[Leads Route] Invalid phone on update for lead ${id}: ${updateData.phone.trim()}. Error: ${phoneValidation.error || 'Invalid format'}`);
        if (!('phone_valid' in updateData)) {
          updateData.phone_valid = 0;
        }
      }
    }
    
    const sanitizedUpdateData = sanitizeLeadUpdatePayload(updateData);

    if (Object.keys(sanitizedUpdateData).length === 0) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'No data provided to update',
      };
      res.status(400).json(errorResponse);
      return;
    }

    let response: ApiResponse<Lead>;
    let assignmentPersisted = true;

    try {
      // Auto-verify email if it's being updated
      if (updateData.email && oldLead && updateData.email !== oldLead.email) {
        try {
          console.log(`[Leads Route] Email changed for lead ${id}, re-verifying: ${updateData.email}`);
          const { verification, mode, emailValidFlag } = await verifyEmailForLead(updateData.email);

          // Add email_valid to update data
          sanitizedUpdateData.email_valid = emailValidFlag;
          sanitizedUpdateData.email_verification_status = resolveEmailVerificationStatus(
            verification,
            emailValidFlag
          ) as any;
          sanitizedUpdateData.email_verified_at = formatMySqlDateTimeUtc(new Date()) as any;

          if (process.env.NODE_ENV !== 'production') {
            console.log(`[Leads Route] Email verification (${mode}) for lead ${id}:`, {
              status: verification?.status,
              email_valid: emailValidFlag,
            });
          }
        } catch (verifyError) {
          console.error(`[Leads Route] Email verification failed for ${updateData.email}:`, verifyError);
          // Don't fail lead update if verification fails
        }
      }

      response = await leadsApi.updateLead(Number(id), sanitizedUpdateData) as ApiResponse<Lead>;
      if (response.status !== 'success' && assignmentUpdateRequested && 'user_id' in sanitizedUpdateData) {
        const { user_id: _removed, ...retryPayload } = sanitizedUpdateData;
        assignmentPersisted = false;
        response = await leadsApi.updateLead(Number(id), retryPayload) as ApiResponse<Lead>;
      }
      if (response.status !== 'success') {
        const errorResponse: ApiResponse<Lead> = {
          status: 'error',
          message: response.message || 'Failed to update lead in NoCodeBackend',
        };
        res.status(500).json(errorResponse);
        return;
      }
    } catch (updateError) {
      console.error('Error updating lead in NoCodeBackend:', updateError);
      const errorResponse: ApiResponse<Lead> = {
        status: 'error',
        message: (updateError as Error).message || 'Failed to update lead in NoCodeBackend',
      };
      res.status(500).json(errorResponse);
      return;
    }
    
    if (statusUpdateRequested && (oldStatusId ?? null) !== (newStatusId ?? null)) {
      try {
        const [oldStatusResponse, newStatusResponse] = await Promise.all([
          oldStatusId ? leadStatusesApi.getStatusById(oldStatusId).catch(() => ({ status: 'error', data: null })) : Promise.resolve({ status: 'success', data: null }),
          newStatusId ? leadStatusesApi.getStatusById(newStatusId).catch(() => ({ status: 'error', data: null })) : Promise.resolve({ status: 'success', data: null })
        ]);
        
        const getStatusName = (apiResponse: ApiResponse<any>): string => {
          if (apiResponse.status !== 'success' || !apiResponse.data) return 'None';
          const statusData: any = Array.isArray(apiResponse.data) ? apiResponse.data[0] : apiResponse.data;
          return statusData?.name || 'None';
        };
        
        const oldStatusName: string = getStatusName(oldStatusResponse as ApiResponse<any>);
        const newStatusName: string = getStatusName(newStatusResponse as ApiResponse<any>);
        
        const workspaceId: number = oldLead!.workspace_id;
        
        const now: Date = new Date();
        const formattedDate: string = now.toISOString().slice(0, 19).replace('T', ' ');
        
        const activityMetadata = {
          old_status_id: oldStatusId,
          new_status_id: newStatusId,
          old_status_name: oldStatusName,
          new_status_name: newStatusName
        };
        
        await leadActivitiesApi.createActivity({
          lead_id: Number(id),
          workspace_id: workspaceId,
          user_id: userIdForActivity,
          type: 'status_change',
          title: `Status changed from ${oldStatusName} to ${newStatusName}`,
          description: `Lead status updated from "${oldStatusName}" to "${newStatusName}"`,
          metadata: JSON.stringify(activityMetadata),
          created_at: formattedDate
        });

        const newStatusData: LeadStatus | null = (() => {
          if (newStatusResponse.status !== 'success' || !newStatusResponse.data) return null;
          const raw = Array.isArray(newStatusResponse.data) ? newStatusResponse.data[0] : newStatusResponse.data;
          return raw as LeadStatus;
        })();

        void maybeEnqueueWhatsAppOnStatusChange({
          workspaceId,
          leadId: Number(id),
          leadName: oldLead?.name || '',
          leadPhone: oldLead?.phone || updateData.phone || '',
          leadEmail: oldLead?.email || updateData.email || '',
          oldStatusId: oldStatusId ?? null,
          newStatusId: newStatusId ?? null,
          newStatus: newStatusData,
        }).catch((waError) => {
          console.error('[Leads Route] Failed to enqueue WhatsApp on status change:', waError);
        });
      } catch (activityError) {
        console.error('Error creating status change activity:', activityError);
      }
    }

    if (assignmentChanged && assignmentPersisted) {
      try {
        const resolveUser = async (id: number | null): Promise<{ name: string; email: string }> => {
          if (!id) return { name: 'Unassigned', email: '' };
          const response = await usersApi.getUserById(id).catch(() => ({ status: 'error', data: null } as any));
          if (response.status !== 'success' || !response.data) return { name: `User ${id}`, email: '' };
          const userData: any = Array.isArray(response.data) ? response.data[0] : response.data;
          return {
            name: userData?.name || userData?.email || `User ${id}`,
            email: userData?.email || '',
          };
        };

        const [oldUser, newUser, actorUser] = await Promise.all([
          resolveUser(oldAssigneeId),
          resolveUser(newAssigneeId ?? null),
          resolveUser(userIdForActivity),
        ]);

        const workspaceId: number = oldLead!.workspace_id;
        const now: Date = new Date();
        const formattedDate: string = now.toISOString().slice(0, 19).replace('T', ' ');

        const activityMetadata = {
          old_assignee_id: oldAssigneeId,
          new_assignee_id: newAssigneeId ?? null,
          old_assignee_name: oldUser.name,
          new_assignee_name: newUser.name
        };

        await leadActivitiesApi.createActivity({
          lead_id: Number(id),
          workspace_id: workspaceId,
          user_id: userIdForActivity,
          type: 'assignment',
          title: 'Lead assignment changed',
          description: `Assigned from ${oldUser.name} to ${newUser.name}`,
          metadata: JSON.stringify(activityMetadata),
          created_at: formattedDate
        });

        if (newAssigneeId && newAssigneeId !== userIdForActivity) {
          try {
            const leadName = oldLead!.name || `Lead ${id}`;
            await notificationsApi.createNotification({
              workspace_id: workspaceId,
              recipient_user_id: newAssigneeId,
              actor_user_id: userIdForActivity,
              lead_id: Number(id),
              type: 'lead_assigned',
              title: 'Lead assigned to you',
              message: `${actorUser.name} assigned ${leadName} to you.`,
              payload: JSON.stringify({
                lead_id: Number(id),
                lead_name: leadName,
                lead_email: oldLead!.email || '',
                lead_phone: oldLead!.phone || '',
                old_assignee_id: oldAssigneeId,
                old_assignee_name: oldUser.name,
                new_assignee_id: newAssigneeId,
                new_assignee_name: newUser.name,
                actor_user_id: userIdForActivity,
                actor_name: actorUser.name,
              }),
              created_at: formattedDate,
            });
          } catch (notificationError) {
            console.error(
              `[Leads Route] Failed to create assignment notification for lead ${id}:`,
              (notificationError as Error).message || notificationError
            );
          }
        }

        // Send email notification to the new assignee
        if (newAssigneeId && newUser.email) {
          void sendLeadAssignmentNotification({
            workspaceId,
            leadId: Number(id),
            leadName: oldLead!.name,
            leadEmail: oldLead!.email,
            leadPhone: oldLead!.phone,
            assigneeEmail: newUser.email,
            assigneeName: newUser.name,
            assignerName: req.user?.email || `User ${userIdForActivity}`,
          }).then((result) => {
            if (!result.sent) {
              console.warn(`[Leads Route] Assignment notification not sent for lead ${id}: ${result.reason || 'unknown'}`);
            }
          }).catch((err) => {
            console.error(`[Leads Route] Failed to send assignment notification for lead ${id}:`, err);
          });
        }
      } catch (activityError) {
        console.error('Error creating assignment activity:', activityError);
      }
    }

    // Restore (clearing deleted_at) changes the active count
    if ('deleted_at' in sanitizedUpdateData) {
      invalidateLeadCountCache(oldLead!.workspace_id);
    }

    // Handle custom field values if present in update payload
    const workspaceId: number = oldLead!.workspace_id;
    let customFields: CustomField[] = [];
    try {
      const customFieldsResponse = await customFieldsApi.getCustomFields(workspaceId) as ApiResponse<CustomField[]>;
      if (customFieldsResponse.status === 'success' && Array.isArray(customFieldsResponse.data)) {
        customFields = customFieldsResponse.data.filter((field: CustomField) => field.is_active === 1);
      }
    } catch (cfError) {
      console.error('Error fetching custom fields for PUT /api/leads/:id:', cfError);
    }

    if (customFields.length > 0) {
      const extractedCustomFields = extractCustomFieldValuesFromPayload(req.body, customFields);
      if (extractedCustomFields.length > 0) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Leads Route] PUT /api/leads/:id - Extracted ${extractedCustomFields.length} custom field values:`, extractedCustomFields.map(f => ({ field_id: f.field_id, field_label: f.field_label, value: f.value })));
        }
        const extractedValuesMinimal = extractedCustomFields.map((f) => ({ field_id: f.field_id, value: f.value }));
        const { saved, errors } = await upsertCustomFieldValuesForLead({
          leadId: Number(id),
          extractedValues: extractedValuesMinimal,
        });
        if (errors.length > 0) {
          console.error(`[Leads Route] Errors saving custom field values for lead ${id}:`, errors);
        }
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Leads Route] PUT /api/leads/:id - Saved ${saved} custom field values for lead ${id}`);
        }
      }
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error in PUT /api/leads/:id:', error);
    const errorResponse: ApiResponse<Lead> = {
      status: 'error',
      message: 'Failed to update lead in NoCodeBackend',
    };
    res.status(500).json(errorResponse);
  }
});

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { id } = req.params;
    const userId: number = Number(req.user?.id || 0);

    const leadResponse = await leadsApi.getLeadById(Number(id)) as ApiResponse<Lead>;
    if (leadResponse.status !== 'success' || !leadResponse.data) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    const lead: Lead = Array.isArray(leadResponse.data) 
      ? leadResponse.data[0] 
      : leadResponse.data;
    
    const workspaceId: number = lead.workspace_id;

    const access: WorkspaceAccess = await verifyWorkspaceAccess(userId, workspaceId);

    if (!access.hasAccess || !canEditLead(access, toNullableUserId((lead as any)?.user_id))) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have permission to delete this lead',
      };
      res.status(403).json(errorResponse);
      return;
    }

    // Soft delete: Set deleted_at timestamp instead of hard delete
    const now = new Date();
    const deletedAt = now.toISOString().slice(0, 19).replace('T', ' ');
    
    const updatePayload = { deleted_at: deletedAt };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Delete Lead] Setting deleted_at for lead ${id} to: ${deletedAt}`);
    }
    
    const response = await leadsApi.updateLead(Number(id), updatePayload) as ApiResponse<any>;
    
    if (response.status === 'success' || response.status === 'failed') {
      invalidateLeadCountCache(workspaceId);
      res.json({
        status: 'success',
        message: 'Lead moved to trash. It will be permanently deleted after 7 days.',
      });
    } else {
      console.error('[Delete Lead] Failed to update lead:', response);
      res.status(500).json(response);
    }
  } catch (error) {
    const status = (error as any)?.status;
    if (status === 404) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    console.error('Error in DELETE /api/leads/:id:', error);
    const errorResponse: ApiResponse = {
      status: 'error',
      message: 'Failed to delete lead in NoCodeBackend',
    };
    res.status(500).json(errorResponse);
  }
});

export default router;
