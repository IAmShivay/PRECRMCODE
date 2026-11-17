import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'route-security-smoke-secret';
process.env.API_KEY = 'route-security-smoke-key';
process.env.API_CACHE_TTL_MS = '0';

const originalFetch = globalThis.fetch;
const writes = [];
const user = { id: 1, name: 'Owner', email: 'owner@example.test', password: 'hidden-hash' };
const lead = { id: 10, workspace_id: 100 };
const activity = { id: 20, lead_id: 10, workspace_id: 100, user_id: 1, type: 'note', title: 'Note', description: 'Test' };
const value = { id: 30, lead_id: 10, field_id: 40, value: 'Test' };

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.nocodebackend.com') {
    return originalFetch(input, options);
  }

  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') writes.push({ path: url.pathname, method, body: options.body ? JSON.parse(options.body) : null });
  let data;
  switch (url.pathname) {
    case '/read/users':
    case '/search/users':
      data = [user];
      break;
    case '/read/users/1':
      data = user;
      break;
    case '/read/leads/10':
      data = lead;
      break;
    case '/read/workspaces/100':
      data = { id: 100, owner_id: 1 };
      break;
    case '/read/workspace_members':
      data = [];
      break;
    case '/read/lead_activities':
      data = [activity, { ...activity, id: 21, lead_id: 11, workspace_id: 200 }];
      break;
    case '/read/lead_activities/20':
      data = activity;
      break;
    case '/read/lead_custom_field_values/30':
      data = value;
      break;
    case '/read/lead_custom_fields':
      data = { id: 40, workspace_id: 100 };
      break;
    default:
      data = { id: 99 };
  }

  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const [{ default: usersRoutes }, { default: activitiesRoutes }, { default: fieldsRoutes }] = await Promise.all([
  import('../routes/usersRoutes.ts'),
  import('../routes/leadActivitiesRoutes.ts'),
  import('../routes/customFieldsRoutes.ts'),
]);

const app = express();
app.use(express.json());
app.use('/api/users', usersRoutes);
app.use('/api', activitiesRoutes);
app.use('/api', fieldsRoutes);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const ownerToken = jwt.sign({ id: 1, email: user.email }, process.env.JWT_SECRET);
const outsiderToken = jwt.sign({ id: 2, email: 'outsider@example.test' }, process.env.JWT_SECRET);

async function request(path, token, method = 'GET', body) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

try {
  assert.equal((await request('/api/leads/10/activities')).status, 401);
  assert.equal((await request('/api/leads/10/activities', outsiderToken)).status, 403);
  const activities = await request('/api/leads/10/activities', ownerToken);
  assert.equal(activities.status, 200);
  assert.deepEqual(activities.body.data.map((row) => row.id), [20]);

  for (const path of ['/api/users', '/api/users/1']) {
    const response = await request(path, ownerToken);
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(response.body).includes('hidden-hash'), false);
  }
  const search = await request('/api/users/search', ownerToken, 'POST', { email: user.email });
  assert.equal(search.status, 200);
  assert.equal(JSON.stringify(search.body).includes('hidden-hash'), false);

  const newActivity = { lead_id: 10, workspace_id: 100, user_id: 2, type: 'note', title: 'Note', description: 'Test' };
  assert.equal((await request('/api/leads/10/activities', outsiderToken, 'POST', newActivity)).status, 403);
  assert.equal((await request('/api/lead-activities/20', outsiderToken, 'PUT', { title: 'Changed' })).status, 403);
  assert.equal((await request('/api/lead-activities/20', outsiderToken, 'DELETE')).status, 403);
  assert.equal((await request('/api/leads/10/activities', ownerToken, 'POST', { ...newActivity, workspace_id: 200 })).status, 400);
  assert.equal((await request('/api/leads/10/activities', ownerToken, 'POST', newActivity)).status, 200);
  assert.equal(writes.at(-1).body.user_id, 1);

  assert.equal((await request('/api/custom-field-values', outsiderToken, 'POST', { lead_id: 10, field_id: 40, value: 'Test' })).status, 403);
  assert.equal((await request('/api/custom-field-values/30', outsiderToken, 'PUT', { value: 'Changed' })).status, 403);
  assert.equal((await request('/api/custom-field-values/30', outsiderToken, 'DELETE')).status, 403);
  assert.equal((await request('/api/custom-field-values/30', ownerToken, 'PUT', { lead_id: 11 })).status, 400);
  assert.equal((await request('/api/custom-field-values', ownerToken, 'POST', { lead_id: 10, field_id: 40, value: 'Test' })).status, 200);
  console.log('Route security smoke test passed.');
} finally {
  server.close();
  globalThis.fetch = originalFetch;
}
