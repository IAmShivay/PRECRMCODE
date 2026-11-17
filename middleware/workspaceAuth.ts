import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest, AuthErrorResponse } from '../types/index.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';

export const workspaceAuthMiddleware = async (req: AuthenticatedRequest, res: Response<AuthErrorResponse>, next: NextFunction): Promise<void> => {
  const workspaceId = Number(req.params.workspaceId || req.body?.workspace_id || req.query.workspace_id);
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) {
    res.status(400).json({ success: false, status: 'error', error: 'Workspace ID is required' });
    return;
  }
  try {
    const access = await getWorkspaceAccess(Number(req.user?.id), workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ success: false, status: 'error', error: 'Access denied to this workspace' });
      return;
    }
    req.userRole = access.role!;
    req.workspaceAccess = true;
    req.workspacePermissions = access.permissions;
    next();
  } catch {
    res.status(503).json({ success: false, status: 'error', error: 'Unable to verify workspace access. Please try again.' });
  }
};
