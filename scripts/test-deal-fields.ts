// node --import tsx scripts/test-deal-fields.ts
// Optional --serve opens an isolated UI fixture on 127.0.0.1:4316 using dist/.
// All database calls are in memory. No production credentials or records are used.
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { DealCustomField } from '../types/dealFields.js';

process.env.JWT_SECRET = 'deal-fields-test-only-do-not-deploy';
const { webhookLogsApi, dealsApi, dealPipelinesApi, dealStageHistoryApi, workspacesApi, workspaceMembersApi, leadsApi, leadActivitiesApi } = await import('../services/api.js');
const { default: router } = await import('../routes/dealsRoutes.js');
const { DEFAULT_DEAL_STAGES } = await import('../services/dealStages.js');
const { dealFieldErrors } = await import('../lib/dealFields.js');
let records: any[] = [];
let nextId = 100;
let historyCount = 0;
let failWrite = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (new URL(String(input)).hostname !== '127.0.0.1') throw new Error('External network is blocked in deal field tests');
  return originalFetch(input, init);
};
const workspaces = [{ id: 7, name: 'Deal fields demo', owner_id: 1, currency: 'INR' }, { id: 8, name: 'Separate workspace', owner_id: 1, currency: 'INR' }];
const user = { id: 1, name: 'Demo Admin', email: 'demo@example.test', accepted_terms: 1 };
const response = (data: any): any => ({ status: 'success', data });
webhookLogsApi.getWebhookLogs = async (params: any) => response(records.filter((row) => row.workspace_id === params.workspace_id && (!params.status || row.status === params.status)));
webhookLogsApi.createWebhookLog = async (body: any) => {
  if (failWrite) return { status: 'error' };
  const record = { ...body, id: nextId++ };
  records.push(record);
  return response(record);
};
webhookLogsApi.updateWebhookLog = async (id: number, body: any) => {
  if (failWrite) return { status: 'error' };
  records = records.map((record) => record.id === id ? { ...record, ...body } : record);
  return response(records.find((record) => record.id === id));
};
dealsApi.getDealById = async (id: number) => response(records.find((record) => record.id === id));
dealsApi.getDeals = async (params: any) => response(records.filter((record) => record.workspace_id === params.workspace_id && record.status === 'deal'));
dealsApi.createDeal = webhookLogsApi.createWebhookLog;
dealsApi.updateDeal = webhookLogsApi.updateWebhookLog;
dealsApi.deleteDeal = async (id: number) => { records = records.filter((record) => record.id !== id); return response(null); };
dealPipelinesApi.getPipelines = async () => response([]);
dealStageHistoryApi.createStageHistory = async () => { historyCount++; return response(null); };
workspacesApi.getWorkspaceById = async (id: number) => response(workspaces.find((workspace) => workspace.id === id));
workspaceMembersApi.getWorkspaceMembers = async (params: any) => response(Number(typeof params === 'number' ? params : params?.workspace_id) === 7 ? [{ id: 20, user_id: 2, workspace_id: 7, role: 'member' }] : []);
leadsApi.getLeadById = async (id: number) => response({ id, name: 'Demo lead', workspace_id: id === 70 ? 7 : 8 });
leadActivitiesApi.createActivity = async () => response(null);
const app = express();
app.use(express.json());
app.use('/api/deals', router);
const token = (id: number) => jwt.sign({ id }, process.env.JWT_SECRET!, { expiresIn: '1h' });
app.post('/api/auth/login', (_req, res) => res.json({ success: true, data: { user, token: token(1) } }));
app.get('/api/auth/me', (_req, res) => res.json({ success: true, data: { user } }));
app.get('/api/workspaces', (_req, res) => res.json(response(workspaces)));
app.get('/api/workspaces/:id/permissions', (req, res) => res.json(response({ workspace_id: Number(req.params.id), user_id: 1, hasAccess: true, role: 'admin', permissions: { deals: 'edit', conversations: 'reply' } })));
app.get('/api/workspaces/:id/members', (req, res) => res.json(response([{ id: 1, user_id: 1, workspace_id: Number(req.params.id), role: 'admin', user_name: user.name, user_email: user.email, user }])));
app.get('/api/workspaces/:id', (req, res) => res.json(response(workspaces.find((workspace) => workspace.id === Number(req.params.id)))));
app.get('/api/workspaces/:id/lead-statuses', (_req, res) => res.json(response([])));
app.use('/api', (_req, res) => res.status(404).json({ status: 'error', message: 'Not part of this isolated test fixture' }));
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
const server = app.listen(process.argv.includes('--serve') ? 4316 : 0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/deals`;
async function call(method: string, route: string, body?: unknown, userId = 1) {
  const result = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${token(userId)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { code: result.status, ...(await result.json()) };
}
try {
  const stages = DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage }));
  let fields: DealCustomField[] = [
    { id: 'df_budget', label: 'Approved budget', type: 'number', options: [], archived: false, required_in_stages: ['proposal', 'won'] },
    { id: 'df_reference', label: 'Purchase order', type: 'text', options: [], archived: false, required_in_stages: ['won'] },
  ];
  const configuration = () => ({ workspace_id: 7, stages, fields });
  assert.equal((await call('GET', '/configuration?workspace_id=7', undefined, 0)).code, 401);
  assert.equal((await call('GET', '/configuration?workspace_id=7', undefined, 99)).code, 403);
  assert.deepEqual((await call('GET', '/configuration?workspace_id=7')).data.fields, []);
  assert.equal((await call('PUT', '/configuration', configuration(), 2)).code, 403);
  const { saveMemberPermissions } = await import('../services/workspacePermissions.js');
  await saveMemberPermissions(7, { id: 20, user_id: 2, workspace_id: 7, role: 'member' } as any, { deals: 'edit', conversations: 'view' });
  assert.equal((await call('PUT', '/configuration', configuration())).code, 200);
  assert.deepEqual((await call('GET', '/configuration?workspace_id=8')).data.fields, []);
  assert.equal((await call('PUT', '/configuration', { ...configuration(), fields: [...fields, fields[0]] })).code, 400);
  assert.equal((await call('PUT', '/configuration', { ...configuration(), fields: [{ ...fields[0], required_in_stages: ['outside'] }] })).code, 400);
  assert.equal((await call('PUT', '/configuration', { ...configuration(), fields: [] })).code, 409);
  assert.equal((await call('PUT', '/configuration', { ...configuration(), fields: [{ ...fields[0], type: 'text' }, fields[1]] })).code, 409);
  const create = { workspace_id: 7, name: 'Sample deal', contact: 'Demo contact', priority: null, expected_close_date: null };
  assert.equal((await call('POST', '', { ...create, stage: 'won' })).code, 422);
  assert.equal((await call('POST', '', { ...create, custom_fields: { df_other_workspace: 'test' } })).code, 400);
  assert.equal((await call('POST', '', { ...create, custom_fields: { df_budget: 123 } })).code, 400);
  const created = await call('POST', '', create, 2);
  assert.equal(created.code, 200);
  const id = created.data.id;
  const before = JSON.stringify(records);
  assert.equal((await call('PUT', `/${id}`, { stage: 'won' })).code, 422);
  assert.equal(JSON.stringify(records), before, 'Rejected moves must not mutate the deal or mark a conversion');
  assert.equal(historyCount, 0);
  assert.equal((await call('PUT', `/${id}`, { stage: 'proposal', custom_fields: { df_budget: 'no' } })).code, 422);
  const moved = await call('PUT', `/${id}`, { stage: 'proposal', custom_fields: { df_budget: '0' } }, 2);
  assert.equal(moved.code, 200, 'Zero satisfies a required number field');
  assert.equal(moved.data.custom_fields.df_budget, '0');
  assert.equal(historyCount, 1);
  assert.equal((await call('PUT', `/${id}`, { stage: 'won', custom_fields: { df_reference: '<b></b>  ' } })).code, 422);
  const converted = await call('PUT', `/${id}`, { stage: 'won', custom_fields: { df_reference: 'PO-123' } });
  assert.equal(converted.code, 200);
  assert(converted.data.converted_at);
  assert.equal(converted.data.custom_fields.df_budget, '0', 'Partial edits retain prior field values');
  assert.equal((await call('PUT', `/${id}`, { expected_close_date: null, priority: null })).code, 200, 'Optional values can be cleared from the edit form');
  assert.equal((await call('PUT', `/${id}`, { custom_fields: { df_reference: '' } })).code, 422);
  assert.equal((await call('PUT', `/${id}`, { stage: 'lost' }, 99)).code, 403);
  const other = await call('POST', '', { workspace_id: 8, name: 'Other', stage: 'won' });
  assert.equal(other.code, 200, 'Rules must not leak to another workspace');
  assert.equal((await call('PUT', `/${other.data.id}`, { custom_fields: { df_budget: '1' } })).code, 400);
  fields = fields.map((field) => ({ ...field, label: `${field.label} updated`, archived: true }));
  assert.equal((await call('PUT', '/configuration', configuration())).code, 200);
  const archivedUpdate = await call('PUT', `/${id}`, { name: 'Renamed deal' });
  assert.equal(archivedUpdate.code, 200);
  assert.equal(archivedUpdate.data.custom_fields.df_reference, 'PO-123', 'Archiving retains saved values');
  assert.equal((await call('PUT', `/${id}`, { custom_fields: { df_reference: 'overwrite' } })).code, 400);
  fields = fields.map((field) => ({ ...field, archived: false, required_in_stages: ['new_lead', 'won'] }));
  assert.equal((await call('PUT', '/configuration', configuration())).code, 200);
  assert.equal((await call('POST', '', { ...create, lead_id: 70 })).code, 422, 'Lead-to-deal creation must enforce the first stage');
  assert.equal((await call('POST', '', { ...create, lead_id: 70, custom_fields: { df_budget: '20', df_reference: 'PO-456' } })).code, 200);
  assert.equal((await call('PUT', '/stages', { workspace_id: 7, stages: stages.map((stage) => ({ ...stage, name: `${stage.name} renamed` })) })).code, 200);
  assert.equal((await call('GET', '/configuration?workspace_id=7')).data.fields.length, 2, 'Legacy stage edits must retain field definitions');
  assert.equal((await call('PUT', '/stages', { workspace_id: 7, stages: stages.filter((stage) => stage.slug !== 'won') })).code, 409, 'Occupied stages cannot be removed');
  const dateField = { ...fields[0]!, type: 'date' as const, required_in_stages: [] };
  assert(Object.keys(dealFieldErrors([dateField], { df_budget: '2026-02-30' }, 'won')).length);
  assert.equal(Object.keys(dealFieldErrors([dateField], { df_budget: '2024-02-29' }, 'won')).length, 0);
  const optionField = { ...dateField, type: 'select' as const, options: ['A', 'B'] };
  assert(Object.keys(dealFieldErrors([optionField], { df_budget: 'C' }, 'won')).length);
  failWrite = true;
  assert.equal((await call('PUT', '/configuration', configuration())).code, 500);
  failWrite = false;
  console.log('PASS: deal field validation, all write paths, stage rules, conversion safety, archiving, workspace isolation, admin access and legacy compatibility.');
  if (process.argv.includes('--serve')) {
    records = [];
    nextId = 100;
    console.log('Isolated UI fixture ready at http://127.0.0.1:4316 — sign in with demo@example.test and any test password.');
  }
} finally {
  if (!process.argv.includes('--serve')) { server.close(); globalThis.fetch = originalFetch; }
}
