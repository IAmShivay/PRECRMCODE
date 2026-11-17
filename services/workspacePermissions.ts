import { webhookLogsApi, workspaceMembersApi, workspacesApi } from './api.js';
import { workspacePermissionsSchema } from '../utils/validation.js';
import { ADMIN_PERMISSIONS, DEFAULT_MEMBER_PERMISSIONS, MANAGER_PERMISSIONS, VIEWER_PERMISSIONS, type WorkspaceAccess, type WorkspacePermissions } from '../types/permissions.js';
import type { StoredDealLog, WorkspaceMember } from '../types/index.js';

const STATUS = 'member_perms';
interface PermissionRecord extends StoredDealLog { source?: string; event_id?: string; }
const rows = <T>(value: T | T[] | undefined): T[] => Array.isArray(value) ? value : value ? [value] : [];

export async function workspacePermissionRecords(workspaceId: number): Promise<PermissionRecord[]> {
  const result: PermissionRecord[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await webhookLogsApi.getWebhookLogs({ workspace_id: workspaceId, status: STATUS, source: STATUS, limit: 200, page, bypassCache: true });
    if (response.status !== 'success' || !Array.isArray(response.data)) throw new Error('Unable to verify workspace permissions');
    const batch = rows(response.data) as PermissionRecord[];
    result.push(...batch.filter((row) => Number(row.workspace_id) === workspaceId && row.status === STATUS && row.source === STATUS));
    if (batch.length < 200) return result;
  }
  throw new Error('Unable to load complete workspace permissions');
}

export function memberPermissions(member: WorkspaceMember, records: PermissionRecord[]): WorkspacePermissions {
  if (member.role === 'admin' || member.role === 'owner') return { ...ADMIN_PERMISSIONS };
  const latest = records.filter((record) => record.event_id === `member_permissions_${member.id}_${member.user_id}` || record.event_id === `perm_${member.id}`)
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!latest) return { ...DEFAULT_MEMBER_PERMISSIONS };
  const payload = typeof latest.payload === 'string' ? JSON.parse(latest.payload) : latest.payload;
  if (!payload || Number(payload.member_id) !== Number(member.id) || Number(payload.user_id) !== Number(member.user_id)) throw new Error('Invalid workspace permissions');
  return workspacePermissionsSchema.parse(payload.permissions);
}

export async function getWorkspaceAccess(userId: number, workspaceId: number): Promise<WorkspaceAccess> {
  const access: WorkspaceAccess = { workspace_id: workspaceId, user_id: userId, hasAccess: false, role: null, permissions: { deals: 'none', conversations: 'none' } };
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) return access;
  const workspaceResponse = await workspacesApi.getWorkspaceById(workspaceId, true);
  if (workspaceResponse.status !== 'success') throw new Error('Unable to verify workspace access');
  const workspace = rows(workspaceResponse.data).find((item) => Number(item.id) === workspaceId);
  if (!workspace) return access;
  if (Number(workspace.owner_id) === userId) return { ...access, hasAccess: true, role: 'admin', permissions: { ...ADMIN_PERMISSIONS } };
  const response = await workspaceMembersApi.getWorkspaceMembers({ workspace_id: workspaceId, user_id: userId, limit: 10000, bypassCache: true });
  if (response.status !== 'success') throw new Error('Unable to verify workspace membership');
  const member = rows(response.data).find((item) => Number(item.workspace_id) === workspaceId && Number(item.user_id) === userId);
  if (!member) return access;
  let effectiveRole: WorkspaceAccess['role'] = 'member';
  if (member.role === 'owner' || member.role === 'admin') effectiveRole = 'admin';
  else if (member.role === 'manager') effectiveRole = 'manager';
  else if (member.role === 'viewer') effectiveRole = 'viewer';

  let perms: WorkspacePermissions;
  if (effectiveRole === 'admin') perms = { ...ADMIN_PERMISSIONS };
  else if (effectiveRole === 'manager') perms = { ...MANAGER_PERMISSIONS };
  else if (effectiveRole === 'viewer') perms = { ...VIEWER_PERMISSIONS };
  else perms = memberPermissions(member, await workspacePermissionRecords(workspaceId));

  return { ...access, hasAccess: true, member_id: member.id, role: effectiveRole, permissions: perms };
}

export async function saveMemberPermissions(workspaceId: number, member: WorkspaceMember, permissions: WorkspacePermissions): Promise<void> {
  const records = await workspacePermissionRecords(workspaceId);
  const eventId = `perm_${member.id}`;
  const existing = records.filter((record) => record.event_id === eventId).sort((a, b) => Number(b.id) - Number(a.id))[0];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const body = { workspace_id: workspaceId, lead_id: 0, status: STATUS, source: STATUS, event_id: eventId,
    payload: JSON.stringify({ member_id: member.id, user_id: member.user_id, permissions, updated_at: now }), created_at: existing?.created_at || now };
  const response = existing?.id ? await webhookLogsApi.updateWebhookLog(existing.id, body) : await webhookLogsApi.createWebhookLog(body);
  if (response.status !== 'success') {
    console.error('Failed to save member permissions:', response);
    throw new Error('Failed to save member permissions');
  }
}

export async function validDealAssignee(workspaceId: number, userId: number): Promise<boolean> {
  return (await getWorkspaceAccess(userId, workspaceId)).hasAccess;
}
