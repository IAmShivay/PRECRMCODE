import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Workspace, WorkspaceMember, AuthSession, ApiError } from '../components/types';
import {
  createUser,
  loginUser,
  refreshAuthToken as apiRefreshAuthToken,
  getCurrentUser as apiGetCurrentUser,
  updateCurrentUser as apiUpdateCurrentUser,
  createWorkspace as apiCreateWorkspace,
  readWorkspaces,
  getWorkspaceMembers,
  getCreatedAt,
} from '../lib/api-client';
import {
  saveUser,
  saveWorkspaces,
  saveCurrentWorkspace,
  getCurrentWorkspaceId,
  saveSession,
  getSession,
  clearSession,
  saveAuthToken,
  clearAuthToken,
  getAuthToken,
} from '../lib/storage';
import { DEFAULT_WORKSPACE_CURRENCY } from '../lib/currency';

interface AuthContextType {
  user: User | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  workspaceMembers: WorkspaceMember[];
  canCreateWorkspace: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, acceptedTerms: boolean) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  updateUserProfile: (updates: Partial<Pick<User, 'name' | 'email' | 'accepted_terms' | 'accepted_terms_at'>>) => Promise<User>;
  logout: () => void;
  refreshWorkspaces: (preferredWorkspaceId?: number) => Promise<void>;
  setCurrentWorkspace: (workspaceId: number | null) => void;
  getUserRole: (workspaceId: number) => 'admin' | 'member' | null;
  loadWorkspaceMembers: (workspaceId: number) => Promise<void>;
  workspaceMembersLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const UNLIMITED_WORKSPACE_EMAIL = 'scraftstudio@gmail.com';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;

const decodeJwtPayload = (token: string): { exp?: number } | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payload = parts[1];
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const json = typeof atob === 'function' ? atob(padded) : '';
    if (!json) return null;
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
};

const getTokenExpiryMs = (token: string): number | null => {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return null;
  return payload.exp * 1000;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspaceState] = useState<Workspace | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => getAuthToken());
  const [workspaceMembersLoading, setWorkspaceMembersLoading] = useState(false);
  const refreshInFlightRef = React.useRef(false);
  const lastLoadedMembersWsIdRef = React.useRef<number | null>(null);
  const normalizedUserEmail = user?.email?.trim().toLowerCase() || '';
  const canCreateWorkspace =
    normalizedUserEmail === UNLIMITED_WORKSPACE_EMAIL || workspaces.length === 0;

  // Initialize auth state from localStorage / token on mount
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = getAuthToken();
      setAuthToken(storedToken);
      const session = getSession();
      if (session) {
        setUser(session.user);
        let sessionWorkspaces = session.workspaces;

        if (storedToken) {
          try {
            const workspacesResponse = await readWorkspaces();
            if (workspacesResponse.status === 'success' && workspacesResponse.data) {
              sessionWorkspaces = workspacesResponse.data;
              saveWorkspaces(sessionWorkspaces);
            }
          } catch (err) {
            console.error('Failed to refresh workspaces on session restore:', err);
          }
        }

        setWorkspaces(sessionWorkspaces);

        // Set current workspace and load its members before marking as ready
        const restoredWsId = session.currentWorkspaceId;
        const workspace = restoredWsId
          ? sessionWorkspaces.find(w => w.id === restoredWsId)
          : sessionWorkspaces[0] || null;
        if (workspace) {
          setCurrentWorkspaceState(workspace || null);
          saveCurrentWorkspace(workspace.id);
          try {
            const membersResponse = await getWorkspaceMembers(workspace.id);
            if (membersResponse.status === 'success' && membersResponse.data) {
              setWorkspaceMembers(membersResponse.data);
            }
          } catch (err) {
            console.error('Failed to load workspace members on session restore:', err);
          }
          lastLoadedMembersWsIdRef.current = workspace.id;
        } else {
          setCurrentWorkspaceState(null);
          saveCurrentWorkspace(null);
        }

        setIsLoading(false);
        setIsInitialized(true);
        return;
      }

      // Fallback: if we have a token but no session, try to hydrate from /api/auth/me
      if (storedToken) {
        try {
          console.log('[AuthContext] Hydrating user from token...');
          const me = await apiGetCurrentUser();
          console.log('[AuthContext] Hydrated user:', me);
          setUser(me);
          saveUser(me);

          // Also load workspaces for this user
          console.log('[AuthContext] Loading accessible workspaces for hydrated user ID:', me.id);
          const workspacesResponse = await readWorkspaces();
          console.log('[AuthContext] readWorkspaces() response (from token hydration):', JSON.stringify(workspacesResponse, null, 2));
          
          if (workspacesResponse.status === 'success' && workspacesResponse.data) {
            const userWorkspaces = workspacesResponse.data;
            console.log('[AuthContext] Setting workspaces (from token hydration):', userWorkspaces);
            setWorkspaces(userWorkspaces);
            saveWorkspaces(userWorkspaces);

            // Set first workspace as current if available
            if (userWorkspaces.length > 0) {
              console.log('[AuthContext] Setting current workspace (from token hydration):', userWorkspaces[0]);
              setCurrentWorkspaceState(userWorkspaces[0]);
              saveCurrentWorkspace(userWorkspaces[0].id);
              // Load members for the current workspace
              try {
                const membersResponse = await getWorkspaceMembers(userWorkspaces[0].id);
                if (membersResponse.status === 'success' && membersResponse.data) {
                  setWorkspaceMembers(membersResponse.data);
                }
                lastLoadedMembersWsIdRef.current = userWorkspaces[0].id;
              } catch (err) {
                console.error('Failed to load workspace members on token hydration:', err);
              }
            } else {
              console.log('[AuthContext] No workspaces found for hydrated user');
            }
          } else {
            console.warn('[AuthContext] Workspaces response was not successful (from token hydration):', workspacesResponse);
          }
        } catch (error) {
          console.error('Failed to hydrate user from token:', error);
          clearAuthToken();
          setAuthToken(null);
        }
      }

      setIsLoading(false);
      setIsInitialized(true);
    };

    initAuth();
  }, []);

  // Update current workspace when workspaces change
  useEffect(() => {
    const currentWorkspaceId = getCurrentWorkspaceId();
    if (currentWorkspaceId && workspaces.length > 0) {
      const workspace = workspaces.find(w => w.id === currentWorkspaceId);
      setCurrentWorkspaceState(workspace || null);
    }
  }, [workspaces]);

  // Persist session to localStorage whenever auth state changes
  // But only after initialization is complete to avoid overwriting stored session
  useEffect(() => {
    if (!isInitialized) return;

    const session: AuthSession = {
      user,
      workspaces,
      currentWorkspaceId: currentWorkspace?.id || null,
    };
    saveSession(session);
  }, [user, workspaces, currentWorkspace, isInitialized]);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspaceState(null);
    setWorkspaceMembers([]);
    clearSession();
    clearAuthToken();
    setAuthToken(null);
    lastLoadedMembersWsIdRef.current = null;
  }, []);

  const refreshAuthToken = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    try {
      const response = await apiRefreshAuthToken();
      if (!response || !response.success || !response.data?.token) {
        throw new ApiError(response?.error || 'Failed to refresh token');
      }

      saveAuthToken(response.data.token);
      setAuthToken(response.data.token);

      if (response.data.user) {
        setUser(response.data.user);
        saveUser(response.data.user);
      }
    } catch (error) {
      console.error('[AuthContext] Token refresh failed:', error);
      if (error instanceof ApiError && error.status === 401) {
        clearAuthState();
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [clearAuthState]);

  useEffect(() => {
    if (!authToken) return;
    const expiryMs = getTokenExpiryMs(authToken);
    if (!expiryMs) return;
    if (typeof window === 'undefined') return;

    const maybeRefresh = () => {
      if (Date.now() >= expiryMs - TOKEN_REFRESH_BUFFER_MS) {
        void refreshAuthToken();
      }
    };

    maybeRefresh();
    const intervalId = window.setInterval(maybeRefresh, TOKEN_REFRESH_CHECK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [authToken, refreshAuthToken]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const trimmedEmail = email.toLowerCase().trim();
      const trimmedPassword = password.trim();

      const response = await loginUser(trimmedEmail, trimmedPassword);

      if (!response || !response.success || !response.data) {
        throw new ApiError(response?.error || 'Login failed. Please try again.');
      }

      const authUser = response.data.user;

      console.log('[AuthContext] Login successful - user:', authUser);
      setUser(authUser);
      saveUser(authUser);
      saveAuthToken(response.data.token);
      setAuthToken(response.data.token);

      // Load user's workspaces
      console.log('[AuthContext] Loading accessible workspaces for user ID:', authUser.id);
      const workspacesResponse = await readWorkspaces();
      console.log('[AuthContext] readWorkspaces() response:', JSON.stringify(workspacesResponse, null, 2));
      
      if (workspacesResponse.status === 'success' && workspacesResponse.data) {
        const userWorkspaces = workspacesResponse.data;
        console.log('[AuthContext] Setting workspaces:', userWorkspaces);
        setWorkspaces(userWorkspaces);
        saveWorkspaces(userWorkspaces);

        // Set first workspace as current if available
        if (userWorkspaces.length > 0) {
          console.log('[AuthContext] Setting current workspace to:', userWorkspaces[0]);
          setCurrentWorkspaceState(userWorkspaces[0]);
          saveCurrentWorkspace(userWorkspaces[0].id);
          // Load members for the current workspace
          try {
            const membersResponse = await getWorkspaceMembers(userWorkspaces[0].id);
            if (membersResponse.status === 'success' && membersResponse.data) {
              setWorkspaceMembers(membersResponse.data);
            }
            lastLoadedMembersWsIdRef.current = userWorkspaces[0].id;
          } catch (err) {
            console.error('Failed to load workspace members on login:', err);
          }
        } else {
          console.log('[AuthContext] No workspaces found for user');
        }
      } else {
        console.warn('[AuthContext] Workspaces response was not successful or missing data:', workspacesResponse);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Login failed. Please try again.');
    }
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string, acceptedTerms: boolean) => {
    try {
      if (!acceptedTerms) {
        throw new ApiError('You must accept the Terms of Service to continue.', 400);
      }

      const response = await createUser({
        name,
        email: email.toLowerCase().trim(),
        password: password.trim(),
        accepted_terms: 1,
        accepted_terms_at: new Date().toISOString(),
      });

      if (!response || !response.success || !response.data) {
        throw new ApiError(response?.error || 'Signup failed. Please try again.');
      }

      const newUser = response.data.user;

      setUser(newUser);
      saveUser(newUser);
      saveAuthToken(response.data.token);
      setAuthToken(response.data.token);
      setWorkspaces([]);
      setCurrentWorkspaceState(null);
      setWorkspaceMembers([]);
      saveWorkspaces([]);
      saveCurrentWorkspace(null);
      lastLoadedMembersWsIdRef.current = null;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Signup failed. Please try again.');
    }
  }, []);

  const createWorkspace = useCallback(async (name: string) => {
    if (!user) {
      throw new ApiError('You must be logged in to create a workspace');
    }

    if (!canCreateWorkspace) {
      throw new ApiError('You can only create one workspace with this account.', 403);
    }

    const trimmedName = String(name ?? '').trim();
    if (!trimmedName) {
      throw new ApiError('Workspace name is required', 400);
    }

    try {
      // Create workspace
      const workspaceResponse = await apiCreateWorkspace({
        owner_id: user.id,
        name: trimmedName,
        currency: DEFAULT_WORKSPACE_CURRENCY,
        created_at: getCreatedAt(),
      });

      if (workspaceResponse.status === 'success' && workspaceResponse.id) {
        const newWorkspace: Workspace = {
          id: workspaceResponse.id,
          owner_id: user.id,
          name: trimmedName,
          currency: DEFAULT_WORKSPACE_CURRENCY,
          created_at: getCreatedAt(),
        };

        // Update state
        const updatedWorkspaces = [...workspaces, newWorkspace];
        setWorkspaces(updatedWorkspaces);
        saveWorkspaces(updatedWorkspaces);
        setCurrentWorkspaceState(newWorkspace);
        saveCurrentWorkspace(newWorkspace.id);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Failed to create workspace. Please try again.');
    }
  }, [user, workspaces, canCreateWorkspace]);

  const refreshWorkspaces = useCallback(async (preferredWorkspaceId?: number) => {
    if (!user && !getAuthToken()) return;

    try {
      const response = await readWorkspaces();
      if (response.status === 'success' && response.data) {
        const userWorkspaces = response.data;
        setWorkspaces(userWorkspaces);
        saveWorkspaces(userWorkspaces);

        const selectedWorkspace =
          (preferredWorkspaceId
            ? userWorkspaces.find(w => w.id === preferredWorkspaceId)
            : null) ||
          (currentWorkspace
            ? userWorkspaces.find(w => w.id === currentWorkspace.id)
            : null) ||
          userWorkspaces.find(w => w.id === getCurrentWorkspaceId()) ||
          userWorkspaces[0] ||
          null;

        setCurrentWorkspaceState(selectedWorkspace);
        saveCurrentWorkspace(selectedWorkspace?.id || null);
      }
    } catch (error) {
      console.error('Failed to refresh workspaces:', error);
    }
  }, [currentWorkspace, user]);

  const loadWorkspaceMembers = useCallback(async (workspaceId: number) => {
    if (!user) return;

    setWorkspaceMembersLoading(true);
    try {
      const response = await getWorkspaceMembers(workspaceId);
      if (response.status === 'success' && response.data) {
        setWorkspaceMembers(prev => {
          // Remove old members for this workspace and add new ones
          const filtered = prev.filter(m => m.workspace_id !== workspaceId);
          return [...filtered, ...response.data];
        });
      }
    } catch (error) {
      console.error('Failed to load workspace members:', error);
      // Don't throw - just log the error
    } finally {
      setWorkspaceMembersLoading(false);
    }
  }, [user]);

  // Auto-load workspace members when current workspace changes
  useEffect(() => {
    if (!currentWorkspace || !user || !isInitialized) return;
    if (lastLoadedMembersWsIdRef.current === currentWorkspace.id) return;
    lastLoadedMembersWsIdRef.current = currentWorkspace.id;
    loadWorkspaceMembers(currentWorkspace.id);
  }, [currentWorkspace, user, isInitialized, loadWorkspaceMembers]);

  const setCurrentWorkspace = useCallback((workspaceId: number | null) => {
    if (workspaceId === null) {
      setCurrentWorkspaceState(null);
      saveCurrentWorkspace(null);
      lastLoadedMembersWsIdRef.current = null;
      return;
    }

    const workspace = workspaces.find(w => w.id === workspaceId);
    if (workspace) {
      setCurrentWorkspaceState(workspace);
      saveCurrentWorkspace(workspaceId);
      lastLoadedMembersWsIdRef.current = workspaceId;
      loadWorkspaceMembers(workspaceId);
    }
  }, [workspaces, loadWorkspaceMembers]);

  const getUserRole = useCallback((workspaceId: number): 'admin' | 'member' | null => {
    if (!user) return null;

    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return null;

    // Check if user is workspace owner
    if (workspace.owner_id === user.id) {
      return 'admin';
    }

    // Check if user is a workspace member
    const member = workspaceMembers.find(
      m => m.workspace_id === workspaceId && m.user_id === user.id
    );
    if (member) {
      return member.role === 'owner' || member.role === 'admin' ? 'admin' : 'member';
    }

    return null;
  }, [user, workspaces, workspaceMembers]);

  const logout = useCallback(() => {
    clearAuthState();
  }, [clearAuthState]);

  const updateUserProfile = useCallback(
    async (
      updates: Partial<Pick<User, 'name' | 'email' | 'accepted_terms' | 'accepted_terms_at'>>
    ): Promise<User> => {
      if (!user) {
        throw new ApiError('You must be logged in', 401);
      }

      const next = await apiUpdateCurrentUser(user.id, updates);
      setUser(next);
      saveUser(next);
      return next;
    },
    [user]
  );

  const value: AuthContextType = {
    user,
    workspaces,
    currentWorkspace,
    workspaceMembers,
    canCreateWorkspace,
    isLoading,
    isAuthenticated: !!user,
    login,
    signup,
    createWorkspace,
    updateUserProfile,
    logout,
    refreshWorkspaces,
    setCurrentWorkspace,
    getUserRole,
    loadWorkspaceMembers,
    workspaceMembersLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
