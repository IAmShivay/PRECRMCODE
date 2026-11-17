import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { leadsApi } from '../services/api.js';
import { getProspectsForWorkspace, ProspectAlreadyCustomerError, setProspectSelection } from '../services/prospects.js';
import { ApiResponse, AuthenticatedRequest, Lead, ProspectsView } from '../types/index.js';
import { selectProspectSchema, validate } from '../utils/validation.js';
import { verifyWorkspaceAccess } from '../utils/workspaceHelpers.js';
import { canEditLead, canViewLead, type WorkspaceAccess } from '../types/permissions.js';

const router: Router = Router();

router.get('/', authMiddleware, async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ProspectsView>>
): Promise<void> => {
  try {
    const workspaceId = Number(req.query.workspace_id);
    if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ status: 'error', message: 'Valid workspace_id is required' });
      return;
    }
    const access: WorkspaceAccess = await verifyWorkspaceAccess(Number(req.user?.id), workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ status: 'error', message: 'Access denied to this workspace' });
      return;
    }
    const view = await getProspectsForWorkspace(workspaceId);
    res.json({ status: 'success', data: {
      prospects: view.prospects.filter((prospect) => canViewLead(access, (prospect.lead as any)?.user_id)),
      candidates: view.candidates.filter((lead) => canViewLead(access, (lead as any)?.user_id)),
    } });
  } catch (error) {
    console.error('Error in GET /api/prospects:', error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ status: 'error', message: 'Failed to load prospects' });
  }
});

router.put('/:leadId', authMiddleware, validate(selectProspectSchema), async (
  req: AuthenticatedRequest<{ leadId: string }, {}, { workspace_id: number; selected: boolean }>,
  res: Response<ApiResponse<{ selected: boolean }>>
): Promise<void> => {
  try {
    const leadId = Number(req.params.leadId);
    if (!Number.isSafeInteger(leadId) || leadId <= 0) {
      res.status(400).json({ status: 'error', message: 'Invalid lead id' });
      return;
    }
    const workspaceId = Number(req.body.workspace_id);
    const access: WorkspaceAccess = await verifyWorkspaceAccess(Number(req.user?.id), workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ status: 'error', message: 'Access denied to this workspace' });
      return;
    }
    const leadResponse = await leadsApi.getLeadById(leadId) as ApiResponse<Lead>;
    const lead = Array.isArray(leadResponse.data) ? leadResponse.data[0] : leadResponse.data;
    if (leadResponse.status !== 'success' || !lead || Number(lead.workspace_id) !== workspaceId) {
      res.status(404).json({ status: 'error', message: 'Lead not found' });
      return;
    }
    if (!canEditLead(access, (lead as any)?.user_id)) {
      res.status(403).json({ status: 'error', message: 'Access denied: You do not have permission to modify this prospect' });
      return;
    }
    await setProspectSelection(workspaceId, leadId, req.body.selected);
    res.json({ status: 'success', data: { selected: req.body.selected } });
  } catch (error) {
    if (error instanceof ProspectAlreadyCustomerError) {
      res.status(409).json({ status: 'error', message: error.message });
      return;
    }
    if (error instanceof Error && error.message === 'Lead not found') {
      res.status(404).json({ status: 'error', message: 'Lead not found' });
      return;
    }
    console.error('Error in PUT /api/prospects/:leadId:', error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ status: 'error', message: 'Failed to save prospect selection' });
  }
});

export default router;
