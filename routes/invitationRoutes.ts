import { Router, Request, Response } from 'express';
import { workspacesApi, workspaceMembersApi, usersApi, workspaceInvitationsApi, webhookLogsApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ApiResponse,
  WorkspaceMember,
  AuthenticatedRequest,
} from '../types/index.js';
import crypto from 'crypto';
import { logJson } from '../utils/logger.js';

const router: Router = Router();
const INVITATION_STATUS = 'workspace_invitation';
const INVITATION_SOURCE = 'workspace_invite';

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function isInvitationExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function toMySqlDatetime(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())) return value.trim();
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function parseWebhookInvitation(log: any): any | null {
  if (!log || log.id === undefined) return null;
  try {
    const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
    const base = payload && typeof payload === 'object' && payload.token ? payload : payload && payload.invitation ? payload.invitation : payload;
    if (!base || typeof base !== 'object') return null;
    const invitation = { ...base };
    if (!invitation.token && log.event_id) invitation.token = String(log.event_id);
    if (!invitation.email && base.email) invitation.email = base.email;
    invitation.id = log.id;
    invitation._webhookLogId = log.id;
    invitation._isWebhook = true;
    if (!invitation.workspace_id && log.workspace_id) invitation.workspace_id = Number(log.workspace_id);
    if (!invitation.status && log.status) invitation.status = log.status === INVITATION_STATUS ? 'pending' : log.status;
    return invitation;
  } catch {
    return null;
  }
}

async function addInvitation(invitation: any): Promise<void> {
  const sanitized: any = { ...invitation };
  if (!sanitized.role) sanitized.role = 'member';
  if (sanitized.expires_at) sanitized.expires_at = toMySqlDatetime(sanitized.expires_at);
  try {
    await workspaceInvitationsApi.createInvitation(sanitized);
    return;
  } catch (primaryError) {
    const fallbackPayload = JSON.stringify({ ...invitation, role: sanitized.role });
    await webhookLogsApi.createWebhookLog({
      workspace_id: Number(invitation.workspace_id),
      lead_id: 0,
      source: INVITATION_SOURCE,
      event_id: String(invitation.token),
      payload: fallbackPayload,
      status: INVITATION_STATUS,
    });
  }
}

async function getInvitationByToken(token: string): Promise<any | undefined> {
  try {
    const res = await workspaceInvitationsApi.getInvitations({ token }) as ApiResponse<any>;
    if (res.status === 'success' && res.data) {
      const list = Array.isArray(res.data) ? res.data : [res.data];
      if (list.length > 0 && list[0]) return list[0];
    }
  } catch {}
  try {
    const res = await webhookLogsApi.getWebhookLogs({ status: INVITATION_STATUS, source: INVITATION_SOURCE, event_id: String(token), limit: 10, bypassCache: true }) as ApiResponse<any[]>;
    if (res.status === 'success' && res.data) {
      const list = Array.isArray(res.data) ? res.data : [res.data];
      for (const log of list) {
        const parsed = parseWebhookInvitation(log);
        if (parsed && String(parsed.token) === String(token)) return parsed;
      }
    }
    const fallbackRes = await webhookLogsApi.getWebhookLogs({ status: INVITATION_STATUS, limit: 50, bypassCache: true }) as ApiResponse<any[]>;
    if (fallbackRes.status === 'success' && fallbackRes.data) {
      const list = Array.isArray(fallbackRes.data) ? fallbackRes.data : [fallbackRes.data];
      for (const log of list) {
        if (String(log.event_id) !== String(token)) continue;
        const parsed = parseWebhookInvitation(log);
        if (parsed) return parsed;
      }
    }
  } catch {}
  return undefined;
}

async function updateInvitationRecord(invitation: any): Promise<void> {
  if (invitation._isWebhook || invitation._webhookLogId) {
    const logId = Number(invitation._webhookLogId || invitation.id);
    const payload = JSON.stringify({ ...invitation, _isWebhook: undefined, _webhookLogId: undefined });
    await webhookLogsApi.updateWebhookLog(logId, {
      workspace_id: Number(invitation.workspace_id),
      lead_id: 0,
      source: INVITATION_SOURCE,
      event_id: String(invitation.token),
      payload,
      status: INVITATION_STATUS,
    });
    return;
  }
  try {
    await workspaceInvitationsApi.updateInvitation(invitation.id, { ...invitation, expires_at: invitation.expires_at ? toMySqlDatetime(invitation.expires_at) : invitation.expires_at });
  } catch {
    const payload = JSON.stringify({ ...invitation });
    const existing = await getInvitationByToken(String(invitation.token));
    if (existing && existing._isWebhook) {
      await updateInvitationRecord({ ...invitation, _isWebhook: true, _webhookLogId: existing._webhookLogId || existing.id });
    } else {
      await webhookLogsApi.createWebhookLog({
        workspace_id: Number(invitation.workspace_id),
        lead_id: 0,
        source: INVITATION_SOURCE,
        event_id: String(invitation.token),
        payload,
        status: INVITATION_STATUS,
      });
    }
  }
}

async function removeInvitation(token: string): Promise<void> {
  const inv = await getInvitationByToken(token);
  if (!inv || !inv.id) return;
  if (inv._isWebhook || inv._webhookLogId) {
    await webhookLogsApi.deleteWebhookLog(Number(inv._webhookLogId || inv.id));
    return;
  }
  try {
    await workspaceInvitationsApi.deleteInvitation(inv.id);
  } catch {
    try {
      await webhookLogsApi.deleteWebhookLog(Number(inv.id));
    } catch {}
  }
}

async function getPendingInvitations(workspaceId: number): Promise<any[]> {
  const results: any[] = [];
  const seenTokens = new Set<string>();
  try {
    const res = await workspaceInvitationsApi.getInvitations({ workspace_id: workspaceId }) as ApiResponse<any>;
    if (res.status === 'success' && res.data) {
      const list = Array.isArray(res.data) ? res.data : [res.data];
      for (const item of list) {
        if (item && item.status === 'pending' && item.token) {
          seenTokens.add(String(item.token));
          results.push(item);
        } else if (item && item.status === 'pending') {
          results.push(item);
        }
      }
    }
  } catch {}
  try {
    const res = await webhookLogsApi.getWebhookLogs({ workspace_id: workspaceId, status: INVITATION_STATUS, source: INVITATION_SOURCE, limit: 200, bypassCache: true }) as ApiResponse<any[]>;
    if (res.status === 'success' && res.data) {
      const list = Array.isArray(res.data) ? res.data : [res.data];
      for (const log of list) {
        const parsed = parseWebhookInvitation(log);
        if (!parsed) continue;
        const token = String(parsed.token || log.event_id || '');
        if (!token || seenTokens.has(token)) continue;
        const status = String(parsed.status || 'pending').toLowerCase();
        if (status !== 'pending') continue;
        if (isInvitationExpired(String(parsed.expires_at || ''))) continue;
        seenTokens.add(token);
        results.push(parsed);
      }
    }
  } catch {}
  return results;
}

async function removeInvitationByEmail(workspaceId: number, email: string): Promise<void> {
  const normalized = String(email).toLowerCase().trim();
  const pending = await getPendingInvitations(workspaceId);
  const inv = pending.find((i: any) => String(i.email || '').toLowerCase().trim() === normalized);
  if (!inv || !inv.id) return;
  if (inv._isWebhook || inv._webhookLogId) {
    await webhookLogsApi.deleteWebhookLog(Number(inv._webhookLogId || inv.id));
    return;
  }
  try {
    await workspaceInvitationsApi.deleteInvitation(inv.id);
  } catch {
    try {
      await webhookLogsApi.deleteWebhookLog(Number(inv.id));
    } catch {}
  }
}

// GET /api/invitations/:token/validate - Validate an invitation token
router.get(
  '/:token/validate',
  async (
    req: Request<{ token: string }>,
    res: Response<ApiResponse<any>>
  ): Promise<void> => {
    try {
      const { token } = req.params;
      const invitation = await getInvitationByToken(token);

      if (!invitation) {
        res.json({
          status: 'error',
          error: 'Invalid or expired invitation',
        });
        return;
      }

      if (invitation.status !== 'pending') {
        res.json({
          status: 'error',
          error: `Invitation has already been ${invitation.status}`,
        });
        return;
      }

      if (isInvitationExpired(invitation.expires_at)) {
        invitation.status = 'expired';
        await updateInvitationRecord(invitation);
        res.json({
          status: 'error',
          error: 'Invitation has expired',
        });
        return;
      }

      const workspaceRes = await workspacesApi.getWorkspaceById(invitation.workspace_id) as ApiResponse<any>;
      let workspaceName = `Workspace ${invitation.workspace_id}`;
      let workspaceId = invitation.workspace_id;
      if (workspaceRes.status === 'success' && workspaceRes.data) {
        const ws = Array.isArray(workspaceRes.data) ? workspaceRes.data[0] : workspaceRes.data;
        if (ws?.name) workspaceName = ws.name;
      }

      let inviterName = 'Someone';
      try {
        const inviterRes = await usersApi.getUserById(invitation.invited_by) as ApiResponse<any>;
        if (inviterRes.status === 'success' && inviterRes.data) {
          const inviter = Array.isArray(inviterRes.data) ? inviterRes.data[0] : inviterRes.data;
          inviterName = inviter?.name || inviter?.email || inviterName;
        }
      } catch (err) {
      }

      let userExists = false;
      try {
        const userSearch = await usersApi.searchUserByEmail?.(String(invitation.email || '').toLowerCase().trim()) as ApiResponse<any> | undefined;
        userExists = Boolean(userSearch && userSearch.status === 'success' && Array.isArray(userSearch.data) && userSearch.data.length > 0);
      } catch {
        userExists = false;
      }

      res.json({
        status: 'success',
        data: {
          valid: true,
          workspaceName,
          inviterName,
          email: invitation.email,
          workspaceId,
          expiresAt: invitation.expires_at,
          userExists,
        },
      });
    } catch (error) {
      console.error('Error in GET /api/invitations/:token/validate:', error);
      res.status(500).json({ status: 'error', message: 'Failed to validate invitation' });
    }
  }
);

// POST /api/invitations/:token/accept - Accept an invitation (after user signup/login)
router.post(
  '/:token/accept',
  authMiddleware,
  async (
    req: AuthenticatedRequest<{ token: string }>,
    res: Response<ApiResponse<WorkspaceMember>>
  ): Promise<void> => {
    try {
      const { token } = req.params;
      const userId = Number(req.user?.id || 0);

      if (!userId) {
        res.status(401).json({ status: 'error', error: 'Authentication required' });
        return;
      }

      const invitation = await getInvitationByToken(token);

      if (!invitation) {
        res.status(404).json({ status: 'error', error: 'Invalid or expired invitation' });
        return;
      }

      if (invitation.status !== 'pending') {
        res.status(400).json({
          status: 'error',
          error: `Invitation has already been ${invitation.status}`,
        });
        return;
      }

      if (isInvitationExpired(invitation.expires_at)) {
        invitation.status = 'expired';
        await updateInvitationRecord(invitation);
        res.status(400).json({ status: 'error', error: 'Invitation has expired' });
        return;
      }

      const userRes = await usersApi.getUserById(userId) as ApiResponse<any>;
      if (userRes.status !== 'success' || !userRes.data) {
        res.status(404).json({ status: 'error', error: 'User not found' });
        return;
      }

      const user = Array.isArray(userRes.data) ? userRes.data[0] : userRes.data;
      if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        res.status(403).json({
          status: 'error',
          error: 'This invitation was sent to a different email address',
        });
        return;
      }

      const membersResponse = await workspaceMembersApi.getWorkspaceMembers(invitation.workspace_id) as ApiResponse<WorkspaceMember[]>;
      if (membersResponse.status === 'success' && membersResponse.data) {
        const members = Array.isArray(membersResponse.data) ? membersResponse.data : [membersResponse.data];
        const existingMember = members.find((m: WorkspaceMember) => Number(m.user_id) === userId);

        if (existingMember) {
          invitation.status = 'accepted';
          await updateInvitationRecord(invitation);
          res.json({
            status: 'success',
            data: existingMember,
            message: 'You are already a member of this workspace',
          });
          return;
        }
      }

      const addMemberResponse = await workspaceMembersApi.addWorkspaceMember({
        workspace_id: invitation.workspace_id,
        user_id: userId,
        role: invitation.role || 'member',
      }) as ApiResponse<WorkspaceMember>;

      if (addMemberResponse.status !== 'success') {
        res.status(500).json({ status: 'error', error: 'Failed to accept invitation' });
        return;
      }

      invitation.status = 'accepted';
      await updateInvitationRecord(invitation);

      logJson('info', 'invitation_accepted', {
        invitationId: invitation.id,
        workspaceId: invitation.workspace_id,
        userId,
        email: invitation.email,
      });

      res.json({
        status: 'success',
        data: addMemberResponse.data,
      });
    } catch (error) {
      console.error('Error in POST /api/invitations/:token/accept:', error);
      res.status(500).json({ status: 'error', message: 'Failed to accept invitation' });
    }
  }
);

export const invitationHelpers = {
  generateInviteToken,
  addInvitation,
  getInvitationByToken,
  removeInvitation,
  isInvitationExpired,
  getPendingInvitations,
  removeInvitationByEmail,
  updateInvitationRecord,
  toMySqlDatetime,
};

export default router;
