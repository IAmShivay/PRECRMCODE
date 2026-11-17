import { User, Workspace, AuthSession } from '../components/types';

const STORAGE_PREFIX = 'scraft_';

const STORAGE_KEYS = {
  USER: `${STORAGE_PREFIX}user`,
  WORKSPACES: `${STORAGE_PREFIX}workspaces`,
  CURRENT_WORKSPACE: `${STORAGE_PREFIX}current_workspace`,
  SESSION: `${STORAGE_PREFIX}session`,
  AUTH_TOKEN: `${STORAGE_PREFIX}auth_token`,
} as const;

type StorageAction = 'read' | 'write' | 'remove' | 'parse';

const isStorageAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const logStorageWarning = (action: StorageAction, key: string, error: unknown): void => {
  if (import.meta.env.DEV) {
    console.warn(`[storage] Failed to ${action} key "${key}"`, error);
  }
};

const readStorage = (key: string): string | null => {
  if (!isStorageAvailable()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    logStorageWarning('read', key, error);
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    logStorageWarning('write', key, error);
  }
};

const removeStorage = (key: string): void => {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    logStorageWarning('remove', key, error);
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    const serializedValue = JSON.stringify(value);
    if (serializedValue === undefined) {
      throw new Error('Value could not be serialized for storage');
    }

    writeStorage(key, serializedValue);
  } catch (error) {
    logStorageWarning('write', key, error);
  }
};

const readJson = <T>(key: string): T | null => {
  const rawValue = readStorage(key);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    logStorageWarning('parse', key, error);
    removeStorage(key);
    return null;
  }
};

// User storage
export function saveUser(user: User): void {
  writeJson(STORAGE_KEYS.USER, user);
}

export function getUser(): User | null {
  return readJson<User>(STORAGE_KEYS.USER);
}

export function clearUser(): void {
  removeStorage(STORAGE_KEYS.USER);
}

// Workspaces storage
export function saveWorkspaces(workspaces: Workspace[]): void {
  writeJson(STORAGE_KEYS.WORKSPACES, workspaces);
}

export function getWorkspaces(): Workspace[] {
  return readJson<Workspace[]>(STORAGE_KEYS.WORKSPACES) ?? [];
}

export function clearWorkspaces(): void {
  removeStorage(STORAGE_KEYS.WORKSPACES);
}

// Current workspace storage
export function saveCurrentWorkspace(workspaceId: number | null): void {
  if (workspaceId === null) {
    removeStorage(STORAGE_KEYS.CURRENT_WORKSPACE);
  } else {
    writeJson(STORAGE_KEYS.CURRENT_WORKSPACE, workspaceId);
  }
}

export function getCurrentWorkspaceId(): number | null {
  return readJson<number>(STORAGE_KEYS.CURRENT_WORKSPACE);
}

// Session storage (consolidated)
export function saveSession(session: AuthSession): void {
  writeJson(STORAGE_KEYS.SESSION, session);
}

export function getSession(): AuthSession | null {
  return readJson<AuthSession>(STORAGE_KEYS.SESSION);
}

// Clear all auth data
export function clearSession(): void {
  removeStorage(STORAGE_KEYS.USER);
  removeStorage(STORAGE_KEYS.WORKSPACES);
  removeStorage(STORAGE_KEYS.CURRENT_WORKSPACE);
  removeStorage(STORAGE_KEYS.SESSION);
  removeStorage(STORAGE_KEYS.AUTH_TOKEN);
}

// Auth token storage (for future JWT-based auth)
export function saveAuthToken(token: string): void {
  writeStorage(STORAGE_KEYS.AUTH_TOKEN, token);
}

export function getAuthToken(): string | null {
  return readStorage(STORAGE_KEYS.AUTH_TOKEN);
}

export function clearAuthToken(): void {
  removeStorage(STORAGE_KEYS.AUTH_TOKEN);
}
