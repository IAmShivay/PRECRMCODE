import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'customers-smoke-secret';
process.env.API_KEY = 'customers-smoke-key';
process.env.API_CACHE_TTL_MS = '0';

const originalFetch = globalThis.fetch;
const lead = { id: 10, workspace_id: 100, name: 'Ada', email: 'ada@example.test', phone: '123' };
const makeLog = (id, workspaceId, stage, value, leadId = 0) => ({
  id,
  workspace_id: workspaceId,
  lead_id: leadId,
  status: 'deal',
  created_at: '2026-01-01 10:00:00',
  payload: JSON.stringify({
    name: `Deal ${id}`,
    contact: leadId ? 'Ada' : 'Walk-in contact',
    lead_id: leadId || undefined,
    stage,
    value,
    pipeline_slug: 'default',
    created_at: '2026-01-01 10:00:00',
    updated_at: '2026-01-02 10:00:00',
  }),
});
const logs = new Map([
  [101, makeLog(101, 100, 'won', 100, 10)],
  [102, makeLog(102, 100, 'won', 50, 10)],
  [103, makeLog(103, 100, 'lost', 25, 10)],
  [104, makeLog(104, 100, 'won', 40)],
  [105, makeLog(105, 200, 'won', 999, 99)],
]);
let nextLogId = 200;

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.nocodebackend.com') return originalFetch(input, options);
  const method = String(options.method || 'GET').toUpperCase();
  let data;
  if (url.pathname === '/read/workspaces/100') data = { id: 100, owner_id: 1 };
  else if (url.pathname === '/read/workspaces/200') data = { id: 200, owner_id: 3 };
  else if (url.pathname === '/read/workspace_members') data = Number(url.searchParams.get('workspace_id')) === 100
    ? [{ workspace_id: 100, user_id: 2, role: 'member' }]
    : [];
  else if (url.pathname === '/read/leads') data = [lead];
  else if (url.pathname === '/read/lead_webhook_logs') data = Array.from(logs.values()).filter((log) =>
    (!url.searchParams.get('status') || log.status === url.searchParams.get('status')) &&
    (!url.searchParams.get('workspace_id') || Number(log.workspace_id) === Number(url.searchParams.get('workspace_id')))
  );
  else if (url.pathname.startsWith('/read/lead_webhook_logs/')) {
    data = logs.get(Number(url.pathname.split('/').at(-1)));
  } else if (url.pathname.startsWith('/update/lead_webhook_logs/') && method === 'PUT') {
    const id = Number(url.pathname.split('/').at(-1));
    logs.set(id, { id, ...JSON.parse(options.body) });
    data = logs.get(id);
  } else if (url.pathname === '/create/lead_webhook_logs' && method === 'POST') {
    data = { id: ++nextLogId, ...JSON.parse(options.body) };
    logs.set(data.id, data);
  } else {
    throw new Error(`Unexpected NoCodeBackend request: ${method} ${url.pathname}`);
  }
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const [{ default: customersRoutes }, { default: dealsRoutes }] = await Promise.all([
  import('../routes/customersRoutes.ts'),
  import('../routes/dealsRoutes.ts'),
]);
const app = express();
app.use(express.json());
app.use('/api/customers', customersRoutes);
app.use('/api/deals', dealsRoutes);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const token = jwt.sign({ id: 1, email: 'owner@example.test' }, process.env.JWT_SECRET);
const memberToken = jwt.sign({ id: 2, email: 'member@example.test' }, process.env.JWT_SECRET);

async function request(path, method = 'GET', body, authenticated = true, authToken = token) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(authenticated ? { authorization: `Bearer ${authToken}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

try {
  assert.equal((await request('/api/customers?workspace_id=100', 'GET', undefined, false)).status, 401);
  assert.equal((await request('/api/customers?workspace_id=bad')).status, 400);
  assert.equal((await request('/api/customers?workspace_id=200')).status, 403);

  let result = await request('/api/customers?workspace_id=100');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 2);
  assert.deepEqual(result.body.data.map((customer) => customer.id).sort(), ['deal:104', 'lead:10']);
  let customer = result.body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.name, 'Ada');
  assert.equal(customer.email, 'ada@example.test');
  assert.equal(customer.order_count, 2);
  assert.equal(customer.total_value, 150);
  assert.deepEqual(customer.orders.map((order) => order.deal_id).sort(), [101, 102]);
  assert.equal(JSON.stringify(result.body).includes('999'), false);

  result = await request('/api/deals/103', 'PUT', { stage: 'won' });
  assert.equal(result.status, 200);
  assert.ok(JSON.parse(logs.get(103).payload).won_at);
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.order_count, 3);
  assert.equal(customer.total_value, 175);

  result = await request('/api/deals/103', 'PUT', { stage: 'lost' });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(logs.get(103).payload).won_at, undefined);
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.order_count, 2);
  assert.equal(customer.total_value, 150);
  assert.equal(lead.id, 10);

  const profile = {
    workspace_id: 100,
    email: 'customer@example.test',
    phone: '555-1234',
    address: '12 Market Street',
    custom_fields: [{ label: 'Preferred delivery', value: 'Morning' }],
    order_items: { 101: [{ name: 'Starter kit', quantity: 2 }] },
  };
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', profile, false)).status, 401);
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', { ...profile, workspace_id: 200 })).status, 403);
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', { ...profile, order_items: { 104: [{ name: 'Another customer item', quantity: 1 }] } })).status, 400);
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', { ...profile, order_items: { 105: [{ name: 'Other workspace item', quantity: 1 }] } })).status, 400);
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', { ...profile, custom_fields: [{ label: 'Tier', value: 'A' }, { label: 'tier', value: 'B' }] })).status, 400);
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', { ...profile, order_items: { 101: [{ name: 'Kit', quantity: 0 }] } })).status, 400);
  assert.equal((await request('/api/customers/lead%3A999', 'PUT', profile)).status, 404);
  result = await request('/api/customers/lead%3A10', 'PUT', profile);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.email, 'customer@example.test');
  assert.equal(result.body.data.address, '12 Market Street');
  assert.deepEqual(result.body.data.orders.find((order) => order.deal_id === 101).items, [{ name: 'Starter kit', quantity: 2 }]);
  const storedProfile = Array.from(logs.values()).find((log) => log.status === 'customer_profile');
  assert.equal(storedProfile.workspace_id, 100);
  assert.equal(storedProfile.lead_id, 10);
  assert.equal(JSON.parse(storedProfile.payload).customer_id, 'lead:10');

  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.phone, '555-1234');
  assert.equal(customer.custom_fields[0].value, 'Morning');
  assert.deepEqual(customer.orders.find((order) => order.deal_id === 101).items, [{ name: 'Starter kit', quantity: 2 }]);

  result = await request('/api/customers/lead%3A10', 'PUT', {
    ...profile,
    email: undefined,
    phone: undefined,
  });
  assert.equal(result.status, 200);
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.email, lead.email);
  assert.equal(customer.phone, lead.phone);
  assert.equal(customer.address, '12 Market Street');
  assert.equal(Array.from(logs.values()).filter((log) => log.status === 'customer_profile').length, 1);

  result = await request('/api/customers/deal%3A104', 'PUT', {
    workspace_id: 100,
    email: 'walkin@example.test',
    address: '7 High Street',
    custom_fields: [],
    order_items: { 104: [{ name: 'Service package', quantity: 1 }] },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.email, 'walkin@example.test');
  assert.equal(result.body.data.orders[0].items[0].name, 'Service package');

  logs.set(300, {
    id: 300, workspace_id: 200, lead_id: 99, status: 'customer_profile',
    payload: JSON.stringify({ customer_id: 'lead:10', email: 'wrong-workspace@example.test' }),
  });
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.email, lead.email);

  assert.equal((await request('/api/deals/101', 'PUT', { stage: 'lost' })).status, 200);
  assert.equal((await request('/api/customers/lead%3A10', 'PUT', {
    workspace_id: 100,
    address: '12 Market Street',
    custom_fields: [],
    order_items: { 102: [] },
  })).status, 200);
  assert.equal((await request('/api/deals/101', 'PUT', { stage: 'won' })).status, 200);
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.deepEqual(customer.orders.find((order) => order.deal_id === 101).items, [{ name: 'Starter kit', quantity: 2 }]);
  const defaultStages = (await request('/api/deals/stages?workspace_id=100')).body.data;
  assert.equal(defaultStages.find((stage) => stage.slug === 'won').counts_as_conversion, true);
  assert.equal(defaultStages.find((stage) => stage.slug === 'qualified').counts_as_conversion, false);
  assert.equal((await request('/api/deals/stages?workspace_id=100', 'GET', undefined, true, memberToken)).status, 200);
  assert.equal((await request('/api/deals/stages', 'PUT', { workspace_id: 100, stages: defaultStages }, true, memberToken)).status, 403);
  assert.equal((await request('/api/deals/stages?workspace_id=200')).status, 403);
  assert.equal((await request('/api/deals/stages', 'PUT', { workspace_id: 200, stages: defaultStages })).status, 403);
  assert.equal((await request('/api/deals/stages', 'PUT', {
    workspace_id: 100,
    stages: defaultStages.map((stage) => ({ ...stage, name: 'Duplicate' })),
  })).status, 400);
  assert.equal((await request('/api/deals/stages', 'PUT', {
    workspace_id: 100,
    stages: defaultStages.filter((stage) => stage.slug !== 'won'),
  })).status, 409);

  logs.set(106, makeLog(106, 100, 'qualified', 35, 10));
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.order_count, 2);

  const customStages = [
    ...defaultStages.map((stage) => stage.slug === 'qualified'
      ? { ...stage, name: 'Sales Qualified', counts_as_conversion: true }
      : stage),
    { slug: 'activated', name: 'Activated', color: '#2563EB', counts_as_conversion: true },
  ];
  assert.equal((await request('/api/deals/stages', 'PUT', { workspace_id: 100, stages: customStages })).status, 200);
  assert.equal((await request('/api/deals/stages?workspace_id=100')).body.data.find((stage) => stage.slug === 'qualified').name, 'Sales Qualified');
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.order_count, 3);
  assert.equal(customer.total_value, 185);
  result = await request('/api/deals/103', 'PUT', { stage: 'activated' });
  assert.equal(result.status, 200);
  assert.ok(JSON.parse(logs.get(103).payload).converted_at);
  customer = (await request('/api/customers?workspace_id=100')).body.data.find((item) => item.id === 'lead:10');
  assert.equal(customer.order_count, 4);
  assert.equal(customer.total_value, 210);
  assert.equal((await request('/api/deals/stages', 'PUT', {
    workspace_id: 100,
    stages: customStages.filter((stage) => stage.slug !== 'activated'),
  })).status, 409);
  assert.equal((await request('/api/deals/103', 'PUT', { stage: 'missing_stage' })).status, 400);
  console.log('Customers conversion and workspace smoke test passed.');
} finally {
  server.close();
  globalThis.fetch = originalFetch;
}
