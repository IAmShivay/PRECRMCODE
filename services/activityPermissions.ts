import { dealsApi } from './api.js';
import { canViewDeal, type WorkspaceAccess } from '../types/permissions.js';

export function isConversationActivity(type: string): boolean {
  return /^(email|whatsapp|call|instagram|message|communication)(_|$)/i.test(type);
}

export function activityDealId(activity: { metadata?: unknown }): number {
  try {
    const metadata = typeof activity.metadata === 'string' ? JSON.parse(activity.metadata) : activity.metadata;
    return Number(metadata && typeof metadata === 'object' && 'deal_id' in metadata ? metadata.deal_id : NaN);
  } catch { return NaN; }
}

export async function visibleActivityDeals(access: WorkspaceAccess): Promise<Set<number>> {
  const response = await dealsApi.getDeals({ workspace_id: access.workspace_id, limit: 10000 });
  if (response.status !== 'success') throw new Error('Unable to verify deal access');
  const visible = new Set<number>();
  for (const row of (Array.isArray(response.data) ? response.data : response.data ? [response.data] : []) as any[]) {
    if (Number(row.workspace_id) !== access.workspace_id || row.status !== 'deal') continue;
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (canViewDeal(access, payload?.owner_id, payload?.pipeline_slug ? String(payload.pipeline_slug) : 'default')) visible.add(Number(row.id));
    } catch { /* Malformed records cannot grant access. */ }
  }
  return visible;
}

export async function canChangeActivity(access: WorkspaceAccess, activity: { type: string; metadata?: unknown }): Promise<boolean> {
  if (access.role === 'admin') return true;
  if (isConversationActivity(activity.type)) return access.permissions.conversations === 'reply';
  if (activity.type.startsWith('deal')) {
    return access.permissions.deals === 'edit' && (await visibleActivityDeals(access)).has(activityDealId(activity));
  }
  return true;
}
