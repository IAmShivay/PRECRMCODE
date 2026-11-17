import {
  WorkspaceRole,
  DealsPermission,
  DealsScope,
  ConversationsPermission,
  ROLE_OWNER,
  ROLE_ADMIN,
  ROLE_MANAGER,
  DEALS_PERM_NONE,
  DEALS_PERM_VIEW,
  DEALS_PERM_EDIT,
  DEALS_SCOPE_ASSIGNED,
  DEALS_SCOPE_ALL,
  CONV_PERM_VIEW,
  CONV_PERM_REPLY,
  PIPELINES_ALL,
} from './constants.js';

export interface WorkspacePermissions {
  deals: DealsPermission;
  deals_scope?: DealsScope;
  pipelines?: typeof PIPELINES_ALL | string[];
  conversations: ConversationsPermission;
}

export interface WorkspaceAccess {
  workspace_id: number;
  user_id: number;
  hasAccess: boolean;
  role: WorkspaceRole | null;
  member_id?: number;
  permissions: WorkspacePermissions;
}

export const DEFAULT_MEMBER_PERMISSIONS: WorkspacePermissions = {
  deals: DEALS_PERM_VIEW,
  deals_scope: DEALS_SCOPE_ASSIGNED,
  pipelines: PIPELINES_ALL,
  conversations: CONV_PERM_VIEW,
};

export const ADMIN_PERMISSIONS: WorkspacePermissions = {
  deals: DEALS_PERM_EDIT,
  deals_scope: DEALS_SCOPE_ALL,
  pipelines: PIPELINES_ALL,
  conversations: CONV_PERM_REPLY,
};

export const MANAGER_PERMISSIONS: WorkspacePermissions = {
  deals: DEALS_PERM_EDIT,
  deals_scope: DEALS_SCOPE_ALL,
  pipelines: PIPELINES_ALL,
  conversations: CONV_PERM_REPLY,
};

export const VIEWER_PERMISSIONS: WorkspacePermissions = {
  deals: DEALS_PERM_VIEW,
  deals_scope: DEALS_SCOPE_ALL,
  pipelines: PIPELINES_ALL,
  conversations: CONV_PERM_VIEW,
};

export function isElevatedRole(role: WorkspaceRole | null): boolean {
  return role === ROLE_OWNER || role === ROLE_ADMIN || role === ROLE_MANAGER;
}

export function hasPipelineAccess(access: WorkspaceAccess, pipelineSlug?: string): boolean {
  if (!access.hasAccess) return false;
  if (isElevatedRole(access.role)) return true;
  
  const pipelines = access.permissions.pipelines;
  if (pipelineSlug && pipelines !== PIPELINES_ALL && Array.isArray(pipelines)) {
    return pipelines.includes(pipelineSlug);
  }
  
  return true;
}

export function canViewDeal(access: WorkspaceAccess, ownerId: unknown, pipelineSlug?: string): boolean {
  if (!hasPipelineAccess(access, pipelineSlug)) return false;
  if (isElevatedRole(access.role)) return true;
  if (access.permissions.deals === DEALS_PERM_NONE) return false;
  if (access.permissions.deals_scope === DEALS_SCOPE_ALL) return true;
  
  const parsedOwnerId = Number(ownerId);
  return !Number.isNaN(parsedOwnerId) && parsedOwnerId !== 0 && parsedOwnerId === access.user_id;
}

export function canEditDeal(access: WorkspaceAccess, ownerId: unknown, pipelineSlug?: string): boolean {
  if (!hasPipelineAccess(access, pipelineSlug)) return false;
  if (isElevatedRole(access.role)) return true;
  if (access.permissions.deals !== DEALS_PERM_EDIT) return false;
  if (access.permissions.deals_scope === DEALS_SCOPE_ALL) return true;
  
  const parsedOwnerId = Number(ownerId);
  return !Number.isNaN(parsedOwnerId) && parsedOwnerId !== 0 && parsedOwnerId === access.user_id;
}

export function canDeleteDeal(access: WorkspaceAccess, ownerId: unknown, pipelineSlug?: string): boolean {
  if (!hasPipelineAccess(access, pipelineSlug)) return false;
  if (isElevatedRole(access.role)) return true;
  if (access.permissions.deals !== DEALS_PERM_EDIT) return false;
  if (access.permissions.deals_scope === DEALS_SCOPE_ALL) return true;
  
  const parsedOwnerId = Number(ownerId);
  return !Number.isNaN(parsedOwnerId) && parsedOwnerId !== 0 && parsedOwnerId === access.user_id;
}

export function canViewLead(access: WorkspaceAccess, assigneeId: unknown): boolean {
  if (isElevatedRole(access.role)) return true;
  if (access.permissions.deals === DEALS_PERM_NONE) return false;
  if (access.permissions.deals_scope === DEALS_SCOPE_ALL) return true;

  const parsedAssigneeId = Number(assigneeId);
  return !Number.isNaN(parsedAssigneeId) && parsedAssigneeId !== 0 && parsedAssigneeId === access.user_id;
}

export function canEditLead(access: WorkspaceAccess, assigneeId: unknown): boolean {
  if (isElevatedRole(access.role)) return true;
  if (access.permissions.deals !== DEALS_PERM_EDIT) return false;
  if (access.permissions.deals_scope === DEALS_SCOPE_ALL) return true;

  const parsedAssigneeId = Number(assigneeId);
  return !Number.isNaN(parsedAssigneeId) && parsedAssigneeId !== 0 && parsedAssigneeId === access.user_id;
}

export function canViewConversations(access: WorkspaceAccess): boolean {
  if (!access.hasAccess) return false;
  if (isElevatedRole(access.role)) return true;
  
  return access.permissions.conversations === CONV_PERM_VIEW || access.permissions.conversations === CONV_PERM_REPLY;
}

export function canReplyConversations(access: WorkspaceAccess): boolean {
  if (!access.hasAccess) return false;
  if (isElevatedRole(access.role)) return true;
  
  return access.permissions.conversations === CONV_PERM_REPLY;
}
