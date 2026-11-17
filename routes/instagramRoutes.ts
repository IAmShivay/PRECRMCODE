import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { instagramOAuthCompleteSchema, instagramReplySchema, validate } from '../utils/validation.js';
import { deleteInstagramUserData, disconnectInstagram, finishInstagramOAuth, getInstagramConnection, getInstagramMessages, instagramWebhookVerifyToken, listInstagramConversations, receiveInstagramWebhook, replyToInstagramConversation, startInstagramOAuth } from '../services/instagram.js';
import { decodeMetaSignedRequest, MetaIntegrationError, publicAppOrigin, signMetaState, verifyMetaState } from '../services/metaSecurity.js';
import { verifyMetaWebhookSignature } from '../services/whatsappMetaApi.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { conversationAccess } from '../middleware/conversationAccess.js';

const router: Router = Router();
function errorResponse(res: Response, error: unknown): void {
  res.status(error instanceof MetaIntegrationError ? error.status : 503).json({
    status: 'error', message: error instanceof MetaIntegrationError ? error.message : 'Instagram is temporarily unavailable. Please try again.',
  });
}

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });

router.get('/oauth/callback', (req: Request, res: Response): void => {
  try {
    const target = new URL('/instagram', publicAppOrigin());
    if (req.query.error) target.searchParams.set('instagram_error', 'Connection was cancelled or permission was not granted.');
    else {
      const state = String(req.query.state || '');
      verifyMetaState(state, 'instagram-connect');
      const code = String(req.query.code || '');
      if (!code || code.length > 4096) throw new MetaIntegrationError('Invalid Instagram callback');
      target.hash = new URLSearchParams({ code, state }).toString();
    }
    // Only the initiating, authenticated workspace administrator can complete the token exchange.
    res.redirect(303, target.toString());
  } catch (error) { errorResponse(res, error); }
});

router.get('/webhook', (req, res): void => {
  const token = instagramWebhookVerifyToken();
  if (!token) { res.status(503).send('Webhook is not configured'); return; }
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  } else res.status(403).send('Forbidden');
});

router.post('/webhook', async (req, res): Promise<void> => {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!secret) { res.status(503).json({ status: 'error' }); return; }
  if (!raw || !verifyMetaWebhookSignature(raw, req.get('x-hub-signature-256'), secret)) {
    res.status(403).json({ status: 'error' }); return;
  }
  try { await receiveInstagramWebhook(req.body); res.json({ status: 'success' }); }
  catch (error) { errorResponse(res, error); }
});

router.post(['/deauthorize', '/data-deletion'], async (req, res): Promise<void> => {
  try {
    const { user_id } = decodeMetaSignedRequest(String(req.body?.signed_request || ''), process.env.INSTAGRAM_APP_SECRET || '');
    await deleteInstagramUserData(user_id);
    if (req.path === '/deauthorize') { res.json({ status: 'success' }); return; }
    const code = signMetaState('instagram-deletion-complete', { completed_at: new Date().toISOString() }, 90 * 86400);
    const receipt = new URL('/api/instagram/data-deletion/status', process.env.INSTAGRAM_REDIRECT_URI || publicAppOrigin());
    receipt.searchParams.set('code', code);
    res.json({ confirmation_code: code, url: receipt.toString() });
  } catch (error) { errorResponse(res, error); }
});

router.get('/data-deletion/status', (req, res): void => {
  try {
    verifyMetaState(String(req.query.code || ''), 'instagram-deletion-complete');
    res.type('text/plain').send('Completed: Instagram connection data and access tokens were removed. Instagram messages are not stored in our database.');
  } catch { res.status(404).type('text/plain').send('No valid deletion confirmation found.'); }
});

router.use('/:workspaceId', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'));

router.get('/:workspaceId/connection', async (req: AuthenticatedRequest, res): Promise<void> => {
  try { res.json({ status: 'success', data: await getInstagramConnection(Number(req.params.workspaceId)) }); }
  catch (error) { errorResponse(res, error); }
});

router.post('/:workspaceId/oauth/start', adminOnlyMiddleware, async (req: AuthenticatedRequest, res): Promise<void> => {
  try { res.json({ status: 'success', data: { url: await startInstagramOAuth(Number(req.params.workspaceId), Number(req.user!.id)) } }); }
  catch (error) { errorResponse(res, error); }
});

router.post('/:workspaceId/oauth/complete', adminOnlyMiddleware, validate(instagramOAuthCompleteSchema), async (req: AuthenticatedRequest, res): Promise<void> => {
  try { res.json({ status: 'success', data: await finishInstagramOAuth(Number(req.params.workspaceId), Number(req.user!.id), req.body.code, req.body.state) }); }
  catch (error) { errorResponse(res, error); }
});

router.delete('/:workspaceId/connection', adminOnlyMiddleware, async (req: AuthenticatedRequest, res): Promise<void> => {
  try { await disconnectInstagram(Number(req.params.workspaceId)); res.json({ status: 'success' }); }
  catch (error) { errorResponse(res, error); }
});

router.get('/:workspaceId/conversations', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const after = req.query.after === undefined ? undefined : String(req.query.after);
    if (after && after.length > 4096) throw new MetaIntegrationError('Invalid page cursor');
    res.json({ status: 'success', data: await listInstagramConversations(Number(req.params.workspaceId), after) });
  } catch (error) { errorResponse(res, error); }
});

router.get('/:workspaceId/conversations/:conversationId/messages', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const data = await getInstagramMessages(Number(req.params.workspaceId), String(req.params.conversationId));
    res.json({ status: 'success', data: { ...data, can_reply: data.can_reply && req.workspacePermissions?.conversations === 'reply' } });
  }
  catch (error) { errorResponse(res, error); }
});

router.post('/:workspaceId/conversations/:conversationId/messages', conversationAccess('reply'), validate(instagramReplySchema), async (req: AuthenticatedRequest, res): Promise<void> => {
  try { res.json({ status: 'success', data: await replyToInstagramConversation(Number(req.params.workspaceId), String(req.params.conversationId), req.body.text) }); }
  catch (error) { errorResponse(res, error); }
});

export default router;
