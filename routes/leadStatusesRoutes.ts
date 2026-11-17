import { Router, Response } from 'express';
import { leadStatusesApi, workspacesApi, workspaceMembersApi, leadsApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { ApiResponse, LeadStatus, LeadStatusCreateData, AuthenticatedRequest, AuthErrorResponse, Lead } from '../types/index.js';
import { validate, createLeadStatusSchema, updateLeadStatusSchema } from '../utils/validation.js';

const router: Router = Router();

interface StatusQuery {
  workspace_id: string;
}

const toArray = <T>(data?: T | T[] | null): T[] => {
  if (!data) {
    return [];
  }

  return Array.isArray(data) ? data : [data];
};

const getPreferredReplacementStatus = (
  statuses: LeadStatus[],
  deletedStatusId: number,
): LeadStatus | null => {
  const remainingStatuses = statuses
    .filter((status) => status.id !== deletedStatusId)
    .sort((left, right) => {
      const orderDifference = Number(left.order_index) - Number(right.order_index);
      if (orderDifference !== 0) {
        return orderDifference;
      }

      return Number(left.id) - Number(right.id);
    });

  if (remainingStatuses.length === 0) {
    return null;
  }

  return (
    remainingStatuses.find((status) => Number(status.is_default) === 1) ??
    remainingStatuses.find((status) => Number(status.is_active) === 1) ??
    remainingStatuses[0] ??
    null
  );
};

const reassignLeadsForDeletedStatus = async (
  workspaceId: number,
  fromStatusId: number,
  toStatusId: number,
): Promise<number> => {
  const leads: Lead[] = [];
  const pageSize = 200;
  let page = 1;

  while (true) {
    const leadsResponse = await leadsApi.getLeads({
      workspace_id: workspaceId,
      status_id: fromStatusId,
      page,
      limit: pageSize,
    }) as ApiResponse<Lead[]>;

    if (leadsResponse.status !== 'success') {
      throw new Error(
        leadsResponse.message ||
        leadsResponse.error ||
        'Failed to load leads for status reassignment'
      );
    }

    const pageLeads = toArray(leadsResponse.data).filter(
      (lead): lead is Lead => Boolean(lead) && Number.isFinite(Number(lead.id)) && Number(lead.id) > 0,
    );

    leads.push(...pageLeads);

    const hasMore = Boolean(leadsResponse.metadata?.hasMore);
    if (!hasMore && pageLeads.length < pageSize) {
      break;
    }

    if (pageLeads.length === 0) {
      break;
    }

    page += 1;
  }

  if (leads.length === 0) {
    return 0;
  }

  const batchSize = 25;

  for (let start = 0; start < leads.length; start += batchSize) {
    const batch = leads.slice(start, start + batchSize);
    const updateResults = await Promise.allSettled(
      batch.map((lead) =>
        leadsApi.updateLead(lead.id, { status_id: toStatusId }),
      ),
    );

    const failedLeadIds = updateResults.reduce<number[]>((accumulator, result, index) => {
      if (result.status === 'rejected') {
        const failedLeadId = batch[index]?.id;
        if (failedLeadId) {
          accumulator.push(failedLeadId);
        }
        return accumulator;
      }

      if (result.value.status !== 'success') {
        const failedLeadId = batch[index]?.id;
        if (failedLeadId) {
          accumulator.push(failedLeadId);
        }
      }

      return accumulator;
    }, []);

    if (failedLeadIds.length > 0) {
      throw new Error(
        `Failed to reassign ${failedLeadIds.length} lead(s) before deleting the status`,
      );
    }
  }

  return leads.length;
};

const enforceSingleDefaultStatus = async (workspaceId: number, keepStatusId?: number) => {
  try {
    const statusesResponse = await leadStatusesApi.getStatuses(workspaceId) as ApiResponse<LeadStatus[]>;
    if (statusesResponse.status !== 'success' || !Array.isArray(statusesResponse.data)) {
      return;
    }

    const defaultsToClear = statusesResponse.data.filter((status) =>
      status.is_default === 1 && status.id !== keepStatusId
    );

    if (defaultsToClear.length === 0) return;

    await Promise.all(
      defaultsToClear.map((status) =>
        leadStatusesApi.updateStatus(status.id, { is_default: 0 })
      )
    );
  } catch (error) {
    console.error('Failed to enforce single default status:', error);
  }
};

router.get('/', authMiddleware, async (req: AuthenticatedRequest<{}, StatusQuery>, res: Response<ApiResponse<LeadStatus[]>>): Promise<void> => {
  try {
    const { workspace_id } = req.query;
    
    if (!workspace_id) {
      res.status(400).json({
        status: 'error',
        message: 'workspace_id is required',
      });
      return;
    }

    const workspaceId: number = Number(workspace_id);
    const userId: number = Number(req.user?.id || 0);

    let hasAccess: boolean = false;
    try {
      const workspaceResponse = await workspacesApi.getWorkspaceById(workspaceId) as ApiResponse<any>;
      
      if (workspaceResponse.status === 'success' && workspaceResponse.data) {
        const workspace: any = Array.isArray(workspaceResponse.data) 
          ? workspaceResponse.data[0] 
          : workspaceResponse.data;
        
        if (workspace && Number(workspace.owner_id) === userId) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        try {
          const membersResponse = await workspaceMembersApi.getWorkspaceMembers(workspaceId) as ApiResponse<any[]>;
          if (membersResponse.status === 'success' && membersResponse.data) {
            const members: any[] = Array.isArray(membersResponse.data) 
              ? membersResponse.data 
              : [membersResponse.data];
            
            hasAccess = members.some((m: any) => Number(m.user_id) === userId);
          }
        } catch (err) {
          console.error('Error checking workspace membership:', err);
        }
      }
    } catch (workspaceError) {
      console.error('Error verifying workspace access:', workspaceError);
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Failed to verify workspace access',
      };
      res.status(500).json(errorResponse);
      return;
    }

    if (!hasAccess) {
      const accessDeniedResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have access to this workspace',
      };
      res.status(403).json(accessDeniedResponse);
      return;
    }

    let response: ApiResponse<LeadStatus[]>;
    try {
      response = await leadStatusesApi.getStatuses(workspaceId) as ApiResponse<LeadStatus[]>;
      res.json(response);
    } catch (apiError) {
      console.error('Error calling leadStatusesApi.getStatuses:', apiError);
      console.error('Error details:', {
        message: (apiError as Error).message,
        stack: (apiError as Error).stack,
        cause: (apiError as any).cause
      });
      const errorResponse: ApiResponse<LeadStatus[]> = {
        status: 'error', 
        message: (apiError as Error).message || 'Failed to load lead statuses from database' 
      };
      res.status(500).json(errorResponse);
    }
  } catch (error) {
    console.error('Error in /api/lead-statuses:', error);
    console.error('Error details:', {
      message: (error as Error).message,
      stack: (error as Error).stack,
      cause: (error as any).cause
    });
    const errorResponse: ApiResponse<LeadStatus[]> = { 
      status: 'error', 
      message: (error as Error).message || 'Failed to load lead statuses' 
    };
    res.status(500).json(errorResponse);
  }
});

router.post('/', authMiddleware, validate(createLeadStatusSchema), async (req: AuthenticatedRequest<{}, {}, LeadStatusCreateData>, res: Response<ApiResponse<LeadStatus>>): Promise<void> => {
  try {
    const { workspace_id } = req.body || {};
    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    req.params = { workspaceId: workspace_id.toString() };
    const { workspaceAuthMiddleware } = await import('../middleware/workspaceAuth.js');
    await new Promise<void>((resolve, reject) => {
      workspaceAuthMiddleware(req, res, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (req.userRole !== 'admin') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required to create lead statuses',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const response = await leadStatusesApi.createStatus(req.body) as ApiResponse<LeadStatus>;

    if (Number(req.body?.is_default) === 1 && response.status === 'success') {
      const createdStatusId =
        response.id ||
        (Array.isArray(response.data) ? response.data[0]?.id : (response.data as LeadStatus | undefined)?.id);
      await enforceSingleDefaultStatus(Number(workspace_id), createdStatusId);
    }

    res.json(response);
  } catch (error: any) {
    if (error.status === 403 || error.status === 401) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: error.message || 'Access denied',
      };
      res.status(error.status).json(errorResponse);
      return;
    }
    console.error('Error in POST /api/lead-statuses:', error);
    const errorResponse: ApiResponse<LeadStatus> = {
      status: 'error', 
      message: 'Failed to create lead status'
    };
    res.status(500).json(errorResponse);
  }
});

router.put('/:id', authMiddleware, validate(updateLeadStatusSchema), async (req: AuthenticatedRequest<{ id: string; workspaceId?: string }, {}, Partial<LeadStatusCreateData>>, res: Response<ApiResponse<LeadStatus>>): Promise<void> => {
  try {
    const { id } = req.params;
    const { workspace_id } = req.body || {};
    const { workspaceAuthMiddleware } = await import('../middleware/workspaceAuth.js');

    if (!workspace_id) {
      try {
        const statusResponse: ApiResponse<LeadStatus> = await leadStatusesApi.getStatusById(Number(id));
        if (statusResponse.status === 'success' && statusResponse.data) {
          const status: LeadStatus = Array.isArray(statusResponse.data)
            ? statusResponse.data[0]
            : statusResponse.data;
          req.body = { ...req.body, workspace_id: status.workspace_id };
        }
      } catch (err) {
        const errorResponse: AuthErrorResponse = {
          success: false,
          status: 'error',
          error: 'workspace_id is required',
        };
        res.status(400).json(errorResponse);
        return;
      }
    }

    // At this point, req.body.workspace_id is guaranteed to be set (either from original body or fetched)
    const finalWorkspaceId: number = req.body.workspace_id ?? workspace_id!;
    if (!finalWorkspaceId) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    req.params = { id, workspaceId: finalWorkspaceId.toString() };
    await new Promise<void>((resolve, reject) => {
      workspaceAuthMiddleware(req, res, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (req.userRole !== 'admin') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required to update lead statuses',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const statusCheckResponse: ApiResponse<LeadStatus> = await leadStatusesApi.getStatusById(Number(id));
    const statusRecord: LeadStatus | undefined = Array.isArray(statusCheckResponse.data)
      ? statusCheckResponse.data[0]
      : statusCheckResponse.data;
    if (statusCheckResponse.status !== 'success' || !statusRecord || Number(statusRecord.workspace_id) !== finalWorkspaceId) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead status does not belong to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const response = await leadStatusesApi.updateStatus(Number(id), req.body) as ApiResponse<LeadStatus>;

    if (Number(req.body?.is_default) === 1 && response.status === 'success') {
      await enforceSingleDefaultStatus(finalWorkspaceId, Number(id));
    }

    res.json(response);
  } catch (error: any) {
    if (error.status === 403 || error.status === 401) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: error.message || 'Access denied',
      };
      res.status(error.status).json(errorResponse);
      return;
    }
    console.error('Error in PUT /api/lead-statuses/:id:', error);
    const errorResponse: ApiResponse<LeadStatus> = {
      status: 'error', 
      message: 'Failed to update lead status'
    };
    res.status(500).json(errorResponse);
  }
});

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string; workspaceId?: string }>, res: Response<ApiResponse>): Promise<void> => {
  let promotedReplacementStatusId: number | null = null;

  try {
    const { id } = req.params;
    const statusId = Number(id);
    const { workspaceAuthMiddleware } = await import('../middleware/workspaceAuth.js');

    if (!Number.isFinite(statusId) || statusId <= 0) {
      const errorResponse: ApiResponse = {
        status: 'error',
        message: 'A valid lead status id is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    let workspaceId: number | null = null;
    let targetStatus: LeadStatus | null = null;
    try {
      const statusResponse: ApiResponse<LeadStatus> = await leadStatusesApi.getStatusById(statusId);
      if (statusResponse.status === 'success' && statusResponse.data) {
        targetStatus = toArray(statusResponse.data)[0] ?? null;
        workspaceId = targetStatus?.workspace_id ?? null;
      }
    } catch (err) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead status not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    if (!workspaceId || !targetStatus) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead status not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    req.params = { id, workspaceId: workspaceId.toString() };
    await new Promise<void>((resolve, reject) => {
      workspaceAuthMiddleware(req, res, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (req.userRole !== 'admin') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required to delete lead statuses',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const statusesResponse = await leadStatusesApi.getStatuses(workspaceId) as ApiResponse<LeadStatus[]>;
    if (statusesResponse.status !== 'success' || !statusesResponse.data) {
      const errorResponse: ApiResponse = {
        status: 'error',
        message: 'Failed to load workspace lead statuses before deletion',
      };
      res.status(500).json(errorResponse);
      return;
    }

    const workspaceStatuses = toArray(statusesResponse.data).filter(
      (status) => Number(status.workspace_id) === workspaceId,
    );

    if (workspaceStatuses.length <= 1) {
      const errorResponse: ApiResponse = {
        status: 'error',
        message: 'Cannot delete the last lead status in a workspace',
      };
      res.status(409).json(errorResponse);
      return;
    }

    const replacementStatus = getPreferredReplacementStatus(workspaceStatuses, statusId);
    if (!replacementStatus) {
      const errorResponse: ApiResponse = {
        status: 'error',
        message: 'No replacement lead status is available for reassignment',
      };
      res.status(409).json(errorResponse);
      return;
    }

    await reassignLeadsForDeletedStatus(workspaceId, statusId, replacementStatus.id);

    const shouldPromoteReplacement =
      Number(targetStatus.is_default) === 1 && Number(replacementStatus.is_default) !== 1;

    if (shouldPromoteReplacement) {
      const promoteResponse = await leadStatusesApi.updateStatus(replacementStatus.id, { is_default: 1 }) as ApiResponse<LeadStatus>;
      if (promoteResponse.status !== 'success') {
        const errorResponse: ApiResponse = {
          status: 'error',
          message: promoteResponse.message || 'Failed to promote a replacement default status',
        };
        res.status(500).json(errorResponse);
        return;
      }

      promotedReplacementStatusId = replacementStatus.id;
    }

    const response = await leadStatusesApi.deleteStatus(statusId) as ApiResponse<any>;
    if (response.status !== 'success') {
      const deleteError = new Error(response.message || response.error || 'Failed to delete lead status');
      (deleteError as Error & { status?: number }).status = 500;
      throw deleteError;
    }

    if (Number(targetStatus.is_default) === 1) {
      await enforceSingleDefaultStatus(workspaceId, replacementStatus.id);
    }

    res.json(response);
  } catch (error: any) {
    if (promotedReplacementStatusId !== null) {
      try {
        await leadStatusesApi.updateStatus(promotedReplacementStatusId, { is_default: 0 });
      } catch (rollbackError) {
        console.error('Failed to rollback replacement default status after delete error:', rollbackError);
      }
    }

    if (error.status === 403 || error.status === 401) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: error.message || 'Access denied',
      };
      res.status(error.status).json(errorResponse);
      return;
    }
    console.error('Error in DELETE /api/lead-statuses/:id:', error);
    const errorResponse: ApiResponse = {
      status: 'error', 
      message: error.message || 'Failed to delete lead status'
    };
    res.status(500).json(errorResponse);
  }
});

export default router;
