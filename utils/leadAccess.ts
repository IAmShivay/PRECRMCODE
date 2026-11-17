import { leadsApi } from '../services/api.js';
import { ApiResponse, Lead } from '../types/index.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';
import type { WorkspaceAccess } from '../types/permissions.js';

export type LeadAccessResult =
  | { status: 'ok'; lead: Lead; workspaceAccess: WorkspaceAccess }
  | { status: 'not_found' | 'forbidden' };

export async function getLeadAccess(userId: number, leadId: number): Promise<LeadAccessResult> {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(leadId) || leadId <= 0) {
    return { status: 'not_found' };
  }

  const response = await leadsApi.getLeadById(leadId) as ApiResponse<Lead>;
  const lead = Array.isArray(response.data) ? response.data[0] : response.data;
  if (response.status !== 'success' || !lead || Number(lead.id) !== leadId) {
    return { status: 'not_found' };
  }

  const workspaceId = Number(lead.workspace_id);
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) {
    return { status: 'forbidden' };
  }

  const workspaceAccess = await getWorkspaceAccess(userId, workspaceId);
  return workspaceAccess.hasAccess ? { status: 'ok', lead, workspaceAccess } : { status: 'forbidden' };
}
