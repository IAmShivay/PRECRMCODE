import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'prospects-smoke-secret';
process.env.API_KEY = 'prospects-smoke-key';
process.env.API_CACHE_TTL_MS = '0';

const originalFetch = globalThis.fetch;
const leads = [
  { id: 10, workspace_id: 100, status_id: 1, name: 'Qualified', email: 'qualified@example.test' },
  { id: 11, workspace_id: 100, status_id: 2, name: 'Potential', email: 'potential@example.test' },
  { id: 12, workspace_id: 100, status_id: 2, name: 'Deleted', deleted_at: '2026-01-01 10:00:00' },
  { id: 13, workspace_id: 200, status_id: 3, name: 'Other workspace' },
];
const statuses = [
  { id: 1, workspace_id: 100, name: 'Qualified', is_qualified: 1 },
  { id: 2, workspace_id: 100, name: 'New', is_qualified: 0 },
  { id: 3, workspace_id: 200, name: 'Qualified', is_qualified: 1 },
];
const logs = new Map();
let nextId = 100;

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.nocodebackend.com') return originalFetch(input, options);
  const method = String(options.method || 'GET').toUpperCase();
  const workspaceId = Number(url.searchParams.get('workspace_id'));
  let data;
  if (url.pathname === '/read/workspaces/100') data = { id: 100, owner_id: 1 };
  else if (url.pathname === '/read/workspaces/200') data = { id: 200, owner_id: 2 };
  else if (url.pathname === '/read/workspace_members') data = [];
  else if (url.pathname === '/read/leads') {
    const page = Number(url.searchParams.get('page') || 1);
    const limit = Number(url.searchParams.get('limit') || 200);
    data = leads.filter((lead) => lead.workspace_id === workspaceId).slice((page - 1) * limit, page * limit);
  }
  else if (url.pathname.startsWith('/read/leads/')) data = leads.find((lead) => lead.id === Number(url.pathname.split('/').at(-1)));
  else if (url.pathname === '/read/lead_statuses') data = statuses.filter((status) => status.workspace_id === workspaceId);
  else if (url.pathname === '/read/lead_webhook_logs') data = Array.from(logs.values()).filter((log) =>
    log.workspace_id === workspaceId && (!url.searchParams.get('status') || log.status === url.searchParams.get('status'))
  );
  else if (url.pathname === '/create/lead_webhook_logs' && method === 'POST') {
    data = { id: ++nextId, ...JSON.parse(options.body) };
    logs.set(data.id, data);
  } else if (url.pathname.startsWith('/update/lead_webhook_logs/') && method === 'PUT') {
    const id = Number(url.pathname.split('/').at(-1));
    data = { id, ...JSON.parse(options.body) };
    logs.set(id, data);
  } else throw new Error(`Unexpected database request: ${method} ${url.pathname}`);
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { default: prospectsRoutes } = await import('../routes/prospectsRoutes.ts');
const app = express();
app.use(express.json());
app.use('/api/prospects', prospectsRoutes);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const token = jwt.sign({ id: 1, email: 'owner@example.test' }, process.env.JWT_SECRET);

async function request(path, method = 'GET', body, authenticated = true) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

try {
  assert.equal((await request('/api/prospects?workspace_id=100', 'GET', undefined, false)).status, 401);
  assert.equal((await request('/api/prospects?workspace_id=200')).status, 403);
  let result = await request('/api/prospects?workspace_id=100');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.prospects.map((item) => item.lead.id), [10]);
  assert.deepEqual(result.body.data.candidates.map((item) => item.id), [10, 11]);

  assert.equal((await request('/api/prospects/13', 'PUT', { workspace_id: 100, selected: true })).status, 404);
  assert.equal((await request('/api/prospects/11', 'PUT', { workspace_id: 200, selected: true })).status, 403);
  assert.equal((await request('/api/prospects/11', 'PUT', { workspace_id: 100, selected: 'yes' })).status, 400);
  assert.equal((await request('/api/prospects/11', 'PUT', { workspace_id: 100, selected: true })).status, 200);
  result = await request('/api/prospects?workspace_id=100');
  assert.deepEqual(result.body.data.prospects.map((item) => item.lead.id).sort(), [10, 11]);
  assert.equal(leads.some((lead) => lead.id === 11), true);
  assert.equal((await request('/api/prospects/11', 'PUT', { workspace_id: 100, selected: false })).status, 200);
  result = await request('/api/prospects?workspace_id=100');
  assert.deepEqual(result.body.data.prospects.map((item) => item.lead.id), [10]);

  assert.equal((await request('/api/prospects/10', 'PUT', { workspace_id: 100, selected: true })).status, 200);
  assert.equal((await request('/api/prospects/10', 'PUT', { workspace_id: 100, selected: false })).status, 200);
  assert.deepEqual((await request('/api/prospects?workspace_id=100')).body.data.prospects.map((item) => item.lead.id), [10]);

  logs.set(201, {
    id: 201, workspace_id: 100, lead_id: 10, status: 'deal',
    payload: JSON.stringify({ lead_id: 10, stage: 'won', name: 'Purchased', value: 20 }),
  });
  result = await request('/api/prospects?workspace_id=100');
  assert.deepEqual(result.body.data.prospects, []);
  assert.deepEqual(result.body.data.candidates.map((item) => item.id), [11]);
  assert.equal((await request('/api/prospects/10', 'PUT', { workspace_id: 100, selected: true })).status, 409);
  assert.equal(leads.some((lead) => lead.id === 10), true);

  logs.set(201, {
    ...logs.get(201),
    payload: JSON.stringify({ lead_id: 10, stage: 'qualified', name: 'Qualified deal', value: 20 }),
  });
  assert.deepEqual((await request('/api/prospects?workspace_id=100')).body.data.prospects.map((item) => item.lead.id), [10]);
  logs.set(202, {
    id: 202, workspace_id: 100, lead_id: 0, status: 'deal_stage_config',
    payload: JSON.stringify({ stages: [{ slug: 'qualified', counts_as_conversion: true }] }),
  });
  assert.deepEqual((await request('/api/prospects?workspace_id=100')).body.data.prospects, []);
  for (let id = 1000; id < 1205; id++) {
    leads.push({ id, workspace_id: 100, status_id: 2, name: `Lead ${id}` });
  }
  assert.equal((await request('/api/prospects?workspace_id=100')).body.data.candidates.length, 206);
  console.log('Prospects qualification, selection, conversion, and workspace smoke test passed.');
} finally {
  server.close();
  globalThis.fetch = originalFetch;
}
