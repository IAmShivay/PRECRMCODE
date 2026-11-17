import { conversationAccess } from '../middleware/conversationAccess.js';
import { Router, Response, Request } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { validate } from '../utils/validation.js';
import {
  upsertWhatsAppConfigSchema,
  upsertWhatsAppTriggerSchema,
  upsertWhatsAppTemplateSchema,
  whatsAppTestMessageSchema,
  whatsAppResendSchema,
  createWhatsAppCampaignSchema,
  whatsAppTriggerKindEnum,
} from '../utils/validation.js';
import {
  getWhatsAppConfigMasked,
  upsertWhatsAppConfig,
  getWhatsAppTriggerConfig,
  upsertWhatsAppTriggerConfig,
  getAllWhatsAppTemplates,
  getWhatsAppTemplate,
  upsertWhatsAppTemplate,
  sendWhatsAppTestMessage,
  sendNoAnswerWhatsApp,
  resendWhatsAppForLead,
  createWhatsAppCampaign,
  listWhatsAppCampaigns,
  getWhatsAppCampaign,
  cancelWhatsAppCampaign,
  listWhatsAppMessages,
  handleWhatsAppDeliveryWebhook,
  WHATSAPP_TRIGGER_KINDS,
  type WhatsAppTriggerKind,
} from '../services/whatsapp.js';
import { verifyMetaWebhookSignature } from '../services/whatsappMetaApi.js';
import { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { completeWhatsAppSignup, whatsappSignupSettings } from '../services/whatsappOnboarding.js';
import { MetaIntegrationError } from '../services/metaSecurity.js';
import { whatsAppSignupCompleteSchema, whatsAppMetaTemplateSchema, whatsAppPhoneRegistrationSchema } from '../utils/validation.js';
import { createWorkspaceMetaTemplate, listWorkspaceMetaTemplates, getWorkspaceWhatsAppPhoneStatus, registerWorkspaceWhatsAppPhone } from '../services/whatsappAccountManagement.js';

const router: Router = Router();

function managementError(res: Response, error: unknown): void {
  res.status(error instanceof MetaIntegrationError ? error.status : 503).json({
    status: 'error', message: error instanceof MetaIntegrationError ? error.message : 'WhatsApp is temporarily unavailable. Please try again.',
  });
}

router.get('/:workspaceId/meta-templates', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const after = req.query.after === undefined ? undefined : String(req.query.after);
    if (after && after.length > 4096) throw new MetaIntegrationError('Invalid page cursor');
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'success', data: await listWorkspaceMetaTemplates(Number(req.params.workspaceId), after) });
  } catch (error) { managementError(res, error); }
});

router.post('/:workspaceId/meta-templates', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), adminOnlyMiddleware, validate(whatsAppMetaTemplateSchema), async (req: AuthenticatedRequest, res): Promise<void> => {
  try { res.json({ status: 'success', data: await createWorkspaceMetaTemplate(Number(req.params.workspaceId), req.body) }); }
  catch (error) { managementError(res, error); }
});

router.get('/:workspaceId/phone-status', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), adminOnlyMiddleware, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'success', data: await getWorkspaceWhatsAppPhoneStatus(Number(req.params.workspaceId)) });
  } catch (error) { managementError(res, error); }
});

router.post('/:workspaceId/register-phone', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), adminOnlyMiddleware, validate(whatsAppPhoneRegistrationSchema), async (req: AuthenticatedRequest, res): Promise<void> => {
  try { await registerWorkspaceWhatsAppPhone(Number(req.params.workspaceId), req.body.pin); res.json({ status: 'success' }); }
  catch (error) { managementError(res, error); }
});

router.get('/:workspaceId/signup', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), adminOnlyMiddleware, (req: AuthenticatedRequest, res): void => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'success', data: whatsappSignupSettings(Number(req.params.workspaceId), Number(req.user!.id)) });
});

router.post('/:workspaceId/signup', authMiddleware, workspaceAuthMiddleware, conversationAccess('view'), adminOnlyMiddleware, validate(whatsAppSignupCompleteSchema), async (req: AuthenticatedRequest, res): Promise<void> => {
  try { res.json({ status: 'success', data: await completeWhatsAppSignup(Number(req.params.workspaceId), Number(req.user!.id), req.body) }); }
  catch (error) { res.status(error instanceof MetaIntegrationError ? error.status : 503).json({ status: 'error', message: error instanceof MetaIntegrationError ? error.message : 'WhatsApp setup is temporarily unavailable.' }); }
});

function parseWorkspaceId(req: AuthenticatedRequest): number {
  return Number(req.params.workspaceId || 0);
}

function parseTriggerKind(raw: string): WhatsAppTriggerKind | null {
  const result = whatsAppTriggerKindEnum.safeParse(raw);
  return result.success ? result.data : null;
}

// ============ WEBHOOK (public, mounted separately in server.ts) ============

export const whatsappWebhookRouter: Router = Router();

whatsappWebhookRouter.get('/', (req: Request, res: Response): void => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const verifyToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();

  if (!verifyToken) {
    res.status(503).send('Webhook verify token is not configured');
    return;
  }

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
    return;
  }
  res.status(403).send('Forbidden');
});

whatsappWebhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const appSecret = String(process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '').trim();
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.get('x-hub-signature-256');

    if (!appSecret) {
      res.status(503).json({ status: 'error', message: 'Webhook signature verification is not configured' });
      return;
    }
    if (!rawBody || !verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      res.status(403).json({ status: 'error', message: 'Invalid signature' });
      return;
    }

    await handleWhatsAppDeliveryWebhook(req.body as Record<string, unknown>);
    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', (error as Error).message);
    res.status(503).json({ status: 'error', message: 'Webhook processing failed' });
  }
});

// ============ CONFIG ============

router.get(
  '/:workspaceId/config',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const config = await getWhatsAppConfigMasked(workspaceId);
      res.json({
        status: 'success',
        data: config || {
          workspace_id: workspaceId,
          enabled: false,
          phone_number_id: '',
          waba_id: '',
          connected: false,
          has_access_token: false,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.put(
  '/:workspaceId/config',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  validate(upsertWhatsAppConfigSchema),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const config = await upsertWhatsAppConfig(workspaceId, req.body);
      res.json({ status: 'success', data: config });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.post(
  '/:workspaceId/config/test',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  validate(whatsAppTestMessageSchema),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const result = await sendWhatsAppTestMessage(
        workspaceId,
        req.body.to_phone,
        req.body.trigger_kind || 'new_lead',
        {
          usePlainText: Boolean(req.body.use_plain_text),
          useSandboxTemplate: Boolean(req.body.use_sandbox_template),
          messageBody: req.body.message_body,
        }
      );
      if (!result.success) {
        res.status(400).json({ status: 'error', message: result.message || 'Test send failed' });
        return;
      }
      res.json({
        status: 'success',
        data: { message_id: result.messageId },
        message: result.message,
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

// ============ TRIGGERS ============

router.get(
  '/:workspaceId/triggers',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const triggers = await getWhatsAppTriggerConfig(workspaceId);
      res.json({ status: 'success', data: triggers });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.put(
  '/:workspaceId/triggers',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  validate(upsertWhatsAppTriggerSchema),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const triggers = await upsertWhatsAppTriggerConfig(workspaceId, req.body);
      res.json({ status: 'success', data: triggers });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

// ============ TEMPLATES ============

router.get(
  '/:workspaceId/templates',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const templates = await getAllWhatsAppTemplates(workspaceId);
      res.json({ status: 'success', data: templates });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.put(
  '/:workspaceId/templates/:kind',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  validate(upsertWhatsAppTemplateSchema),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const kind = parseTriggerKind(String(req.params.kind || ''));
      if (!kind) {
        res.status(400).json({ status: 'error', message: 'Invalid template kind' });
        return;
      }
      const template = await upsertWhatsAppTemplate(workspaceId, kind, req.body);
      res.json({ status: 'success', data: template });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.get(
  '/:workspaceId/templates/:kind',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const kind = parseTriggerKind(String(req.params.kind || ''));
      if (!kind) {
        res.status(400).json({ status: 'error', message: 'Invalid template kind' });
        return;
      }
      const template = await getWhatsAppTemplate(workspaceId, kind);
      res.json({ status: 'success', data: template });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

// ============ MANUAL TRIGGER ============

router.post(
  '/:workspaceId/leads/:leadId/send-no-answer',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('reply'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const leadId = Number(req.params.leadId || 0);
      const userId = Number(req.user?.id || 0);

      const result = await sendNoAnswerWhatsApp({ workspaceId, leadId, userId });
      if (!result.queued) {
        res.status(400).json({
          status: 'error',
          message: result.reason || 'Failed to queue WhatsApp message',
          data: result,
        });
        return;
      }
      res.json({ status: 'success', data: result });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.post(
  '/:workspaceId/leads/:leadId/resend',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  validate(whatsAppResendSchema),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const leadId = Number(req.params.leadId || 0);
      const userId = Number(req.user?.id || 0);
      const triggerKind = req.body.trigger_kind || 'new_lead';

      const result = await resendWhatsAppForLead({
        workspaceId,
        leadId,
        triggerKind,
        userId,
      });
      if (!result.queued) {
        res.status(400).json({
          status: 'error',
          message: result.reason || 'Failed to queue WhatsApp resend',
          data: result,
        });
        return;
      }
      res.json({ status: 'success', data: result, message: 'WhatsApp resend queued' });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

// ============ CAMPAIGNS ============

router.post(
  '/:workspaceId/campaigns',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  validate(createWhatsAppCampaignSchema),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const result = await createWhatsAppCampaign({
        workspaceId,
        name: req.body.name,
        templateKind: req.body.template_kind || 'bulk_marketing',
        leadIds: req.body.lead_ids,
        statusIds: req.body.status_ids,
        sourceFilter: req.body.source_filter,
        createdByUserId: Number(req.user?.id || 0) || undefined,
      });

      if (!result.success) {
        res.status(400).json({ status: 'error', message: result.message || 'Campaign failed' });
        return;
      }
      res.json({ status: 'success', data: result });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.get(
  '/:workspaceId/campaigns',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const campaigns = await listWhatsAppCampaigns(workspaceId);
      res.json({ status: 'success', data: campaigns });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.get(
  '/:workspaceId/campaigns/:campaignId',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const campaign = await getWhatsAppCampaign(workspaceId, String(req.params.campaignId || ''));
      if (!campaign) {
        res.status(404).json({ status: 'error', message: 'Campaign not found' });
        return;
      }
      res.json({ status: 'success', data: campaign });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.post(
  '/:workspaceId/campaigns/:campaignId/cancel',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  adminOnlyMiddleware,
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const cancelled = await cancelWhatsAppCampaign(workspaceId, String(req.params.campaignId || ''));
      if (!cancelled) {
        res.status(404).json({ status: 'error', message: 'Campaign not found' });
        return;
      }
      res.json({ status: 'success', data: { cancelled: true } });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

// ============ MESSAGE LOGS ============

router.get(
  '/:workspaceId/messages',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const limit = Number(req.query.limit || 50);
      const page = Number(req.query.page || 1);
      const messages = await listWhatsAppMessages(workspaceId, { limit, page });
      res.json({ status: 'success', data: messages });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

router.get(
  '/:workspaceId/messages/lead/:leadId',
  authMiddleware,
  workspaceAuthMiddleware,
  conversationAccess('view'),
  async (req: AuthenticatedRequest, res: Response<ApiResponse>): Promise<void> => {
    try {
      const workspaceId = parseWorkspaceId(req);
      const leadId = Number(req.params.leadId || 0);
      const messages = await listWhatsAppMessages(workspaceId, { leadId, limit: 100 });
      res.json({ status: 'success', data: messages });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  }
);

// Meta info endpoint
router.get(
  '/meta/trigger-kinds',
  authMiddleware,
  (_req: AuthenticatedRequest, res: Response<ApiResponse>): void => {
    res.json({ status: 'success', data: WHATSAPP_TRIGGER_KINDS });
  }
);

export default router;
