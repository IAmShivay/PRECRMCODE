import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';
import { canViewDeal } from '../types/permissions.js';
import { validate, createDealAssociationSchema } from '../utils/validation.js';
import { dealAssociationsApi, dealsApi } from '../services/api.js';
import { ApiResponse, AuthenticatedRequest } from '../types/index.js';
import { DEAL_ASSOCIATION_TYPES } from '../types/constants.js';

const router: Router = Router();

async function verifyDeal(workspaceId: number, dealId: number): Promise<any | null> {
  if (!Number.isFinite(dealId) || dealId <= 0) return null;
  try {
    const res = await dealsApi.getDealById(dealId) as any;
    const log = Array.isArray(res.data) ? res.data[0] : res.data;
    if (res.status !== 'success' || !log || Number(log.id) !== dealId || String(log.status || '') !== 'deal' || Number(log.workspace_id) !== workspaceId) return null;
    return log;
  } catch {
    return null;
  }
}

router.get(
  '/workspaces/:workspaceId/deals/:dealId/associations',
  authMiddleware,
  async (req: AuthenticatedRequest<{ workspaceId: string; dealId: string }>, res: Response<ApiResponse<any[]>>): Promise<void> => {
    try {
      const workspaceId = Number(req.params.workspaceId);
      const dealId = Number(req.params.dealId);
      const userId = Number(req.user?.id || 0);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0 || !Number.isFinite(dealId) || dealId <= 0) {
        res.status(400).json({ status: 'error', message: 'Invalid workspace or deal id' });
        return;
      }
      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        res.status(403).json({ status: 'error', message: 'Access denied' });
        return;
      }
      const deal = await verifyDeal(workspaceId, dealId);
      if (!deal) {
        res.status(404).json({ status: 'error', message: 'Deal not found' });
        return;
      }
      if (!canViewDeal(access, (deal as any).payload ? JSON.parse((deal as any).payload).owner_id : null, (deal as any).payload ? JSON.parse((deal as any).payload).pipeline_slug : undefined)) {
        const rawPayload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload;
        if (!canViewDeal(access, rawPayload?.owner_id, rawPayload?.pipeline_slug)) {
          res.status(403).json({ status: 'error', message: 'Access denied to deal' });
          return;
        }
      }
      const result = await dealAssociationsApi.getAssociations({ workspace_id: workspaceId, limit: 10000 }) as any;
      const rows = result.status === 'success' && Array.isArray(result.data) ? result.data : [];
      const filtered = rows.filter((row: any) => Number(row.workspace_id) === workspaceId && (Number(row.source_deal_id) === dealId || Number(row.target_deal_id) === dealId));
      res.json({ status: 'success', data: filtered });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message || 'Failed to load associations' });
    }
  }
);

router.post(
  '/deal-associations',
  authMiddleware,
  validate(createDealAssociationSchema),
  async (req: AuthenticatedRequest<{}, {}, { workspace_id: number; source_deal_id: number; target_deal_id: number; type?: string }>, res: Response<ApiResponse<any>>): Promise<void> => {
    try {
      const workspaceId = Number(req.body.workspace_id);
      const sourceId = Number(req.body.source_deal_id);
      const targetId = Number(req.body.target_deal_id);
      const type = req.body.type ? String(req.body.type) : DEAL_ASSOCIATION_TYPES[0];
      const userId = Number(req.user?.id || 0);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id required' });
        return;
      }
      if (sourceId === targetId) {
        res.status(400).json({ status: 'error', message: 'Cannot associate deal with itself' });
        return;
      }
      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        res.status(403).json({ status: 'error', message: 'Access denied' });
        return;
      }
      if (access.permissions.deals !== 'edit') {
        res.status(403).json({ status: 'error', message: 'Edit permission required' });
        return;
      }
      const sourceDeal = await verifyDeal(workspaceId, sourceId);
      const targetDeal = await verifyDeal(workspaceId, targetId);
      if (!sourceDeal || !targetDeal) {
        res.status(404).json({ status: 'error', message: 'One or both deals not found' });
        return;
      }
      const existing = await dealAssociationsApi.getAssociations({ workspace_id: workspaceId, limit: 10000 }) as any;
      const rows = existing.status === 'success' && Array.isArray(existing.data) ? existing.data : [];
      const duplicate = rows.find((row: any) => Number(row.workspace_id) === workspaceId && Number(row.source_deal_id) === sourceId && Number(row.target_deal_id) === targetId && String(row.type) === type);
      if (duplicate) {
        res.status(409).json({ status: 'error', message: 'Association already exists' });
        return;
      }
      const reverse = rows.find((row: any) => Number(row.workspace_id) === workspaceId && Number(row.source_deal_id) === targetId && Number(row.target_deal_id) === sourceId && String(row.type) === type);
      if (reverse) {
        res.status(409).json({ status: 'error', message: 'Reverse association already exists' });
        return;
      }
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const created = await dealAssociationsApi.createAssociation({
        workspace_id: workspaceId,
        source_deal_id: sourceId,
        target_deal_id: targetId,
        type,
        created_by: userId,
        created_at: now,
      }) as any;
      if (created.status !== 'success') {
        res.status(500).json({ status: 'error', message: created.error || 'Failed to create association' });
        return;
      }
      const id = Number(created.id || created.data?.id || 0);
      const payload = { id: id || undefined, workspace_id: workspaceId, source_deal_id: sourceId, target_deal_id: targetId, type, created_by: userId, created_at: now };
      res.json({ status: 'success', data: payload });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message || 'Failed to create association' });
    }
  }
);

router.delete(
  '/deal-associations/:id',
  authMiddleware,
  async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse<any>>): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const userId = Number(req.user?.id || 0);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', message: 'Invalid id' });
        return;
      }
      const existing = await dealAssociationsApi.getAssociationById(id) as any;
      const row = existing.status === 'success' ? (Array.isArray(existing.data) ? existing.data[0] : existing.data) : null;
      if (!row || Number(row.id) !== id) {
        res.status(404).json({ status: 'error', message: 'Association not found' });
        return;
      }
      const workspaceId = Number(row.workspace_id);
      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess || access.permissions.deals !== 'edit') {
        res.status(403).json({ status: 'error', message: 'Access denied' });
        return;
      }
      const del = await dealAssociationsApi.deleteAssociation(id) as any;
      if (del.status !== 'success') {
        res.status(500).json({ status: 'error', message: del.error || 'Failed to delete' });
        return;
      }
      res.json({ status: 'success', message: 'Deleted' });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message || 'Failed to delete' });
    }
  }
);

export default router;
