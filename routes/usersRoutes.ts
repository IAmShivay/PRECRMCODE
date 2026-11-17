import { Router, Response } from 'express';
import { usersApi } from '../services/api.js';
import { User, ApiResponse, SearchUsersBody, AuthenticatedRequest } from '../types/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router: Router = Router();

function publicUser(user: User): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
    accepted_terms: user.accepted_terms,
    accepted_terms_at: user.accepted_terms_at,
  };
}

function publicUsersResponse(response: ApiResponse<User[]>): ApiResponse<User[]> {
  return {
    ...response,
    data: Array.isArray(response.data)
      ? response.data.map(publicUser)
      : response.data ? [publicUser(response.data)] : undefined,
  };
}

router.get('/', authMiddleware, async (_req: AuthenticatedRequest, res: Response<ApiResponse<User[]>>): Promise<void> => {
  try {
    const response: ApiResponse<User[]> = await usersApi.getUsers();
    res.json(publicUsersResponse(response));
  } catch (error) {
    console.error('Error in GET /api/users:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load users' });
  }
});

router.get('/:id', authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response<ApiResponse<User>>): Promise<void> => {
  try {
    const { id } = req.params;
    const response = await usersApi.getUserById(Number(id)) as ApiResponse<User>;
    const user = Array.isArray(response.data) ? response.data[0] : response.data;
    res.json({ ...response, data: user ? publicUser(user) : undefined });
  } catch (error) {
    console.error('Error in GET /api/users/:id:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load user' });
  }
});

router.put(
  '/:id',
  authMiddleware,
  async (
    req: AuthenticatedRequest<
      { id: string },
      {},
      Partial<Pick<User, 'name' | 'email' | 'accepted_terms' | 'accepted_terms_at'>>
    >,
    res: Response<ApiResponse<User>>
  ): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = Number(req.user?.id || 0);
    const targetUserId = Number(id);

    if (!userId || userId !== targetUserId) {
      res.status(403).json({ status: 'error', message: 'Cannot update another user' });
      return;
    }

    const nameRaw = typeof req.body?.name === 'string' ? req.body.name : undefined;
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email : undefined;
    const acceptedTermsRaw =
      typeof req.body?.accepted_terms === 'number' || typeof req.body?.accepted_terms === 'string'
        ? Number(req.body.accepted_terms)
        : undefined;
    const acceptedTermsAtRaw =
      typeof req.body?.accepted_terms_at === 'string' ? req.body.accepted_terms_at : undefined;

    const nextName = nameRaw !== undefined ? nameRaw.trim() : undefined;
    const nextEmail = emailRaw !== undefined ? emailRaw.toLowerCase().trim() : undefined;
    const nextAcceptedTerms = acceptedTermsRaw !== undefined ? Number(acceptedTermsRaw) : undefined;
    const nextAcceptedTermsAt =
      acceptedTermsAtRaw !== undefined ? acceptedTermsAtRaw.trim() : undefined;

    if (nextName !== undefined && !nextName) {
      res.status(400).json({ status: 'error', message: 'Name cannot be empty' });
      return;
    }

    if (nextEmail !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(nextEmail)) {
        res.status(400).json({ status: 'error', message: 'Invalid email format' });
        return;
      }

      const existing = await usersApi.searchUserByEmail?.(nextEmail) as ApiResponse<User[]> | undefined;
      if (existing && existing.status === 'success' && Array.isArray(existing.data)) {
        const conflict = existing.data.find((u) => Number(u.id) !== targetUserId);
        if (conflict) {
          res.status(409).json({ status: 'error', message: 'An account with this email already exists' });
          return;
        }
      }
    }

    const payload: Partial<User> = {};
    if (nextName !== undefined) payload.name = nextName;
    if (nextEmail !== undefined) payload.email = nextEmail;
    if (nextAcceptedTerms !== undefined) {
      if (nextAcceptedTerms !== 0 && nextAcceptedTerms !== 1) {
        res.status(400).json({ status: 'error', message: 'accepted_terms must be 0 or 1' });
        return;
      }

      if (nextAcceptedTerms === 1 && !nextAcceptedTermsAt) {
        res.status(400).json({ status: 'error', message: 'accepted_terms_at is required' });
        return;
      }

      payload.accepted_terms = nextAcceptedTerms;
      if (nextAcceptedTermsAt !== undefined) {
        payload.accepted_terms_at = nextAcceptedTermsAt;
      }
    } else if (nextAcceptedTermsAt !== undefined) {
      res.status(400).json({ status: 'error', message: 'accepted_terms is required' });
      return;
    }

    if (Object.keys(payload).length === 0) {
      const current = await usersApi.getUserById(targetUserId) as ApiResponse<User>;
      const user = Array.isArray(current.data) ? current.data[0] : current.data;
      res.json({ ...current, data: user ? publicUser(user) : undefined });
      return;
    }

    const updateResponse = await usersApi.updateUser(targetUserId, payload) as ApiResponse<any>;
    if (updateResponse.status !== 'success') {
      res.status(500).json({ status: 'error', message: updateResponse.message || 'Failed to update user' });
      return;
    }

    const refreshed = await usersApi.getUserById(targetUserId) as ApiResponse<User>;
    if (refreshed.status !== 'success' || !refreshed.data) {
      res.status(500).json({ status: 'error', message: 'Failed to load updated user' });
      return;
    }

    const updatedUser: User = {
      id: refreshed.data.id,
      name: refreshed.data.name,
      email: refreshed.data.email,
      created_at: refreshed.data.created_at || new Date().toISOString(),
      accepted_terms: refreshed.data.accepted_terms,
      accepted_terms_at: refreshed.data.accepted_terms_at,
    };

    res.json({ status: 'success', data: updatedUser });
  } catch (error) {
    console.error('Error in PUT /api/users/:id:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update user' });
  }
}
);

router.post('/search', authMiddleware, async (req: AuthenticatedRequest<{}, {}, SearchUsersBody>, res: Response<ApiResponse<User[]>>): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ status: 'error', message: 'Email is required for user search' });
      return;
    }

    const searchResponse = await usersApi.searchUserByEmail?.(email) as ApiResponse<User[]> | undefined;
    if (searchResponse) {
      res.json(publicUsersResponse(searchResponse));
      return;
    }

    const usersResponse = await usersApi.getUsers() as ApiResponse<User[]>;
    if (usersResponse.status === 'success' && usersResponse.data) {
      const filtered: User[] = usersResponse.data.filter(
        (u: User) => u.email && u.email.toLowerCase() === String(email).toLowerCase()
      );
      res.json({ status: 'success', data: filtered.map(publicUser) });
      return;
    }

    res.json(publicUsersResponse(usersResponse));
  } catch (error) {
    console.error('Error in POST /api/users/search:', error);
    res.status(500).json({ status: 'error', message: 'Failed to search users' });
  }
});

export default router;
