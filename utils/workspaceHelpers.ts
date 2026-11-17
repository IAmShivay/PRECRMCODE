import { getWorkspaceAccess } from '../services/workspacePermissions.js';
import type { WorkspaceAccess } from '../types/permissions.js';

export async function verifyWorkspaceAccess(userId: number, workspaceId: number): Promise<WorkspaceAccess> {
  return getWorkspaceAccess(userId, workspaceId);
}

export async function verifyWorkspaceAdmin(userId: number, workspaceId: number): Promise<boolean> {
  const access = await getWorkspaceAccess(userId, workspaceId);
  return access.role === 'admin' || access.role === 'owner';
}
