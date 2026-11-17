// Get NoCodeBackend auth token for server-side requests ONLY
// IMPORTANT: This module is intended for Node/Express usage, not for direct browser access.
const getAuthToken = () => {
  // Server-side: use environment variable
  if (typeof window === 'undefined') {
    const token = process.env.API_KEY || process.env.GEMINI_API_KEY;

    if (!token) {
      const message =
        '[NoCodeBackend] Missing API key. Set API_KEY (preferred) or GEMINI_API_KEY in your server environment.';
      // Fail loudly in development so misconfiguration is obvious
      if (process.env.NODE_ENV !== 'production') {
        console.error(message);
        throw new Error(message);
      }
      // In production, still return null so callers can handle a 401-style failure
      return null;
    }

    return token;
  }

  // Client-side should never call this – hitting NoCodeBackend directly from the browser is not supported.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(
      '[NoCodeBackend] getAuthToken() was called in the browser. ' +
        'Frontend code must call your Node backend (/api/*) instead of the NoCodeBackend API directly.'
    );
  }
  return null;
};

const DEFAULT_CACHE_TTL_MS = 15000;
const DEFAULT_CACHE_MAX_ENTRIES = 500;

// Verbose NoCodeBackend logging is noisy; enable only when debugging.
const ENABLE_NOCODE_LOGS = String(process.env.NOCODE_LOGS || '').toLowerCase() === 'true';
// The live database Swagger document uses this API host. Keep it configurable
// so a provider endpoint change does not require another application release.
const NOCODE_API_BASE_URL = String(process.env.NOCODE_API_BASE_URL || 'https://api.nocodebackend.com').replace(/\/+$/, '');

const cacheTtlEnv = Number.parseInt(process.env.API_CACHE_TTL_MS || '', 10);
const cacheMaxEnv = Number.parseInt(process.env.API_CACHE_MAX_ENTRIES || '', 10);

const CACHE_TTL_MS = Number.isFinite(cacheTtlEnv) ? cacheTtlEnv : DEFAULT_CACHE_TTL_MS;
const CACHE_MAX_ENTRIES = Number.isFinite(cacheMaxEnv) ? cacheMaxEnv : DEFAULT_CACHE_MAX_ENTRIES;
const CACHE_ENABLED = CACHE_TTL_MS > 0 && CACHE_MAX_ENTRIES > 0;

const apiResponseCache = new Map();

const shouldBypassCache = (options, headers) => {
  if (!CACHE_ENABLED) return true;
  if (options?.cache === 'no-store' || options?.cache === 'no-cache') return true;

  const cacheControl = String(headers?.['Cache-Control'] || headers?.['cache-control'] || '').toLowerCase();
  if (cacheControl.includes('no-cache') || cacheControl.includes('no-store')) return true;

  const bypassHeader = String(headers?.['x-cache-bypass'] || headers?.['X-Cache-Bypass'] || '').toLowerCase();
  return bypassHeader === '1' || bypassHeader === 'true';
};

const getCacheKey = (method, endpoint, headers) => {
  if (method !== 'GET') return null;
  const authHeader = headers?.Authorization || headers?.authorization || '';
  return `${method}:${endpoint}|auth=${authHeader}`;
};

const readCache = (cacheKey) => {
  if (!CACHE_ENABLED || !cacheKey) return null;

  const entry = apiResponseCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    apiResponseCache.delete(cacheKey);
    return null;
  }

  try {
    return JSON.parse(entry.payload);
  } catch (error) {
    apiResponseCache.delete(cacheKey);
    return null;
  }
};

const writeCache = (cacheKey, data) => {
  if (!CACHE_ENABLED || !cacheKey) return;

  try {
    const payload = JSON.stringify(data);

    while (apiResponseCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = apiResponseCache.keys().next().value;
      apiResponseCache.delete(oldestKey);
    }

    apiResponseCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  } catch (error) {
    // If serialization fails, skip caching to avoid breaking requests.
    if (ENABLE_NOCODE_LOGS) {
      console.warn('[NoCodeBackend] Skipping cache write due to serialization error:', error);
    }
  }
};

const invalidateCache = (reason) => {
  if (!CACHE_ENABLED) return;

  apiResponseCache.clear();
  if (ENABLE_NOCODE_LOGS && reason) {
    console.log(`[NoCodeBackend] Cache cleared: ${reason}`);
  }
};

// Generic API request handler with retry logic
const MAX_RETRIES = 3;
const RETRY_DELAY = 600;

function getRetryDelayMs(retryCount) {
  const jitter = Math.floor(Math.random() * 200);
  return RETRY_DELAY * Math.pow(2, Math.max(0, retryCount)) + jitter;
}

function getErrorCode(error) {
  return error?.cause?.code || error?.code;
}

function isRetryableNetworkError(error) {
  const code = getErrorCode(error);
  if (!code) return false;
  return (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'ECONNREFUSED' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH'
  );
}

function isRetryableHttpStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

// NoCodeBackend retired POST /search/:table; filter with GET /read/:table query params instead.
async function readMatching(table, filters = {}) {
  const query = new URLSearchParams({ Instance: '54182_scraft_crm_database' });
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== '');
  entries.forEach(([key, value]) => query.append(key, String(value)));
  const response = await apiRequest(`/read/${table}?${query.toString()}`, { cache: 'no-store' });
  if (response?.status !== 'success' || !Array.isArray(response.data)) return response;
  const exact = response.data.filter((row) =>
    entries.every(([key, value]) => String(row?.[key] ?? '').toLowerCase() === String(value).toLowerCase())
  );
  return { ...response, data: exact };
}

async function apiRequest(endpoint, options = {}, retryCount = 0) {
  const token = getAuthToken();
  const url = `${NOCODE_API_BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const method = (options.method || 'GET').toUpperCase();
    const bypassCache = shouldBypassCache(options, headers);
    const cacheKey = !bypassCache ? getCacheKey(method, endpoint, headers) : null;

    if (cacheKey) {
      const cached = readCache(cacheKey);
      if (cached) {
        if (ENABLE_NOCODE_LOGS) {
          console.log('[NoCodeBackend] Cache hit:', { endpoint, method });
        }
        return cached;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds

    // Debug logging
    if (ENABLE_NOCODE_LOGS) {
      if (retryCount > 0) {
        console.log(`[NoCodeBackend] Retry attempt ${retryCount}/${MAX_RETRIES} for:`, endpoint);
      } else {
        console.log('[NoCodeBackend] Making request:', {
          endpoint,
          method: options.method || 'GET',
          hasBody: !!options.body,
          bodyKeys: options.body ? Object.keys(options.body) : [],
        });
      }
    }

    // Use native fetch directly to avoid undici issues
    const response = await fetch(url, {
      ...options,
      headers,
      method: options.method || 'GET',
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseForText = response.clone();
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      // If JSON parsing fails, try to get text response
      let textResponse = '';
      try {
        textResponse = await responseForText.text();
      } catch (_textError) {
        textResponse = '[unavailable]';
      }
      console.error('[NoCodeBackend] Failed to parse JSON response', {
        endpoint,
        status: response.status,
        textResponse: textResponse.substring(0, 500), // First 500 chars
      });
      throw new Error(`Invalid JSON response from NoCodeBackend: ${textResponse.substring(0, 200)}`);
    }

    if (ENABLE_NOCODE_LOGS) {
      console.log('[NoCodeBackend] Response received:', {
        endpoint,
        status: response.status,
        ok: response.ok,
        dataType: typeof data,
        hasStatus: !!data?.status,
      });
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `HTTP error! status: ${response.status}`;
      const httpError = new Error(message);
      httpError.status = response.status;
      httpError.endpoint = endpoint;
      httpError.data = data;

      if (ENABLE_NOCODE_LOGS || (response.status !== 404 && response.status !== 401 && response.status !== 403)) {
        console.error('[NoCodeBackend] API error', {
          endpoint,
          status: response.status,
          message: data?.message,
          error: data?.error,
          data: JSON.stringify(data, null, 2),
        });
      }

      if (isRetryableHttpStatus(response.status) && retryCount < MAX_RETRIES) {
        const delayMs = getRetryDelayMs(retryCount);
        if (ENABLE_NOCODE_LOGS) {
          console.log(
            `[NoCodeBackend] Upstream ${response.status}, retrying in ${delayMs}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return apiRequest(endpoint, { ...options, cache: 'no-store' }, retryCount + 1);
      }

      throw httpError;
    }

    const isCacheableResponse =
      response.ok && (!data || data.status === undefined || data.status === 'success');

    if (cacheKey && isCacheableResponse) {
      writeCache(cacheKey, data);
    }

    if (response.ok && method !== 'GET') {
      invalidateCache(`${method} ${endpoint}`);
    }

    return data;
  } catch (error) {
    const isAbortError = error?.name === 'AbortError';
    const isFetchFailed = error?.name === 'TypeError' && String(error?.message || '').includes('fetch failed');
    const retryableNetwork = isRetryableNetworkError(error);
    const shouldRetry = (isAbortError || retryableNetwork || isFetchFailed) && retryCount < MAX_RETRIES;

    if (shouldRetry) {
      const delayMs = getRetryDelayMs(retryCount);
      if (ENABLE_NOCODE_LOGS) {
        console.log(
          `[NoCodeBackend] Network error (${getErrorCode(error) || error?.name || 'unknown'}), retrying in ${delayMs}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return apiRequest(endpoint, { ...options, cache: 'no-store' }, retryCount + 1);
    }

    if (isAbortError) {
      const timeoutError = new Error('Request to NoCodeBackend timed out after 60 seconds. Check your network connection.');
      timeoutError.cause = error;
      timeoutError.status = 504;
      throw timeoutError;
    }

    if (retryableNetwork || isFetchFailed) {
      const networkError = new Error('Network error: Unable to reach NoCodeBackend API. Please check your connection.');
      networkError.cause = error;
      networkError.status = 503;
      throw networkError;
    }

    if (typeof error?.status === 'number') {
      throw error;
    }

    const code = getErrorCode(error);
    if (code !== 'ENOTFOUND' && code !== 'ECONNREFUSED' && code !== 'EAI_AGAIN') {
      console.error('API request failed:', error);
    }
    throw error;
  }
}

// ============ LEADS API ============
export const leadsApi = {
  async getLeads(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.status_id) queryParams.append('status_id', params.status_id.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sort) queryParams.append('sort', params.sort);
    if (params?.order) queryParams.append('order', params.order);

    // Note: We don't filter by deleted_at at the API level because:
    // 1. The API filter syntax might not work reliably for null/empty checks
    // 2. We'll filter on the backend side after fetching all leads
    // This ensures we get all leads and can properly filter by deleted_at value

    const queryString = queryParams.toString();
    const endpoint = `/read/leads?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;

    return apiRequest(endpoint);
  },

  async getLeadById(id) {
    return apiRequest(`/read/leads/${id}?Instance=54182_scraft_crm_database`);
  },

  async searchLeads(searchParams) {
    return readMatching('leads', searchParams);
  },

  async createLead(lead) {
    const endpoint = `/create/leads?Instance=54182_scraft_crm_database`;
    
    // Debug logging
    if (ENABLE_NOCODE_LOGS) {
      console.log('[NoCodeBackend] createLead:', {
        endpoint,
        lead,
        bodyKeys: Object.keys(lead),
      });
    }

    return apiRequest(endpoint, {
      method: 'POST',
      body: lead,
    });
  },

  async updateLead(id, lead) {
    return apiRequest(`/update/leads/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: lead,
    });
  },

  async deleteLead(id) {
    return apiRequest(`/delete/leads/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ LEAD STATUSES API ============
export const leadStatusesApi = {
  async getStatuses(workspaceId) {
    const queryParams = new URLSearchParams();
    if (workspaceId) queryParams.append('workspace_id', workspaceId.toString());

    const queryString = queryParams.toString();
    const endpoint = `/read/lead_statuses?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;

    return apiRequest(endpoint);
  },

  async getStatusById(id) {
    return apiRequest(`/read/lead_statuses/${id}?Instance=54182_scraft_crm_database`);
  },

  async createStatus(status) {
    return apiRequest(`/create/lead_statuses?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: status,
    });
  },

  async updateStatus(id, status) {
    return apiRequest(`/update/lead_statuses/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: status,
    });
  },

  async deleteStatus(id) {
    return apiRequest(`/delete/lead_statuses/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ LEAD ACTIVITIES API ============
export const leadActivitiesApi = {
  async getActivityById(id) {
    return apiRequest(`/read/lead_activities/${id}?Instance=54182_scraft_crm_database`);
  },

  async getActivities(leadId) {
    const queryParams = new URLSearchParams();
    if (leadId) queryParams.append('lead_id', leadId.toString());

    const queryString = queryParams.toString();
    const endpoint = `/read/lead_activities?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;

    return apiRequest(endpoint);
  },

  async createActivity(activity) {
    return apiRequest(`/create/lead_activities?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: activity,
    });
  },

  async updateActivity(id, activity) {
    return apiRequest(`/update/lead_activities/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: activity,
    });
  },

  async deleteActivity(id) {
    return apiRequest(`/delete/lead_activities/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ CUSTOM FIELDS API ============
export const customFieldsApi = {
  async getCustomFields(workspaceId) {
    const endpoint = `/read/lead_custom_fields?Instance=54182_scraft_crm_database&workspace_id=${workspaceId}`;
    return apiRequest(endpoint);
  },

  async createCustomField(field) {
    return apiRequest(`/create/lead_custom_fields?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: field,
    });
  },

  async updateCustomField(id, field) {
    return apiRequest(`/update/lead_custom_fields/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: field,
    });
  },

  async deleteCustomField(id) {
    return apiRequest(`/delete/lead_custom_fields/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ CUSTOM FIELD VALUES API ============
export const customFieldValuesApi = {
  async getCustomFieldValueById(id) {
    return apiRequest(`/read/lead_custom_field_values/${id}?Instance=54182_scraft_crm_database`);
  },

  async getCustomFieldValues(leadId) {
    const endpoint = `/read/lead_custom_field_values?Instance=54182_scraft_crm_database&lead_id=${leadId}`;
    return apiRequest(endpoint);
  },

  async createCustomFieldValue(value) {
    return apiRequest(`/create/lead_custom_field_values?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: value,
    });
  },

  async updateCustomFieldValue(id, value) {
    return apiRequest(`/update/lead_custom_field_values/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: value,
    });
  },

  async deleteCustomFieldValue(id) {
    return apiRequest(`/delete/lead_custom_field_values/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// Sanitise webhook-log bodies before they hit NoCodeBackend.
// MySQL TIMESTAMP columns reject ISO-8601 strings (e.g. "2026-02-12T14:53:05.893Z").
// Convert created_at to MySQL-compatible "YYYY-MM-DD HH:MM:SS" format.
function sanitizeWebhookLogBody(log) {
  if (!log) return log;
  const sanitized = { ...log };
  if (sanitized.created_at && typeof sanitized.created_at === 'string') {
    const d = new Date(sanitized.created_at);
    if (!isNaN(d.getTime())) {
      sanitized.created_at = d.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
    }
  }
  return sanitized;
}

// ============ WEBHOOK LOGS API ============
export const webhookLogsApi = {
  async getWebhookLogs(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.lead_id) queryParams.append('lead_id', params.lead_id.toString());
    if (params?.source) queryParams.append('source', params.source);
    if (params?.event_id) queryParams.append('event_id', params.event_id);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.includeTotal !== undefined) queryParams.append('includeTotal', String(params.includeTotal));
    if (params?.sort) queryParams.append('sort', params.sort);
    if (params?.order) queryParams.append('order', params.order);
    if (params?.only) queryParams.append('only', params.only);
    if (params?.by) queryParams.append('by', params.by);

    const queryString = queryParams.toString();
    const endpoint = `/read/lead_webhook_logs?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;
    const bypassCache =
      params?.bypassCache === true || params?.cache === 'no-store' || params?.cache === 'no-cache';

    return apiRequest(endpoint, bypassCache ? { cache: 'no-store' } : {});
  },

  async createWebhookLog(log) {
    return apiRequest(`/create/lead_webhook_logs?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: sanitizeWebhookLogBody(log),
    });
  },

  async updateWebhookLog(id, log) {
    return apiRequest(`/update/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: sanitizeWebhookLogBody(log),
    });
  },

  async deleteWebhookLog(id) {
    return apiRequest(`/delete/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ NOTIFICATIONS API ============
export const notificationsApi = {
  async getNotifications(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.recipient_user_id) queryParams.append('recipient_user_id', params.recipient_user_id.toString());
    if (params?.read_at !== undefined && params?.read_at !== null) {
      queryParams.append('read_at', params.read_at.toString());
    }
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sort) queryParams.append('sort', params.sort);
    if (params?.order) queryParams.append('order', params.order);

    const queryString = queryParams.toString();
    const endpoint = `/read/notifications?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;
    const bypassCache =
      params?.bypassCache === true || params?.cache === 'no-store' || params?.cache === 'no-cache';

    return apiRequest(endpoint, bypassCache ? { cache: 'no-store' } : {});
  },

  async getNotificationById(id) {
    return apiRequest(`/read/notifications/${id}?Instance=54182_scraft_crm_database`, {
      cache: 'no-store',
    });
  },

  async createNotification(notification) {
    return apiRequest(`/create/notifications?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: notification,
    });
  },

  async updateNotification(id, notification) {
    return apiRequest(`/update/notifications/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: notification,
    });
  },

  async deleteNotification(id) {
    return apiRequest(`/delete/notifications/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ USERS API ============
export const usersApi = {
  async getUsers() {
    return apiRequest(`/read/users?Instance=54182_scraft_crm_database`);
  },

  async getUserById(id) {
    return apiRequest(`/read/users/${id}?Instance=54182_scraft_crm_database`);
  },

  async createUser(user) {
    return apiRequest(`/create/users?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: user,
    });
  },

  async updateUser(id, user) {
    return apiRequest(`/update/users/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: user,
    });
  },

  async searchUserByEmail(email) {
    return readMatching('users', { email });
  },
};

// ============ WORKSPACES API ============
export const workspacesApi = {
  async getWorkspaces(params) {
    const queryParams = new URLSearchParams();
    if (params?.owner_id) queryParams.append('owner_id', params.owner_id.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const queryString = queryParams.toString();
    const endpoint = `/read/workspaces?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  async getWorkspaceById(id, bypassCache = false) {
    return apiRequest(`/read/workspaces/${id}?Instance=54182_scraft_crm_database`, bypassCache ? { cache: 'no-store' } : {});
  },

  async createWorkspace(workspace) {
    return apiRequest(`/create/workspaces?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: workspace,
    });
  },

  async updateWorkspace(id, workspace) {
    return apiRequest(`/update/workspaces/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: workspace,
    });
  },

  async deleteWorkspace(id) {
    return apiRequest(`/delete/workspaces/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ WORKSPACE MEMBERS API ============
export const workspaceMembersApi = {
  async getWorkspaceMembers(workspaceIdOrParams) {
    const queryParams = new URLSearchParams();

    if (typeof workspaceIdOrParams === 'number') {
      queryParams.append('workspace_id', workspaceIdOrParams.toString());
    } else if (workspaceIdOrParams && typeof workspaceIdOrParams === 'object') {
      if (workspaceIdOrParams.workspace_id !== undefined && workspaceIdOrParams.workspace_id !== null) {
        queryParams.append('workspace_id', workspaceIdOrParams.workspace_id.toString());
      }
      if (workspaceIdOrParams.user_id !== undefined && workspaceIdOrParams.user_id !== null) {
        queryParams.append('user_id', workspaceIdOrParams.user_id.toString());
      }
      if (workspaceIdOrParams.page !== undefined && workspaceIdOrParams.page !== null) {
        queryParams.append('page', workspaceIdOrParams.page.toString());
      }
      if (workspaceIdOrParams.limit !== undefined && workspaceIdOrParams.limit !== null) {
        queryParams.append('limit', workspaceIdOrParams.limit.toString());
      }
    }

    const queryString = queryParams.toString();
    const endpoint = `/read/workspace_members?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;
    return apiRequest(endpoint, workspaceIdOrParams?.bypassCache ? { cache: 'no-store' } : {});
  },

  async getWorkspaceMemberById(memberId) {
    return apiRequest(`/read/workspace_members/${memberId}?Instance=54182_scraft_crm_database`);
  },

  async addWorkspaceMember(member) {
    return apiRequest(`/create/workspace_members?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: member,
    });
  },

  async updateWorkspaceMember(memberId, member) {
    return apiRequest(`/update/workspace_members/${memberId}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: member,
    });
  },

  async deleteWorkspaceMember(memberId) {
    return apiRequest(`/delete/workspace_members/${memberId}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ WEBHOOK SOURCES API ============
// Sources are stored in the external database using lead_webhook_logs table
// Sources are identified by status='source_registry' to differentiate from webhook logs

export const sourcesApi = {
  async getSources(workspaceId) {
    // Get all webhook logs with status='source_registry' for this workspace
    const response = await apiRequest(
      `/read/lead_webhook_logs?Instance=54182_scraft_crm_database&workspace_id=${workspaceId}&status=source_registry`
    );
    return response;
  },

  async getSourceById(workspaceId, sourceId) {
    // Get webhook logs filtered by workspace, status=source_registry, and event_id
    const response = await apiRequest(
      `/read/lead_webhook_logs?Instance=54182_scraft_crm_database&workspace_id=${workspaceId}&event_id=${sourceId}`
    );
    if (response.status === 'success' && response.data && response.data.length > 0) {
      return { status: 'success', data: response.data[0] };
    }
    return { status: 'error', message: 'Source not found' };
  },

  async createSource(workspaceId, name) {
    // Generate a unique source ID
    const sourceId = `src_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    // Create a new webhook log entry with status='source_registry'
    return apiRequest(`/create/lead_webhook_logs?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: {
        workspace_id: Number(workspaceId),
        lead_id: 0,
        source: name,
        event_id: sourceId,
        payload: JSON.stringify({ type: 'source_registry' }),
        status: 'source_registry',
      },
    });
  },

  async updateSource(id, source) {
    // Update the webhook log entry
    return apiRequest(`/update/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: {
        workspace_id: source.workspace_id,
        lead_id: source.lead_id || 0,
        source: source.source,
        event_id: source.event_id,
        payload: source.payload || JSON.stringify({ type: 'source_registry' }),
        status: 'source_registry',
      },
    });
  },

  async deleteSource(workspaceId, sourceId) {
    // First find the source by workspace_id, event_id, and status
    const findResponse = await this.getSourceById(workspaceId, sourceId);
    if (findResponse.status !== 'success' || !findResponse.data) {
      throw new Error('Source not found');
    }
    // Delete the webhook log entry by ID
    return apiRequest(`/delete/lead_webhook_logs/${findResponse.data.id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ DEALS API ============
export const dealsApi = {
  async getDeals(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());

    const queryString = queryParams.toString();
    const endpoint = `/read/lead_webhook_logs?Instance=54182_scraft_crm_database&status=deal${queryString ? `&${queryString}` : ''}`;
    return apiRequest(endpoint, { cache: 'no-store' });
  },

  async getDealById(id) {
    return apiRequest(`/read/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, { cache: 'no-store' });
  },

  async createDeal(deal) {
    return apiRequest(`/create/lead_webhook_logs?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: deal,
    });
  },

  async updateDeal(id, deal) {
    return apiRequest(`/update/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: deal,
    });
  },

  async deleteDeal(id) {
    return apiRequest(`/delete/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

export const dealPipelinesApi = {
  async getPipelines(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());

    const queryString = queryParams.toString();
    const endpoint = `/read/lead_webhook_logs?Instance=54182_scraft_crm_database&status=deal_pipeline${queryString ? `&${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  async createPipeline(pipeline) {
    return apiRequest(`/create/lead_webhook_logs?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: pipeline,
    });
  },

  async updatePipeline(id, pipeline) {
    return apiRequest(`/update/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: pipeline,
    });
  },

  async deletePipeline(id) {
    return apiRequest(`/delete/lead_webhook_logs/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

export const dealStageHistoryApi = {
  async createStageHistory(entry) {
    return apiRequest(`/create/lead_webhook_logs?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: entry,
    });
  },
};

export const dealAssociationsApi = {
  async getAssociations(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.source_deal_id) queryParams.append('source_deal_id', params.source_deal_id.toString());
    if (params?.target_deal_id) queryParams.append('target_deal_id', params.target_deal_id.toString());
    if (params?.deal_id) queryParams.append('source_deal_id', params.deal_id.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    const queryString = queryParams.toString();
    const endpoint = `/read/deal_associations?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;
    return apiRequest(endpoint, { cache: 'no-store' });
  },
  async getAssociationById(id) {
    return apiRequest(`/read/deal_associations/${id}?Instance=54182_scraft_crm_database`, { cache: 'no-store' });
  },
  async createAssociation(association) {
    return apiRequest(`/create/deal_associations?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: association,
    });
  },
  async deleteAssociation(id) {
    return apiRequest(`/delete/deal_associations/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ WORKSPACE INVITATIONS API ============
export const workspaceInvitationsApi = {
  async getInvitations(params) {
    const queryParams = new URLSearchParams();
    if (params?.workspace_id) queryParams.append('workspace_id', params.workspace_id.toString());
    if (params?.token) queryParams.append('token', params.token);
    if (params?.email) queryParams.append('email', params.email);
    const queryString = queryParams.toString();
    const endpoint = `/read/workspace_invitations?Instance=54182_scraft_crm_database${queryString ? `&${queryString}` : ''}`;
    return apiRequest(endpoint, { cache: 'no-store' });
  },
  async getInvitationById(id) {
    return apiRequest(`/read/workspace_invitations/${id}?Instance=54182_scraft_crm_database`);
  },
  async createInvitation(invitation) {
    return apiRequest(`/create/workspace_invitations?Instance=54182_scraft_crm_database`, {
      method: 'POST',
      body: invitation,
    });
  },
  async updateInvitation(id, updates) {
    return apiRequest(`/update/workspace_invitations/${id}?Instance=54182_scraft_crm_database`, {
      method: 'PUT',
      body: updates,
    });
  },
  async deleteInvitation(id) {
    return apiRequest(`/delete/workspace_invitations/${id}?Instance=54182_scraft_crm_database`, {
      method: 'DELETE',
    });
  },
};

// ============ AUTOMATIONS (dedicated tables) ============
function tableApi(table) {
  const base = (path) => `/${path}/${table}`;
  const instance = 'Instance=54182_scraft_crm_database';
  return {
    async list(filters = {}, options = {}) {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') query.append(key, String(value));
      });
      const qs = query.toString();
      return apiRequest(`${base('read')}?${instance}${qs ? `&${qs}` : ''}`, options.fresh ? { cache: 'no-store' } : {});
    },
    async get(id) {
      return apiRequest(`${base('read')}/${id}?${instance}`, { cache: 'no-store' });
    },
    async create(row) {
      return apiRequest(`${base('create')}?${instance}`, { method: 'POST', body: row });
    },
    async update(id, row) {
      return apiRequest(`${base('update')}/${id}?${instance}`, { method: 'PUT', body: row });
    },
    async remove(id) {
      return apiRequest(`${base('delete')}/${id}?${instance}`, { method: 'DELETE' });
    },
  };
}

export const automationsApi = tableApi('automations');
export const automationRunsApi = tableApi('automation_runs');
export const tasksApi = tableApi('tasks');
