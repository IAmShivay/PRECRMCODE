import { Router, Response } from 'express';
import { usersApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateToken } from '../utils/authHelpers.js';
import { User, AuthResponse, AuthErrorResponse, ApiResponse, AuthenticatedRequest, JWTPayload } from '../types/index.js';

const router: Router = Router();

router.get('/auth/me', authMiddleware, async (req: AuthenticatedRequest, res: Response<AuthResponse | AuthErrorResponse>): Promise<void> => {
  try {
    const userId: number | undefined = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        status: 'error',
        error: 'Invalid token payload',
      });
      return;
    }

    const userResponse = await usersApi.getUserById(Number(userId)) as ApiResponse<User>;
    if (userResponse.status !== 'success' || !userResponse.data) {
      res.status(404).json({
        success: false,
        status: 'error',
        error: 'User not found',
      });
      return;
    }

    const user: User = {
      id: userResponse.data.id,
      name: userResponse.data.name,
      email: userResponse.data.email,
      created_at: userResponse.data.created_at || new Date().toISOString(),
      accepted_terms: userResponse.data.accepted_terms,
      accepted_terms_at: userResponse.data.accepted_terms_at,
    };

    const successRes: AuthResponse = {
      success: true,
      status: 'success',
      data: { user, token: '' } as any, // AuthResponse requires both user & token, but /auth/me only returns user
    } as AuthResponse;

    res.json(successRes);
  } catch (error) {
    console.error('Error in GET /api/auth/me:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: 'Failed to load current user',
    });
  }
});

router.post('/auth/refresh', authMiddleware, async (req: AuthenticatedRequest, res: Response<AuthResponse | AuthErrorResponse>): Promise<void> => {
  try {
    const userId: number | undefined = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        status: 'error',
        error: 'Invalid token payload',
      });
      return;
    }

    const userResponse = await usersApi.getUserById(Number(userId)) as ApiResponse<User>;
    if (userResponse.status !== 'success' || !userResponse.data) {
      res.status(404).json({
        success: false,
        status: 'error',
        error: 'User not found',
      });
      return;
    }

    const user: User = {
      id: userResponse.data.id,
      name: userResponse.data.name,
      email: userResponse.data.email,
      created_at: userResponse.data.created_at || new Date().toISOString(),
      accepted_terms: userResponse.data.accepted_terms,
      accepted_terms_at: userResponse.data.accepted_terms_at,
    };

    const userForToken: JWTPayload = {
      id: user.id,
      email: user.email,
    };

    const token = generateToken(userForToken);

    const successRes: AuthResponse = {
      success: true,
      status: 'success',
      data: { user, token },
    };

    res.json(successRes);
  } catch (error) {
    console.error('Error in POST /api/auth/refresh:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: 'Failed to refresh token',
    });
  }
});

export default router;
