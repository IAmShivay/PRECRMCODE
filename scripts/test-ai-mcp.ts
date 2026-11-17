import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';

process.env.JWT_SECRET = 'ai-mcp-test-secret-key-do-not-deploy-1234';

const { webhookLogsApi, dealsApi, workspacesApi, workspaceMembersApi, leadsApi, customFieldsApi, notificationsApi } = await import('../services/api.js');
const { default: aiRouter } = await import('../routes/aiRoutes.js');
const { default: mcpRouter } = await import('../routes/mcpRoutes.js');
const { crmToolDefinitions } = await import('../services/mcp/toolRegistry.js');

let mockLogs: any[] = [];
let nextLogId = 100;

const user = { id: 1, name: 'AI Admin', email: 'admin@scraft.test', accepted_terms: 1 };
const workspace = { id: 10, name: 'AI Test Workspace', owner_id: 1, currency: 'USD' };

workspacesApi.getWorkspaceById = async (id: number) => {
  if (id === workspace.id) return { status: 'success', data: workspace } as any;
  return { status: 'error', message: 'Workspace not found' } as any;
};

workspaceMembersApi.getWorkspaceMembers = async (params: any) => {
  if (params?.workspace_id === workspace.id && params?.user_id === user.id) {
    return {
      status: 'success',
      data: [{ id: 1, workspace_id: workspace.id, user_id: user.id, role: 'owner' }],
    } as any;
  }
  return { status: 'success', data: [] } as any;
};

webhookLogsApi.getWebhookLogs = async (params: any) => {
  let filtered = [...mockLogs];
  if (params?.workspace_id !== undefined) {
    filtered = filtered.filter((r) => r.workspace_id === params.workspace_id);
  }
  if (params?.status) {
    filtered = filtered.filter((r) => r.status === params.status);
  }
  if (params?.event_id) {
    filtered = filtered.filter((r) => r.event_id === params.event_id);
  }
  return { status: 'success', data: filtered } as any;
};

webhookLogsApi.createWebhookLog = async (body: any) => {
  const row = { ...body, id: nextLogId++ };
  mockLogs.push(row);
  return { status: 'success', data: row } as any;
};

webhookLogsApi.updateWebhookLog = async (id: number, body: any) => {
  mockLogs = mockLogs.map((r) => (r.id === id ? { ...r, ...body } : r));
  const found = mockLogs.find((r) => r.id === id);
  return { status: 'success', data: found } as any;
};

webhookLogsApi.deleteWebhookLog = async (id: number) => {
  mockLogs = mockLogs.filter((r) => r.id !== id);
  return { status: 'success', data: { deleted: true } } as any;
};

dealsApi.getDeals = async (_params: any) => {
  const deals = mockLogs.filter((r) => r.status === 'deal');
  return { status: 'success', data: deals } as any;
};

dealsApi.getDealById = async (id: number) => {
  const found = mockLogs.find((r) => r.id === id);
  return { status: 'success', data: found } as any;
};

leadsApi.getLeads = async (_params: any) => {
  return {
    status: 'success',
    data: [
      { id: 1, workspace_id: 10, name: 'Alice Smith', email: 'alice@example.com', phone: '+123456789', status_id: 1, created_at: '2026-10-28 10:00:00' },
      { id: 2, workspace_id: 10, name: 'Bob Jones', email: 'bob@example.com', phone: '+987654321', status_id: 1, created_at: '2026-10-28 11:00:00' },
    ],
  } as any;
};

leadsApi.getLeadById = async (id: number) => {
  return {
    status: 'success',
    data: { id, workspace_id: 10, name: 'Alice Smith', email: 'alice@example.com', phone: '+123456789', status_id: 1 },
  } as any;
};

customFieldsApi.getCustomFields = async () => ({ status: 'success', data: [] } as any);
notificationsApi.getNotifications = async () => ({ status: 'success', data: [] } as any);

const app = express();
app.use(express.json());
app.use('/api/ai', aiRouter);
app.use('/api/mcp', mcpRouter);

const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const { port } = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${port}`;

const token = jwt.sign(
  { id: user.id, email: user.email, name: user.name },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

try {
  console.log('[Test 1] Verify MCP Tool Definitions');
  assert.equal(crmToolDefinitions.length, 17, 'Expected 17 CRM tool definitions');
  const toolNames = crmToolDefinitions.map((t) => t.name);
  assert.ok(toolNames.includes('search_leads'));
  assert.ok(toolNames.includes('search_deals'));
  assert.ok(toolNames.includes('move_deal_stage'));
  assert.ok(toolNames.includes('verify_email'));
  assert.ok(toolNames.includes('send_whatsapp_message'));
  assert.ok(toolNames.includes('search_customers'));
  assert.ok(toolNames.includes('get_customer_details'));
  assert.ok(toolNames.includes('get_deal_associations'));
  assert.ok(toolNames.includes('list_pipeline_stages'));
  assert.ok(toolNames.includes('list_custom_fields'));
  assert.ok(toolNames.includes('list_notifications'));
  console.log('Passed: 17 CRM MCP tools defined properly.');

  console.log('[Test 2] GET /api/ai/tools');
  const toolsRes = await fetch(`${baseUrl}/api/ai/tools`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(toolsRes.status, 200);
  const toolsJson = await toolsRes.json();
  assert.equal(toolsJson.status, 'success');
  assert.equal(toolsJson.data.length, 17);
  console.log('Passed: /api/ai/tools returns full tool catalog (17 tools).');

  console.log('[Test 3] POST & GET /api/mcp/tokens');
  const createTokenRes = await fetch(`${baseUrl}/api/mcp/tokens?workspace_id=10`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Claude Desktop Test' }),
  });
  assert.equal(createTokenRes.status, 200);
  const createTokenJson = await createTokenRes.json();
  assert.equal(createTokenJson.status, 'success');
  const mcpToken = createTokenJson.data.token;
  assert.ok(mcpToken.startsWith('scraft_mcp_'), 'Expected scraft_mcp_ prefix');
  const tokenId = createTokenJson.data.record.id;

  const listTokensRes = await fetch(`${baseUrl}/api/mcp/tokens?workspace_id=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(listTokensRes.status, 200);
  const listTokensJson = await listTokensRes.json();
  assert.equal(listTokensJson.status, 'success');
  assert.equal(listTokensJson.data.length, 1);
  assert.equal(listTokensJson.data[0].name, 'Claude Desktop Test');
  console.log('Passed: MCP token generated and verified in list.');

  console.log('[Test 4] GET /api/mcp/sse Unauthorized & Authorized');
  const unauthSseRes = await fetch(`${baseUrl}/api/mcp/sse?token=invalid_token`);
  assert.equal(unauthSseRes.status, 401);

  const authSseController = new AbortController();
  const authSseRes = await fetch(`${baseUrl}/api/mcp/sse?token=${mcpToken}`, {
    signal: authSseController.signal,
  });
  assert.equal(authSseRes.status, 200);
  assert.ok(authSseRes.headers.get('content-type')?.includes('text/event-stream'));
  authSseController.abort();
  console.log('Passed: MCP SSE endpoint authenticated and established stream.');

  console.log('[Test 5] POST /api/mcp Streamable HTTP initialize & tools/list');
  const initRes = await fetch(`${baseUrl}/api/mcp?token=${mcpToken}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'streamable-test', version: '1.0.0' },
      },
    }),
  });
  assert.equal(initRes.status, 200);
  const initJson = await initRes.json();
  assert.equal(initJson.result.serverInfo.name, 'scraft-crm');
  assert.ok(initJson.result.capabilities.tools);

  const toolsListRes = await fetch(`${baseUrl}/api/mcp?token=${mcpToken}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  assert.equal(toolsListRes.status, 200);
  const toolsListJson = await toolsListRes.json();
  assert.equal(toolsListJson.result.tools.length, 17);

  const unauthorizedStreamableRes = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
  });
  assert.equal(unauthorizedStreamableRes.status, 401);
  console.log('Passed: Streamable HTTP endpoint initialized and listed 17 tools.');

  console.log('[Test 6] POST /api/ai/chat (SSE streaming)');
  const chatRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workspace_id: 10,
      message: 'Show pipeline summary',
    }),
  });
  assert.equal(chatRes.status, 200);
  assert.ok(chatRes.headers.get('content-type')?.includes('text/event-stream'));
  const chatText = await chatRes.text();
  assert.ok(chatText.includes('event: tool_start'));
  assert.ok(chatText.includes('event: tool_end'));
  assert.ok(chatText.includes('event: done'));
  console.log('Passed: AI chat agent executed tool and streamed SSE events.');

  console.log('[Test 7] DELETE /api/mcp/tokens/:id');
  const deleteTokenRes = await fetch(`${baseUrl}/api/mcp/tokens/${tokenId}?workspace_id=10`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(deleteTokenRes.status, 200);
  const deleteTokenJson = await deleteTokenRes.json();
  assert.equal(deleteTokenJson.status, 'success');
  assert.equal(deleteTokenJson.data.revoked, true);
  console.log('Passed: MCP token revoked.');

  console.log('[Test 8] Action Ticket Rejection & Confirmation API');
  const { createActionTicket } = await import('../services/ai/actionTickets.js');
  const actionTicket = createActionTicket({
    workspace_id: 10,
    user_id: 1,
    tool_name: 'move_deal_stage',
    params: { deal_id: 99, target_stage: 'won' },
    summary: 'Move Deal #99 to Won stage',
  });
  const rejectRes = await fetch(`${baseUrl}/api/ai/confirm-action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ticket_id: actionTicket.ticket_id, confirmed: false }),
  });
  assert.equal(rejectRes.status, 200);
  const rejectJson = await rejectRes.json();
  assert.equal(rejectJson.status, 'success');
  assert.equal(rejectJson.data.rejected, true);
  console.log('Passed: Action ticket rejection endpoint verified.');

  console.log('[Test 9] Anti-Exploit Rate Limiter Check');
  const { checkMcpRateLimit } = await import('../services/mcp/rateLimiter.js');
  for (let i = 0; i < 5; i++) {
    assert.equal(checkMcpRateLimit(999, 'send_whatsapp_message').allowed, true);
  }
  const blocked = checkMcpRateLimit(999, 'send_whatsapp_message');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reason?.includes('WhatsApp messaging rate limit exceeded'));
  console.log('Passed: Abuse rate limiter immediately throttles excessive calls.');

  console.log('\nALL TESTS PASSED WITH 100% SUCCESS!');
} finally {
  server.close();
}
