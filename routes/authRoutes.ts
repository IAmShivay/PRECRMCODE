import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { usersApi } from '../services/api.js';
import { hashPassword, verifyPassword, generateToken } from '../utils/authHelpers.js';
import { User, SignupBody, LoginBody, AuthResponse, AuthErrorResponse, ApiResponse, JWTPayload } from '../types/index.js';
import {
  buildFacebookAuthOAuthUrl,
  createFacebookAuthStateToken,
  verifyFacebookAuthStateToken,
  exchangeCodeForUserAccessToken,
  getFacebookAuthRedirectUri,
  getFacebookUserProfile,
} from '../services/facebook.js';
import { validate, loginSchema, signupSchema } from '../utils/validation.js';

const router: Router = Router();

function getRequestOrigin(req: Request): string {
  const proto = (String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0] || 'http').trim();
  const host = (String(req.get('x-forwarded-host') || req.get('host') || 'localhost:3006').split(',')[0] || 'localhost:3006').trim();
  return `${proto}://${host}`;
}

function getCreatedAt(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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

export const login = async (req: Request<{}, {}, LoginBody>, res: Response<AuthResponse | AuthErrorResponse>): Promise<void> => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Email and password are required',
      };
      res.status(400).json(errorRes);
      return;
    }

    const normalizedEmail: string = String(email).toLowerCase().trim();
    const trimmedPassword: string = String(password).trim();

    const searchResponse = await usersApi.searchUserByEmail(normalizedEmail) as ApiResponse<User[]>;

    if (searchResponse.status !== 'success' || !searchResponse.data || searchResponse.data.length === 0) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'No account found with this email',
      };
      res.status(401).json(errorRes);
      return;
    }

    const foundUser: User | undefined = searchResponse.data[0];
    if (!foundUser) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'No account found with this email',
      };
      res.status(401).json(errorRes);
      return;
    }
    const storedPassword: string = (foundUser.password || '').trim();

    if (!verifyPassword(trimmedPassword, storedPassword)) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Incorrect password',
      };
      res.status(401).json(errorRes);
      return;
    }

    const userForToken: JWTPayload = {
      id: foundUser.id,
      email: foundUser.email,
    };

    const user: User = {
      id: foundUser.id,
      name: foundUser.name,
      email: foundUser.email,
      created_at: foundUser.created_at || new Date().toISOString(),
      accepted_terms: foundUser.accepted_terms,
      accepted_terms_at: foundUser.accepted_terms_at,
    };

    const token: string = generateToken(userForToken);

    const successRes: AuthResponse = {
      success: true,
      status: 'success',
      data: {
        user,
        token,
      },
    };
    res.json(successRes);
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error);
    const errorRes: AuthErrorResponse = {
      success: false,
      status: 'error',
      error: 'Login failed',
    };
    res.status(500).json(errorRes);
  }
};

export const signup = async (req: Request<{}, {}, SignupBody>, res: Response<AuthResponse | AuthErrorResponse>): Promise<void> => {
  try {
    const { name, email, password, accepted_terms, accepted_terms_at } = req.body || {};

    if (!name || !email || !password) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'Name, email, and password are required',
      };
      res.status(400).json(errorRes);
      return;
    }

    const normalizedEmail: string = String(email).toLowerCase().trim();

    const existing = await usersApi.searchUserByEmail(normalizedEmail) as ApiResponse<User[]>;
    if (existing.status === 'success' && existing.data && existing.data.length > 0) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: 'An account with this email already exists',
      };
      res.status(409).json(errorRes);
      return;
    }

    const hashedPassword: string = hashPassword(String(password));

    const createdAt = getCreatedAt();

    const createResponse = await usersApi.createUser({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      created_at: createdAt,
    });

    const createdUserId = (createResponse as any)?.id ?? (createResponse as any)?.data?.id;
    if (createResponse.status !== 'success' || !createdUserId) {
      const errorRes: AuthErrorResponse = {
        success: false,
        status: 'error',
        error: createResponse.message || 'Failed to create user',
      };
      res.status(500).json(errorRes);
      return;
    }

    const userForToken: JWTPayload = {
      id: Number(createdUserId),
      email: normalizedEmail,
    };

    const user: User = {
      id: Number(createdUserId),
      name,
      email: normalizedEmail,
      created_at: createdAt,
      accepted_terms: Number(accepted_terms || 0),
      accepted_terms_at: String(accepted_terms_at || '').trim(),
    };

    const token: string = generateToken(userForToken);

    const successRes: AuthResponse = {
      success: true,
      status: 'success',
      data: {
        user,
        token,
      },
    };
    res.status(201).json(successRes);
  } catch (error) {
    console.error('Error in POST /api/users:', error);
    const errorRes: AuthErrorResponse = {
      success: false,
      status: 'error',
      error: 'Failed to create user',
    };
    res.status(500).json(errorRes);
  }
};

/**
 * Start Facebook OAuth flow for user authentication (login or signup).
 * Route: GET /api/auth/facebook/start
 */
router.get('/auth/facebook/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.query as { action?: string };

    if (!action || (action !== 'login' && action !== 'signup')) {
      res.status(400).json({
        success: false,
        status: 'error',
        error: 'Action parameter is required and must be "login" or "signup"',
      });
      return;
    }

    const requestOrigin = getRequestOrigin(req);
    const redirectUri = getFacebookAuthRedirectUri(requestOrigin);
    const returnToRaw = String((req.query as any)?.return_to || (req.query as any)?.returnTo || '').trim();
    const returnToOrigin = normalizeOrigin(returnToRaw);
    const allowedReturnTo = resolveAllowedReturnToOrigins(requestOrigin);
    const safeReturnTo = returnToOrigin && allowedReturnTo.has(returnToOrigin) ? returnToOrigin : undefined;
    const state = createFacebookAuthStateToken(action as 'login' | 'signup', safeReturnTo);
    const authUrl = buildFacebookAuthOAuthUrl(redirectUri, state);

    res.json({
      status: 'success',
      data: {
        authUrl: authUrl,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/auth/facebook/start:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: 'Failed to start Facebook OAuth flow',
    });
  }
});

/**
 * Facebook OAuth callback handler for user authentication.
 * Route: GET /api/auth/facebook/callback
 */
router.get('/auth/facebook/callback', async (req: Request, res: Response): Promise<void> => {
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
            return verifyFacebookAuthStateToken(String(state));
          } catch {
            return null;
          }
        })()
      : null;

    const appRedirectBase = (
      decodedState?.returnTo ||
      getAppOrigin(requestOrigin) ||
      ''
    ).replace(/\/+$/, '');

    if (fbError) {
      console.error('Facebook OAuth error:', fbError, error_description);
      const redirectUrl = `${appRedirectBase}/login?error=${encodeURIComponent(
        fbError
      )}`;
      res.redirect(redirectUrl);
      return;
    }

    if (!code || !state) {
      const redirectUrl = `${appRedirectBase}/login?error=${encodeURIComponent(
        'missing_code_or_state'
      )}`;
      res.redirect(redirectUrl);
      return;
    }

    if (!decodedState) {
      throw new Error('invalid_state');
    }

    const { action } = decodedState;
    const redirectUri = getFacebookAuthRedirectUri(requestOrigin);

    // Exchange code for access token
    const token = await exchangeCodeForUserAccessToken(String(code), redirectUri);

    // Get user profile from Facebook
    const fbProfile = await getFacebookUserProfile(token.access_token);

    if (!fbProfile.email) {
      const redirectUrl = `${appRedirectBase}/login?error=${encodeURIComponent(
        'email_required'
      )}`;
      res.redirect(redirectUrl);
      return;
    }

    const normalizedEmail = fbProfile.email.toLowerCase().trim();

    // Check if user exists
    const existingUserResponse = await usersApi.searchUserByEmail(normalizedEmail) as ApiResponse<User[]>;
    const existingUser = existingUserResponse.status === 'success' && existingUserResponse.data && existingUserResponse.data.length > 0
      ? existingUserResponse.data[0]
      : null;

    if (action === 'login') {
      if (!existingUser) {
        const redirectUrl = `${appRedirectBase}/login?error=${encodeURIComponent(
          'no_account_found'
        )}`;
        res.redirect(redirectUrl);
        return;
      }

      // Generate token for existing user
      const userForToken: JWTPayload = {
        id: existingUser.id,
        email: existingUser.email,
      };

      const user: User = {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        created_at: existingUser.created_at || new Date().toISOString(),
        accepted_terms: existingUser.accepted_terms,
        accepted_terms_at: existingUser.accepted_terms_at,
      };

      const jwtToken = generateToken(userForToken);

      // Redirect to login success page with token
      const redirectUrl = `${appRedirectBase}/login?token=${encodeURIComponent(
        jwtToken
      )}&user=${encodeURIComponent(JSON.stringify(user))}`;
      res.redirect(redirectUrl);
      return;
    } else {
      // Signup flow
      if (existingUser) {
        // User already exists, log them in instead
        const userForToken: JWTPayload = {
          id: existingUser.id,
          email: existingUser.email,
        };

        const user: User = {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          created_at: existingUser.created_at || new Date().toISOString(),
          accepted_terms: existingUser.accepted_terms,
          accepted_terms_at: existingUser.accepted_terms_at,
        };

        const jwtToken = generateToken(userForToken);

        const redirectUrl = `${appRedirectBase}/login?token=${encodeURIComponent(
          jwtToken
        )}&user=${encodeURIComponent(JSON.stringify(user))}`;
        res.redirect(redirectUrl);
        return;
      }

      // Create new user
      // Generate a random password since Facebook auth doesn't provide one
      // The password won't be used for Facebook-authenticated users
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashedPassword = hashPassword(randomPassword);

      const createdAt = getCreatedAt();

      const createResponse = await usersApi.createUser({
        name: fbProfile.name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        password: hashedPassword,
        created_at: createdAt,
      });

      const createdUserId = (createResponse as any)?.id ?? (createResponse as any)?.data?.id;
      if (createResponse.status !== 'success' || !createdUserId) {
        const redirectUrl = `${appRedirectBase}/signup?error=${encodeURIComponent(
          'failed_to_create_account'
        )}`;
        res.redirect(redirectUrl);
        return;
      }

      const userForToken: JWTPayload = {
        id: Number(createdUserId),
        email: normalizedEmail,
      };

      const user: User = {
        id: Number(createdUserId),
        name: fbProfile.name ?? normalizedEmail.split('@')[0] ?? 'User',
        email: normalizedEmail,
        created_at: createdAt,
        accepted_terms: 0,
        accepted_terms_at: '',
      };

      const jwtToken = generateToken(userForToken);

      // Redirect to signup success (workspace creation)
      const redirectUrl = `${appRedirectBase}/login?token=${encodeURIComponent(
        jwtToken
      )}&user=${encodeURIComponent(JSON.stringify(user))}`;
      res.redirect(redirectUrl);
      return;
    }
  } catch (error: any) {
    console.error('Error in GET /api/auth/facebook/callback:', error);

    const fallbackOrigin =
      String(process.env.APP_BASE_URL || '').trim() ||
      getAppOrigin(getRequestOrigin(req)) ||
      'http://localhost:3006';
    const appRedirectBase = fallbackOrigin.replace(/\/+$/, '');

    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'oauth_failed';

    const redirectUrl = `${appRedirectBase}/login?error=${encodeURIComponent(
      message
    )}`;
    res.redirect(redirectUrl);
  }
});

router.post('/users', validate(signupSchema), signup);
router.post('/auth/login', validate(loginSchema), login);

// ============ ADMIN: RESET USER PASSWORD ============
import { authMiddleware } from '../middleware/auth.js';

const SUPER_ADMIN_EMAIL = 'scraftstudio@gmail.com';

router.post(
  '/auth/admin/reset-password',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const adminUser = (req as any).user as JWTPayload;
      if (!adminUser?.email || adminUser.email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
        res.status(403).json({ status: 'error', message: 'Only the super admin can reset passwords' });
        return;
      }

      const { user_id, new_password } = req.body || {};
      if (!user_id || !new_password) {
        res.status(400).json({ status: 'error', message: 'user_id and new_password are required' });
        return;
      }

      if (String(new_password).trim().length < 6) {
        res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
        return;
      }

      const targetUser = await usersApi.getUserById(Number(user_id)) as ApiResponse<User>;
      if (targetUser.status !== 'success' || !targetUser.data) {
        res.status(404).json({ status: 'error', message: 'User not found' });
        return;
      }

      const hashedPassword = hashPassword(String(new_password).trim());
      const updateResponse = await usersApi.updateUser(Number(user_id), { password: hashedPassword });

      if ((updateResponse as any).status !== 'success') {
        res.status(500).json({ status: 'error', message: 'Failed to reset password' });
        return;
      }

      res.json({
        status: 'success',
        message: `Password reset successfully for ${targetUser.data.email}`,
      });
    } catch (error) {
      console.error('Error in POST /api/auth/admin/reset-password:', error);
      res.status(500).json({ status: 'error', message: 'Failed to reset password' });
    }
  }
);

export default router;
