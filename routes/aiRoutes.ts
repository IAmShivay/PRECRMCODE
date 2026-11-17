import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';
import { validate, aiChatSchema, aiConfirmActionSchema } from '../utils/validation.js';
import { crmToolDefinitions } from '../services/mcp/toolRegistry.js';
import { runAgent } from '../services/ai/agentEngine.js';
import { confirmActionTicket, rejectActionTicket } from '../services/ai/actionTickets.js';
import type { ApiResponse, AuthenticatedRequest } from '../types/index.js';
import { AI_EVENT_DONE, AI_EVENT_ERROR, type AiStreamEventType } from '../types/constants.js';

const router: Router = Router();

router.get('/tools', authMiddleware, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const tools = crmToolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    security_level: t.security_level,
    parameters: t.input_schema,
  }));
  res.json({ status: 'success', data: tools });
});

router.post(
  '/chat',
  authMiddleware,
  validate(aiChatSchema),
  async (req: AuthenticatedRequest<{}, {}, { workspace_id: number; message: string; history?: any[] }>, res: Response): Promise<void> => {
    const userId = Number(req.user?.id || 0);
    const workspaceId = Number(req.body.workspace_id);

    try {
      const access = await getWorkspaceAccess(userId, workspaceId);
      if (!access.hasAccess) {
        res.status(403).json({ status: 'error', message: 'Access denied to this workspace' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (event: AiStreamEventType, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      await runAgent({
        workspaceId,
        userId,
        userRole: access.role || undefined,
        message: req.body.message,
        history: req.body.history,
        onEvent: (event, data) => {
          sendEvent(event, data);
          if (event === AI_EVENT_DONE) {
            res.end();
          }
        },
      });
    } catch (error: any) {
      console.error('Error in /api/ai/chat:', error);
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', message: error?.message || 'Chat error' });
      } else {
        res.write(`event: ${AI_EVENT_ERROR}\ndata: ${JSON.stringify({ message: error?.message || 'Chat processing error' })}\n\n`);
        res.write(`event: ${AI_EVENT_DONE}\ndata: ${JSON.stringify({ status: 'error' })}\n\n`);
        res.end();
      }
    }
  }
);

router.post(
  '/confirm-action',
  authMiddleware,
  validate(aiConfirmActionSchema),
  async (
    req: AuthenticatedRequest<{}, {}, { ticket_id: string; confirmed: boolean }>,
    res: Response<ApiResponse<any>>
  ): Promise<void> => {
    try {
      const userId = Number(req.user?.id || 0);
      if (req.body.confirmed) {
        const result = await confirmActionTicket(req.body.ticket_id, userId);
        if (!result.success) {
          res.status(400).json({ status: 'error', message: result.error || 'Failed to confirm action' });
          return;
        }
        res.json({ status: 'success', data: result.result });
      } else {
        const rejected = rejectActionTicket(req.body.ticket_id, userId);
        if (!rejected) {
          res.status(400).json({ status: 'error', message: 'Unable to reject ticket' });
          return;
        }
        res.json({ status: 'success', data: { rejected: true } });
      }
    } catch (error: any) {
      console.error('Error in /api/ai/confirm-action:', error);
      res.status(500).json({ status: 'error', message: error?.message || 'Failed to process confirmation' });
    }
  }
);

export default router;
