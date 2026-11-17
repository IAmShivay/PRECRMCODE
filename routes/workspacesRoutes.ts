import { Router, Response } from 'express';
import {
  workspacesApi,
  workspaceMembersApi,
  leadStatusesApi,
  usersApi
} from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { ROLE_OWNER, ROLE_MEMBER } from '../types/constants.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { verifyWorkspaceAdmin } from '../utils/workspaceHelpers.js';
import { getWorkspaceAccess, memberPermissions, saveMemberPermissions, workspacePermissionRecords } from '../services/workspacePermissions.js';
import { updateWorkspacePermissionsSchema } from '../utils/validation.js';
import { sendWorkspaceInviteEmail } from '../services/mailer.js';
import { createTraceId, errorToLogObject, logJson, maskEmail } from '../utils/logger.js';
import {
  DEFAULT_WORKSPACE_INVITE_TEMPLATE,
  getWorkspaceInviteEmailTemplate,
  normalizeInviteTemplate,
  upsertWorkspaceInviteEmailTemplate,
  WorkspaceInviteEmailTemplate,
} from '../services/workspaceEmailTemplates.js';
import {
  getWorkspaceSmtpConfigMasked,
  upsertWorkspaceSmtpConfig,
  sendWorkspaceSmtpTestEmail,
  getLeadAutoReplyTemplate,
  upsertLeadAutoReplyTemplate,
  sendLeadAutoReplyTemplateTestEmail,
  getLeadNotificationTemplate,
  upsertLeadNotificationTemplate,
  getLeadAssignmentTemplate,
  upsertLeadAssignmentTemplate,
  type WorkspaceSmtpConfigInput,
  type WorkspaceSmtpConfigMasked,
  type LeadAutoReplyTemplate,
  type LeadAutoReplyTemplateInput,
  type LeadNotificationTemplate,
  type LeadNotificationTemplateInput,
  type LeadAssignmentTemplate,
  type LeadAssignmentTemplateInput,
} from '../services/leadAutoReplyEmail.js';
import {
  ApiResponse,
  User,
  Workspace,
  WorkspaceMember,
  AuthenticatedRequest,
  InviteMemberBody,
  UpdateMemberBody,
  AuthErrorResponse
} from '../types/index.js';
import {
  validate,
  createWorkspaceSchema,
  createWorkspaceMemberSchema,
  inviteMemberSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from '../utils/validation.js';

const router: Router = Router();

router.get('/:workspaceId/permissions', authMiddleware, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const access = await getWorkspaceAccess(Number(req.user?.id), Number(req.params.workspaceId));
    if (!access.hasAccess) { res.status(403).json({ status: 'error', message: 'Access denied' }); return; }
    res.set('Cache-Control', 'no-store').json({ status: 'success', data: access });
  } catch { res.status(503).json({ status: 'error', message: 'Unable to load workspace permissions' }); }
});

router.put('/:workspaceId/members/:memberId/permissions', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, validate(updateWorkspacePermissionsSchema), async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const workspaceId = Number(req.params.workspaceId);
    const memberId = Number(req.params.memberId);
    const response = await workspaceMembersApi.getWorkspaceMembers({ workspace_id: workspaceId, limit: 10000, bypassCache: true });
    if (response.status !== 'success') throw new Error('Unable to verify member');
    const members = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    const member = members.find((item) => Number(item.id) === memberId && Number(item.workspace_id) === workspaceId);
    if (!member) { res.status(404).json({ status: 'error', message: 'Workspace member not found' }); return; }
    const workspaceResponse = await workspacesApi.getWorkspaceById(workspaceId, true);
    const workspace = Array.isArray(workspaceResponse.data) ? workspaceResponse.data[0] : workspaceResponse.data;
    if (workspaceResponse.status !== 'success' || !workspace) throw new Error('Unable to verify workspace');
    if (member.role !== ROLE_MEMBER || Number(member.user_id) === Number(workspace.owner_id)) {
      res.status(400).json({ status: 'error', message: 'Workspace administrators retain full access. Set permissions for regular members.' }); return;
    }
    await saveMemberPermissions(workspaceId, member, req.body.permissions);
    res.json({ status: 'success', data: req.body.permissions });
  } catch (error) { console.error('[DEBUG permissions route]', error); res.status(503).json({ status: 'error', message: 'Failed to save member permissions' }); }
});

interface OwnerWorkspaceCacheEntry {
  data: Workspace[];
  expiresAtMs: number;
}

const DEFAULT_OWNER_WORKSPACES_CACHE_TTL_MS = 45_000;
const ownerWorkspacesCache = new Map<number, OwnerWorkspaceCacheEntry>();

const rawOwnerCacheTtlMs = Number.parseInt(process.env.WORKSPACES_OWNER_CACHE_TTL_MS || '', 10);
const OWNER_WORKSPACES_CACHE_TTL_MS =
  Number.isFinite(rawOwnerCacheTtlMs) && rawOwnerCacheTtlMs >= 0
    ? rawOwnerCacheTtlMs
    : DEFAULT_OWNER_WORKSPACES_CACHE_TTL_MS;

const ENABLE_WORKSPACES_METRICS_LOGS =
  process.env.NODE_ENV !== 'production' ||
  String(process.env.WORKSPACES_METRICS_LOGS || '').toLowerCase() === 'true';

const UNLIMITED_WORKSPACE_EMAIL = 'scraftstudio@gmail.com';
const WORKSPACES_PAGE_SIZE = 100;

function getOwnerWorkspacesFromCache(ownerId: number): Workspace[] | null {
  const entry = ownerWorkspacesCache.get(ownerId);
  if (!entry) return null;

  if (Date.now() >= entry.expiresAtMs) {
    ownerWorkspacesCache.delete(ownerId);
    return null;
  }

  return entry.data;
}

function setOwnerWorkspacesCache(ownerId: number, data: Workspace[]): void {
  if (OWNER_WORKSPACES_CACHE_TTL_MS <= 0) return;
  ownerWorkspacesCache.set(ownerId, {
    data,
    expiresAtMs: Date.now() + OWNER_WORKSPACES_CACHE_TTL_MS,
  });
}

function invalidateOwnerWorkspaceCacheForUser(userId: unknown): void {
  const id = Number(userId);
  if (Number.isFinite(id) && id > 0) {
    ownerWorkspacesCache.delete(id);
  }
}

function invalidateOwnerWorkspaceCacheForUsers(userIds: Iterable<unknown>): void {
  for (const userId of userIds) {
    invalidateOwnerWorkspaceCacheForUser(userId);
  }
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function fetchOwnedWorkspaces(ownerId: number): Promise<{
  ownedWorkspaces: Workspace[];
  workspacePagesFetched: number;
}> {
  let ownedWorkspaces: Workspace[] = [];
  let workspacePage: number = 1;
  let hasMoreWorkspaces: boolean = true;
  let workspacePagesFetched = 0;

  while (hasMoreWorkspaces) {
    const response = await workspacesApi.getWorkspaces({
      owner_id: ownerId,
      page: workspacePage,
      limit: WORKSPACES_PAGE_SIZE,
    }) as ApiResponse<Workspace[]>;

    if (!(response.status === 'success' && response.data)) {
      break;
    }

    const pageRows: Workspace[] = Array.isArray(response.data)
      ? response.data
      : [response.data];

    ownedWorkspaces.push(
      ...pageRows.filter((workspace: Workspace) => Number(workspace.owner_id) === ownerId)
    );
    workspacePagesFetched++;
    hasMoreWorkspaces =
      Boolean(response.metadata?.hasMore) || pageRows.length === WORKSPACES_PAGE_SIZE;
    workspacePage++;
  }

  return { ownedWorkspaces, workspacePagesFetched };
}

async function fetchMemberWorkspaces(userId: number): Promise<{
  memberWorkspaces: Workspace[];
  memberRowsFetched: number;
}> {
  let memberRows: WorkspaceMember[] = [];
  let memberPage: number = 1;
  let hasMoreMembers: boolean = true;
  let memberRowsFetched = 0;

  while (hasMoreMembers) {
    const response = await workspaceMembersApi.getWorkspaceMembers({
      page: memberPage,
      limit: WORKSPACES_PAGE_SIZE,
    }) as ApiResponse<WorkspaceMember[]>;

    if (!(response.status === 'success' && response.data)) {
      break;
    }

    const pageRows: WorkspaceMember[] = Array.isArray(response.data)
      ? response.data
      : [response.data];
    const userRows = pageRows.filter((member: WorkspaceMember) => Number(member.user_id) === userId);

    memberRows.push(...userRows);
    memberRowsFetched += userRows.length;
    hasMoreMembers =
      Boolean(response.metadata?.hasMore) || pageRows.length === WORKSPACES_PAGE_SIZE;
    memberPage++;
  }

  const workspaceIds = Array.from(
    new Set(
      memberRows
        .map((member: WorkspaceMember) => Number(member.workspace_id))
        .filter((workspaceId: number) => Number.isFinite(workspaceId) && workspaceId > 0)
    )
  );

  const workspaceResults = await Promise.all(
    workspaceIds.map(async (workspaceId: number): Promise<Workspace | null> => {
      try {
        const response = await workspacesApi.getWorkspaceById(workspaceId) as ApiResponse<Workspace>;
        if (response.status !== 'success' || !response.data) return null;
        const workspace: Workspace = Array.isArray(response.data)
          ? response.data[0]
          : response.data;
        return workspace?.id ? workspace : null;
      } catch (error) {
        console.error(`[Workspaces] Failed to load member workspace ${workspaceId}:`, error);
        return null;
      }
    })
  );

  return {
    memberWorkspaces: workspaceResults.filter((workspace): workspace is Workspace => Boolean(workspace)),
    memberRowsFetched,
  };
}

async function canAuthenticatedUserCreateWorkspace(userId: number, email: string | undefined): Promise<boolean> {
  if (email?.trim().toLowerCase() === UNLIMITED_WORKSPACE_EMAIL) {
    return true;
  }

  const { ownedWorkspaces } = await fetchOwnedWorkspaces(userId);
  return ownedWorkspaces.length === 0;
}

router.get(
  '/:workspaceId/email-templates/invite',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<WorkspaceInviteEmailTemplate>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      const stored = await getWorkspaceInviteEmailTemplate(workspaceIdNum);
      res.json({ status: 'success', data: stored.template || DEFAULT_WORKSPACE_INVITE_TEMPLATE });
    } catch (error) {
      console.error('Error in GET /api/workspaces/:workspaceId/email-templates/invite:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load email template' });
    }
  }
);

router.put(
  '/:workspaceId/email-templates/invite',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, Partial<WorkspaceInviteEmailTemplate>>,
    res: Response<ApiResponse<WorkspaceInviteEmailTemplate>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      const normalized = normalizeInviteTemplate(req.body || {});

      await upsertWorkspaceInviteEmailTemplate(workspaceIdNum, normalized);

      res.json({ status: 'success', data: normalized });
    } catch (error) {
      console.error('Error in PUT /api/workspaces/:workspaceId/email-templates/invite:', error);
      res.status(500).json({ status: 'error', message: 'Failed to save email template' });
    }
  }
);

router.get(
  '/:workspaceId/email/smtp',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<WorkspaceSmtpConfigMasked | null>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const config = await getWorkspaceSmtpConfigMasked(workspaceIdNum);
      res.json({ status: 'success', data: config });
    } catch (error) {
      console.error('Error in GET /api/workspaces/:workspaceId/email/smtp:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load SMTP configuration' });
    }
  }
);

router.put(
  '/:workspaceId/email/smtp',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, WorkspaceSmtpConfigInput>,
    res: Response<ApiResponse<WorkspaceSmtpConfigMasked>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const saved = await upsertWorkspaceSmtpConfig(workspaceIdNum, req.body || {});
      res.json({ status: 'success', data: saved });
    } catch (error: any) {
      console.error('Error in PUT /api/workspaces/:workspaceId/email/smtp:', error);
      res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to save SMTP configuration',
      });
    }
  }
);

router.post(
  '/:workspaceId/email/smtp/test',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, { to: string }>,
    res: Response<ApiResponse<{ messageId?: string }>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      const to = String(req.body?.to || '').trim().toLowerCase();

      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      if (!to || !isValidEmailAddress(to)) {
        res.status(400).json({ status: 'error', message: 'A valid test email is required' });
        return;
      }

      const result = await sendWorkspaceSmtpTestEmail(workspaceIdNum, to);
      res.json({
        status: 'success',
        data: { messageId: result.messageId },
        message: 'SMTP test email sent successfully',
      });
    } catch (error: any) {
      console.error('Error in POST /api/workspaces/:workspaceId/email/smtp/test:', error);
      res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to send SMTP test email',
      });
    }
  }
);

router.get(
  '/:workspaceId/email-templates/lead-autoreply',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<LeadAutoReplyTemplate | null>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const template = await getLeadAutoReplyTemplate(workspaceIdNum);
      res.json({ status: 'success', data: template });
    } catch (error) {
      console.error('Error in GET /api/workspaces/:workspaceId/email-templates/lead-autoreply:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load lead auto-reply template' });
    }
  }
);

router.put(
  '/:workspaceId/email-templates/lead-autoreply',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, LeadAutoReplyTemplateInput>,
    res: Response<ApiResponse<LeadAutoReplyTemplate>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const saved = await upsertLeadAutoReplyTemplate(workspaceIdNum, req.body || {});
      res.json({ status: 'success', data: saved });
    } catch (error: any) {
      console.error('Error in PUT /api/workspaces/:workspaceId/email-templates/lead-autoreply:', error);
      res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to save lead auto-reply template',
      });
    }
  }
);

router.post(
  '/:workspaceId/email-templates/lead-autoreply/test',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<
      { workspaceId: string },
      {},
      {
        to: string;
        lead?: {
          name?: string;
          email?: string;
          phone?: string;
          source_old?: string;
          source_ref?: string;
        };
      }
    >,
    res: Response<ApiResponse<{ messageId?: string }>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      const to = String(req.body?.to || '').trim().toLowerCase();

      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      if (!to || !isValidEmailAddress(to)) {
        res.status(400).json({ status: 'error', message: 'A valid test email is required' });
        return;
      }

      const result = await sendLeadAutoReplyTemplateTestEmail(workspaceIdNum, to, req.body?.lead);
      res.json({
        status: 'success',
        data: { messageId: result.messageId },
        message: 'Lead auto-reply test email sent successfully',
      });
    } catch (error: any) {
      console.error(
        'Error in POST /api/workspaces/:workspaceId/email-templates/lead-autoreply/test:',
        error
      );
      res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to send lead auto-reply test email',
      });
    }
  }
);

router.get(
  '/:workspaceId/email-templates/lead-notification',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<LeadNotificationTemplate | null>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const template = await getLeadNotificationTemplate(workspaceIdNum);
      res.json({ status: 'success', data: template });
    } catch (error) {
      console.error('Error in GET /api/workspaces/:workspaceId/email-templates/lead-notification:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load lead notification template' });
    }
  }
);

router.put(
  '/:workspaceId/email-templates/lead-notification',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, LeadNotificationTemplateInput>,
    res: Response<ApiResponse<LeadNotificationTemplate>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const saved = await upsertLeadNotificationTemplate(workspaceIdNum, req.body || {});
      res.json({ status: 'success', data: saved });
    } catch (error: any) {
      console.error('Error in PUT /api/workspaces/:workspaceId/email-templates/lead-notification:', error);
      res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to save lead notification template',
      });
    }
  }
);

router.get(
  '/:workspaceId/email-templates/lead-assignment',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<LeadAssignmentTemplate | null>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const template = await getLeadAssignmentTemplate(workspaceIdNum);
      res.json({ status: 'success', data: template });
    } catch (error) {
      console.error('Error in GET /api/workspaces/:workspaceId/email-templates/lead-assignment:', error);
      res.status(500).json({ status: 'error', message: 'Failed to load lead assignment template' });
    }
  }
);

router.put(
  '/:workspaceId/email-templates/lead-assignment',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, LeadAssignmentTemplateInput>,
    res: Response<ApiResponse<LeadAssignmentTemplate>>
  ): Promise<void> => {
    try {
      const workspaceIdNum: number = Number(req.params.workspaceId);
      if (!workspaceIdNum || Number.isNaN(workspaceIdNum)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const saved = await upsertLeadAssignmentTemplate(workspaceIdNum, req.body || {});
      res.json({ status: 'success', data: saved });
    } catch (error: any) {
      console.error('Error in PUT /api/workspaces/:workspaceId/email-templates/lead-assignment:', error);
      res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to save lead assignment template',
      });
    }
  }
);

router.get('/', authMiddleware, async (req: AuthenticatedRequest<any, WorkspaceQuery, any>, res: Response<ApiResponse<Workspace[]>>): Promise<void> => {
  try {
    const { owner_id } = req.query || {};

    const traceId = createTraceId();
    const requestStartedAtMs = Date.now();
    const authenticatedOwnerId: number = Number(req.user?.id);
    const requestedOwnerId: number | null = owner_id ? Number(owner_id) : null;

    if (!Number.isFinite(authenticatedOwnerId) || authenticatedOwnerId <= 0) {
      res.status(401).json({ status: 'error', data: [], message: 'Authentication required' });
      return;
    }

    if (
      requestedOwnerId !== null &&
      (!Number.isFinite(requestedOwnerId) || requestedOwnerId !== authenticatedOwnerId)
    ) {
      res.status(403).json({
        status: 'error',
        data: [],
        message: 'You can only list workspaces you created',
      });
      return;
    }

    const cachedWorkspaces = getOwnerWorkspacesFromCache(authenticatedOwnerId);
    if (requestedOwnerId !== null && cachedWorkspaces) {
      if (ENABLE_WORKSPACES_METRICS_LOGS) {
        logJson('info', 'workspaces_list_owner_metrics', {
          traceId,
          ownerId: authenticatedOwnerId,
          cacheHit: true,
          resultCount: cachedWorkspaces.length,
          durationMs: Date.now() - requestStartedAtMs,
        });
      }
      res.json({ status: 'success', data: cachedWorkspaces });
      return;
    }

    const workspacesFetchStartedAtMs = Date.now();
    const ownedFetch = cachedWorkspaces
      ? { ownedWorkspaces: cachedWorkspaces, workspacePagesFetched: 0 }
      : await fetchOwnedWorkspaces(authenticatedOwnerId);
    const { ownedWorkspaces, workspacePagesFetched } = ownedFetch;

    if (!cachedWorkspaces) {
      setOwnerWorkspacesCache(authenticatedOwnerId, ownedWorkspaces);
    }

    const { memberWorkspaces, memberRowsFetched } = requestedOwnerId === null
      ? await fetchMemberWorkspaces(authenticatedOwnerId)
      : { memberWorkspaces: [], memberRowsFetched: 0 };

    const workspacesById = new Map<number, Workspace>();
    for (const workspace of [...ownedWorkspaces, ...memberWorkspaces]) {
      workspacesById.set(Number(workspace.id), workspace);
    }
    const accessibleWorkspaces = Array.from(workspacesById.values());

    if (ENABLE_WORKSPACES_METRICS_LOGS) {
      logJson('info', 'workspaces_list_owner_metrics', {
        traceId,
        ownerId: authenticatedOwnerId,
        requestedOwnerId,
        cacheHit: Boolean(cachedWorkspaces),
        resultCount: accessibleWorkspaces.length,
        ownedCount: ownedWorkspaces.length,
        memberCount: memberWorkspaces.length,
        memberRowsFetched,
        workspacePagesFetched,
        workspacesFetchDurationMs: Date.now() - workspacesFetchStartedAtMs,
        durationMs: Date.now() - requestStartedAtMs,
        cacheTtlMs: OWNER_WORKSPACES_CACHE_TTL_MS,
      });
    }

    res.json({ status: 'success', data: accessibleWorkspaces });
  } catch (error) {
    console.error('Error in GET /api/workspaces:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load workspaces' });
  }
});

router.post('/', authMiddleware, (req, res, next) => {
  const schema = req.baseUrl?.includes('/api/workspace-members')
    ? createWorkspaceMemberSchema
    : createWorkspaceSchema;
  return validate(schema)(req, res, next);
}, async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
  try {
    // This router is mounted at both:
    // - /api/workspaces (workspaces CRUD)
    // - /api/workspace-members (workspace membership CRUD)
    //
    // Branch here so POST /api/workspace-members creates a membership record (not a workspace).
    if (req.baseUrl?.includes('/api/workspace-members')) {
      const workspaceId = Number((req.body as any)?.workspace_id);
      const userId = Number(req.user?.id);
      const isAdmin = await verifyWorkspaceAdmin(userId, workspaceId);

      if (!isAdmin) {
        res.status(403).json({
          status: 'error',
          message: 'Only workspace admins can add workspace members',
        });
        return;
      }

      const response = await workspaceMembersApi.addWorkspaceMember(req.body) as ApiResponse<WorkspaceMember>;
      if (response.status === 'success') {
        invalidateOwnerWorkspaceCacheForUser((req.body as any)?.user_id);
      }
      res.json(response);
      return;
    }

    const userId = Number(req.user?.id);
    const canCreateWorkspace = await canAuthenticatedUserCreateWorkspace(userId, req.user?.email);
    if (!canCreateWorkspace) {
      res.status(403).json({
        status: 'error',
        message: 'You can only create one workspace with this account.',
      });
      return;
    }

    const workspaceToCreate = {
      ...req.body,
      owner_id: req.user?.id,
    };

    const response = await workspacesApi.createWorkspace(workspaceToCreate) as ApiResponse<Workspace>;
    
    if (response.status === 'success' && response.id) {
      try {
        const memberResponse = await workspaceMembersApi.addWorkspaceMember({
          workspace_id: response.id,
          user_id: req.user?.id,
          role: 'owner',
          created_at: (req.body as any)?.created_at,
        }) as ApiResponse<WorkspaceMember>;

        if (memberResponse.status !== 'success') {
          console.error('[API] Failed to create workspace owner member:', memberResponse);
        }
      } catch (memberError) {
        console.error('[API] Error creating workspace owner member:', memberError);
      }

      try {
        const pendingStatusResponse = await leadStatusesApi.createStatus({
          workspace_id: response.id,
          name: 'Pending',
          slug: 'pending',
          color: '#6B7280',
          type: 'open',
          is_default:1,
          is_active:1,
          order_index:1,
          is_qualified: 0,
        });
        
        if (!(pendingStatusResponse.status === 'success' && pendingStatusResponse.id)) {
          console.error('[API] Failed to create default "Pending" status:', pendingStatusResponse);
        }
      } catch (statusError) {
        console.error('[API] Error creating default "Pending" status for workspace:', statusError);
      }
    }

    if (response.status === 'success') {
      invalidateOwnerWorkspaceCacheForUser(req.user?.id);
    }
    
    res.json(response);
  } catch (error) {
    console.error(`Error in POST ${req.baseUrl}:`, error);
    const message = req.baseUrl?.includes('/api/workspace-members')
      ? 'Failed to create workspace member'
      : 'Failed to create workspace';
    res.status(500).json({ status: 'error', message });
  }
});

router.put(
  '/:workspaceId/settings',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  validate(updateWorkspaceSchema),
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, {}, Partial<Workspace>>,
    res: Response<ApiResponse<Workspace>>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      if (!workspaceId || Number.isNaN(workspaceId)) {
        res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
        return;
      }

      const updates: Partial<Workspace> = {};
      if (req.body.name !== undefined) {
        updates.name = req.body.name;
      }
      if (req.body.currency !== undefined) {
        updates.currency = String(req.body.currency).trim().toUpperCase();
      }

      const response = (await workspacesApi.updateWorkspace(workspaceId, updates)) as ApiResponse<Workspace>;
      if (response.status === 'success') {
        const workspaceResponse = await workspacesApi.getWorkspaceById(workspaceId) as ApiResponse<Workspace>;
        const workspace = Array.isArray(workspaceResponse.data)
          ? workspaceResponse.data[0]
          : workspaceResponse.data;

        invalidateOwnerWorkspaceCacheForUser(workspace?.owner_id);
        if (req.user?.id !== workspace?.owner_id) {
          invalidateOwnerWorkspaceCacheForUser(req.user?.id);
        }

        res.json({ status: 'success', data: workspace || response.data });
        return;
      }

      res.status(400).json({
        status: 'error',
        message: response.message || response.error || 'Failed to update workspace settings',
      });
    } catch (error) {
      console.error('Error in PUT /api/workspaces/:workspaceId/settings:', error);
      res.status(500).json({ status: 'error', message: 'Failed to update workspace settings' });
    }
  }
);

router.get('/:workspaceId', authMiddleware, workspaceAuthMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string }>, res: Response<ApiResponse<Workspace>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const response: ApiResponse<Workspace> = await workspacesApi.getWorkspaceById(Number(workspaceId));
    res.json(response);
  } catch (error) {
    console.error('Error in GET /api/workspaces/:id:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load workspace' });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { id } = req.params;
    const userId: number = Number(req.user?.id || 0);

    // Branch: when mounted at /api/workspace-members, DELETE /:id deletes a member record
    if (req.baseUrl?.includes('/api/workspace-members')) {
      const memberId: number = Number(id);
      const { workspace_id } = req.query || {};
      let memberUserIdToInvalidate: number | null = null;

      if (!workspace_id) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'workspace_id query parameter is required',
        };
        res.status(400).json(errorResponse);
        return;
      }

      const workspaceId: number = Number(workspace_id);
      const isAdmin: boolean = await verifyWorkspaceAdmin(userId, workspaceId);
      if (!isAdmin) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Admin privileges required',
        };
        res.status(403).json(errorResponse);
        return;
      }

      const memberResponse = await workspaceMembersApi.getWorkspaceMemberById(Number(memberId)) as ApiResponse<WorkspaceMember>;
    const targetMember = Array.isArray(memberResponse.data) ? memberResponse.data[0] : memberResponse.data;
    if (memberResponse.status !== 'success' || !targetMember || Number(targetMember.workspace_id) !== workspaceId) {
      res.status(404).json({ status: 'error', message: 'Workspace member not found' });
      return;
    }
    const targetWorkspaceResponse = await workspacesApi.getWorkspaceById(workspaceId, true);
    const targetWorkspace = Array.isArray(targetWorkspaceResponse.data) ? targetWorkspaceResponse.data[0] : targetWorkspaceResponse.data;
    if (targetWorkspaceResponse.status !== 'success' || !targetWorkspace) throw new Error('Unable to verify workspace owner');
    if (Number(targetWorkspace.owner_id) === Number(targetMember.user_id)) {
      res.status(400).json({ status: 'error', message: 'Cannot modify the workspace owner' });
      return;
    }

      if (memberResponse.status === 'success' && memberResponse.data) {
        const member: WorkspaceMember = Array.isArray(memberResponse.data) 
          ? memberResponse.data[0] 
          : memberResponse.data;
        
        if (member) {
          if (member.role === ROLE_OWNER) {
            const errorResponse: AuthErrorResponse = {
              success: false,
              status: 'error',
              error: 'Cannot remove workspace owner',
            };
            res.status(400).json(errorResponse);
            return;
          }

          if (Number(member.user_id) === userId) {
            const errorResponse: AuthErrorResponse = {
              success: false,
              status: 'error',
              error: 'Cannot remove yourself from workspace',
            };
            res.status(400).json(errorResponse);
            return;
          }

          const parsedMemberUserId = Number(member.user_id);
          if (Number.isFinite(parsedMemberUserId) && parsedMemberUserId > 0) {
            memberUserIdToInvalidate = parsedMemberUserId;
          }
        }
      }

      const response = await workspaceMembersApi.deleteWorkspaceMember(Number(memberId)) as ApiResponse<any>;
      if (response.status === 'success' && memberUserIdToInvalidate) {
        invalidateOwnerWorkspaceCacheForUser(memberUserIdToInvalidate);
      }
      res.json(response);
      return;
    }

    const workspaceId: number = Number(id);
    const invalidationUserIds = new Set<number>();

    // Verify user is the workspace owner
    const workspaceResponse = await workspacesApi.getWorkspaceById(workspaceId) as ApiResponse<Workspace>;
    if (workspaceResponse.status === 'success' && workspaceResponse.data) {
      const workspace: Workspace = Array.isArray(workspaceResponse.data)
        ? workspaceResponse.data[0]
        : workspaceResponse.data;

      if (workspace && Number(workspace.owner_id) !== userId) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Only the workspace owner can delete the workspace',
        };
        res.status(403).json(errorResponse);
        return;
      }

      const ownerId = Number(workspace?.owner_id);
      if (Number.isFinite(ownerId) && ownerId > 0) {
        invalidationUserIds.add(ownerId);
      }
    }

    try {
      const membersResponse = await workspaceMembersApi.getWorkspaceMembers(workspaceId) as ApiResponse<WorkspaceMember[]>;
      if (membersResponse.status === 'success' && membersResponse.data) {
        const members: WorkspaceMember[] = Array.isArray(membersResponse.data)
          ? membersResponse.data
          : [membersResponse.data];
        for (const member of members) {
          const memberUserId = Number(member.user_id);
          if (Number.isFinite(memberUserId) && memberUserId > 0) {
            invalidationUserIds.add(memberUserId);
          }
        }
      }
    } catch {
      // Best-effort invalidation only.
    }

    const response: ApiResponse = await workspacesApi.deleteWorkspace(workspaceId);
    if (response.status === 'success') {
      invalidateOwnerWorkspaceCacheForUsers(invalidationUserIds);
    }
    res.json(response);
  } catch (error) {
    console.error(`Error in DELETE ${req.baseUrl}/:id:`, error);
    res.status(500).json({ status: 'error', message: 'Failed to delete record' });
  }
});

router.post('/workspace-members', authMiddleware, validate(createWorkspaceMemberSchema), async (req: AuthenticatedRequest<{}, {}, any>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const workspaceId = Number(req.body?.workspace_id);
    const userId = Number(req.user?.id);
    const isAdmin = await verifyWorkspaceAdmin(userId, workspaceId);

    if (!isAdmin) {
      res.status(403).json({
        status: 'error',
        message: 'Only workspace admins can add workspace members',
      });
      return;
    }

    const response = await workspaceMembersApi.addWorkspaceMember(req.body) as ApiResponse<WorkspaceMember>;
    if (response.status === 'success') {
      invalidateOwnerWorkspaceCacheForUser((req.body as any)?.user_id);
    }
    res.json(response);
  } catch (error) {
    console.error('Error in POST /api/workspace-members:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create workspace member' });
  }
});

router.get('/:workspaceId/members', authMiddleware, workspaceAuthMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string }>, res: Response<ApiResponse<WorkspaceMember[]>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const response = await workspaceMembersApi.getWorkspaceMembers({ workspace_id: Number(workspaceId), limit: 10000, bypassCache: true }) as ApiResponse<WorkspaceMember[]>;
    const permissionRecords = await workspacePermissionRecords(Number(workspaceId));
    if (response.status === 'success') {
      const members = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
      response.data = members.filter((member) => Number(member.workspace_id) === Number(workspaceId))
        .map((member) => ({ ...member, permissions: memberPermissions(member, permissionRecords) }));
    }

    if (response.status === 'success' && Array.isArray(response.data)) {
      const uniqueUserIds = Array.from(
        new Set(
          response.data
            .map((m: any) => Number(m.user_id))
            .filter((n: number) => Number.isFinite(n) && n > 0)
        )
      );

      const nameByUserId = new Map<number, { name: string; email: string }>();
      const userFetches = uniqueUserIds.map(async (userId: number) => {
        const userRes = await usersApi.getUserById(userId).catch(() => ({ status: 'error', data: null } as any));
        if (userRes.status !== 'success' || !userRes.data) return;
        const userData: any = Array.isArray(userRes.data) ? userRes.data[0] : userRes.data;
        nameByUserId.set(userId, {
          name: userData?.name || '',
          email: userData?.email || '',
        });
      });
      await Promise.all(userFetches);

      response.data = response.data.map((member: any) => {
        const userId = Number(member.user_id);
        const info = nameByUserId.get(userId);
        return {
          ...member,
          user_name: info?.name || '',
          user_email: req.userRole === 'admin' ? info?.email || '' : '',
        };
      }) as any;
    }

    res.json(response);
  } catch (error) {
    console.error('Error in GET /api/workspaces/:workspaceId/members:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load workspace members' });
  }
});

router.post('/:workspaceId/members/invite', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, validate(inviteMemberSchema), async (req: AuthenticatedRequest<{ workspaceId: string }, {}, InviteMemberBody>, res: Response<ApiResponse<WorkspaceMember | { token: string; email: string; expiresAt: string }>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { email } = req.body || {};
    const traceId = createTraceId();

    if (!email) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Email is required',
      };
      logJson('warn', 'workspace_invite_rejected', {
        traceId,
        workspaceId: Number(workspaceId),
        inviterUserId: Number(req.user?.id || 0) || undefined,
        reason: 'missing_email',
      });
      res.status(400).json(errorResponse);
      return;
    }

    const normalizedEmail: string = String(email).toLowerCase().trim();
    logJson('info', 'workspace_invite_start', {
      traceId,
      workspaceId: Number(workspaceId),
      inviterUserId: Number(req.user?.id || 0) || undefined,
      invitedEmail: maskEmail(normalizedEmail),
    });

    let searchResponse: ApiResponse<any[]> | null = null;
    try {
      searchResponse = await usersApi.searchUserByEmail(normalizedEmail) as ApiResponse<any[]>;
    } catch (searchErr) {
      logJson('warn', 'workspace_invite_search_failed', {
        traceId,
        workspaceId: Number(workspaceId),
        invitedEmail: maskEmail(normalizedEmail),
        err: errorToLogObject(searchErr),
      });
      searchResponse = null;
    }

    if (searchResponse && searchResponse.status === 'success' && searchResponse.data && searchResponse.data.length > 0) {
      const user: any = searchResponse.data[0];
      logJson('info', 'workspace_invite_user_found', {
        traceId,
        workspaceId: Number(workspaceId),
        invitedEmail: maskEmail(normalizedEmail),
        invitedUserId: typeof user?.id === 'number' ? user.id : Number(user?.id || 0) || undefined,
      });

      let membersResponse: ApiResponse<WorkspaceMember[]> | null = null;
      try {
        membersResponse = await workspaceMembersApi.getWorkspaceMembers({ workspace_id: Number(workspaceId), limit: 10000, bypassCache: true }) as ApiResponse<WorkspaceMember[]>;
      } catch (memberErr) {
        logJson('warn', 'workspace_invite_member_check_failed', {
          traceId,
          workspaceId: Number(workspaceId),
          invitedEmail: maskEmail(normalizedEmail),
          err: errorToLogObject(memberErr),
        });
      }
      if (membersResponse && membersResponse.status === 'success' && membersResponse.data) {
        const members: WorkspaceMember[] = Array.isArray(membersResponse.data)
          ? membersResponse.data
          : [membersResponse.data];

        const existingMember: WorkspaceMember | undefined = members.find((m: WorkspaceMember) => Number(m.user_id) === user.id);
        if (existingMember) {
          const errorResponse: AuthErrorResponse = {
            success: false,
            status: 'error',
            error: 'User is already a member of this workspace',
          };
          logJson('warn', 'workspace_invite_already_member', {
            traceId,
            workspaceId: Number(workspaceId),
            invitedEmail: maskEmail(normalizedEmail),
            invitedUserId: typeof user?.id === 'number' ? user.id : Number(user?.id || 0) || undefined,
            existingMemberId: existingMember?.id,
            role: existingMember?.role,
          });
          res.status(409).json(errorResponse);
          return;
        }
      }

      const createResponse = await workspaceMembersApi.addWorkspaceMember({
        workspace_id: Number(workspaceId),
        user_id: user.id,
        role: (req.body.role as any) || 'member',
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }) as ApiResponse<WorkspaceMember>;

      if (createResponse.status === 'success') {
        invalidateOwnerWorkspaceCacheForUser(user?.id);
      }

      logJson('info', 'workspace_invite_member_created', {
        traceId,
        workspaceId: Number(workspaceId),
        invitedEmail: maskEmail(normalizedEmail),
        invitedUserId: typeof user?.id === 'number' ? user.id : Number(user?.id || 0) || undefined,
        status: createResponse.status,
        memberId: (createResponse as any)?.id ?? (createResponse as any)?.data?.id,
        message: (createResponse as any)?.message,
      });

      // Send invite email via Emailit (do not fail the invite if email fails)
      if (createResponse.status === 'success') {
        try {
          const workspaceIdNum: number = Number(workspaceId);
          const invitedLabel: string = String(user?.name || user?.email || normalizedEmail).trim() || normalizedEmail;

          // Workspace name
          let workspaceName: string = `Workspace ${workspaceIdNum}`;
          try {
            const workspaceRes = await workspacesApi.getWorkspaceById(workspaceIdNum) as ApiResponse<Workspace>;
            if (workspaceRes.status === 'success' && workspaceRes.data) {
              const ws: Workspace | undefined = Array.isArray(workspaceRes.data)
                ? workspaceRes.data[0]
                : workspaceRes.data;
              if (ws?.name) workspaceName = ws.name;
            }
          } catch (wsErr) {
            console.warn('[Invite] Could not load workspace name for email:', (wsErr as Error).message);
          }

          // Inviter name (fallback to inviter email from JWT payload)
          let inviterName: string = req.user?.email || 'Someone';
          try {
            const inviterId: number = Number(req.user?.id || 0);
            if (inviterId) {
              const inviterRes = await usersApi.getUserById(inviterId) as ApiResponse<User>;
              if (inviterRes.status === 'success' && inviterRes.data) {
                const inviter: User | undefined = Array.isArray(inviterRes.data)
                  ? inviterRes.data[0]
                  : inviterRes.data;
                inviterName = inviter?.name || inviter?.email || inviterName;
              }
            }
          } catch (inviterErr) {
            console.warn('[Invite] Could not load inviter name for email:', (inviterErr as Error).message);
          }

          // Optional per-workspace template (falls back to default if missing)
          const storedTemplate = await getWorkspaceInviteEmailTemplate(workspaceIdNum);
          logJson('info', 'workspace_invite_email_prepare', {
            traceId,
            workspaceId: workspaceIdNum,
            invitedEmail: maskEmail(normalizedEmail),
            inviterName,
            workspaceName,
            templateConfigured: Boolean(storedTemplate?.template),
            templateLogId: storedTemplate?.logId,
            templateEventId: storedTemplate?.eventId,
          });

          let inviteToken: string | undefined;
          try {
            const invitationHelpers = (await import('./invitationRoutes.js')).invitationHelpers;
            if (invitationHelpers) {
              const token = invitationHelpers.generateInviteToken();
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 7);
              await invitationHelpers.addInvitation({
                workspace_id: workspaceIdNum,
                email: normalizedEmail,
                token,
                invited_by: Number(req.user?.id || 0),
                role: (req.body.role as any) || 'member',
                status: 'pending',
                expires_at: expiresAt.toISOString().slice(0, 19).replace('T', ' '),
              });
              inviteToken = token;
              logJson('info', 'workspace_invitation_created_existing_user', {
                traceId,
                workspaceId: workspaceIdNum,
                invitedEmail: maskEmail(normalizedEmail),
                token: token.substring(0, 8) + '...',
                expiresAt: expiresAt.toISOString().slice(0, 19).replace('T', ' '),
              });
            }
          } catch (invErr) {
            console.warn('[Invite] Could not create invitation for existing user:', (invErr as Error).message);
          }

          const emailResult = await sendWorkspaceInviteEmail({
            to: normalizedEmail,
            inviterName,
            workspaceName,
            workspaceId: workspaceIdNum,
            template: storedTemplate.template,
            traceId,
            ...(inviteToken ? { inviteToken } : {}),
          });

          if (!emailResult.sent) {
            const detail = emailResult.skipped ? emailResult.reason : emailResult.error;
            createResponse.message = createResponse.message
              ? `${createResponse.message} (${detail})`
              : `Member invited, but invite email was not sent. (${detail})`;

            logJson('warn', 'workspace_invite_email_not_sent', {
              traceId,
              workspaceId: workspaceIdNum,
              invitedEmail: maskEmail(normalizedEmail),
              skipped: Boolean((emailResult as any)?.skipped),
              detail,
            });
          } else {
            createResponse.message =
              createResponse.message || `Member "${invitedLabel}" invited and email sent successfully.`;

            logJson('info', 'workspace_invite_email_sent', {
              traceId,
              workspaceId: workspaceIdNum,
              invitedEmail: maskEmail(normalizedEmail),
              messageId: (emailResult as any)?.messageId,
            });
          }
        } catch (emailErr) {
          console.error('[Invite] Error sending invite email:', emailErr);
          logJson('error', 'workspace_invite_email_exception', {
            traceId,
            workspaceId: Number(workspaceId),
            invitedEmail: maskEmail(normalizedEmail),
            err: errorToLogObject(emailErr),
          });

          // Ensure the UI gets *some* signal even if the upstream message is generic.
          const suffix = `Invite email failed (traceId: ${traceId})`;
          createResponse.message = createResponse.message
            ? `${createResponse.message} (${suffix})`
            : `Member invited, but ${suffix}.`;
        }
      }

      res.json(createResponse);
    } else {
      // User doesn't exist - create an invitation
      const invitationHelpers = (await import('./invitationRoutes.js')).invitationHelpers;

      if (!invitationHelpers) {
        throw new Error('Failed to load invitation helpers');
      }

      try {
        const existingPending = await invitationHelpers.getPendingInvitations(Number(workspaceId));
        const duplicate = existingPending.find((i: any) => String(i.email || '').toLowerCase().trim() === normalizedEmail);
        if (duplicate) {
          logJson('warn', 'workspace_invite_duplicate_pending', {
            traceId,
            workspaceId: Number(workspaceId),
            invitedEmail: maskEmail(normalizedEmail),
            existingToken: String(duplicate.token || '').substring(0, 8) + '...',
          });
          res.status(409).json({ status: 'error', message: 'An invitation is already pending for this email' } as any);
          return;
        }
      } catch (pendingCheckErr) {
        logJson('warn', 'workspace_invite_pending_check_failed', {
          traceId,
          workspaceId: Number(workspaceId),
          invitedEmail: maskEmail(normalizedEmail),
          err: errorToLogObject(pendingCheckErr),
        });
      }

      const token = invitationHelpers.generateInviteToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = {
        workspace_id: Number(workspaceId),
        email: normalizedEmail,
        token,
        invited_by: Number(req.user?.id || 0),
        role: (req.body.role as any) || 'member',
        status: 'pending',
        expires_at: expiresAt.toISOString().slice(0, 19).replace('T', ' '),
      };

      try {
        await invitationHelpers.addInvitation(invitation);
      } catch (invStoreErr) {
        logJson('error', 'workspace_invitation_store_failed', {
          traceId,
          workspaceId: Number(workspaceId),
          invitedEmail: maskEmail(normalizedEmail),
          err: errorToLogObject(invStoreErr),
        });
        const fallbackEmail = String(invStoreErr instanceof Error ? invStoreErr.message : invStoreErr);
        if (fallbackEmail.includes('Incorrect datetime') || fallbackEmail.includes('expires_at')) {
          throw new Error('Invitation date format error - please contact support');
        }
      }

      logJson('info', 'workspace_invitation_created', {
        traceId,
        workspaceId: Number(workspaceId),
        invitedEmail: maskEmail(normalizedEmail),
        token: token.substring(0, 8) + '...',
        expiresAt: invitation.expires_at,
      });

      // Get workspace name and inviter name for email
      let workspaceName: string = `Workspace ${workspaceId}`;
      (async () => {
        try {
          const workspaceRes = await workspacesApi.getWorkspaceById(Number(workspaceId)) as ApiResponse<Workspace>;
          if (workspaceRes.status === 'success' && workspaceRes.data) {
            const ws = Array.isArray(workspaceRes.data) ? workspaceRes.data[0] : workspaceRes.data;
            if (ws?.name) workspaceName = ws.name;
          }
        } catch (wsErr) {
          console.warn('[Invite] Could not load workspace name for email:', (wsErr as Error).message);
        }

        let inviterName: string = req.user?.email || 'Someone';
        try {
          const inviterId = Number(req.user?.id || 0);
          if (inviterId) {
            const inviterRes = await usersApi.getUserById(inviterId) as ApiResponse<User>;
            if (inviterRes.status === 'success' && inviterRes.data) {
              const inviter = Array.isArray(inviterRes.data) ? inviterRes.data[0] : inviterRes.data;
              inviterName = inviter?.name || inviter?.email || inviterName;
            }
          }
        } catch (inviterErr) {
          console.warn('[Invite] Could not load inviter name for email:', (inviterErr as Error).message);
        }

        // Send invitation email
        try {
          const storedTemplate = await getWorkspaceInviteEmailTemplate(Number(workspaceId));
          const emailResult = await sendWorkspaceInviteEmail({
            to: normalizedEmail,
            inviterName,
            workspaceName,
            workspaceId: Number(workspaceId),
            template: storedTemplate.template,
            traceId,
            inviteToken: token, // Pass invitation token for new users
          });

          if (emailResult.sent) {
            logJson('info', 'workspace_invitation_email_sent', {
              traceId,
              workspaceId: Number(workspaceId),
              invitedEmail: maskEmail(normalizedEmail),
              messageId: (emailResult as any)?.messageId,
            });
          } else {
            const detail = emailResult.skipped ? emailResult.reason : emailResult.error;
            logJson('warn', 'workspace_invitation_email_not_sent', {
              traceId,
              workspaceId: Number(workspaceId),
              invitedEmail: maskEmail(normalizedEmail),
              detail,
            });
          }
        } catch (emailErr) {
          console.error('[Invite] Error sending invitation email:', emailErr);
          logJson('error', 'workspace_invitation_email_exception', {
            traceId,
            workspaceId: Number(workspaceId),
            invitedEmail: maskEmail(normalizedEmail),
            err: errorToLogObject(emailErr),
          });
        }
      })();

      res.json({
        status: 'success',
        data: {
          token,
          email: normalizedEmail,
          expiresAt: invitation.expires_at,
        },
        message: 'Invitation sent! The user will receive an email to create an account and join the workspace.',
      });
    }
  } catch (error) {
    console.error('Error in POST /api/workspaces/:workspaceId/members/invite:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to invite workspace member';
    const isDateError = message.includes('Incorrect datetime') || message.includes('expires_at');
    logJson('error', 'workspace_invite_failed', {
      workspaceId: Number((req.params as any)?.workspaceId || 0),
      err: errorToLogObject(error),
    });
    res.status(isDateError ? 400 : 500).json({ status: 'error', message: isDateError ? message : 'Failed to invite workspace member' });
  }
});

// Alias for WorkspaceMember updates when this router is mounted at /api/workspace-members
// (client calls PUT /api/workspace-members/:memberId)
router.put('/:memberId', authMiddleware, validate(updateMemberSchema), async (req: AuthenticatedRequest<{ memberId: string }, {}, UpdateMemberBody>, res: Response<ApiResponse<WorkspaceMember>>): Promise<void> => {
  // Avoid accidentally handling PUT /api/workspaces/:id (not supported)
  if (!req.baseUrl?.includes('/api/workspace-members')) {
    res.status(404).json({ status: 'error', message: 'Not found' });
    return;
  }

  try {
    const { memberId } = req.params;
    const { workspace_id, role } = req.body || {};
    
    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required in request body',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const userId: number = Number(req.user?.id || 0);
    const workspaceId: number = Number(workspace_id);

    const isAdmin: boolean = await verifyWorkspaceAdmin(userId, workspaceId);
    if (!isAdmin) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const memberResponse = await workspaceMembersApi.getWorkspaceMemberById(Number(memberId)) as ApiResponse<WorkspaceMember>;
    const targetMember = Array.isArray(memberResponse.data) ? memberResponse.data[0] : memberResponse.data;
    if (memberResponse.status !== 'success' || !targetMember || Number(targetMember.workspace_id) !== workspaceId) {
      res.status(404).json({ status: 'error', message: 'Workspace member not found' });
      return;
    }
    const targetWorkspaceResponse = await workspacesApi.getWorkspaceById(workspaceId, true);
    const targetWorkspace = Array.isArray(targetWorkspaceResponse.data) ? targetWorkspaceResponse.data[0] : targetWorkspaceResponse.data;
    if (targetWorkspaceResponse.status !== 'success' || !targetWorkspace) throw new Error('Unable to verify workspace owner');
    if (Number(targetWorkspace.owner_id) === Number(targetMember.user_id)) {
      res.status(400).json({ status: 'error', message: 'Cannot modify the workspace owner' });
      return;
    }

    if (memberResponse.status === 'success' && memberResponse.data) {
      const member: WorkspaceMember = Array.isArray(memberResponse.data) 
        ? memberResponse.data[0] 
        : memberResponse.data;
      
      if (member && member.role === ROLE_OWNER) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Cannot modify workspace owner',
        };
        res.status(400).json(errorResponse);
        return;
      }
    }

    if (Number(targetMember.user_id) === userId) {
      res.status(400).json({ status: 'error', message: 'You cannot modify your own member role' });
      return;
    }

    const response = await workspaceMembersApi.updateWorkspaceMember(Number(memberId), { role }) as ApiResponse<WorkspaceMember>;
    res.json(response);
  } catch (error) {
    console.error('Error in PUT /api/workspace-members/:memberId:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update workspace member' });
  }
});

router.put('/workspace-members/:memberId', authMiddleware, validate(updateMemberSchema), async (req: AuthenticatedRequest<{ memberId: string }, {}, UpdateMemberBody>, res: Response<ApiResponse<WorkspaceMember>>): Promise<void> => {
  try {
    const { memberId } = req.params;
    const { workspace_id, role } = req.body || {};
    
    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required in request body',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const userId: number = Number(req.user?.id || 0);
    const workspaceId: number = Number(workspace_id);

    const isAdmin: boolean = await verifyWorkspaceAdmin(userId, workspaceId);
    if (!isAdmin) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const memberResponse = await workspaceMembersApi.getWorkspaceMemberById(Number(memberId)) as ApiResponse<WorkspaceMember>;
    const targetMember = Array.isArray(memberResponse.data) ? memberResponse.data[0] : memberResponse.data;
    if (memberResponse.status !== 'success' || !targetMember || Number(targetMember.workspace_id) !== workspaceId) {
      res.status(404).json({ status: 'error', message: 'Workspace member not found' });
      return;
    }
    const targetWorkspaceResponse = await workspacesApi.getWorkspaceById(workspaceId, true);
    const targetWorkspace = Array.isArray(targetWorkspaceResponse.data) ? targetWorkspaceResponse.data[0] : targetWorkspaceResponse.data;
    if (targetWorkspaceResponse.status !== 'success' || !targetWorkspace) throw new Error('Unable to verify workspace owner');
    if (Number(targetWorkspace.owner_id) === Number(targetMember.user_id)) {
      res.status(400).json({ status: 'error', message: 'Cannot modify the workspace owner' });
      return;
    }

    if (memberResponse.status === 'success' && memberResponse.data) {
      const member: WorkspaceMember = Array.isArray(memberResponse.data) 
        ? memberResponse.data[0] 
        : memberResponse.data;
      
      if (member && member.role === ROLE_OWNER) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'Cannot modify workspace owner',
        };
        res.status(400).json(errorResponse);
        return;
      }
    }

    if (Number(targetMember.user_id) === userId) {
      res.status(400).json({ status: 'error', message: 'You cannot modify your own member role' });
      return;
    }

    const response = await workspaceMembersApi.updateWorkspaceMember(Number(memberId), { role }) as ApiResponse<WorkspaceMember>;
    res.json(response);
  } catch (error) {
    console.error('Error in PUT /api/workspace-members/:memberId:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update workspace member' });
  }
});

router.delete('/workspace-members/:memberId', authMiddleware, async (req: AuthenticatedRequest<{ memberId: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { memberId } = req.params;
    const { workspace_id } = req.query || {};
    let memberUserIdToInvalidate: number | null = null;

    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id query parameter is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const userId: number = Number(req.user?.id || 0);
    const workspaceId: number = Number(workspace_id);

    const isAdmin: boolean = await verifyWorkspaceAdmin(userId, workspaceId);
    if (!isAdmin) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const memberResponse = await workspaceMembersApi.getWorkspaceMemberById(Number(memberId)) as ApiResponse<WorkspaceMember>;
    const targetMember = Array.isArray(memberResponse.data) ? memberResponse.data[0] : memberResponse.data;
    if (memberResponse.status !== 'success' || !targetMember || Number(targetMember.workspace_id) !== workspaceId) {
      res.status(404).json({ status: 'error', message: 'Workspace member not found' });
      return;
    }
    const targetWorkspaceResponse = await workspacesApi.getWorkspaceById(workspaceId, true);
    const targetWorkspace = Array.isArray(targetWorkspaceResponse.data) ? targetWorkspaceResponse.data[0] : targetWorkspaceResponse.data;
    if (targetWorkspaceResponse.status !== 'success' || !targetWorkspace) throw new Error('Unable to verify workspace owner');
    if (Number(targetWorkspace.owner_id) === Number(targetMember.user_id)) {
      res.status(400).json({ status: 'error', message: 'Cannot modify the workspace owner' });
      return;
    }

    if (memberResponse.status === 'success' && memberResponse.data) {
      const member: WorkspaceMember = Array.isArray(memberResponse.data) 
        ? memberResponse.data[0] 
        : memberResponse.data;
      
      if (member) {
        if (member.role === ROLE_OWNER) {
          const errorResponse: AuthErrorResponse = {
            success: false,
            status: 'error',
            error: 'Cannot remove workspace owner',
          };
          res.status(400).json(errorResponse);
          return;
        }

        if (Number(member.user_id) === userId) {
          const errorResponse: AuthErrorResponse = {
            success: false,
            status: 'error',
            error: 'Cannot remove yourself from workspace',
          };
          res.status(400).json(errorResponse);
          return;
        }

        const parsedMemberUserId = Number(member.user_id);
        if (Number.isFinite(parsedMemberUserId) && parsedMemberUserId > 0) {
          memberUserIdToInvalidate = parsedMemberUserId;
        }
      }
    }

    const response = await workspaceMembersApi.deleteWorkspaceMember(Number(memberId)) as ApiResponse<any>;
    if (response.status === 'success' && memberUserIdToInvalidate) {
      invalidateOwnerWorkspaceCacheForUser(memberUserIdToInvalidate);
    }
    res.json(response);
  } catch (error) {
    console.error('Error in DELETE /api/workspace-members/:memberId:', error);
    res.status(500).json({ status: 'error', message: 'Failed to remove workspace member' });
  }
});

// GET /api/workspaces/:workspaceId/invitations - List pending invitations
router.get('/:workspaceId/invitations', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string }>, res: Response<ApiResponse<any>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const invitationHelpers = (await import('./invitationRoutes.js')).invitationHelpers;
    if (!invitationHelpers) {
      res.status(500).json({ status: 'error', message: 'Failed to load invitation helpers' });
      return;
    }
    const pendingInvites = await invitationHelpers.getPendingInvitations(Number(workspaceId));
    console.log(`[DEBUG] Pending invites for ${workspaceId}:`, pendingInvites);
    res.json({ status: 'success', data: pendingInvites });
  } catch (error) {
    console.error('Error in GET /api/workspaces/:workspaceId/invitations:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch invitations' });
  }
});

// DELETE /api/workspaces/:workspaceId/invitations/:email - Cancel invitation
router.delete('/:workspaceId/invitations/:email', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string; email: string }>, res: Response<ApiResponse<any>>): Promise<void> => {
  try {
    const { workspaceId, email } = req.params;
    const normalizedEmail = decodeURIComponent(email).toLowerCase().trim();
    const invitationHelpers = (await import('./invitationRoutes.js')).invitationHelpers;
    if (!invitationHelpers) {
      res.status(500).json({ status: 'error', message: 'Failed to load invitation helpers' });
      return;
    }
    await invitationHelpers.removeInvitationByEmail(Number(workspaceId), normalizedEmail);
    res.json({ status: 'success', message: 'Invitation cancelled' });
  } catch (error) {
    console.error('Error in DELETE /api/workspaces/:workspaceId/invitations/:email:', error);
    res.status(500).json({ status: 'error', message: 'Failed to cancel invitation' });
  }
});

interface WorkspaceQuery {
  owner_id?: string;
}

export default router;
