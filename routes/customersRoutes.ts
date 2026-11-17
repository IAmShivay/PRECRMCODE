import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getCustomersForWorkspace,
  InvalidCustomerOrderError,
  InvalidCustomerProfileError,
  updateCustomerProfile,
} from '../services/customers.js';
import { ApiResponse, AuthenticatedRequest, Customer, CustomerProfileUpdate } from '../types/index.js';
import { updateCustomerProfileSchema, validate } from '../utils/validation.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';
import { isElevatedRole } from '../types/permissions.js';

const router: Router = Router();

router.get('/', authMiddleware, async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Customer[]>>
): Promise<void> => {
  try {
    const workspaceId = Number(req.query.workspace_id);
    if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ status: 'error', message: 'Valid workspace_id is required' });
      return;
    }

    const access = await getWorkspaceAccess(Number(req.user?.id), workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ status: 'error', message: 'Access denied to this workspace' });
      return;
    }

    const customers = await getCustomersForWorkspace(workspaceId, access);
    res.json({ status: 'success', data: customers });
  } catch (error) {
    console.error('Error in GET /api/customers:', error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ status: 'error', message: 'Failed to load customers' });
  }
});

router.put('/:customerId', authMiddleware, validate(updateCustomerProfileSchema), async (
  req: AuthenticatedRequest<{ customerId: string }, {}, CustomerProfileUpdate>,
  res: Response<ApiResponse<Customer>>
): Promise<void> => {
  try {
    const workspaceId = Number(req.body.workspace_id);
    const customerId = req.params.customerId;
    if (!/^(lead|deal):[1-9]\d*$/.test(customerId)) {
      res.status(400).json({ status: 'error', message: 'Invalid customer id' });
      return;
    }

    const access = await getWorkspaceAccess(Number(req.user?.id), workspaceId);
    if (!access.hasAccess) {
      res.status(403).json({ status: 'error', message: 'Access denied to this workspace' });
      return;
    }

    if (!isElevatedRole(access.role)) { res.status(403).json({ status: 'error', message: 'Only workspace admins and managers can edit shared customer profiles' }); return; }
    const customer = await updateCustomerProfile(workspaceId, customerId, req.body);
    if (!customer) {
      res.status(404).json({ status: 'error', message: 'Customer not found' });
      return;
    }
    res.json({ status: 'success', data: customer });
  } catch (error) {
    if (error instanceof InvalidCustomerOrderError || error instanceof InvalidCustomerProfileError) {
      res.status(400).json({ status: 'error', message: error.message });
      return;
    }
    console.error('Error in PUT /api/customers/:customerId:', error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ status: 'error', message: 'Failed to save customer' });
  }
});

export default router;
