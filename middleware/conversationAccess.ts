import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';

export function conversationAccess(mode: 'view' | 'reply') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Workspace middleware already loaded fresh membership and permissions for this request.
      const permissions = req.workspaceAccess && req.workspacePermissions
        ? req.workspacePermissions
        : (await getWorkspaceAccess(Number(req.user?.id), Number(req.params.workspaceId))).permissions;
      const allowed = mode === 'reply' ? permissions.conversations === 'reply' : permissions.conversations !== 'none';
      if (!allowed) {
        res.status(403).json({ status: 'error', message: mode === 'reply' ? 'Your conversation access is view only. Ask an administrator for reply access.' : 'Conversation access is disabled for your account.' });
        return;
      }
      req.workspacePermissions = permissions;
      next();
    } catch { res.status(503).json({ status: 'error', message: 'Unable to verify conversation permissions. Please try again.' }); }
  };
}
