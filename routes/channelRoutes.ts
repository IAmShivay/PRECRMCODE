import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { conversationAccess } from '../middleware/conversationAccess.js';
import { validate } from '../utils/validation.js';
import { channelsApi } from '../services/api.js';
import {
  CHANNEL_TYPE_VALUES,
  MESSAGE_DIRECTION,
  POLL_MESSAGE_LIMIT,
  type Channel,
} from '../services/channels/constants.js';
import {
  createdIdOf,
  getChannel,
  listChannelConversations,
  listConversationMessages,
  listWorkspaceChannels,
  loadConversation,
  nowSql,
  toChannel,
  toChannelRow,
} from '../services/channels/store.js';
import { ingestInboundMessage } from '../services/channels/runtime.js';
import { buildWidgetScript } from '../services/channels/widget.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
export const conversationsRouter = Router();

const DEFAULT_WIDGET_TITLE = 'Chat with us';
const DEFAULT_WIDGET_ACCENT = '#3F7DF4';
const WIDGET_CACHE_SECONDS = 300;

const channelSchema = z.object({
  workspace_id: z.number().int().positive(),
  type: z.enum(CHANNEL_TYPE_VALUES),
  name: z.string().trim().max(120).default(''),
  config: z.record(z.string(), z.unknown()).default({}),
  secret: z.string().trim().max(200).default(''),
  bot_id: z.number().int().min(0).max(1_000_000_000).default(0),
  active: z.boolean().default(true),
});

const inboundSchema = z.object({
  visitor_uid: z.string().trim().min(1).max(200),
  session_id: z.string().trim().max(200).default(''),
  text: z.string().trim().min(1).max(4000),
  utm: z.record(z.string(), z.unknown()).default({}),
});

type Req = AuthenticatedRequest<any, any, any>;
const fail = (res: Response, status: number, message: string): void => {
  res.status(status).json({ status: 'error', message });
};
const workspaceOf = (req: Req) => Number(req.body?.workspace_id || req.query.workspace_id);

async function ownedChannel(id: number, workspaceId: number): Promise<Channel | null> {
  const channel = await getChannel(id);
  return channel && channel.workspace_id === workspaceId ? channel : null;
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Loads a public, active channel and enforces its optional per-channel secret. */
async function resolvePublicChannel(req: Request, res: Response): Promise<Channel | null> {
  const channel = await getChannel(Number(req.params.id));
  if (!channel || !channel.active) {
    fail(res, 404, 'Channel not found');
    return null;
  }
  if (channel.secret) {
    const provided = String(req.query?.token || req.headers?.['x-channel-token'] || '').trim();
    if (!secretsMatch(provided, channel.secret)) {
      fail(res, 401, 'Invalid or missing channel token');
      return null;
    }
  }
  return channel;
}

// ============ PUBLIC INGRESS ============
router.post('/:id/inbound', validate(inboundSchema), async (req: Request, res: Response) => {
  try {
    const channel = await resolvePublicChannel(req, res);
    if (!channel) return;
    const body = req.body as z.infer<typeof inboundSchema>;
    const result = await ingestInboundMessage({
      channel,
      visitorUid: body.visitor_uid,
      sessionId: body.session_id,
      text: body.text,
      utm: body.utm,
    });
    const messages = await listConversationMessages(result.conversation.id, {
      afterId: result.inboundMessage.id,
      direction: MESSAGE_DIRECTION.OUT,
      limit: POLL_MESSAGE_LIMIT,
    });
    res.json({ status: 'success', conversation_id: result.conversation.id, messages });
  } catch (error) {
    console.error('[Channels] inbound failed', error);
    fail(res, 500, 'Could not process the message');
  }
});

router.get('/:id/poll', async (req: Request, res: Response) => {
  try {
    const channel = await resolvePublicChannel(req, res);
    if (!channel) return;
    const conversationId = Number(req.query.conversation_id);
    const conversation = conversationId > 0 ? await loadConversation(conversationId) : null;
    if (!conversation || conversation.channel_id !== channel.id) return fail(res, 404, 'Conversation not found');
    const messages = await listConversationMessages(conversationId, {
      afterId: Number(req.query.after) || 0,
      direction: MESSAGE_DIRECTION.OUT,
      limit: POLL_MESSAGE_LIMIT,
    });
    res.json({ status: 'success', conversation_id: conversationId, messages });
  } catch (error) {
    console.error('[Channels] poll failed', error);
    fail(res, 500, 'Could not load messages');
  }
});

router.get('/:id/widget.js', async (req: Request, res: Response) => {
  try {
    const channel = await getChannel(Number(req.params.id));
    if (!channel || !channel.active) return fail(res, 404, 'Channel not found');
    const base = `${req.protocol}://${req.get('host')}`;
    const script = buildWidgetScript({
      baseUrl: base,
      channelId: channel.id,
      token: channel.secret || '',
      title: String(channel.config.title || channel.name || DEFAULT_WIDGET_TITLE),
      accent: String(channel.config.accent || DEFAULT_WIDGET_ACCENT),
    });
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', `public, max-age=${WIDGET_CACHE_SECONDS}`);
    res.send(script);
  } catch (error) {
    console.error('[Channels] widget failed', error);
    fail(res, 500, 'Could not load the widget');
  }
});

// ============ ADMIN CRUD ============
router.get('/', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    res.json({ status: 'success', data: await listWorkspaceChannels(workspaceOf(req)) });
  } catch (error) {
    console.error('[Channels] list failed', error);
    fail(res, 500, 'Could not load channels. Check the channels table exists in NoCodeBackend.');
  }
});

router.post('/', authMiddleware, validate(channelSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const body = req.body as z.infer<typeof channelSchema>;
    const secret = body.secret || crypto.randomBytes(16).toString('hex');
    const created: any = await channelsApi.create(toChannelRow({ ...body, secret, created_at: nowSql() }));
    if (created?.status !== 'success') return fail(res, 500, 'Could not save channel');
    const id = createdIdOf(created);
    res.status(201).json({ status: 'success', data: toChannel({ ...toChannelRow({ ...body, secret }), id }) });
  } catch (error) {
    console.error('[Channels] create failed', error);
    fail(res, 500, 'Could not save channel');
  }
});

router.put('/:id', authMiddleware, validate(channelSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof channelSchema>;
    const existing = await ownedChannel(id, body.workspace_id);
    if (!existing) return fail(res, 404, 'Channel not found');
    const secret = body.secret || existing.secret;
    const updated: any = await channelsApi.update(id, toChannelRow({ ...body, secret, created_at: existing.created_at }));
    if (updated?.status !== 'success') return fail(res, 500, 'Could not save channel');
    res.json({ status: 'success', data: toChannel({ ...toChannelRow({ ...body, secret }), id }) });
  } catch (error) {
    console.error('[Channels] update failed', error);
    fail(res, 500, 'Could not save channel');
  }
});

router.delete('/:id', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const workspaceId = workspaceOf(req);
    if (!(await ownedChannel(id, workspaceId))) return fail(res, 404, 'Channel not found');
    await channelsApi.remove(id);
    res.json({ status: 'success', data: { id } });
  } catch (error) {
    console.error('[Channels] delete failed', error);
    fail(res, 500, 'Could not delete channel');
  }
});

// ============ INBOX (staff, conversations permission) ============
router.get('/:id/conversations', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), async (req: Req, res: Response) => {
  try {
    const workspaceId = workspaceOf(req);
    const channel = await ownedChannel(Number(req.params.id), workspaceId);
    if (!channel) return fail(res, 404, 'Channel not found');
    res.json({ status: 'success', data: await listChannelConversations(channel.id, workspaceId) });
  } catch (error) {
    console.error('[Channels] conversations failed', error);
    fail(res, 500, 'Could not load conversations');
  }
});

conversationsRouter.get('/:id/messages', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), async (req: Req, res: Response) => {
  try {
    const workspaceId = workspaceOf(req);
    const conversation = await loadConversation(Number(req.params.id));
    if (!conversation || conversation.workspace_id !== workspaceId) return fail(res, 404, 'Conversation not found');
    res.json({ status: 'success', data: await listConversationMessages(conversation.id) });
  } catch (error) {
    console.error('[Channels] messages failed', error);
    fail(res, 500, 'Could not load messages');
  }
});

export default router;
