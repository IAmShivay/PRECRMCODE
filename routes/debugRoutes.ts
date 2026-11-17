import { Router, Request, Response } from 'express';
import { webhookLogsApi, customFieldsApi, leadsApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { ApiResponse, AuthenticatedRequest, AuthErrorResponse } from '../types/index.js';

const router: Router = Router();

interface HealthResponse {
  status: string;
  message: string;
  timestamp: string;
  version: string;
  middleware: boolean;
}

interface DatabaseDebugResponse {
  status: string;
  database: string;
  can_read_leads?: boolean;
  error?: string;
}

interface WebhookLogsDebugResponse {
  status: string;
  workspace_id: string;
  logs_count: number;
  logs: any[];
  error?: string;
}

interface CustomFieldsDebugResponse {
  status: string;
  workspace_id: string;
  custom_fields_count: number;
  custom_fields?: any[];
  error?: string;
}

router.get('/health', (_req: Request, res: Response<HealthResponse>): void => {
  res.json({
    status: 'ok',
    message: 'Webhook server is running',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    middleware: true,
  });
});

router.get(
  '/database',
  authMiddleware,
  async (
    _req: AuthenticatedRequest,
    res: Response<DatabaseDebugResponse | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const response = await leadsApi.getLeads({ limit: 1 }) as ApiResponse<any[]>;
      const responseData: DatabaseDebugResponse = {
        status: 'ok',
        database: 'connected',
        can_read_leads: response.status === 'success',
      };
      res.json(responseData);
    } catch (error: any) {
      const errorResponse: DatabaseDebugResponse = {
        status: 'error',
        error: error.message,
        database: 'disconnected',
      };
      res.status(500).json(errorResponse);
    }
  }
);

router.get(
  '/webhook-logs/:workspaceId',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<WebhookLogsDebugResponse | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const { workspaceId } = req.params;
      const response = (await webhookLogsApi.getWebhookLogs({
        workspace_id: Number(workspaceId),
        limit: 10,
      })) as ApiResponse<any[]>;

      const responseData: WebhookLogsDebugResponse =
        response.status === 'success'
          ? {
              status: 'success',
              workspace_id: workspaceId,
              logs_count: response.data?.length || 0,
              logs: (response.data || []).map(log => ({ ...log, payload: '[redacted]', error: log.error ? '[redacted]' : null })),
            }
          : {
              status: 'success',
              workspace_id: workspaceId,
              logs_count: 0,
              logs: [],
            };
      res.json(responseData);
    } catch (error: any) {
      const errorResponse: WebhookLogsDebugResponse = {
        status: 'error',
        error: error.message,
        workspace_id: req.params.workspaceId,
        logs_count: 0,
        logs: [],
      };
      res.status(500).json(errorResponse);
    }
  }
);

router.get(
  '/custom-fields/:workspaceId',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<CustomFieldsDebugResponse | AuthErrorResponse>
  ): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const response = await customFieldsApi.getCustomFields(Number(workspaceId)) as ApiResponse<any[]>;

    const responseData: CustomFieldsDebugResponse = response.status === 'success'
      ? {
          status: 'success',
          workspace_id: workspaceId,
          custom_fields_count: response.data?.length || 0,
          custom_fields: response.data || [],
        }
      : {
          status: 'error',
          workspace_id: workspaceId,
          custom_fields_count: 0,
          ...(response.message ? { error: response.message } : {}),
        };
    res.json(responseData);
  } catch (error: any) {
    const errorResponse: CustomFieldsDebugResponse = {
      status: 'error',
      workspace_id: req.params.workspaceId,
      custom_fields_count: 0,
      ...(error.message ? { error: error.message } : {}),
    };
    res.status(500).json(errorResponse);
  }
});

export default router;
