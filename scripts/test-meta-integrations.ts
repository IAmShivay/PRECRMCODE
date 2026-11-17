// Run with: node --import tsx scripts/test-meta-integrations.ts
// All database/provider requests are mocked; no live records or messages are touched.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';

process.env.JWT_SECRET = 'test-only-signing-secret-never-deploy';
process.env.INSTAGRAM_APP_ID = '12345';
process.env.INSTAGRAM_APP_SECRET = 'test-instagram-secret';
process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'test-verify';
process.env.PUBLIC_BASE_URL = 'https://example.com';
process.env.FACEBOOK_APP_ID = '54321';
process.env.FACEBOOK_APP_SECRET = 'test-facebook-secret';
process.env.WHATSAPP_CONFIG_ID = '6789';

const { webhookLogsApi, workspacesApi, workspaceMembersApi } = await import('../services/api.js');
const instagram = await import('../services/instagram.js');
const { completeWhatsAppSignup, whatsappSignupSettings } = await import('../services/whatsappOnboarding.js');
const { decodeMetaSignedRequest, signMetaState } = await import('../services/metaSecurity.js');
const { getFacebookPages, FacebookRateLimitError, revokeFacebookUserConnections } = await import('../services/facebook.js');
const { createWorkspaceMetaTemplate, listWorkspaceMetaTemplates, registerWorkspaceWhatsAppPhone } = await import('../services/whatsappAccountManagement.js');
const { whatsAppMetaTemplateSchema } = await import('../utils/validation.js');
const { default: instagramRoutes } = await import('../routes/instagramRoutes.js');
const { default: whatsappRoutes, whatsappWebhookRouter } = await import('../routes/whatsappRoutes.js');
let rows: any[] = [];
let nextId = 1;
let failWrite = false;
webhookLogsApi.getWebhookLogs = async (params: any) => ({ status: 'success', data: rows.filter(row =>
  ['workspace_id', 'source', 'status', 'event_id'].every(key => params[key] === undefined || String(params[key]) === String(row[key])))
  .slice(((params.page || 1) - 1) * (params.limit || 100), (params.page || 1) * (params.limit || 100)) });
webhookLogsApi.createWebhookLog = async (body: any) => {
  if (failWrite) return { status: 'error' };
  rows.push({ ...body, id: nextId++ }); return { status: 'success' };
};
webhookLogsApi.updateWebhookLog = async (id: number, body: any) => {
  if (failWrite) return { status: 'error' };
  rows = rows.map(row => row.id === id ? { ...row, ...body } : row); return { status: 'success' };
};
webhookLogsApi.deleteWebhookLog = async (id: number) => { rows = rows.filter(row => row.id !== id); return { status: 'success' }; };
workspacesApi.getWorkspaceById = async (id: number) => ({ status: 'success', data: { id, owner_id: id === 7 ? 1 : 9 } });
workspaceMembersApi.getWorkspaceMembers = async () => ({ status: 'success', data: [{ id: 20, workspace_id: 7, user_id: 2, role: 'member' }] });

const originalFetch = globalThis.fetch;
let nowMessage = new Date().toISOString();
let wrongConversation = false;
let graphCalls = 0;
let sent = 0;
let shortWrapped = true;
let allowWaba = true;
let phoneStatus = 'CONNECTED';
let registered = 0;
const calls: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === '127.0.0.1') return originalFetch(input, init);
  calls.push(`${init?.method || 'GET'} ${url.hostname}${url.pathname}`);
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.hostname === 'api.instagram.com' && url.pathname === '/oauth/access_token') {
    const data = { access_token: 'short-test-token', user_id: '900', permissions: 'instagram_business_basic,instagram_business_manage_messages' };
    return ok(shortWrapped ? { data: [data] } : data);
  }
  if (url.hostname === 'graph.instagram.com') {
    if (url.pathname === '/access_token' || url.pathname === '/refresh_access_token') return ok({ access_token: 'long-test-token', expires_in: 5184000 });
    if (url.pathname.endsWith('/me')) return ok({ user_id: '800', username: 'demo' });
    if (url.pathname.endsWith('/subscribed_apps')) return ok({ success: true });
    if (url.pathname.endsWith('/conversations')) return ok({ data: [{ id: 'conv-1', participants: { data: [{ id: '800' }, { id: '700', username: 'visitor' }] } }] });
    if (url.pathname.endsWith('/messages')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.recipient.id, '700'); assert.equal(body.message.text, 'Hello'); sent++;
      return ok({ message_id: 'outgoing-1' });
    }
    if (url.pathname.endsWith('/conv-1')) return ok({ id: 'conv-1', participants: { data: [{ id: wrongConversation ? '999' : '800' }, { id: '700' }] }, messages: { data: [
      { id: 'message-1', created_time: nowMessage, from: { id: '700' }, to: { data: [{ id: '800' }] }, message: 'Private incoming message' },
    ] } });
  }
  if (url.hostname === 'graph.facebook.com') {
    if (url.pathname.endsWith('/me/accounts')) { graphCalls++; return ok({ error: { code: 4, message: 'Application request limit reached' } }, 400); }
    if (url.pathname.endsWith('/oauth/access_token')) return ok({ access_token: 'wa-test-token' });
    if (url.pathname.endsWith('/debug_token')) return ok({ data: { is_valid: true, app_id: '54321', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'], granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: [allowWaba ? '500' : '999'] }] } });
    if (url.pathname.endsWith('/500/phone_numbers')) return ok({ data: [{ id: '600', display_phone_number: '+1 555 0100' }] });
    if (url.pathname.endsWith('/500/subscribed_apps')) return ok({ success: true });
    if (url.pathname.endsWith('/500/message_templates')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        assert.equal(body.components[0].text, 'Your appointment is confirmed.');
        return ok({ id: 'template-1', status: 'PENDING' });
      }
      return ok({ data: [{ id: 'template-1', name: 'appointment_update', language: 'en_US', status: 'PENDING', category: 'UTILITY' }] });
    }
    if (url.pathname.endsWith('/600/register')) {
      assert.equal(JSON.parse(String(init?.body)).pin, '123456'); registered++;
      return ok({ success: true });
    }
    if (url.pathname.endsWith('/600')) return ok({ status: phoneStatus, code_verification_status: 'VERIFIED', display_phone_number: '+1 555 0100' });
  }
  throw new Error(`Unexpected network call blocked: ${url.hostname}${url.pathname}`);
};

try {
  const authUrl = new URL(await instagram.startInstagramOAuth(7, 1));
  const state = authUrl.searchParams.get('state')!;
  assert.equal(authUrl.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_messages');
  assert(!authUrl.toString().includes('test-instagram-secret'));
  await assert.rejects(instagram.finishInstagramOAuth(8, 1, 'code', state), /same workspace/);
  await assert.rejects(instagram.finishInstagramOAuth(7, 2, 'code', state), /same workspace/);
  await assert.rejects(instagram.finishInstagramOAuth(7, 1, 'code', state + 'x'), /expired/);
  const view = await instagram.finishInstagramOAuth(7, 1, 'code', state);
  assert.equal(view.connected, true); assert.equal(view.account_id, '800');
  assert(!JSON.stringify(view).includes('token'));
  assert(rows.some(row => row.status === 'ig_connection' && JSON.parse(row.payload).access_token_enc.startsWith('enc:')));
  assert(!JSON.stringify(rows).includes('long-test-token'));
  await assert.rejects(instagram.finishInstagramOAuth(7, 1, 'code', state), /already been used/);
  assert.equal((await instagram.listInstagramConversations(7)).conversations.length, 1);
  assert.equal((await instagram.getInstagramMessages(7, 'conv-1')).can_reply, true);
  await instagram.replyToInstagramConversation(7, 'conv-1', 'Hello'); assert.equal(sent, 1);
  nowMessage = new Date(Date.now() - 25 * 3600000).toISOString();
  await assert.rejects(instagram.replyToInstagramConversation(7, 'conv-1', 'Hello'), /24-hour/); assert.equal(sent, 1);
  wrongConversation = true;
  await assert.rejects(instagram.getInstagramMessages(7, 'conv-1'), /does not belong/);
  wrongConversation = false; nowMessage = new Date().toISOString();
  await instagram.receiveInstagramWebhook({ object: 'instagram', entry: [{ id: '800', messaging: [{ message: { text: 'Private incoming message' } }] }] });
  assert(!JSON.stringify(rows).includes('Private incoming message'));
  assert((await instagram.getInstagramConnection(7)).last_webhook_at);

  const waState = whatsappSignupSettings(7, 1).state!;
  allowWaba = false;
  await assert.rejects(completeWhatsAppSignup(7, 1, { code: 'wa-code', state: waState, waba_id: '500', phone_number_id: '600' }), /not granted/);
  assert(!rows.some(row => row.status === 'wa_config'));
  allowWaba = true;
  const wa = await completeWhatsAppSignup(7, 1, { code: 'wa-code2', state: whatsappSignupSettings(7, 1).state!, waba_id: '500', phone_number_id: '600' });
  assert(wa.connected); assert(!JSON.stringify(rows).includes('wa-test-token'));
  const template = { name: 'appointment_update', language: 'en_US', category: 'UTILITY' as const, body: 'Your appointment is confirmed.', examples: [] };
  assert(whatsAppMetaTemplateSchema.safeParse(template).success);
  assert(!whatsAppMetaTemplateSchema.safeParse({ ...template, body: 'Hello {{2}}', examples: ['Example'] }).success);
  assert(!whatsAppMetaTemplateSchema.safeParse({ ...template, body: 'Hello {{1}}' }).success);
  assert(whatsAppMetaTemplateSchema.safeParse({ ...template, body: 'Hello {{1}}', examples: ['Example'] }).success);
  assert.equal((await createWorkspaceMetaTemplate(7, template)).status, 'PENDING');
  assert.equal((await listWorkspaceMetaTemplates(7)).templates[0]?.name, template.name);
  await assert.rejects(createWorkspaceMetaTemplate(8, template), /Connect WhatsApp first/);
  await registerWorkspaceWhatsAppPhone(7, '123456'); assert.equal(registered, 0, 'Never reset a registered number PIN');
  phoneStatus = 'PENDING';
  await registerWorkspaceWhatsAppPhone(7, '123456'); assert.equal(registered, 1);
  assert(!JSON.stringify(rows).includes('123456'), 'Registration PIN must not be stored');
  phoneStatus = 'DISCONNECTED';
  await assert.rejects(registerWorkspaceWhatsAppPhone(7, '123456'), /Finish phone verification/);

  const addFacebook = (status: string, payload: unknown, workspace_id = 7) => rows.push({ id: nextId++, source: 'facebook', status, workspace_id, payload: JSON.stringify(payload) });
  addFacebook('facebook_connection', { workspace_id: 7, user_id: 1, facebook_user_id: '111' });
  addFacebook('facebook_connection', { workspace_id: 8, user_id: 9, facebook_user_id: '222' }, 8);
  addFacebook('facebook_mapping', { workspace_id: 7, user_id: 1 });
  addFacebook('fb_reconcile', { workspaceId: 7, userId: 1 });
  addFacebook('fb_map_idx', { mappings: [{ workspace_id: 7, user_id: 1 }, { workspace_id: 8, user_id: 9 }] }, 8);
  await revokeFacebookUserConnections('111');
  const fbRows = rows.filter(row => row.source === 'facebook');
  assert.equal(fbRows.length, 2);
  assert.equal(JSON.parse(fbRows.find(row => row.status === 'fb_map_idx').payload).mappings.length, 1);
  assert.equal(JSON.parse(fbRows.find(row => row.status === 'facebook_connection').payload).facebook_user_id, '222');
  await assert.rejects(getFacebookPages('mock-token'), FacebookRateLimitError);
  await assert.rejects(getFacebookPages('mock-token'), FacebookRateLimitError);
  assert.equal(graphCalls, 1, 'Rate limited calls must stop before network access');

  const app = express();
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/instagram', instagramRoutes);
  app.use('/api/whatsapp/webhook', whatsappWebhookRouter);
  app.use('/api/whatsapp', whatsappRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const userToken = (id: number) => jwt.sign({ id }, process.env.JWT_SECRET!);
    assert.equal((await fetch(`${base}/api/instagram/7/connection`)).status, 401);
    assert.equal((await fetch(`${base}/api/instagram/8/connection`, { headers: { Authorization: `Bearer ${userToken(1)}` } })).status, 403);
    assert.equal((await fetch(`${base}/api/instagram/7/oauth/start`, { method: 'POST', headers: { Authorization: `Bearer ${userToken(2)}` } })).status, 403);
    assert.equal((await fetch(`${base}/api/whatsapp/7/meta-templates`, { method: 'POST', headers: { Authorization: `Bearer ${userToken(2)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(template) })).status, 403);
    assert.equal((await fetch(`${base}/api/whatsapp/8/meta-templates`, { headers: { Authorization: `Bearer ${userToken(1)}` } })).status, 403);
    assert.equal((await fetch(`${base}/api/whatsapp/7/register-phone`, { method: 'POST', headers: { Authorization: `Bearer ${userToken(1)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'bad' }) })).status, 400);
    const hookBody = JSON.stringify({ object: 'instagram', entry: [] });
    const signed = 'sha256=' + crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!).update(hookBody).digest('hex');
    assert.equal((await fetch(`${base}/api/instagram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: hookBody })).status, 403);
    assert.equal((await fetch(`${base}/api/instagram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signed }, body: hookBody })).status, 200);
    assert.equal((await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const waSig = 'sha256=' + crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET!).update('{}').digest('hex');
    assert.equal((await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': waSig }, body: '{}' })).status, 200);
    assert.equal((await fetch(`${base}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=hello`)).status, 200);
    assert.equal((await fetch(`${base}/api/instagram/data-deletion/status?code=anything`)).status, 404);
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '900' })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!).update(payload).digest('base64url');
    assert.equal(decodeMetaSignedRequest(`${signature}.${payload}`, process.env.INSTAGRAM_APP_SECRET!).user_id, '900');
    assert.throws(() => decodeMetaSignedRequest(`bad.${payload}`, process.env.INSTAGRAM_APP_SECRET!));
    const deletion = await fetch(`${base}/api/instagram/data-deletion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signed_request: `${signature}.${payload}` }) });
    assert.equal(deletion.status, 200);
    const receipt = await deletion.json() as { confirmation_code: string };
    assert.equal((await fetch(`${base}/api/instagram/data-deletion/status?code=${encodeURIComponent(receipt.confirmation_code)}`)).status, 200);
    assert.equal((await instagram.getInstagramConnection(7)).connected, false);
    assert(!rows.some(row => row.source === 'instagram'));
  } finally { server.close(); server.closeAllConnections(); }

  shortWrapped = false;
  const reconnectState = new URL(await instagram.startInstagramOAuth(7, 1)).searchParams.get('state')!;
  assert((await instagram.finishInstagramOAuth(7, 1, 'new-code', reconnectState)).connected);
  failWrite = true;
  await assert.rejects(instagram.startInstagramOAuth(7, 1), /Unable to save/);
  await assert.rejects(instagram.finishInstagramOAuth(7, 1, 'code', signMetaState('instagram-connect', { workspaceId: 7, userId: 1 }, -1)), /expired/);
  console.log('PASS: OAuth identity/replay/expiry, encrypted persistence, tenant access, 24-hour replies, Meta asset validation, webhook signatures, deletion receipts, and rate-limit backoff. All network/database calls mocked.');
} finally { globalThis.fetch = originalFetch; }
