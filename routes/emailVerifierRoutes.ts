import { Router, Response } from 'express';
import { verifyEmail, getBalance, isEmailValid } from '../services/emailVerifier.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ApiResponse,
  AuthenticatedRequest,
} from '../types/index.js';

const router: Router = Router();
const ENABLE_ACCEPT_ALL_PROBE: boolean =
  String(process.env.EMAIL_VERIFY_ACCEPT_ALL_PROBE || '').toLowerCase() === 'true';

function toApiEmailValidFlag(result: any, mode: 'quick' | 'power'): boolean {
  if (isEmailValid(result, mode)) return true;

  const status = typeof result?.status === 'string' ? result.status.trim().toLowerCase() : '';
  const syntaxOk = result?.is_valid_syntax !== false;
  const notDisposable = result?.is_disposable !== true;
  const notSpamtrap = result?.is_spamtrap !== true;

  return (status === 'safe' || status === 'valid') && syntaxOk && notDisposable && notSpamtrap;
}

/**
 * POST /api/email-verify
 * Verify a single email address
 */
router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest<{}, {}, { email: string; mode?: 'quick' | 'power' | 'auto' }>, res: Response<ApiResponse<any>>): Promise<void> => {
    try {
      const { email, mode = 'auto' } = req.body;

      if (!email) {
        res.status(400).json({
          status: 'error',
          message: 'email is required',
        });
        return;
      }

      // Validate email format before API call
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid email format',
        });
        return;
      }

      const requestedMode: 'quick' | 'power' | 'auto' = mode;
      let usedMode: 'quick' | 'power' = 'quick';
      let result: any;

      if (requestedMode === 'quick' || requestedMode === 'power') {
        usedMode = requestedMode;
        result = await verifyEmail(email, usedMode);
      } else {
        try {
          usedMode = 'power';
          result = await verifyEmail(email, 'power');
        } catch {
          usedMode = 'quick';
          result = await verifyEmail(email, 'quick');
        }
      }

      // Keep API/UI verification aligned with lead auto-verification logic.
      let isValid = toApiEmailValidFlag(result, usedMode);
      let verdict: 'deliverable' | 'undeliverable' | 'unknown_accept_all' | 'unknown' =
        isValid ? 'deliverable' : 'undeliverable';
      let acceptAll: boolean | undefined;

      // Optional strict mode: detect potential accept-all domains.
      // Disabled by default to avoid false negatives on valid corporate emails.
      if (ENABLE_ACCEPT_ALL_PROBE && usedMode === 'power' && isValid && result?.is_free_email === false) {
        const domain = String(email).trim().toLowerCase().split('@')[1] || '';
        if (domain) {
          const randomLocal = `scraft_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
          const probeEmail = `${randomLocal}@${domain}`;
          try {
            const probeResult = await verifyEmail(probeEmail, 'power');
            const probeValid = toApiEmailValidFlag(probeResult, 'power');
            acceptAll = probeValid;
            if (probeValid) {
              isValid = false;
              verdict = 'unknown_accept_all';
            }
          } catch {}
        }
      }

      res.json({
        status: 'success',
        data: {
          ...result,
          email_valid: isValid,
          email_verdict: verdict,
          email_accept_all: acceptAll,
          email_verification_mode: usedMode,
          email_requested_mode: requestedMode,
        },
      });
    } catch (error) {
      console.error('Error in POST /api/email-verify:', error);
      
      // Provide user-friendly error messages
      const errorMessage = (error as Error).message || 'Failed to verify email';
      const statusCode = errorMessage.includes('timeout') || errorMessage.includes('unable to connect') ? 503 : 500;
      
      res.status(statusCode).json({
        status: 'error',
        message: errorMessage,
      });
    }
  }
);

/**
 * GET /api/email-verify/balance
 * Check remaining API credits
 */
router.get(
  '/balance',
  authMiddleware,
  async (_req: AuthenticatedRequest, res: Response<ApiResponse<any>>): Promise<void> => {
    try {
      const balance = await getBalance();

      res.json({
        status: 'success',
        data: balance,
      });
    } catch (error) {
      const errorMessage = (error as Error).message || 'Failed to check balance';
      console.error('Error in GET /api/email-verify/balance:', errorMessage);
      
      // Check if it's an API key error
      if (errorMessage.includes('REOON_API_KEY')) {
        console.error('[EmailVerifier] REOON_API_KEY environment variable is not set');
        res.status(500).json({
          status: 'error',
          message: 'Email verification service is not configured. Please set REOON_API_KEY environment variable.',
        });
        return;
      }

      // Check if it's a network/API error
      const statusCode = errorMessage.includes('timeout') || errorMessage.includes('unable to connect') || errorMessage.includes('fetch') ? 503 : 500;
      
      res.status(statusCode).json({
        status: 'error',
        message: errorMessage,
      });
    }
  }
);

export default router;
