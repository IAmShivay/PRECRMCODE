import crypto from 'crypto';
import { Router, Response, Request } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import {
  buildFacebookOAuthUrl,
  createFacebookStateToken,
  exchangeCodeForUserAccessToken,
  exchangeForLongLivedUserAccessToken,
  getFacebookRedirectUri,
  saveFacebookConnection,
  verifyFacebookStateToken,
  getFacebookConnection,
  getFacebookPages,
  getFacebookForms,
  getFacebookFormFields,
  getFacebookFormMapping,
  saveFacebookFormMapping,
  deleteFacebookFormMapping,
  listFacebookFormMappings,
  FacebookFormMapping,
  subscribePageToWebhooks,
  getPageWebhookSubscriptions,
  getFacebookAppWebhookSubscriptions,
  getFacebookMappingsForPageForm,
  revokeFacebookUserConnections,
} from '../services/facebook.js';
import { decodeMetaSignedRequest } from '../services/metaSecurity.js';
import { AuthenticatedRequest, AuthErrorResponse, ApiResponse } from '../types/index.js';
import { webhookLogsApi } from '../services/api.js';

const router: Router = Router();

function formatFacebookApiError(error: any): string {
  const errorMessage = String(error?.message || '');
  const errorCode = error?.cause?.code || error?.code;
  
  if (errorCode === 'ETIMEDOUT' || errorMessage.toLowerCase().includes('timeout')) {
    return 'Unable to connect to Facebook. Please check your internet connection and try again.';
  }
  
  if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND' || errorMessage.includes('fetch failed')) {
    return 'Unable to reach Facebook servers. Please check your network connection and try again.';
  }
  
  if (errorMessage.toLowerCase().includes('invalid') && errorMessage.toLowerCase().includes('token')) {
    return 'Facebook access token is invalid or expired. Please reconnect your Facebook account.';
  }
  
  return errorMessage || 'An error occurred while communicating with Facebook';
}

function getRequestOrigin(req: Pick<Request, 'get' | 'protocol'>): string {
  const proto = (String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0] || 'http').trim();
  const host = (String(req.get('x-forwarded-host') || req.get('host') || 'localhost:3006').split(',')[0] || 'localhost:3006').trim();
  return `${proto}://${host}`;
}

function getAppOrigin(requestOrigin: string): string {
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;

  const publicBase = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (publicBase) {
    try {
      const url = new URL(publicBase);
      const hostname = String(url.hostname || '');
      if (!hostname.startsWith('api.')) {
        return url.toString().replace(/\/+$/, '');
      }
    } catch {
    }
  }
  const candidates = [publicBase, requestOrigin].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const hostname = String(url.hostname || '');
      if (hostname.startsWith('api.')) {
        const rest = hostname.slice('api.'.length);
        url.hostname = `app.${rest}`;
        return url.toString().replace(/\/+$/, '');
      }
    } catch {
    }
  }

  return (publicBase || requestOrigin || '').replace(/\/+$/, '');
}

function normalizeOrigin(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

function computeAppOriginFromApiOrigin(origin: string): string | null {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const hostname = String(url.hostname || '');
    if (!hostname.startsWith('api.')) return null;
    url.hostname = `app.${hostname.slice('api.'.length)}`;
    return url.origin;
  } catch {
    return null;
  }
}

function resolveAllowedReturnToOrigins(requestOrigin: string): Set<string> {
  const allowed = new Set<string>();
  const explicit = normalizeOrigin(String(process.env.APP_BASE_URL || ''));
  if (explicit) allowed.add(explicit);

  const publicOrigin = normalizeOrigin(String(process.env.PUBLIC_BASE_URL || ''));
  if (publicOrigin) allowed.add(publicOrigin);

  const reqOrigin = normalizeOrigin(requestOrigin);
  if (reqOrigin) allowed.add(reqOrigin);

  const appFromApi = computeAppOriginFromApiOrigin(requestOrigin);
  if (appFromApi) allowed.add(appFromApi);

  return allowed;
}

function peekFacebookStateForRedirect(state: unknown): { workspaceId?: number; returnTo?: string } | null {
  const raw = String(state || '').trim();
  const [encodedPayload] = raw.split('.', 2);
  if (!encodedPayload) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      workspaceId?: unknown;
      returnTo?: unknown;
    };
    const workspaceId = Number(payload?.workspaceId);
    const returnTo = typeof payload?.returnTo === 'string' ? payload.returnTo : undefined;

    return {
      ...(Number.isFinite(workspaceId) && workspaceId > 0 ? { workspaceId } : {}),
      ...(returnTo ? { returnTo } : {}),
    };
  } catch {
    return null;
  }
}

function getFacebookIntegrationPath(workspaceId?: number): string {
  return workspaceId
    ? `/workspace/${workspaceId}/integrations/facebook`
    : '/integrations/facebook';
}

function buildFacebookIntegrationRedirect(
  appRedirectBase: string,
  workspaceId: number | undefined,
  params: Record<string, string>
): string {
  const searchParams = new URLSearchParams(params);
  return `${appRedirectBase.replace(/\/+$/, '')}${getFacebookIntegrationPath(workspaceId)}?${searchParams.toString()}`;
}

function getFacebookWebhookBaseUrl(req: Pick<Request, 'get' | 'protocol'>): string {
  const explicit = String(
    process.env.FACEBOOK_WEBHOOK_BASE_URL ||
      process.env.FACEBOOK_OAUTH_BASE_URL ||
      process.env.FACEBOOK_REDIRECT_BASE_URL ||
      process.env.APP_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      ''
  ).trim();

  if (explicit) return explicit.replace(/\/+$/, '');
  return getRequestOrigin(req).replace(/\/+$/, '');
}

function getFacebookWebhookUrl(req: Pick<Request, 'get' | 'protocol'>): string {
  return `${getFacebookWebhookBaseUrl(req)}/api/facebook/webhook`;
}

router.post('/data-deletion', async (req: Request, res: Response): Promise<void> => {
  try {
    const appSecret = String(process.env.FACEBOOK_APP_SECRET || '').trim();
    if (!appSecret) {
      res.status(500).json({ status: 'error', error: 'missing_facebook_app_secret' });
      return;
    }

    const signedRequest = String((req.body as any)?.signed_request || '').trim();
    decodeMetaSignedRequest(signedRequest, appSecret);
    // Meta's app settings use our public deletion instructions. Never fabricate a completion receipt.
    res.status(410).json({ status: 'error', message: 'Use the data deletion instructions to request removal of imported CRM records.', url: 'https://breaktheice.in/data-deletion' });
  } catch (error: any) {
    res.status(400).json({ status: 'error', error: error?.message || 'invalid_request' });
  }
});

router.get('/data-deletion/status', async (_req: Request, res: Response): Promise<void> => {
  res
    .status(410)
    .type('text/html')
    .send(
      '<html><head><title>Data deletion instructions</title></head><body><h1>Contact support to request data deletion</h1><p>This endpoint does not confirm that a deletion request was received or completed.</p><a href="https://breaktheice.in/data-deletion">View deletion instructions</a></body></html>'
    );
});

router.post('/deauthorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const appSecret = String(process.env.FACEBOOK_APP_SECRET || '').trim();
    if (!appSecret) {
      res.status(500).json({ status: 'error', error: 'missing_facebook_app_secret' });
      return;
    }

    const signedRequest = String((req.body as any)?.signed_request || '').trim();
    const { user_id } = decodeMetaSignedRequest(signedRequest, appSecret);
    await revokeFacebookUserConnections(user_id);

    res.json({ status: 'success' });
  } catch (error: any) {
    res.status(503).json({ status: 'error', error: 'Unable to complete deauthorization. Please retry.' });
  }
});

/**
 * Start Facebook OAuth flow for a given workspace and authenticated user.
 * Route: GET /api/facebook/:workspaceId/oauth/start
 */
router.get(
  '/:workspaceId/oauth/start',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<{ authUrl: string }> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);

      if (!workspaceId || Number.isNaN(workspaceId)) {
        res.status(400).json({
          success: false,
          status: 'error',
          error: 'Workspace ID is required',
        });
        return;
      }

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      const requestOrigin = getRequestOrigin(req);
      const redirectUri = getFacebookRedirectUri(requestOrigin);
      const returnToRaw = String((req.query as any)?.return_to || (req.query as any)?.returnTo || '').trim();
      const returnToOrigin = normalizeOrigin(returnToRaw);
      const allowedReturnTo = resolveAllowedReturnToOrigins(requestOrigin);
      const safeReturnTo = returnToOrigin && allowedReturnTo.has(returnToOrigin) ? returnToOrigin : undefined;
      const state = createFacebookStateToken(workspaceId, userId, safeReturnTo);
      const authUrl = buildFacebookOAuthUrl(redirectUri, state);

      console.log('[Facebook OAuth] Start', { workspaceId, userId, redirectUri });

      // Return the OAuth URL as JSON so the frontend can handle the redirect
      // This allows the Authorization header to be sent with the request
      res.json({
        status: 'success',
        data: {
          authUrl: authUrl,
        },
      });
    } catch (error) {
      console.error('Error in GET /api/facebook/:workspaceId/oauth/start:', error);
      res.status(500).json({
        success: false,
        status: 'error',
        error: 'Failed to start Facebook OAuth flow',
      });
    }
  }
);

/**
 * Facebook OAuth callback handler.
 * Route: GET /api/facebook/oauth/callback
 *
 * Exchanges the authorization code for a user access token and stores the
 * connection for the workspace + user. Then redirects back to the app.
 */
router.get(
  '/oauth/callback',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { code, state, error: fbError, error_description } = req.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };

      const requestOrigin = getRequestOrigin(req);
      const decodedState = state
        ? (() => {
            try {
              return verifyFacebookStateToken(String(state));
            } catch {
              return null;
            }
          })()
        : null;
      const redirectState = decodedState || peekFacebookStateForRedirect(state);

      const appRedirectBase = (
        redirectState?.returnTo ||
        getAppOrigin(requestOrigin) ||
        ''
      ).replace(/\/+$/, '');

      console.log('[Facebook OAuth] Callback hit', {
        hasCode: !!code,
        hasState: !!state,
        hasError: !!fbError,
      });

      if (fbError) {
        console.error('Facebook OAuth error:', fbError, error_description);
        const redirectUrl = buildFacebookIntegrationRedirect(appRedirectBase, redirectState?.workspaceId, {
          error: String(fbError),
        });
        res.redirect(redirectUrl);
        return;
      }

      if (!code || !state) {
        const redirectUrl = buildFacebookIntegrationRedirect(appRedirectBase, redirectState?.workspaceId, {
          error: 'missing_code_or_state',
        });
        res.redirect(redirectUrl);
        return;
      }

      if (!decodedState) {
        const redirectUrl = buildFacebookIntegrationRedirect(appRedirectBase, redirectState?.workspaceId, {
          error: 'invalid_state',
        });
        res.redirect(redirectUrl);
        return;
      }

      const { workspaceId, userId } = decodedState;
      const redirectUri = getFacebookRedirectUri(requestOrigin);

      const token = await exchangeCodeForUserAccessToken(String(code), redirectUri);
      const accessToken = await (async () => {
        try {
          const longLived = await exchangeForLongLivedUserAccessToken(token.access_token);
          return longLived.access_token || token.access_token;
        } catch {
          return token.access_token;
        }
      })();

      await saveFacebookConnection(workspaceId, userId, accessToken);

      const redirectUrl = buildFacebookIntegrationRedirect(appRedirectBase, workspaceId, {
        status: 'connected',
      });
      res.redirect(encodeURI(redirectUrl));
    } catch (error: any) {
      console.error('Error in GET /api/facebook/oauth/callback:', error);

      const fallbackOrigin =
        String(process.env.APP_BASE_URL || '').trim() ||
        getAppOrigin(getRequestOrigin(req)) ||
        'http://localhost:3006';
      const appRedirectBase = fallbackOrigin.replace(/\/+$/, '');

      const message =
        error?.message && typeof error.message === 'string'
          ? error.message
          : 'oauth_failed';
      const redirectState = peekFacebookStateForRedirect((req.query as any)?.state);

      const redirectUrl = buildFacebookIntegrationRedirect(appRedirectBase, redirectState?.workspaceId, {
        error: message,
      });
      res.redirect(redirectUrl);
    }
  }
);

/**
 * Get Facebook pages for the authenticated user's connection.
 * Route: GET /api/facebook/:workspaceId/pages
 */
router.get(
  '/:workspaceId/pages',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<any[]> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      const connection = await getFacebookConnection(workspaceId, userId);
      if (!connection || !connection.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Facebook connection not found. Please connect your Facebook account first.',
        });
        return;
      }

      const pages = await getFacebookPages(connection.access_token);
      res.json({
        status: 'success',
        data: pages,
      });
    } catch (error: any) {
      console.error('Error in GET /api/facebook/:workspaceId/pages:', error);
      const message = String(error?.message || '');
      const lowered = message.toLowerCase();
      const isTokenInvalid =
        lowered.includes('active access token') ||
        lowered.includes('invalid oauth access token') ||
        lowered.includes('session has expired') ||
        lowered.includes('error validating access token');

      res.status(isTokenInvalid ? 401 : 500).json({
        status: 'error',
        error: isTokenInvalid
          ? 'Facebook connection expired or was revoked. Please reconnect your Facebook account.'
          : formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Get Facebook Lead Ad forms for a specific page.
 * Route: GET /api/facebook/:workspaceId/forms
 */
router.get(
  '/:workspaceId/forms',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }, { pageId: string }>,
    res: Response<ApiResponse<any[]> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const pageId = req.query.pageId as string;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      if (!pageId) {
        res.status(400).json({
          status: 'error',
          error: 'pageId query parameter is required',
        });
        return;
      }

      const connection = await getFacebookConnection(workspaceId, userId);
      if (!connection || !connection.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Facebook connection not found. Please connect your Facebook account first.',
        });
        return;
      }

      // Get pages to find the page access token
      const pages = await getFacebookPages(connection.access_token);
      const page = pages.find((p) => p.id === pageId);

      if (!page || !page.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Page not found or access token unavailable',
        });
        return;
      }

      const forms = await getFacebookForms(pageId, page.access_token);
      res.json({
        status: 'success',
        data: forms,
      });
    } catch (error: any) {
      console.error('Error in GET /api/facebook/:workspaceId/forms:', error);
      const message = String(error?.message || '');
      const lowered = message.toLowerCase();
      const isTokenInvalid =
        lowered.includes('active access token') ||
        lowered.includes('invalid oauth access token') ||
        lowered.includes('session has expired') ||
        lowered.includes('error validating access token');
      const isPermissionError =
        lowered.includes('requires pages_manage_ads') ||
        lowered.includes('requires pages_manage_ad') ||
        lowered.includes('permissions error') ||
        lowered.includes('permissions') && lowered.includes('manage_ads');

      res.status(isTokenInvalid ? 401 : isPermissionError ? 403 : 500).json({
        status: 'error',
        error: isTokenInvalid
          ? 'Facebook connection expired or was revoked. Please reconnect your Facebook account.'
          : isPermissionError
            ? 'Facebook didn’t allow access to Lead Ad forms for this Page. Reconnect Facebook and approve the requested permissions. If it still fails, confirm your user has the required Page access and Ads Manager access for this Page.'
            : formatFacebookApiError(error),
      });
    }
  }
);
/**
 * Get fields for a specific Facebook Lead Ad form.
 * Route: GET /api/facebook/:workspaceId/forms/:formId/fields
 */
router.get(
  '/:workspaceId/forms/:formId/fields',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string; formId: string }>,
    res: Response<ApiResponse<any[]> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const formId = req.params.formId;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      const connection = await getFacebookConnection(workspaceId, userId);
      if (!connection || !connection.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Facebook connection not found. Please connect your Facebook account first.',
        });
        return;
      }

      const fields = await getFacebookFormFields(formId, connection.access_token);
      res.json({
        status: 'success',
        data: fields,
      });
    } catch (error: any) {
      console.error('Error in GET /api/facebook/:workspaceId/forms/:formId/fields:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Get all Facebook form mappings for a workspace (optionally filtered by user).
 * Route: GET /api/facebook/:workspaceId/mappings
 */
router.get(
  '/:workspaceId/mappings',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string }>,
    res: Response<ApiResponse<FacebookFormMapping[]> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      // List mappings for the current user
      const mappings = await listFacebookFormMappings(workspaceId, userId);
      res.json({
        status: 'success',
        data: mappings,
      });
    } catch (error: any) {
      console.error('Error in GET /api/facebook/:workspaceId/mappings:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Get a specific Facebook form mapping.
 * Route: GET /api/facebook/:workspaceId/mappings/:formId
 */
router.get(
  '/:workspaceId/mappings/:formId',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string; formId: string }>,
    res: Response<ApiResponse<FacebookFormMapping> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const formId = req.params.formId;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      const mapping = await getFacebookFormMapping(workspaceId, userId, formId);
      if (!mapping) {
        res.status(404).json({
          status: 'error',
          error: 'Form mapping not found',
        });
        return;
      }

      res.json({
        status: 'success',
        data: mapping,
      });
    } catch (error: any) {
      console.error('Error in GET /api/facebook/:workspaceId/mappings/:formId:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Create or update a Facebook form mapping.
 * Route: POST /api/facebook/:workspaceId/mappings
 */
router.post(
  '/:workspaceId/mappings',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<
      { workspaceId: string },
      {},
      { pageId: string; formId: string; formName?: string; mapping_config: FacebookFormMapping['mapping_config'] }
    >,
    res: Response<ApiResponse<FacebookFormMapping> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const { pageId, formId, formName, mapping_config } = req.body;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      if (!pageId || !formId || !mapping_config) {
        res.status(400).json({
          status: 'error',
          error: 'pageId, formId, and mapping_config are required',
        });
        return;
      }

      const mapping = await saveFacebookFormMapping(
        workspaceId,
        userId,
        pageId,
        formId,
        mapping_config,
        formName
      );

      // Automatically subscribe to webhooks for real-time lead sync
      let webhookSubscribed = false;
      let webhookSubscriptionError: string | undefined;
      try {
        const connection = await getFacebookConnection(workspaceId, userId);
        if (connection && connection.access_token) {
          const pages = await getFacebookPages(connection.access_token);
          const page = pages.find((p) => p.id === pageId);
          
          if (page && page.access_token) {
            const webhookUrl = getFacebookWebhookUrl(req);
            const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN || 'dev-verify-token-change-me';
            
            const subscriptionResult = await subscribePageToWebhooks(
              pageId,
              page.access_token,
              webhookUrl,
              verifyToken
            );
            webhookSubscribed = subscriptionResult.success;
            
            if (webhookSubscribed) {
              console.log(`[Facebook] Auto-subscribed page ${pageId} to webhooks`, {
                webhookUrl,
              });
            } else {
              webhookSubscriptionError =
                subscriptionResult.error || 'Facebook did not activate the webhook subscription';
              console.warn(
                `[Facebook] Failed to auto-subscribe page ${pageId}: ${subscriptionResult.error}`
              );
            }
          } else {
            webhookSubscriptionError = 'Facebook page access token is unavailable';
          }
        } else {
          webhookSubscriptionError = 'Facebook connection is unavailable';
        }
      } catch (webhookError: any) {
        // Log but don't fail the mapping save if webhook subscription fails
        console.error('[Facebook] Failed to auto-subscribe to webhooks:', webhookError);
        webhookSubscriptionError = formatFacebookApiError(webhookError);
        // Continue - mapping is saved, user can manually configure webhooks if needed
      }

      res.json({
        status: 'success',
        data: mapping,
        webhookSubscribed,
        ...(webhookSubscriptionError ? { webhookSubscriptionError } : {}),
      } as ApiResponse<FacebookFormMapping> & {
        webhookSubscribed: boolean;
        webhookSubscriptionError?: string;
      });
    } catch (error: any) {
      console.error('Error in POST /api/facebook/:workspaceId/mappings:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Delete a Facebook form mapping.
 * Route: DELETE /api/facebook/:workspaceId/mappings/:formId
 */
router.delete(
  '/:workspaceId/mappings/:formId',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string; formId: string }>,
    res: Response<ApiResponse<void> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const formId = req.params.formId;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      await deleteFacebookFormMapping(workspaceId, userId, formId);

      res.json({
        status: 'success',
        message: 'Form mapping deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in DELETE /api/facebook/:workspaceId/mappings/:formId:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Facebook Webhook verification and processing.
 * Route: GET /api/facebook/webhook (verification)
 * Route: POST /api/facebook/webhook (lead notifications)
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function getFacebookVerifyToken(): string {
  return process.env.FACEBOOK_VERIFY_TOKEN ||
    (isProduction() ? '' : 'dev-verify-token-change-me');
}

function getFacebookAppSecret(): string {
  return process.env.FACEBOOK_APP_SECRET || '';
}

const FACEBOOK_LEAD_JOB_PENDING = 'fb_lead_pending';
const FACEBOOK_LEAD_JOB_PROCESSING = 'fb_lead_proc';
const FACEBOOK_LEAD_JOB_COMPLETED = 'fb_lead_done';
const FACEBOOK_IMPORT_JOB_PENDING = 'fb_import_pending';
const FACEBOOK_IMPORT_JOB_PROCESSING = 'fb_import_proc';
const FACEBOOK_IMPORT_JOB_COMPLETED = 'fb_import_done';
const FACEBOOK_IMPORT_JOB_FAILED = 'fb_import_failed';

function logFacebookLeadSyncInfo(message: string, context?: Record<string, unknown>): void {
  if (context && Object.keys(context).length > 0) {
    console.info(`[Facebook Lead Sync] ${message}`, context);
    return;
  }
  console.info(`[Facebook Lead Sync] ${message}`);
}

function verifyFacebookWebhookSignature(req: Request): boolean {
  const sigHeader =
    req.get('x-hub-signature-256') ||
    req.get('X-Hub-Signature-256') ||
    req.get('x-hub-signature') ||
    req.get('X-Hub-Signature');

  if (!sigHeader) return false;
  const appSecret = getFacebookAppSecret();
  if (!appSecret) return false;

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody || !Buffer.isBuffer(rawBody)) return false;

  if (sigHeader.startsWith('sha256=')) {
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = sigHeader.slice('sha256='.length);
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
  }

  if (sigHeader.startsWith('sha1=')) {
    const expected = crypto.createHmac('sha1', appSecret).update(rawBody).digest('hex');
    const provided = sigHeader.slice('sha1='.length);
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
  }

  return false;
}

/**
 * Facebook webhook verification (GET request).
 * Facebook sends a GET request with hub.verify_token and hub.challenge to verify the endpoint.
 */
router.get('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const mode = req.query['hub.mode'] as string;
    const token = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    const verifyToken = getFacebookVerifyToken();
    if (isProduction() && !verifyToken) {
      res.status(500).send('Webhook verify token not configured');
      return;
    }

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[Facebook Webhook] Verification successful');
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Forbidden');
    }
  } catch (error) {
    console.error('Error in GET /api/facebook/webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Facebook webhook processing (POST request).
 * Processes leadgen_id events from Facebook Lead Ads.
 */
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawEntries = Array.isArray(req.body?.entry) ? req.body.entry.length : 0;
    console.info('[Facebook Webhook] POST hit', {
      object: req.body?.object || 'unknown',
      entries: rawEntries,
      hasSignature256: Boolean(req.get('x-hub-signature-256') || req.get('X-Hub-Signature-256')),
      hasSignature1: Boolean(req.get('x-hub-signature') || req.get('X-Hub-Signature')),
    });

    if (isProduction()) {
      if (!getFacebookAppSecret()) {
        console.error('[Facebook Webhook] Rejecting webhook: FACEBOOK_APP_SECRET missing in production');
        res.status(500).json({ status: 'error', error: 'Facebook app secret not configured' });
        return;
      }
      if (!verifyFacebookWebhookSignature(req)) {
        console.warn('[Facebook Webhook] Rejecting webhook: invalid signature (production mode)');
        res.status(401).json({ status: 'error', error: 'Invalid signature' });
        return;
      }
    } else if (getFacebookAppSecret() && req.get('x-hub-signature-256')) {
      if (!verifyFacebookWebhookSignature(req)) {
        console.warn('[Facebook Webhook] Rejecting webhook: invalid signature (dev signature present)');
        res.status(401).json({ status: 'error', error: 'Invalid signature' });
        return;
      }
    }

    const body = req.body;
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    let queuedJobs = 0;
    let duplicateJobsSkipped = 0;
    let leadgenEvents = 0;

    logFacebookLeadSyncInfo('Webhook event received', {
      object: body?.object || 'unknown',
      entries: entries.length,
    });

    // Facebook sends webhook data in a specific format
    if (body.object === 'page') {
      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          if (change.field === 'leadgen') {
            leadgenEvents++;
            const leadgenId = change.value?.leadgen_id;
            const formId = change.value?.form_id;
            const pageId = entry.id;

            console.info('[Facebook Webhook] Received leadgen event', {
              leadgenId: leadgenId || null,
              formId: formId || null,
              pageId: pageId || null,
            });

            if (!leadgenId || !formId || !pageId) {
              console.warn('[Facebook Webhook] Missing required fields:', { leadgenId, formId, pageId });
              continue;
            }

            logFacebookLeadSyncInfo('Leadgen change received', {
              leadgenId,
              formId,
              pageId,
            });

            const mappings = await getFacebookMappingsForPageForm(pageId, formId);
            if (!mappings.length) {
              console.warn(`[Facebook Webhook] No exact mapping found for form ${formId} on page ${pageId}`);
              continue;
            }

            logFacebookLeadSyncInfo('Resolved mappings for leadgen event', {
              leadgenId,
              formId,
              pageId,
              mappings: mappings.length,
            });

            const now = new Date().toISOString();
            for (const mapping of mappings) {
              const jobEventId = `fb_lead_${mapping.workspace_id}_${mapping.user_id}_${leadgenId}`;
              const payload = {
                workspaceId: mapping.workspace_id,
                userId: mapping.user_id,
                leadgenId,
                pageId,
                formId,
                mappingConfig: mapping.mapping_config,
                attempts: 0,
                nextRunAt: now,
                createdAt: now,
              };

              const existingJobResponse = (await webhookLogsApi.getWebhookLogs({
                workspace_id: mapping.workspace_id,
                source: 'facebook',
                event_id: jobEventId,
                limit: 10,
                cache: 'no-store',
              })) as ApiResponse<any[]>;
              const existingJobs = Array.isArray(existingJobResponse.data)
                ? existingJobResponse.data
                : existingJobResponse.data
                  ? [existingJobResponse.data]
                  : [];
              const activeOrCompletedJob = existingJobs.some((job) =>
                [
                  FACEBOOK_LEAD_JOB_PENDING,
                  FACEBOOK_LEAD_JOB_PROCESSING,
                  FACEBOOK_LEAD_JOB_COMPLETED,
                ].includes(String(job?.status || ''))
              );

              if (activeOrCompletedJob) {
                duplicateJobsSkipped++;
                logFacebookLeadSyncInfo('Skipped duplicate lead sync job', {
                  jobEventId,
                  workspaceId: mapping.workspace_id,
                  leadgenId,
                });
                continue;
              }

              await webhookLogsApi.createWebhookLog({
                workspace_id: mapping.workspace_id,
                lead_id: 0,
                source: 'facebook',
                source_old: 'facebook',
                event_id: jobEventId,
                payload: JSON.stringify(payload),
                status: FACEBOOK_LEAD_JOB_PENDING,
                error: null,
                created_at: now,
              });

              queuedJobs++;
              logFacebookLeadSyncInfo('Queued lead sync job', {
                jobEventId,
                workspaceId: mapping.workspace_id,
                userId: mapping.user_id,
                leadgenId,
                pageId,
                formId,
              });
            }
          }
        }
      }
    } else {
      logFacebookLeadSyncInfo('Ignoring webhook object that is not page', {
        object: body?.object || 'unknown',
      });
    }

    if (leadgenEvents === 0) {
      console.warn('[Facebook Webhook] POST hit but no leadgen changes found', {
        object: body?.object || 'unknown',
        entries: entries.length,
      });
    }

    logFacebookLeadSyncInfo('Webhook processing completed', {
      queuedJobs,
      duplicateJobsSkipped,
      entries: entries.length,
      leadgenEvents,
    });

    // Always respond quickly to Facebook
    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error in POST /api/facebook/webhook:', error);
    // A non-2xx response tells Meta to retry transient database/queue failures.
    // Duplicate job checks above make those retries idempotent.
    res.status(500).json({ status: 'error', error: 'Processing failed' });
  }
});

/**
 * Check webhook subscription status for a Facebook page.
 * Route: GET /api/facebook/:workspaceId/pages/:pageId/webhook-status
 */
router.get(
  '/:workspaceId/pages/:pageId/webhook-status',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string; pageId: string }>,
    res: Response<ApiResponse<{
      subscribed: boolean;
      pageSubscribed: boolean;
      appSubscribed: boolean;
      fields: string[];
      callbackUrl?: string;
      expectedCallbackUrl: string;
    }> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const pageId = req.params.pageId;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      const connection = await getFacebookConnection(workspaceId, userId);
      if (!connection || !connection.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Facebook connection not found. Please connect your Facebook account first.',
        });
        return;
      }

      const pages = await getFacebookPages(connection.access_token);
      const page = pages.find((p) => p.id === pageId);

      if (!page || !page.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Page not found or access token unavailable',
        });
        return;
      }

      const fields = await getPageWebhookSubscriptions(pageId, page.access_token);
      const pageSubscribed = fields.includes('leadgen');
      const expectedCallbackUrl = getFacebookWebhookUrl(req);
      const appSubscriptions = await getFacebookAppWebhookSubscriptions();
      const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '');
      const appSubscription = appSubscriptions.find(
        (subscription) =>
          subscription.object === 'page' &&
          subscription.active !== false &&
          Array.isArray(subscription.fields) &&
          subscription.fields.includes('leadgen') &&
          normalizeUrl(String(subscription.callback_url || '')) === normalizeUrl(expectedCallbackUrl)
      );
      const appSubscribed = Boolean(appSubscription);
      const subscribed = pageSubscribed && appSubscribed;

      res.json({
        status: 'success',
        data: {
          subscribed,
          pageSubscribed,
          appSubscribed,
          fields,
          ...(appSubscription?.callback_url ? { callbackUrl: appSubscription.callback_url } : {}),
          expectedCallbackUrl,
        },
      });
    } catch (error: any) {
      console.error('Error in GET /api/facebook/:workspaceId/pages/:pageId/webhook-status:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

/**
 * Import historical leads from a Facebook Lead Ad form.
 * Route: POST /api/facebook/:workspaceId/import
 */
router.post(
  '/:workspaceId/import',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<
      { workspaceId: string },
      {},
      { pageId: string; formId: string; since?: string }
    >,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const userId: number = Number(req.user?.id || 0);
      const { pageId, formId } = req.body;

      if (!userId) {
        res.status(401).json({
          success: false,
          status: 'error',
          error: 'Authentication required',
        });
        return;
      }

      if (!pageId || !formId) {
        res.status(400).json({
          status: 'error',
          error: 'pageId and formId are required',
        });
        return;
      }

      // Get the mapping for this form
      const mapping = await getFacebookFormMapping(workspaceId, userId, formId);
      if (!mapping) {
        res.status(404).json({
          status: 'error',
          error: 'Form mapping not found. Please configure field mapping first.',
        });
        return;
      }

      // Get the Facebook connection
      const connection = await getFacebookConnection(workspaceId, userId);
      if (!connection || !connection.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Facebook connection not found. Please connect your Facebook account first.',
        });
        return;
      }

      // Get page access token
      const pages = await getFacebookPages(connection.access_token);
      const page = pages.find((p) => p.id === pageId);
      if (!page || !page.access_token) {
        res.status(404).json({
          status: 'error',
          error: 'Page not found or access token unavailable',
        });
        return;
      }

      const now = new Date().toISOString();
      const jobId = `fb_import_${workspaceId}_${userId}_${formId}_${Date.now()}`;
      const payload = {
        workspaceId,
        userId,
        pageId,
        formId,
        mappingConfig: mapping.mapping_config,
        after: undefined,
        batchSize: 50,
        stats: { processed: 0, created: 0, duplicates: 0, errors: 0 },
        attempts: 0,
        nextRunAt: now,
        createdAt: now,
      };

      await webhookLogsApi.createWebhookLog({
        workspace_id: workspaceId,
        lead_id: 0,
        source: 'facebook',
        source_old: 'facebook',
        event_id: jobId,
        payload: JSON.stringify(payload),
        status: FACEBOOK_IMPORT_JOB_PENDING,
        error: null,
        created_at: now,
      });

      res.json({
        status: 'success',
        data: { jobId },
        message: 'Import started. Leads will be processed in the background.',
      });
    } catch (error: any) {
      console.error('Error in POST /api/facebook/:workspaceId/import:', error);
      res.status(500).json({
        status: 'error',
        error: formatFacebookApiError(error),
      });
    }
  }
);

router.get(
  '/:workspaceId/import/jobs/:jobId',
  authMiddleware,
  workspaceAuthMiddleware,
  adminOnlyMiddleware,
  async (
    req: AuthenticatedRequest<{ workspaceId: string; jobId: string }>,
    res: Response<ApiResponse<any> | AuthErrorResponse>
  ): Promise<void> => {
    try {
      const workspaceId: number = Number(req.params.workspaceId);
      const jobId = String(req.params.jobId || '');
      if (!jobId) {
        res.status(400).json({ status: 'error', error: 'jobId is required' });
        return;
      }

      const statuses = [
        FACEBOOK_IMPORT_JOB_PENDING,
        FACEBOOK_IMPORT_JOB_PROCESSING,
        FACEBOOK_IMPORT_JOB_COMPLETED,
        FACEBOOK_IMPORT_JOB_FAILED,
      ];

      for (const status of statuses) {
        const response = (await webhookLogsApi.getWebhookLogs({
          workspace_id: workspaceId,
          status,
          event_id: jobId,
          limit: 1,
        })) as ApiResponse<any[]>;

        if (response.status === 'success' && response.data && response.data.length > 0) {
          const log = Array.isArray(response.data) ? response.data[0] : (response.data as any);
          let payload: any = null;
          try {
            payload = JSON.parse(log.payload || '{}');
          } catch {
            payload = null;
          }

          res.json({
            status: 'success',
            data: {
              jobId,
              status: log.status,
              error: log.error || null,
              created_at: log.created_at,
              payload,
            },
          });
          return;
        }
      }

      res.status(404).json({ status: 'error', error: 'Import job not found' });
    } catch (error: any) {
      res.status(500).json({ status: 'error', error: formatFacebookApiError(error) });
    }
  }
);

export default router;
