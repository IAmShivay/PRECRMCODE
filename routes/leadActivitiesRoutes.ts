import { Router, Response } from 'express';
import { leadActivitiesApi, usersApi, workspaceMembersApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { ApiResponse, LeadActivity, CreateActivityBody, UpdateActivityBody, AuthenticatedRequest } from '../types/index.js';
import { validate, createActivitySchema, updateActivitySchema } from '../utils/validation.js';
import { getLeadAccess } from '../utils/leadAccess.js';
import { activityDealId, canChangeActivity, isConversationActivity, visibleActivityDeals } from '../services/activityPermissions.js';

const router: Router = Router();

router.get('/leads/:id/activities', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse<LeadActivity[]>>): Promise<void> => {
  try {
    const { id } = req.params;
    const access = await getLeadAccess(Number(req.user?.id), Number(id));
    if (access.status !== 'ok') {
      res.status(access.status === 'not_found' ? 404 : 403).json({ status: 'error', message: 'Lead not found or access denied' });
      return;
    }
    const response = await leadActivitiesApi.getActivities(Number(id)) as ApiResponse<LeadActivity[]>;
    if (response.status === 'success') {
      const activities: LeadActivity[] = Array.isArray(response.data)
        ? response.data
        : response.data ? [response.data as LeadActivity] : [];
      response.data = activities.filter((activity) =>
        Number(activity.lead_id) === Number(id) &&
        Number(activity.workspace_id) === Number(access.lead.workspace_id)
      );
      if (access.workspaceAccess.role !== 'admin') {
        const visibleDeals = response.data.some((activity) => activity.type.startsWith('deal'))
          ? await visibleActivityDeals(access.workspaceAccess) : new Set<number>();
        response.data = response.data.filter((activity) =>
          (!isConversationActivity(activity.type) || access.workspaceAccess.permissions.conversations !== 'none') &&
          (!activity.type.startsWith('deal') || visibleDeals.has(activityDealId(activity)))
        );
      }
    }
    if (response.status === 'success' && Array.isArray(response.data) && response.data.length > 0) {
      const workspaceId = Number(access.lead.workspace_id);

      const roleByUserId = new Map<number, string>();
      if (workspaceId) {
        const membersRes = await workspaceMembersApi.getWorkspaceMembers(workspaceId).catch(() => ({ status: 'error', data: null } as any));
        if (membersRes.status === 'success' && Array.isArray(membersRes.data)) {
          for (const member of membersRes.data) {
            if (member?.user_id) roleByUserId.set(Number(member.user_id), String(member.role));
          }
        }
      }

      const uniqueUserIds = Array.from(
        new Set(
          response.data
            .map((a: any) => Number(a.user_id))
            .filter((n: number) => Number.isFinite(n) && n > 0)
        )
      );

      const nameByUserId = new Map<number, string>();
      const userFetches = uniqueUserIds.map(async (userId: number) => {
        const userRes = await usersApi.getUserById(userId).catch(() => ({ status: 'error', data: null } as any));
        if (userRes.status !== 'success' || !userRes.data) return;
        const userData: any = Array.isArray(userRes.data) ? userRes.data[0] : userRes.data;
        const name = userData?.name || userData?.email || `User ${userId}`;
        nameByUserId.set(userId, name);
      });
      await Promise.all(userFetches);

      response.data = response.data.map((activity: any) => {
        const userId = Number(activity.user_id);
        const role = roleByUserId.get(userId);
        const actorRole = role === 'owner' || role === 'admin' || role === 'member' ? role : undefined;
        const actorName = nameByUserId.get(userId) || `User ${userId}`;
        return {
          ...activity,
          actor_name: actorName,
          actor_role: actorRole,
        };
      }) as any;
    }
    res.json(response);
  } catch (error) {
    console.error('Error in GET /api/leads/:id/activities:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load lead activities' });
  }
});

router.post('/leads/:id/activities', authMiddleware, validate(createActivitySchema), async (req: AuthenticatedRequest<{ id: string }, {}, CreateActivityBody>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const leadId = Number(req.params.id);
    const access = await getLeadAccess(Number(req.user?.id), leadId);
    if (access.status !== 'ok') {
      res.status(access.status === 'not_found' ? 404 : 403).json({ status: 'error', message: 'Lead not found or access denied' });
      return;
    }
    if (Number(req.body.lead_id) !== leadId || Number(req.body.workspace_id) !== Number(access.lead.workspace_id)) {
      res.status(400).json({ status: 'error', message: 'Activity lead and workspace must match the requested lead' });
      return;
    }
    let activity: CreateActivityBody = req.body || {} as CreateActivityBody;
    if (!await canChangeActivity(access.workspaceAccess, activity)) {
      res.status(403).json({ status: 'error', message: 'You do not have permission to change this activity' });
      return;
    }
    activity.user_id = Number(req.user?.id);
    
    if (activity.created_at) {
      const date: Date = new Date(activity.created_at);
      if (!isNaN(date.getTime())) {
        activity.created_at = date.toISOString().slice(0, 19).replace('T', ' ');
      }
    } else {
      const now: Date = new Date();
      activity.created_at = now.toISOString().slice(0, 19).replace('T', ' ');
    }
    
    if (activity.metadata && typeof activity.metadata === 'object') {
      activity.metadata = JSON.stringify(activity.metadata);
    }
    
    const response = await leadActivitiesApi.createActivity(activity as LeadActivity) as ApiResponse<LeadActivity>;
    res.json(response);
  } catch (error) {
    console.error('Error in POST /api/leads/:id/activities:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create lead activity' });
  }
});

router.put('/lead-activities/:activityId', authMiddleware, validate(updateActivitySchema), async (req: AuthenticatedRequest<{ activityId: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { activityId } = req.params;
    const activityResponse = await leadActivitiesApi.getActivityById(Number(activityId));
    const activity = Array.isArray(activityResponse.data) ? activityResponse.data[0] : activityResponse.data;
    if (activityResponse.status !== 'success' || !activity || Number(activity.id) !== Number(activityId)) {
      res.status(404).json({ status: 'error', message: 'Activity not found' });
      return;
    }
    const access = await getLeadAccess(Number(req.user?.id), Number(activity.lead_id));
    if (access.status !== 'ok' || Number(access.lead.workspace_id) !== Number(activity.workspace_id)) {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }
    if (!await canChangeActivity(access.workspaceAccess, activity) || !await canChangeActivity(access.workspaceAccess, { ...activity, ...req.body })) {
      res.status(403).json({ status: 'error', message: 'You do not have permission to change this activity' });
      return;
    }
    const response = await leadActivitiesApi.updateActivity(Number(activityId), req.body as UpdateActivityBody) as ApiResponse<LeadActivity>;
    res.json(response);
  } catch (error) {
    console.error('Error in PUT /api/lead-activities/:activityId:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update lead activity' });
  }
});

router.delete('/lead-activities/:activityId', authMiddleware, async (req: AuthenticatedRequest<{ activityId: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { activityId } = req.params;
    const activityResponse = await leadActivitiesApi.getActivityById(Number(activityId));
    const activity = Array.isArray(activityResponse.data) ? activityResponse.data[0] : activityResponse.data;
    if (activityResponse.status !== 'success' || !activity || Number(activity.id) !== Number(activityId)) {
      res.status(404).json({ status: 'error', message: 'Activity not found' });
      return;
    }
    const access = await getLeadAccess(Number(req.user?.id), Number(activity.lead_id));
    if (access.status !== 'ok' || Number(access.lead.workspace_id) !== Number(activity.workspace_id)) {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }
    if (!await canChangeActivity(access.workspaceAccess, activity)) {
      res.status(403).json({ status: 'error', message: 'You do not have permission to change this activity' });
      return;
    }
    const response = await leadActivitiesApi.deleteActivity(Number(activityId)) as ApiResponse<any>;
    res.json(response);
  } catch (error) {
    console.error('Error in DELETE /api/lead-activities/:activityId:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete lead activity' });
  }
});

export default router;
