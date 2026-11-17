import { Router, Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authMiddleware } from '../middleware/auth.js';
import { getWorkspaceAccess } from '../services/workspacePermissions.js';
import { validate, createMcpTokenSchema } from '../utils/validation.js';
import { createCrmMcpServer } from '../services/mcp/mcpServer.js';
import {
  createWorkspaceMcpToken,
  listWorkspaceMcpTokens,
  revokeWorkspaceMcpToken,
  validateMcpToken,
} from '../services/mcp/mcpTokenStore.js';
import type { ApiResponse, AuthenticatedRequest } from '../types/index.js';
import { MCP_DEFAULT_MESSAGES_ENDPOINT } from '../types/constants.js';

const router: Router = Router();

const activeTransports = new Map<string, SSEServerTransport>();

type McpAuthResult =
  | { ok: true; workspaceId: number; userId: number }
  | { ok: false; reason: 'missing' | 'invalid' };

async function resolveMcpAuth(req: Request): Promise<McpAuthResult> {
  const authHeader = String(req.headers.authorization || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const token = queryToken || bearerToken;

  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  const validation = await validateMcpToken(token);
  if (!validation.valid || !validation.workspaceId || !validation.userId) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    workspaceId: validation.workspaceId,
    userId: validation.userId,
  };
}

function sendMcpAuthError(res: Response, reason: 'missing' | 'invalid'): void {
  res.status(401).json({
    status: 'error',
    message: reason === 'missing' ? 'MCP token required' : 'Invalid or inactive MCP token',
  });
}

function sendMcpJsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const auth = await resolveMcpAuth(req);
  if (!auth.ok) {
    sendMcpAuthError(res, auth.reason);
    return;
  }

  const server = createCrmMcpServer(auth.workspaceId, auth.userId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error in POST /api/mcp:', error);
    if (!res.headersSent) {
      sendMcpJsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
});

router.get('/', (_req: Request, res: Response): void => {
  sendMcpJsonRpcError(res, 405, -32000, 'Method not allowed');
});

router.delete('/', (_req: Request, res: Response): void => {
  sendMcpJsonRpcError(res, 405, -32000, 'Method not allowed');
});

router.get('/sse', async (req: Request, res: Response): Promise<void> => {
  const auth = await resolveMcpAuth(req);
  if (!auth.ok) {
    sendMcpAuthError(res, auth.reason);
    return;
  }

  const transport = new SSEServerTransport(MCP_DEFAULT_MESSAGES_ENDPOINT, res);
  const server = createCrmMcpServer(auth.workspaceId, auth.userId);

  activeTransports.set(transport.sessionId, transport);

  transport.onclose = () => {
    activeTransports.delete(transport.sessionId);
  };

  await server.connect(transport);
});

router.post('/messages', async (req: Request, res: Response): Promise<void> => {
  const sessionId = String(req.query.sessionId || '');
  if (!sessionId) {
    res.status(400).json({ status: 'error', message: 'sessionId query parameter required' });
    return;
  }

  const transport = activeTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ status: 'error', message: 'MCP session not found' });
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

router.get(
  '/tokens',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response<ApiResponse<any>>): Promise<void> => {
    try {
      const workspaceId = Number(req.query.workspace_id);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id is required' });
        return;
      }
      const access = await getWorkspaceAccess(Number(req.user?.id || 0), workspaceId);
      if (!access.hasAccess) {
        res.status(403).json({ status: 'error', message: 'Access denied' });
        return;
      }
      const tokens = await listWorkspaceMcpTokens(workspaceId);
      res.json({ status: 'success', data: tokens });
    } catch (error: any) {
      console.error('Error in GET /api/mcp/tokens:', error);
      res.status(500).json({ status: 'error', message: error?.message || 'Failed to list tokens' });
    }
  }
);

router.post(
  '/tokens',
  authMiddleware,
  validate(createMcpTokenSchema),
  async (
    req: AuthenticatedRequest<{}, {}, { name: string }>,
    res: Response<ApiResponse<any>>
  ): Promise<void> => {
    try {
      const workspaceId = Number(req.query.workspace_id || req.body?.name ? (req as any).query?.workspace_id : 0);
      const effectiveWorkspaceId = Number(workspaceId > 0 ? workspaceId : (req.headers['x-workspace-id'] || 0));
      if (!Number.isFinite(effectiveWorkspaceId) || effectiveWorkspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'workspace_id query or header is required' });
        return;
      }
      const access = await getWorkspaceAccess(Number(req.user?.id || 0), effectiveWorkspaceId);
      if (!access.hasAccess || (access.role !== 'admin' && access.role !== 'manager')) {
        res.status(403).json({ status: 'error', message: 'Admin or Manager role required to generate MCP tokens' });
        return;
      }
      const { token, record } = await createWorkspaceMcpToken(
        effectiveWorkspaceId,
        Number(req.user?.id || 0),
        req.body.name
      );
      res.json({
        status: 'success',
        data: {
          token,
          record,
        },
      });
    } catch (error: any) {
      console.error('Error in POST /api/mcp/tokens:', error);
      res.status(500).json({ status: 'error', message: error?.message || 'Failed to create token' });
    }
  }
);

router.delete(
  '/tokens/:id',
  authMiddleware,
  async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse<any>>): Promise<void> => {
    try {
      const tokenId = Number(req.params.id);
      const workspaceId = Number(req.query.workspace_id);
      if (!Number.isFinite(tokenId) || !Number.isFinite(workspaceId) || workspaceId <= 0) {
        res.status(400).json({ status: 'error', message: 'Valid tokenId and workspace_id required' });
        return;
      }
      const access = await getWorkspaceAccess(Number(req.user?.id || 0), workspaceId);
      if (!access.hasAccess || access.role !== 'admin') {
        res.status(403).json({ status: 'error', message: 'Admin role required to revoke tokens' });
        return;
      }
      const revoked = await revokeWorkspaceMcpToken(workspaceId, tokenId);
      res.json({ status: 'success', data: { revoked } });
    } catch (error: any) {
      console.error('Error in DELETE /api/mcp/tokens/:id:', error);
      res.status(500).json({ status: 'error', message: error?.message || 'Failed to revoke token' });
    }
  }
);

export default router;
