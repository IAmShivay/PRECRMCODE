import { dealAssociationsApi, dealsApi } from './api.js';

export async function getDealOrNull(id: number): Promise<any | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const res = await dealsApi.getDealById(id) as any;
    const log = Array.isArray(res.data) ? res.data[0] : res.data;
    if (res.status !== 'success' || !log || Number(log.id) !== id || String(log.status || '') !== 'deal') return null;
    return log;
  } catch {
    return null;
  }
}

export async function listAssociationsForDeal(workspaceId: number, dealId: number): Promise<any[]> {
  const res = await dealAssociationsApi.getAssociations({ workspace_id: workspaceId, deal_id: dealId }) as any;
  if (res.status !== 'success' || !Array.isArray(res.data)) return [];
  const all = res.data.filter((row: any) => Number(row.workspace_id) === workspaceId);
  return all.filter((row: any) => Number(row.source_deal_id) === dealId || Number(row.target_deal_id) === dealId);
}

export async function listAllAssociationsForWorkspace(workspaceId: number): Promise<any[]> {
  const res = await dealAssociationsApi.getAssociations({ workspace_id: workspaceId }) as any;
  if (res.status !== 'success' || !Array.isArray(res.data)) return [];
  return res.data.filter((row: any) => Number(row.workspace_id) === workspaceId);
}
