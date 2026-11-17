import { Router, Response } from 'express';
import {
  customFieldsApi,
  customFieldValuesApi,
  leadsApi,
} from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { verifyWorkspaceAccess } from '../utils/workspaceHelpers.js';
import { getLeadAccess } from '../utils/leadAccess.js';
import {
  ApiResponse,
  CustomField,
  CustomFieldCreateData,
  CustomFieldValue,
  AuthenticatedRequest,
  AuthErrorResponse
} from '../types/index.js';
import {
  validate,
  createCustomFieldSchema,
  updateCustomFieldSchema,
  createCustomFieldValueSchema,
  updateCustomFieldValueSchema,
} from '../utils/validation.js';

const router: Router = Router();

function fieldBelongsToWorkspace(
  response: ApiResponse<CustomField[]>,
  fieldId: number,
  workspaceId: number
): boolean {
  if (response.status !== 'success') return false;
  const fields: CustomField[] = Array.isArray(response.data)
    ? response.data
    : response.data ? [response.data as CustomField] : [];
  return fields.some((field) =>
    Number(field.id) === fieldId && Number(field.workspace_id) === workspaceId
  );
}

// Helper function to properly handle workspaceAuthMiddleware when called dynamically
const callWorkspaceAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  workspaceId: number
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    // Store original workspaceId
    const originalWorkspaceId = req.params.workspaceId;
    
    // Set workspaceId for middleware
    req.params.workspaceId = workspaceId.toString();
    
    let resolved = false;
    const doResolve = (value: boolean) => {
      if (!resolved) {
        resolved = true;
        req.params.workspaceId = originalWorkspaceId;
        resolve(value);
      }
    };
    
    // Call middleware
    workspaceAuthMiddleware(req, res, (err: any) => {
      // Middleware called next() - check if response was sent
      if (err) {
        doResolve(false);
      } else if (res.headersSent) {
        doResolve(false);
      } else {
        doResolve(true); // Middleware passed, continue
      }
    });
    
    // Check if response was sent synchronously (middleware sends response directly)
    // Use setImmediate to check after current call stack
    setImmediate(() => {
      if (!resolved) {
        if (res.headersSent) {
          doResolve(false);
        } else {
          // If no response was sent and we haven't resolved, middleware likely called next()
          // Wait a bit more to be sure
          setTimeout(() => {
            if (!resolved) {
              doResolve(!res.headersSent);
            }
          }, 10);
        }
      }
    });
  });
};

router.get('/workspaces/:workspaceId/custom-fields', authMiddleware, workspaceAuthMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string }>, res: Response<ApiResponse<CustomField[]>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const response = await customFieldsApi.getCustomFields(Number(workspaceId)) as ApiResponse<CustomField[]>;
    res.json(response);
  } catch (error) {
    console.error('Error in GET /api/workspaces/:workspaceId/custom-fields:', error);
    const errorResponse: ApiResponse<CustomField[]> = {
      status: 'error', 
      message: 'Failed to load custom fields' 
    };
    res.status(500).json(errorResponse);
  }
});

router.post('/workspaces/:workspaceId/custom-fields', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, validate(createCustomFieldSchema), async (req: AuthenticatedRequest<{ workspaceId: string }, {}, CustomFieldCreateData>, res: Response<ApiResponse<CustomField>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;

    const label = String(req.body.label || '').trim();
    const slug = String(req.body.slug || '').trim();
    const field_type = String(req.body.field_type || 'text');
    const optionsValue = req.body.options && String(req.body.options).trim() !== '' ? String(req.body.options).trim() : null;
    const is_required = req.body.is_required !== undefined ? Number(req.body.is_required) : 0;
    const is_active = req.body.is_active !== undefined ? Number(req.body.is_active) : 1;
    const sort_order = req.body.sort_order !== undefined ? Number(req.body.sort_order) : 0;

    if (!label || !slug) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Label and slug are required fields',
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Check for duplicate slug in this workspace before calling NoCodeBackend (avoids generic "Error creating record").
    const existingResponse = await customFieldsApi.getCustomFields(Number(workspaceId)) as ApiResponse<CustomField[]>;
    const existingFields: CustomField[] = Array.isArray(existingResponse?.data)
      ? existingResponse.data
      : existingResponse?.data != null
        ? [existingResponse.data as CustomField]
        : [];
    const slugLower = slug.toLowerCase();
    const slugExists = existingFields.some(
      (f) => (f.slug || '').toLowerCase() === slugLower
    );
    if (slugExists) {
      const errorResponse: ApiResponse<CustomField> = {
        status: 'error',
        message: 'A custom field with this slug already exists. Please use a different slug.',
      };
      res.status(409).json(errorResponse);
      return;
    }

    // Build payload for NoCodeBackend: omit optional keys when null so the backend/DB does not reject the request.
    // For select/multiselect, the DB may expect options as a JSON array string; plain comma-separated can cause 500.
    const fieldPayload: Record<string, unknown> = {
      workspace_id: Number(workspaceId),
      label,
      slug,
      field_type,
      is_required,
      is_active,
      sort_order,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    if (optionsValue != null) {
      const isSelectOrMultiselect = field_type === 'select' || field_type === 'multiselect';
      fieldPayload.options = isSelectOrMultiselect
        ? JSON.stringify(optionsValue.split(',').map((s) => s.trim()).filter(Boolean))
        : optionsValue;
    }

    console.log('[API] POST /api/workspaces/:workspaceId/custom-fields payload:', fieldPayload);
    const response = await customFieldsApi.createCustomField(fieldPayload) as ApiResponse<CustomField>;
    console.log('[API] POST /api/workspaces/:workspaceId/custom-fields NoCodeBackend response:', response);
    
    if (response.status === 'success' && response.id) {
      res.json({
        status: 'success',
        data: {
          id: response.id,
          workspace_id: Number(workspaceId),
          label,
          slug,
          field_type,
          is_required,
          is_active,
          sort_order,
          options: optionsValue || null,
        } as CustomField,
        ...(response.message ? { message: response.message } : {}),
      });
    } else {
      res.json(response);
    }
  } catch (error: any) {
    console.error('Error in POST /api/workspaces/:workspaceId/custom-fields:', error);

    const errorMessage: string = error?.message || '';
    if (errorMessage.includes('unique') || errorMessage.includes('duplicate') || errorMessage.includes('already exists')) {
      const errorResponse: ApiResponse<CustomField> = {
        status: 'error',
        message: 'A custom field with this slug already exists. Please use a different slug.',
      };
      res.status(409).json(errorResponse);
      return;
    }
    
    const errorResponse: ApiResponse<CustomField> = {
      status: 'error',
      message: errorMessage || 'Failed to create custom field',
    };
    res.status(500).json(errorResponse);
  }
});

router.put('/custom-fields/:id', authMiddleware, validate(updateCustomFieldSchema), async (req: AuthenticatedRequest<{ id: string; workspaceId?: string }>, res: Response<ApiResponse<CustomField>>): Promise<void> => {
  try {
    const { id } = req.params;
    const { workspace_id } = req.body || {};
    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Use workspaceAuthMiddleware directly by setting the workspaceId in params
    const originalWorkspaceId = req.params.workspaceId;
    req.params.workspaceId = String(workspace_id);
    
    let middlewareCompleted = false;
    await new Promise<void>((resolve) => {
      workspaceAuthMiddleware(req, res, (err) => {
        req.params.workspaceId = originalWorkspaceId;
        if (res.headersSent) {
          // Middleware already sent a response (403 or 401)
          resolve();
          return;
        }
        if (err) {
          // Middleware encountered an error but didn't send response
          resolve();
          return;
        }
        middlewareCompleted = true;
        resolve();
      });
    });

    // If middleware sent a response, stop here
    if (res.headersSent) {
      return;
    }

    // Check userRole after middleware has set it
    if (!middlewareCompleted || !req.userRole || req.userRole !== 'admin') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const fieldsResponse = await customFieldsApi.getCustomFields(Number(workspace_id)) as ApiResponse<CustomField[]>;
    if (!fieldBelongsToWorkspace(fieldsResponse, Number(id), Number(workspace_id))) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Custom field does not belong to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    // Validate and sanitize the update payload
    const updateData: Partial<CustomFieldCreateData & { workspace_id?: number }> = {
      workspace_id: Number(workspace_id),
    };
    
    if (req.body.label !== undefined) {
      updateData.label = String(req.body.label || '').trim();
    }
    
    if (req.body.slug !== undefined) {
      updateData.slug = String(req.body.slug || '').trim();
    }
    
    if (req.body.field_type !== undefined) {
      updateData.field_type = String(req.body.field_type || 'text');
    }
    
    // Handle options field - ensure it's either null or a valid non-empty string
    // For select/multiselect, send options as JSON array string (same as POST) so the backend accepts the update.
    if (req.body.options !== undefined) {
      const raw = req.body.options && String(req.body.options).trim() !== '' ? String(req.body.options).trim() : null;
      if (raw != null) {
        const fType = updateData.field_type ?? req.body.field_type;
        const isSelectOrMultiselect = fType === 'select' || fType === 'multiselect';
        updateData.options = isSelectOrMultiselect
          ? JSON.stringify(raw.split(',').map((s: string) => s.trim()).filter(Boolean))
          : raw;
      } else {
        updateData.options = null;
      }
    }
    
    if (req.body.is_required !== undefined) {
      updateData.is_required = Number(req.body.is_required);
    }
    
    if (req.body.is_active !== undefined) {
      updateData.is_active = Number(req.body.is_active);
    }
    
    if (req.body.sort_order !== undefined) {
      updateData.sort_order = Number(req.body.sort_order);
    }

    // Validate required fields if they're being updated
    if (updateData.label !== undefined && !updateData.label) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Label cannot be empty',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (updateData.slug !== undefined && !updateData.slug) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Slug cannot be empty',
      };
      res.status(400).json(errorResponse);
      return;
    }

    console.log('[API] PUT /api/custom-fields/:id payload:', updateData);
    const response = await customFieldsApi.updateCustomField(Number(id), updateData) as ApiResponse<CustomField>;
    console.log('[API] PUT /api/custom-fields/:id NoCodeBackend response:', response);
    
    if (response.status === 'success' || response.id) {
      res.json(response);
    } else {
      // Handle constraint errors specifically
      const errorMessage = response.message || response.error || 'Failed to update custom field';
      if (errorMessage.includes('CONSTRAINT') || errorMessage.includes('constraint')) {
        const errorResponse: ApiResponse<CustomField> = {
          status: 'error',
          message: 'Invalid field data. Please check that the options field is valid JSON or empty.',
        };
        res.status(400).json(errorResponse);
        return;
      }
      res.json(response);
    }
  } catch (error: any) {
    if (error.status === 403 || error.status === 401) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: error.message || 'Access denied',
      };
      res.status(error.status).json(errorResponse);
      return;
    }
    console.error('Error in PUT /api/custom-fields/:id:', error);
    
    // Check for constraint errors
    const errorMessage = error?.message || error?.error || '';
    if (errorMessage.includes('CONSTRAINT') || errorMessage.includes('constraint')) {
      const errorResponse: ApiResponse<CustomField> = {
        status: 'error',
        message: 'Invalid field data. The options field must be valid JSON or empty. Please check your input.',
      };
      res.status(400).json(errorResponse);
      return;
    }
    
    const errorResponse: ApiResponse<CustomField> = {
      status: 'error', 
      message: errorMessage || 'Failed to update custom field'
    };
    res.status(500).json(errorResponse);
  }
});

router.delete('/custom-fields/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string; workspaceId?: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { id } = req.params;
    const { workspace_id } = req.query || {};
    if (!workspace_id) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'workspace_id query parameter is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    const canContinue = await callWorkspaceAuthMiddleware(req, res, Number(workspace_id));
    if (!canContinue) {
      return; // Response was already sent by middleware
    }

    if (req.userRole !== 'admin') {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Admin privileges required',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const fieldsResponse = await customFieldsApi.getCustomFields(Number(workspace_id)) as ApiResponse<CustomField[]>;
    if (!fieldBelongsToWorkspace(fieldsResponse, Number(id), Number(workspace_id))) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Custom field does not belong to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const response = await customFieldsApi.deleteCustomField(Number(id)) as ApiResponse<any>;
    res.json(response);
  } catch (error: any) {
    if (error.status === 403 || error.status === 401) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: error.message || 'Access denied',
      };
      res.status(error.status).json(errorResponse);
      return;
    }
    console.error('Error in DELETE /api/custom-fields/:id:', error);
    const errorResponse: ApiResponse = {
      status: 'error', 
      message: 'Failed to delete custom field'
    };
    res.status(500).json(errorResponse);
  }
});

router.get('/leads/:id/custom-field-values', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse<CustomFieldValue[]>>): Promise<void> => {
  try {
    const { id } = req.params;
    const userId: number = Number(req.user?.id || 0);

    const leadResponse = await leadsApi.getLeadById(Number(id)) as ApiResponse<any>;
    if (leadResponse.status !== 'success' || !leadResponse.data) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Lead not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    const lead: any = Array.isArray(leadResponse.data) 
      ? leadResponse.data[0] 
      : leadResponse.data;
    
    const workspaceId: number = lead.workspace_id;

    const { hasAccess } = await verifyWorkspaceAccess(userId, workspaceId);

    if (!hasAccess) {
      const errorResponse: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Access denied: You do not have access to this workspace',
      };
      res.status(403).json(errorResponse);
      return;
    }

    const response = await customFieldValuesApi.getCustomFieldValues(Number(id)) as ApiResponse<CustomFieldValue[]>;
    res.json(response);
  } catch (error) {
    console.error('Error in GET /api/leads/:id/custom-field-values:', error);
    const errorResponse: ApiResponse<CustomFieldValue[]> = { 
      status: 'error', 
      message: (error as Error).message || 'Failed to load custom field values' 
    };
    res.status(500).json(errorResponse);
  }
});

router.post('/custom-field-values', authMiddleware, validate(createCustomFieldValueSchema), async (req: AuthenticatedRequest<{}, {}, CustomFieldValue>, res: Response<ApiResponse<CustomFieldValue>>): Promise<void> => {
  try {
    const access = await getLeadAccess(Number(req.user?.id), Number(req.body.lead_id));
    if (access.status !== 'ok') {
      res.status(access.status === 'not_found' ? 404 : 403).json({ status: 'error', message: 'Lead not found or access denied' });
      return;
    }
    const fields = await customFieldsApi.getCustomFields(Number(access.lead.workspace_id)) as ApiResponse<CustomField[]>;
    if (!fieldBelongsToWorkspace(fields, Number(req.body.field_id), Number(access.lead.workspace_id))) {
      res.status(400).json({ status: 'error', message: 'Custom field does not belong to this workspace' });
      return;
    }
    const response = await customFieldValuesApi.createCustomFieldValue(req.body) as ApiResponse<CustomFieldValue>;
    res.json(response);
  } catch (error) {
    console.error('Error in POST /api/custom-field-values:', error);
    const errorResponse: ApiResponse<CustomFieldValue> = {
      status: 'error', 
      message: 'Failed to create custom field value' 
    };
    res.status(500).json(errorResponse);
  }
});

router.put('/custom-field-values/:id', authMiddleware, validate(updateCustomFieldValueSchema), async (req: AuthenticatedRequest<{ id: string }, {}, Partial<CustomFieldValue>>, res: Response<ApiResponse<CustomFieldValue>>): Promise<void> => {
  try {
    const { id } = req.params;
    const valueResponse = await customFieldValuesApi.getCustomFieldValueById(Number(id));
    const value = Array.isArray(valueResponse.data) ? valueResponse.data[0] : valueResponse.data;
    if (valueResponse.status !== 'success' || !value || Number(value.id) !== Number(id)) {
      res.status(404).json({ status: 'error', message: 'Custom field value not found' });
      return;
    }
    const access = await getLeadAccess(Number(req.user?.id), Number(value.lead_id));
    if (access.status !== 'ok') {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }
    if (req.body.lead_id !== undefined && Number(req.body.lead_id) !== Number(value.lead_id)) {
      res.status(400).json({ status: 'error', message: 'Cannot move a custom field value to another lead' });
      return;
    }
    if (req.body.field_id !== undefined) {
      const fields = await customFieldsApi.getCustomFields(Number(access.lead.workspace_id)) as ApiResponse<CustomField[]>;
      if (!fieldBelongsToWorkspace(fields, Number(req.body.field_id), Number(access.lead.workspace_id))) {
        res.status(400).json({ status: 'error', message: 'Custom field does not belong to this workspace' });
        return;
      }
    }
    const response = await customFieldValuesApi.updateCustomFieldValue(Number(id), req.body) as ApiResponse<CustomFieldValue>;
    res.json(response);
  } catch (error) {
    console.error('Error in PUT /api/custom-field-values/:id:', error);
    const errorResponse: ApiResponse<CustomFieldValue> = {
      status: 'error', 
      message: 'Failed to update custom field value' 
    };
    res.status(500).json(errorResponse);
  }
});

router.delete('/custom-field-values/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse>): Promise<void> => {
  try {
    const { id } = req.params;
    const valueResponse = await customFieldValuesApi.getCustomFieldValueById(Number(id));
    const value = Array.isArray(valueResponse.data) ? valueResponse.data[0] : valueResponse.data;
    if (valueResponse.status !== 'success' || !value || Number(value.id) !== Number(id)) {
      res.status(404).json({ status: 'error', message: 'Custom field value not found' });
      return;
    }
    const access = await getLeadAccess(Number(req.user?.id), Number(value.lead_id));
    if (access.status !== 'ok') {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }
    const response = await customFieldValuesApi.deleteCustomFieldValue(Number(id)) as ApiResponse<any>;
    res.json(response);
  } catch (error) {
    console.error('Error in DELETE /api/custom-field-values/:id:', error);
    const errorResponse: ApiResponse = {
      status: 'error', 
      message: 'Failed to delete custom field value' 
    };
    res.status(500).json(errorResponse);
  }
});

export default router;
