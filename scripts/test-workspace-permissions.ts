// node --import tsx scripts/test-workspace-permissions.ts [--serve]
// Isolated in-memory database and mocked Meta provider. Never sends real messages.
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.JWT_SECRET = 'workspace-permissions-fixture-only';
process.env.INSTAGRAM_APP_ID = '12345';
process.env.INSTAGRAM_APP_SECRET = 'fixture-only';
const api = await import('../services/api.js');
const { getWorkspaceAccess, saveMemberPermissions } = await import('../services/workspacePermissions.js');
const { encryptConfigSecret } = await import('../services/secureConfigCrypto.js');
const { default: dealsRoutes } = await import('../routes/dealsRoutes.js');
const { default: workspaceRoutes } = await import('../routes/workspacesRoutes.js');
const { default: instagramRoutes } = await import('../routes/instagramRoutes.js');
const { default: whatsappRoutes } = await import('../routes/whatsappRoutes.js');
const { default: activitiesRoutes } = await import('../routes/leadActivitiesRoutes.js');
const { default: customersRoutes } = await import('../routes/customersRoutes.js');
const ok = (data: any): any => ({ status: 'success', data });
const users = [
  { id: 1, name: 'Demo Admin', email: 'admin@example.test', accepted_terms: 1 },
  { id: 2, name: 'Maya Designer', email: 'designer@example.test', accepted_terms: 1 },
  { id: 3, name: 'Sam Sales', email: 'sales@example.test', accepted_terms: 1 },
];
const workspaces = [{ id: 7, name: 'Permissions demo', owner_id: 1, currency: 'INR' }, { id: 8, name: 'Separate client', owner_id: 9, currency: 'INR' }];
let members: any[];
let rows: any[];
let nextId = 100;
let failPermissions = false;
let missingPermissionData = false;
let failPermissionWrite = false;
let sent = 0;
let providerCalls = 0;
let activities: any[];
const lead = { id: 70, workspace_id: 7, name: 'Demo Customer', email: 'customer@example.test', phone: '+15550100000', status: 'New', created_at: '2026-01-01' };
function reset() {
  members = [
    { id: 11, workspace_id: 7, user_id: 1, role: 'admin' },
    { id: 12, workspace_id: 7, user_id: 2, role: 'member' },
    { id: 13, workspace_id: 7, user_id: 3, role: 'member' },
    { id: 22, workspace_id: 8, user_id: 2, role: 'member' },
  ];
  rows = [2, 3, null].map((owner, index) => ({ id: index + 1, workspace_id: 7, lead_id: 70, status: 'deal', source: 'deal', created_at: '2026-01-01', payload: JSON.stringify({ name: ['Design project', 'Sales project', 'Unassigned project'][index], contact: lead.name, owner_id: owner, value: (index + 1) * 1000, stage: 'won', pipeline_slug: 'default', converted_at: '2026-01-01', lead_id: 70, custom_fields: {} }) }));
  rows.push({ id: 4, workspace_id: 8, status: 'deal', source: 'deal', payload: JSON.stringify({ name: 'Other client', contact: 'Other customer', owner_id: 2, value: 9000, stage: 'new_lead' }) });
  rows.push({ id: 5, workspace_id: 7, source: 'instagram', status: 'ig_connection', event_id: 'ig_ws_7', payload: JSON.stringify({ workspace_id: 7, account_id: '800', user_id: '900', username: 'demo_brand', access_token_enc: encryptConfigSecret('fake-test-token'), expires_at: new Date(Date.now() + 86400000 * 40).toISOString(), refreshed_at: new Date().toISOString() }) });
  activities = [
    { id: 1, type: 'deal_created', metadata: JSON.stringify({ deal_id: 1 }), title: 'Design project created', description: 'Design project ₹1000' },
    { id: 2, type: 'deal_created', metadata: JSON.stringify({ deal_id: 2 }), title: 'Sales project created', description: 'Sales project ₹2000' },
    { id: 3, type: 'whatsapp', title: 'Customer message', description: 'Review the attached design', metadata: '{}' },
    { id: 4, type: 'note', title: 'Note', description: 'Project note', metadata: '{}' },
  ].map((item) => ({ ...item, lead_id: 70, workspace_id: 7, user_id: 1, created_at: '2026-01-01' }));
  nextId = 100;
}
reset();
api.webhookLogsApi.getWebhookLogs = async (params: any) => {
  if (failPermissions && params.status === 'workspace_member_permissions') return { status: 'error' };
  if (missingPermissionData && params.status === 'workspace_member_permissions') return { status: 'success' };
  return ok(rows.filter((row) => ['workspace_id', 'source', 'status', 'event_id'].every((key) => params[key] === undefined || String(row[key]) === String(params[key])))
    .slice(((params.page || 1) - 1) * (params.limit || 100), (params.page || 1) * (params.limit || 100)));
};
api.webhookLogsApi.createWebhookLog = async (body: any) => { const row = { ...body, id: nextId++ }; rows.push(row); return ok(row); };
api.webhookLogsApi.updateWebhookLog = async (id, body: any) => {
  if (failPermissionWrite && body.status === 'workspace_member_permissions') return { status: 'error' };
  rows = rows.map((row) => row.id === id ? { ...row, ...body } : row);
  return ok(rows.find((row) => row.id === id));
};
api.webhookLogsApi.deleteWebhookLog = async (id) => { rows = rows.filter((row) => row.id !== id); return ok(null); };
api.dealsApi.getDeals = async (params: any) => ok(rows.filter((row) => row.status === 'deal' && row.workspace_id === params.workspace_id));
api.dealsApi.getDealById = async (id) => ok(rows.find((row) => row.id === id));
api.dealsApi.createDeal = api.webhookLogsApi.createWebhookLog;
api.dealsApi.updateDeal = api.webhookLogsApi.updateWebhookLog;
api.dealsApi.deleteDeal = api.webhookLogsApi.deleteWebhookLog;
api.dealPipelinesApi.getPipelines = async () => ok([]);
api.dealStageHistoryApi.createStageHistory = async () => ok(null);
api.workspacesApi.getWorkspaceById = async (id) => ok(workspaces.find((workspace) => workspace.id === id));
api.workspaceMembersApi.getWorkspaceMembers = async (params: any) => ok(members.filter((member) => typeof params === 'number' ? member.workspace_id === params : (!params.workspace_id || params.workspace_id === member.workspace_id) && (!params.user_id || params.user_id === member.user_id)));
api.workspaceMembersApi.getWorkspaceMemberById = async (id) => ok(members.find((member) => member.id === id));
api.workspaceMembersApi.updateWorkspaceMember = async (id, body: any) => { members = members.map((member) => member.id === id ? { ...member, ...body } : member); return ok(null); };
api.workspaceMembersApi.deleteWorkspaceMember = async (id) => { members = members.filter((member) => member.id !== id); return ok(null); };
api.usersApi.getUserById = async (id) => ok(users.find((user) => user.id === id));
api.leadsApi.getLeadById = async (id) => ok(id === 70 ? lead : undefined);
api.leadsApi.getLeads = async () => ok([lead]);
api.leadActivitiesApi.getActivities = async () => ok(activities.map((item) => ({ ...item })));
api.leadActivitiesApi.getActivityById = async (id) => ok(activities.find((item) => item.id === id));
api.leadActivitiesApi.createActivity = async (body: any) => { activities.push({ ...body, id: nextId++ }); return ok(body); };
api.leadActivitiesApi.updateActivity = async (id, body: any) => { activities = activities.map((item) => item.id === id ? { ...item, ...body } : item); return ok(null); };
api.leadActivitiesApi.deleteActivity = async (id) => { activities = activities.filter((item) => item.id !== id); return ok(null); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === '127.0.0.1') return originalFetch(input, init);
  const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (url.hostname === 'graph.instagram.com') {
    providerCalls++;
    if (url.pathname.endsWith('/conversations')) return response({ data: [{ id: 'conv-1', updated_time: new Date().toISOString(), participants: { data: [{ id: '800', username: 'demo_brand' }, { id: '700', username: 'customer_demo' }] } }] });
    if (url.pathname.endsWith('/conv-1')) return response({ id: 'conv-1', participants: { data: [{ id: '800' }, { id: '700' }] }, messages: { data: [{ id: 'msg-1', created_time: new Date().toISOString(), from: { id: '700', username: 'customer_demo' }, to: { data: [{ id: '800' }] }, message: 'Could you please review the new design?' }] } });
    if (url.pathname.endsWith('/messages') && init?.method === 'POST') { sent++; return response({ message_id: 'fake-outgoing-1' }); }
  }
  throw new Error(`Unexpected external request blocked: ${url.hostname}${url.pathname}`);
};
const token = (id: number) => jwt.sign({ id }, process.env.JWT_SECRET!, { expiresIn: '1h' });
const app = express();
app.use(express.json());
app.post('/api/auth/login', (req, res) => { const user = users.find((item) => item.email === req.body.email); res.json(user ? { success: true, data: { user, token: token(user.id) } } : { success: false }); });
app.get('/api/auth/me', (req, res) => { const payload = jwt.verify(req.headers.authorization!.slice(7), process.env.JWT_SECRET!) as { id: number }; res.json({ success: true, data: { user: users.find((user) => user.id === payload.id) } }); });
app.get('/api/workspaces', (req, res) => {
  const payload = jwt.verify(req.headers.authorization!.slice(7), process.env.JWT_SECRET!) as { id: number };
  res.json(ok(workspaces.filter((workspace) => workspace.owner_id === payload.id || members.some((member) => member.workspace_id === workspace.id && member.user_id === payload.id))));
});
app.get('/api/workspaces/:id/lead-statuses', (_req, res) => res.json(ok([])));
app.use('/api/deals', dealsRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workspace-members', workspaceRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api', activitiesRoutes);
app.use('/api', (_req, res) => res.status(404).json({ status: 'error', message: 'Not part of this isolated fixture' }));
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
const serve = process.argv.includes('--serve');
const server = app.listen(serve ? 4316 : 0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
async function call(method: string, route: string, userId = 1, body?: unknown) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${token(userId)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { code: response.status, ...(await response.json()) };
}
const grant = (memberId: number, deals: 'none' | 'view' | 'edit', conversations: 'none' | 'view' | 'reply', userId = 1) => call('PUT', `/workspaces/7/members/${memberId}/permissions`, userId, { permissions: { deals, conversations } });
try {
  assert.equal((await call('GET', '/deals?workspace_id=7', 0)).code, 401);
  assert.equal((await call('GET', '/deals?workspace_id=7', 99)).code, 403);
  assert.deepEqual((await call('GET', '/deals?workspace_id=7', 2)).data.map((deal: any) => deal.id), [1]);
  assert.equal((await call('GET', '/deals?workspace_id=7')).data.length, 3);
  assert.equal((await call('PUT', '/deals/1', 2, { stage: 'proposal' })).code, 403);
  assert.equal((await grant(12, 'edit', 'reply', 2)).code, 403, 'Members cannot escalate their own access');
  assert.equal((await grant(22, 'edit', 'reply')).code, 404, 'Another workspace membership cannot be changed');
  assert.equal((await grant(11, 'view', 'view')).code, 400, 'Admins retain full access');
  assert.equal((await call('PUT', '/workspace-members/11', 1, { workspace_id: 7, role: 'member' })).code, 400, 'The owner cannot be demoted through a legacy member route');
  assert.equal((await call('PUT', '/workspace-members/22', 1, { workspace_id: 7, role: 'admin' })).code, 404);
  assert.equal((await call('DELETE', '/workspace-members/22?workspace_id=7')).code, 404);
  assert.equal((await call('PUT', '/workspaces/7/members/12/permissions', 1, { permissions: { deals: 'all', conversations: 'reply' } })).code, 400);
  assert.equal((await grant(13, 'edit', 'view')).code, 200);
  assert.equal((await call('POST', '/deals/pipelines', 3, { workspace_id: 7, name: 'Blocked pipeline' })).code, 403);
  assert.equal((await call('PUT', '/customers/lead%3A70', 2, { workspace_id: 7, address: 'Unauthorized edit' })).code, 403);
  assert.equal((await call('GET', '/whatsapp/7/messages', 2)).code, 200, 'Viewers can read WhatsApp logs');
  assert.equal((await call('PUT', '/deals/2', 3, { stage: 'proposal' })).code, 200);
  assert.equal((await call('PUT', '/deals/1', 3, { stage: 'proposal', owner_id: 3 })).code, 403, 'Cannot take ownership of another member’s deal');
  assert.equal((await call('PUT', '/deals/2', 3, { owner_id: 2 })).code, 403);
  assert.equal((await call('DELETE', '/deals/2', 3)).code, 403);
  assert.equal((await call('PUT', '/deals/2', 1, { owner_id: 99 })).code, 403);
  assert.equal((await call('POST', '/deals', 2, { workspace_id: 7, name: 'Blocked', contact: 'Demo' })).code, 403);
  const created = await call('POST', '/deals', 3, { workspace_id: 7, name: 'Own deal', contact: 'Demo' });
  assert.equal(created.code, 200); assert.equal(created.data.owner_id, 3);
  assert.equal((await call('POST', '/deals', 3, { workspace_id: 7, name: 'Other assignment', contact: 'Demo', owner_id: 2 })).code, 403);
  assert.equal((await call('PUT', '/deals/2', 1, { owner_id: 2 })).code, 200);
  assert.equal((await call('PUT', '/deals/2', 3, { stage: 'won' })).code, 403, 'Reassignment takes effect without a new login');
  await call('PUT', '/deals/2', 1, { owner_id: 3, stage: 'won' });
  const customers = await call('GET', '/customers?workspace_id=7', 2);
  assert.equal(customers.code, 200); assert.equal(customers.data.length, 1);
  assert.deepEqual(customers.data[0].orders.map((order: any) => order.deal_id), [1], 'Customer history cannot reveal another member’s deals');
  const visibleActivities = await call('GET', '/leads/70/activities', 2);
  assert.deepEqual(visibleActivities.data.map((activity: any) => activity.id), [1, 3, 4]);
  const activityBody = { lead_id: 70, workspace_id: 7, user_id: 2, type: 'email', title: 'Message', description: 'Hello' };
  assert.equal((await call('POST', '/leads/70/activities', 2, activityBody)).code, 403);
  assert.equal((await call('PUT', '/lead-activities/3', 2, { description: 'Overwrite' })).code, 403);
  assert.equal((await call('DELETE', '/lead-activities/3', 2)).code, 403);
  assert.equal((await call('GET', '/instagram/7/conversations', 2)).code, 200);
  const messages = await call('GET', '/instagram/7/conversations/conv-1/messages', 2);
  assert.equal(messages.data.can_reply, false); assert.equal(messages.data.messages[0].message, 'Could you please review the new design?');
  const beforeProvider = providerCalls;
  assert.equal((await call('POST', '/instagram/7/conversations/conv-1/messages', 2, { text: 'Blocked' })).code, 403);
  assert.equal((await call('POST', '/instagram/7/conversations/conv-1/messages', 3, { text: 'Blocked' })).code, 403, 'Deal editing does not grant reply access');
  assert.equal((await call('POST', '/whatsapp/7/leads/70/send-no-answer', 2)).code, 403);
  assert.equal(providerCalls, beforeProvider); assert.equal(sent, 0);
  assert.equal((await grant(12, 'view', 'reply')).code, 200);
  assert.equal((await call('POST', '/leads/70/activities', 2, { ...activityBody, type: 'note' })).code, 200, 'Ordinary internal notes still work');
  assert.equal((await call('POST', '/instagram/7/conversations/conv-1/messages', 2, { text: 'Mock reply' })).code, 200);
  assert.equal(sent, 1, 'Allowed replies reach only the fake provider');
  assert.equal((await call('PUT', '/deals/1', 2, { stage: 'proposal' })).code, 403, 'Reply access does not grant deal editing');
  await grant(12, 'none', 'none');
  const permissionSnapshot = JSON.stringify(rows);
  failPermissionWrite = true;
  assert.equal((await grant(12, 'edit', 'reply')).code, 503, 'Failed saves must not report success or change access');
  failPermissionWrite = false;
  assert.equal(JSON.stringify(rows), permissionSnapshot);
  assert.deepEqual((await getWorkspaceAccess(2, 7)).permissions, { deals: 'none', conversations: 'none' });
  assert.equal((await call('GET', '/deals?workspace_id=7', 2)).data.length, 0);
  assert.equal((await call('GET', '/instagram/7/conversations', 2)).code, 403);
  assert.equal((await call('GET', '/whatsapp/7/messages', 2)).code, 403);
  assert.equal((await call('GET', '/leads/70/activities', 2)).data.length, 2);
  assert.equal((await call('GET', '/customers?workspace_id=7', 2)).data.length, 0);
  missingPermissionData = true;
  assert.equal((await call('GET', '/workspaces/7/permissions', 2)).code, 503, 'Missing database results cannot fall back to wider default permissions');
  missingPermissionData = false;
  const policy = rows.find((row) => row.event_id === 'member_permissions_12_2');
  const savedPayload = policy.payload;
  policy.payload = '{invalid-json';
  assert.equal((await call('GET', '/workspaces/7/permissions', 2)).code, 503);
  policy.payload = savedPayload;
  assert.deepEqual((await getWorkspaceAccess(2, 8)).permissions, { deals: 'view', conversations: 'view' }, 'Permissions are independent per workspace');
  members.find((member) => member.id === 12).id = 120;
  assert.deepEqual((await getWorkspaceAccess(2, 7)).permissions, { deals: 'view', conversations: 'view' }, 'Rejoining cannot revive an old grant');
  failPermissions = true;
  assert.equal((await call('GET', '/workspaces/7/permissions', 2)).code, 503);
  assert.equal((await call('PUT', '/deals/1', 2, { stage: 'proposal' })).code, 500, 'Permission lookup failure never grants access');
  failPermissions = false;
  assert.equal((await call('PUT', '/workspace-members/13', 1, { workspace_id: 7, role: 'admin' })).code, 200);
  assert.equal((await getWorkspaceAccess(3, 7)).role, 'admin');
  assert.equal((await call('PUT', '/deals/1', 3, { name: 'Admin edit' })).code, 200);
  assert.equal((await call('PUT', '/workspace-members/13', 1, { workspace_id: 7, role: 'member' })).code, 200);
  assert.equal((await call('PUT', '/deals/1', 3, { name: 'Blocked after demotion' })).code, 403);
  assert.equal((await call('DELETE', '/deals/3', 1)).code, 200, 'Admins retain deal deletion');
  members = members.filter((member) => member.user_id !== 3);
  assert.equal((await call('GET', '/deals?workspace_id=7', 3)).code, 403, 'Removed members lose access with existing tokens');
  console.log('PASS: assigned visibility, independent view/edit/reply permissions, admin boundaries, workspace isolation, activity/customer privacy, reassignment, revocation, rejoining, and fail-closed checks. No live messages or database writes.');
  if (serve) {
    reset();
    await saveMemberPermissions(7, members.find((member) => member.id === 13), { deals: 'edit', conversations: 'reply' });
    await saveMemberPermissions(8, members.find((member) => member.id === 22), { deals: 'edit', conversations: 'none' });
    console.log('UI fixture at http://127.0.0.1:4316/login. Use admin@example.test, designer@example.test, or sales@example.test with any test password.');
  }
} finally {
  if (!serve) { server.close(); server.closeAllConnections(); globalThis.fetch = originalFetch; }
}
