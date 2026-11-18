import {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  UpdateWorkspaceRequest,
  ReadWorkspaceResponse,
  CreateWorkspaceMemberRequest,
  CreateWorkspaceMemberResponse,
  ApiError,
  User,
  LeadCustomField,
  LeadCustomFieldValue,
  ApiResponse,
  Customer,
  CustomerProfileUpdate,
  ProspectsView,
  Workspace,
  WorkspaceMember,
  WhatsAppWorkspaceConfigMasked,
  WhatsAppTemplateConfig,
  WhatsAppTriggerConfig,
  WhatsAppTriggerKind,
  WhatsAppCampaignSummary,
  WhatsAppMessageLogEntry,
  DealStageConfig,
  DealCustomField,
  Deal,
  DealDocument,
  WebFormDealMapping,
} from '../components/types';
import { getAuthToken } from './storage';
import type { WorkspaceAccess, WorkspacePermissions } from '../types/permissions';

// Use relative URLs in production (same domain), or env variable if set
// This allows the API to work whether served by nginx or directly by Node.js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export async function readWorkspaceAccess(workspaceId: number, signal?: AbortSignal): Promise<WorkspaceAccess> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/permissions`, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
  return (await handleResponse<ApiResponse<WorkspaceAccess>>(response)).data!;
}

export async function updateMemberPermissions(workspaceId: number, memberId: number, permissions: WorkspacePermissions): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/members/${memberId}/permissions`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions }),
  });
  await handleResponse(response);
}

export async function updateWorkspaceMemberRole(workspaceId: number, memberId: number, role: 'admin' | 'manager' | 'member' | 'viewer'): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/workspace-members/${memberId}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId, role }),
  });
  await handleResponse(response);
}

export interface DealConfiguration { stages: DealStageConfig[]; fields: DealCustomField[]; required_documents?: string[] }

export async function dealRequest<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/deals${path}`, {
    method: options.method || 'GET', signal: options.signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return (await handleResponse<ApiResponse<T>>(response)).data as T;
}

export function readDealConfiguration(workspaceId: number, signal?: AbortSignal): Promise<DealConfiguration> {
  return dealRequest(`/configuration?workspace_id=${workspaceId}`, { signal });
}

export function saveDealConfiguration(workspaceId: number, configuration: DealConfiguration): Promise<DealConfiguration> {
  return dealRequest('/configuration', { method: 'PUT', body: { workspace_id: workspaceId, ...configuration } });
}

/** Load stage configuration for a specific pipeline (falls back to global if no pipeline config saved yet). */
export function readPipelineConfiguration(workspaceId: number, pipelineSlug: string, signal?: AbortSignal): Promise<DealConfiguration> {
  return dealRequest(`/configuration?workspace_id=${workspaceId}&pipeline_slug=${encodeURIComponent(pipelineSlug)}`, { signal });
}

/** Save stage configuration scoped to a specific pipeline. */
export function savePipelineConfiguration(workspaceId: number, pipelineSlug: string, configuration: DealConfiguration): Promise<DealConfiguration> {
  return dealRequest('/configuration', { method: 'PUT', body: { workspace_id: workspaceId, pipeline_slug: pipelineSlug, ...configuration } });
}

export function getPipelines(workspaceId: number): Promise<any[]> {
  return dealRequest(`/pipelines?workspace_id=${workspaceId}`);
}

export function renamePipeline(workspaceId: number, slug: string, name: string): Promise<{ id: number; workspace_id: number; slug: string; name: string }> {
  return dealRequest(`/pipelines/${encodeURIComponent(slug)}`, { method: 'PUT', body: { workspace_id: workspaceId, name } });
}

export function deletePipeline(workspaceId: number, slug: string): Promise<unknown> {
  return dealRequest(`/pipelines/${encodeURIComponent(slug)}?workspace_id=${workspaceId}`, { method: 'DELETE' });
}

export function saveDeal(body: unknown, id?: number): Promise<Deal> {
  return dealRequest(id ? `/${id}` : '', { method: id ? 'PUT' : 'POST', body });
}

export function listDealDocuments(dealId: number, signal?: AbortSignal): Promise<DealDocument[]> {
  return dealRequest(`/${dealId}/documents`, { signal });
}

export function uploadDealDocument(dealId: number, input: { name: string; kind: string; mime: string; size: number; data: string }): Promise<DealDocument> {
  return dealRequest(`/${dealId}/documents`, { method: 'POST', body: input });
}

export function deleteDealDocument(dealId: number, docId: string): Promise<{ deleted: boolean }> {
  return dealRequest(`/${dealId}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

export function dealDocumentDownloadUrl(dealId: number, docId: string): string {
  return `${API_BASE_URL}/api/deals/${dealId}/documents/${encodeURIComponent(docId)}/download`;
}

export async function instagramRequest<T>(workspaceId: number, path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/instagram/${workspaceId}/${path}`, {
    method: options.method || 'GET', signal: options.signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return (await handleResponse<ApiResponse<T>>(response)).data as T;
}

export async function whatsAppSignupRequest<T>(workspaceId: number, body?: unknown): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/signup`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (await handleResponse<ApiResponse<T>>(response)).data as T;
}

export async function whatsAppManagementRequest<T>(workspaceId: number, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/${path}`, {
    method: body ? 'POST' : 'GET', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (await handleResponse<ApiResponse<T>>(response)).data as T;
}

export async function readCustomers(workspaceId: number, signal?: AbortSignal): Promise<ApiResponse<Customer[]>> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);

  const response = await fetch(
    `${API_BASE_URL}/api/customers?workspace_id=${encodeURIComponent(workspaceId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal }
  );
  return handleResponse<ApiResponse<Customer[]>>(response);
}

export async function updateCustomer(
  customerId: string,
  update: CustomerProfileUpdate
): Promise<ApiResponse<Customer>> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);

  const response = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return handleResponse<ApiResponse<Customer>>(response);
}

export async function readProspects(workspaceId: number, signal?: AbortSignal): Promise<ApiResponse<ProspectsView>> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(
    `${API_BASE_URL}/api/prospects?workspace_id=${encodeURIComponent(workspaceId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal }
  );
  return handleResponse<ApiResponse<ProspectsView>>(response);
}

export async function setProspectSelection(
  workspaceId: number,
  leadId: number,
  selected: boolean
): Promise<ApiResponse<{ selected: boolean }>> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/prospects/${leadId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, selected }),
  });
  return handleResponse<ApiResponse<{ selected: boolean }>>(response);
}

// Helper to format date for API
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const getCreatedAt = () => formatDate(new Date());

interface AuthPayload {
  user: User;
  token: string;
}

interface AuthResponse {
  success: boolean;
  status?: string;
  data?: AuthPayload;
  error?: string;
}

// Helper to handle API responses from our Node backend
async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');

  const data = contentType?.includes('application/json') ? await response.json() : null;

  const apiStatus =
    data && typeof data.status === 'string' ? data.status.toLowerCase() : undefined;
  const apiFailed =
    (apiStatus !== undefined && apiStatus !== 'success') ||
    (data && data.success === false);

  if (!response.ok || apiFailed) {
    const errorMessage =
      (data && (data.message || data.error)) || `Request failed with status ${response.status}`;
    const errorStatus = response.ok ? 500 : response.status;
    throw new ApiError(errorMessage, errorStatus);
  }

  return data as T;
}

// User & Auth API (proxied through Node backend – no NoCodeBackend key in the browser)
export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  accepted_terms: number;
  accepted_terms_at: string;
}): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return handleResponse<AuthResponse>(response);
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  return handleResponse<AuthResponse>(response);
}

export async function getFacebookAuthUrl(action: 'login' | 'signup'): Promise<{ authUrl: string }> {
  const returnTo =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  const params = new URLSearchParams({ action });
  if (returnTo) params.set('return_to', returnTo);

  const response = await fetch(`${API_BASE_URL}/api/auth/facebook/start?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const data = await handleResponse<{ status: string; data?: { authUrl: string }; error?: string }>(response);
  
  if (data.status !== 'success' || !data.data?.authUrl) {
    throw new ApiError(data.error || 'Failed to get Facebook auth URL', 500);
  }

  return { authUrl: data.data.authUrl };
}

export async function refreshAuthToken(): Promise<AuthResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse<AuthResponse>(response);
}

export async function getCurrentUser(): Promise<User> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token for /api/auth/me request', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await handleResponse<{ success: boolean; data?: { user: User } }>(response);

  if (!data || !data.success || !data.data?.user) {
    throw new ApiError('Invalid response from /api/auth/me', 500);
  }

  return data.data.user;
}

export async function updateCurrentUser(
  userId: number,
  updates: Partial<Pick<User, 'name' | 'email' | 'accepted_terms' | 'accepted_terms_at'>>
): Promise<User> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(updates),
  });

  const data = await handleResponse<ApiResponse<User>>(response);
  if (!data || data.status !== 'success' || !data.data) {
    throw new ApiError('Failed to update user', 500);
  }

  return data.data;
}

// Workspace API
export async function createWorkspace(
  data: CreateWorkspaceRequest
): Promise<CreateWorkspaceResponse> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/workspaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });

  return handleResponse<CreateWorkspaceResponse>(response);
}

export async function readWorkspaces(ownerId?: number): Promise<ReadWorkspaceResponse> {
  const token = getAuthToken();
  const params = new URLSearchParams();
  if (ownerId) params.append('owner_id', ownerId.toString());

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces${params.toString() ? `?${params.toString()}` : ''}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );

  return handleResponse<ReadWorkspaceResponse>(response);
}

export async function updateWorkspace(
  workspaceId: number,
  data: UpdateWorkspaceRequest
): Promise<{ status: string; data: Workspace; message?: string; error?: string }> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });

  return handleResponse<{ status: string; data: Workspace; message?: string; error?: string }>(response);
}

// Workspace Member API
export async function createWorkspaceMember(
  data: CreateWorkspaceMemberRequest
): Promise<CreateWorkspaceMemberResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspace-members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<CreateWorkspaceMemberResponse>(response);
}

export interface WorkspaceMemberWithUser extends WorkspaceMember {
  user?: User;
}

export interface GetWorkspaceMembersResponse {
  status: string;
  data: WorkspaceMemberWithUser[];
}

export async function getWorkspaceMembers(
  workspaceId: number
): Promise<GetWorkspaceMembersResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/members`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse<GetWorkspaceMembersResponse>(response);
}

export interface InviteWorkspaceMemberRequest {
  email: string;
}

export interface InviteWorkspaceMemberResponse {
  status: string;
  id?: number;
  message?: string;
}

export async function inviteWorkspaceMember(
  workspaceId: number,
  data: InviteWorkspaceMemberRequest
): Promise<InviteWorkspaceMemberResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/members/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<InviteWorkspaceMemberResponse>(response);
}

// Workspace Email Templates API
export interface WorkspaceInviteEmailTemplate {
  subject: string;
  intro: string;
  buttonText: string;
  whatsTitle: string;
  whatsBody: string;
}

export interface GetWorkspaceInviteEmailTemplateResponse {
  status: string;
  data: WorkspaceInviteEmailTemplate;
}

export async function getWorkspaceInviteEmailTemplate(
  workspaceId: number
): Promise<GetWorkspaceInviteEmailTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/invite`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return handleResponse<GetWorkspaceInviteEmailTemplateResponse>(response);
}

export interface UpdateWorkspaceInviteEmailTemplateResponse {
  status: string;
  data: WorkspaceInviteEmailTemplate;
}

export async function updateWorkspaceInviteEmailTemplate(
  workspaceId: number,
  template: Partial<WorkspaceInviteEmailTemplate>
): Promise<UpdateWorkspaceInviteEmailTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/invite`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(template),
    }
  );

  return handleResponse<UpdateWorkspaceInviteEmailTemplateResponse>(response);
}

export interface WorkspaceSmtpConfig {
  workspace_id: number;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_name: string;
  from_email: string;
  reply_to?: string;
  password_set: boolean;
  password_masked: string;
  created_at?: string;
  updated_at: string;
}

export interface WorkspaceSmtpConfigInput {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string;
}

export interface GetWorkspaceSmtpConfigResponse {
  status: string;
  data: WorkspaceSmtpConfig | null;
}

export async function getWorkspaceSmtpConfig(
  workspaceId: number
): Promise<GetWorkspaceSmtpConfigResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/email/smtp`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse<GetWorkspaceSmtpConfigResponse>(response);
}

export interface UpdateWorkspaceSmtpConfigResponse {
  status: string;
  data: WorkspaceSmtpConfig;
}

export async function updateWorkspaceSmtpConfig(
  workspaceId: number,
  config: WorkspaceSmtpConfigInput
): Promise<UpdateWorkspaceSmtpConfigResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/email/smtp`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(config),
  });

  return handleResponse<UpdateWorkspaceSmtpConfigResponse>(response);
}

export interface SendWorkspaceSmtpTestEmailResponse {
  status: string;
  data?: { messageId?: string };
  message?: string;
}

export async function sendWorkspaceSmtpTestEmail(
  workspaceId: number,
  to: string
): Promise<SendWorkspaceSmtpTestEmailResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/email/smtp/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to }),
  });

  return handleResponse<SendWorkspaceSmtpTestEmailResponse>(response);
}

export interface LeadAutoReplyTemplateAttachment {
  filename: string;
  url: string;
}

export interface LeadAutoReplyTemplate {
  workspace_id: number;
  enabled: boolean;
  subject: string;
  html: string;
  text: string;
  attachments: LeadAutoReplyTemplateAttachment[];
  created_at?: string;
  updated_at: string;
}

export interface LeadAutoReplyTemplateInput {
  enabled?: boolean;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: Array<Partial<LeadAutoReplyTemplateAttachment>>;
}

export interface GetLeadAutoReplyTemplateResponse {
  status: string;
  data: LeadAutoReplyTemplate | null;
}

export async function getLeadAutoReplyTemplate(
  workspaceId: number
): Promise<GetLeadAutoReplyTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-autoreply`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return handleResponse<GetLeadAutoReplyTemplateResponse>(response);
}

export interface UpdateLeadAutoReplyTemplateResponse {
  status: string;
  data: LeadAutoReplyTemplate;
}

export async function updateLeadAutoReplyTemplate(
  workspaceId: number,
  template: LeadAutoReplyTemplateInput
): Promise<UpdateLeadAutoReplyTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-autoreply`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(template),
    }
  );

  return handleResponse<UpdateLeadAutoReplyTemplateResponse>(response);
}

export interface SendLeadAutoReplyTemplateTestEmailResponse {
  status: string;
  data?: { messageId?: string };
  message?: string;
}

export async function sendLeadAutoReplyTemplateTestEmail(
  workspaceId: number,
  payload: {
    to: string;
    lead?: {
      name?: string;
      email?: string;
      phone?: string;
      source_old?: string;
      source_ref?: string;
    };
  }
): Promise<SendLeadAutoReplyTemplateTestEmailResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-autoreply/test`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  return handleResponse<SendLeadAutoReplyTemplateTestEmailResponse>(response);
}

export interface LeadNotificationTemplate {
  workspace_id: number;
  enabled: boolean;
  recipient_email: string;
  additional_recipients: string[];
  subject: string;
  html: string;
  text: string;
  created_at?: string;
  updated_at: string;
}

export interface LeadNotificationTemplateInput {
  enabled?: boolean;
  recipient_email?: string;
  additional_recipients?: string[];
  subject?: string;
  html?: string;
  text?: string;
}

export interface GetLeadNotificationTemplateResponse {
  status: string;
  data: LeadNotificationTemplate | null;
}

export async function getLeadNotificationTemplate(
  workspaceId: number
): Promise<GetLeadNotificationTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-notification`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return handleResponse<GetLeadNotificationTemplateResponse>(response);
}

export interface UpdateLeadNotificationTemplateResponse {
  status: string;
  data: LeadNotificationTemplate;
}

export async function updateLeadNotificationTemplate(
  workspaceId: number,
  template: LeadNotificationTemplateInput
): Promise<UpdateLeadNotificationTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-notification`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(template),
    }
  );

  return handleResponse<UpdateLeadNotificationTemplateResponse>(response);
}

// Lead Assignment Notification Template
export interface LeadAssignmentTemplate {
  workspace_id: number;
  enabled: boolean;
  subject: string;
  html: string;
  text: string;
  created_at?: string;
  updated_at: string;
}

export interface LeadAssignmentTemplateInput {
  enabled?: boolean;
  subject?: string;
  html?: string;
  text?: string;
}

export interface GetLeadAssignmentTemplateResponse {
  status: string;
  data: LeadAssignmentTemplate | null;
}

export async function getLeadAssignmentTemplate(
  workspaceId: number
): Promise<GetLeadAssignmentTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-assignment`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return handleResponse<GetLeadAssignmentTemplateResponse>(response);
}

export interface UpdateLeadAssignmentTemplateResponse {
  status: string;
  data: LeadAssignmentTemplate;
}

export async function updateLeadAssignmentTemplate(
  workspaceId: number,
  template: LeadAssignmentTemplateInput
): Promise<UpdateLeadAssignmentTemplateResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/email-templates/lead-assignment`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(template),
    }
  );

  return handleResponse<UpdateLeadAssignmentTemplateResponse>(response);
}

export interface UpdateWorkspaceMemberRequest {
  role: string;
  workspace_id: number;
}

export interface UpdateWorkspaceMemberResponse {
  status: string;
  message?: string;
}

export async function updateWorkspaceMember(
  memberId: number,
  data: UpdateWorkspaceMemberRequest
): Promise<UpdateWorkspaceMemberResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/workspace-members/${memberId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<UpdateWorkspaceMemberResponse>(response);
}

export interface RemoveWorkspaceMemberResponse {
  status: string;
  message?: string;
}

export async function removeWorkspaceMember(
  memberId: number,
  workspaceId: number
): Promise<RemoveWorkspaceMemberResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workspace-members/${memberId}?workspace_id=${workspaceId}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return handleResponse<RemoveWorkspaceMemberResponse>(response);
}

// Custom Fields API (proxied through Node backend)
export async function getWorkspaceCustomFields(
  workspaceId: number
): Promise<ApiResponse<LeadCustomField[]>> {
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/custom-fields`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );

  return handleResponse<ApiResponse<LeadCustomField[]>>(response);
}

export async function createWorkspaceCustomField(
  workspaceId: number,
  field: Omit<LeadCustomField, 'id' | 'created_at'>
): Promise<ApiResponse<{ id: number }>> {
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/custom-fields`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(field),
    }
  );

  return handleResponse<ApiResponse<{ id: number }>>(response);
}

export async function updateWorkspaceCustomField(
  id: number,
  field: Partial<Omit<LeadCustomField, 'id' | 'created_at'>>
): Promise<ApiResponse<LeadCustomField>> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/custom-fields/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(field),
  });

  return handleResponse<ApiResponse<LeadCustomField>>(response);
}

export async function deleteWorkspaceCustomField(
  id: number,
  workspaceId: number
): Promise<ApiResponse<null>> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/custom-fields/${id}?workspace_id=${workspaceId}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return handleResponse<ApiResponse<null>>(response);
}

// Custom Field Values API (proxied through Node backend)
export async function getLeadCustomFieldValues(
  leadId: number
): Promise<ApiResponse<LeadCustomFieldValue[]>> {
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/api/leads/${leadId}/custom-field-values`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );

  return handleResponse<ApiResponse<LeadCustomFieldValue[]>>(response);
}

export async function createLeadCustomFieldValue(
  value: Omit<LeadCustomFieldValue, 'id' | 'created_at'>
): Promise<ApiResponse<{ id: number }>> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/custom-field-values`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(value),
  });

  return handleResponse<ApiResponse<{ id: number }>>(response);
}

export async function updateLeadCustomFieldValue(
  id: number,
  value: Partial<Omit<LeadCustomFieldValue, 'id' | 'created_at'>>
): Promise<ApiResponse<LeadCustomFieldValue>> {
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/api/custom-field-values/${id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(value),
    }
  );

  return handleResponse<ApiResponse<LeadCustomFieldValue>>(response);
}

export async function deleteLeadCustomFieldValue(
  id: number
): Promise<ApiResponse<null>> {
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/api/custom-field-values/${id}`,
    {
      method: 'DELETE',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );

  return handleResponse<ApiResponse<null>>(response);
}

// Email Verification API
export interface EmailVerificationResult {
  email: string;
  status: 'valid' | 'safe' | 'risky' | 'invalid' | 'disposable' | 'spamtrap' | 'unknown';
  username: string;
  domain: string;
  is_valid_syntax: boolean;
  is_disposable: boolean;
  is_role_account: boolean;
  mx_accepts_mail: boolean;
  is_spamtrap: boolean;
  is_free_email: boolean;
  mx_records: string[];
  verification_mode: 'quick' | 'power';
  email_valid: boolean;
  email_verdict?: 'deliverable' | 'undeliverable' | 'unknown_accept_all' | 'unknown';
  email_accept_all?: boolean;
  email_verification_mode?: 'quick' | 'power';
  email_requested_mode?: 'quick' | 'power' | 'auto';
}

export interface EmailVerifierBalance {
  api_status: 'active' | 'inactive';
  remaining_daily_credits: number;
  remaining_instant_credits: number;
  status: 'success' | 'error';
}

export async function verifyEmail(
  email: string,
  mode: 'quick' | 'power' | 'auto' = 'auto'
): Promise<EmailVerificationResult> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/email-verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email, mode }),
  });

  return handleResponse<{ data: EmailVerificationResult }>(response).then(
    (res) => res.data
  );
}

export async function getEmailVerifierBalance(): Promise<EmailVerifierBalance> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/email-verify/balance`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse<{ data: EmailVerifierBalance }>(response).then(
    (res) => res.data
  );
}

// Admin: Reset user password
export async function adminResetPassword(
  userId: number,
  newPassword: string
): Promise<{ status: string; message?: string }> {
  const token = getAuthToken();
  if (!token) {
    throw new ApiError('Missing auth token', 401);
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/admin/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user_id: userId, new_password: newPassword }),
  });

  return handleResponse<{ status: string; message?: string }>(response);
}

// ============ WhatsApp Integration ============

function whatsAppHeaders(): HeadersInit {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function getWhatsAppConfig(workspaceId: number): Promise<WhatsAppWorkspaceConfigMasked> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/config`, {
    headers: whatsAppHeaders(),
  });
  return handleResponse<{ data: WhatsAppWorkspaceConfigMasked }>(response).then((r) => r.data);
}

export async function updateWhatsAppConfig(
  workspaceId: number,
  data: Partial<{
    enabled: boolean;
    phone_number_id: string;
    waba_id: string;
    access_token: string;
    display_phone: string;
  }>
): Promise<WhatsAppWorkspaceConfigMasked> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/config`, {
    method: 'PUT',
    headers: whatsAppHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse<{ data: WhatsAppWorkspaceConfigMasked }>(response).then((r) => r.data);
}

export async function sendWhatsAppTestMessage(
  workspaceId: number,
  toPhone: string,
  triggerKind?: WhatsAppTriggerKind,
  options?: { usePlainText?: boolean; useSandboxTemplate?: boolean; messageBody?: string }
): Promise<{ message_id?: string; message?: string }> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/config/test`, {
    method: 'POST',
    headers: whatsAppHeaders(),
    body: JSON.stringify({
      to_phone: toPhone,
      trigger_kind: triggerKind,
      use_plain_text: options?.usePlainText,
      use_sandbox_template: options?.useSandboxTemplate,
      message_body: options?.messageBody,
    }),
  });
  const data = await handleResponse<{ data: { message_id?: string }; message?: string }>(response);
  return { message_id: data.data?.message_id, message: data.message };
}

export async function getWhatsAppTriggers(workspaceId: number): Promise<WhatsAppTriggerConfig> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/triggers`, {
    headers: whatsAppHeaders(),
  });
  return handleResponse<{ data: WhatsAppTriggerConfig }>(response).then((r) => r.data);
}

export async function updateWhatsAppTriggers(
  workspaceId: number,
  data: Partial<Omit<WhatsAppTriggerConfig, 'workspace_id' | 'updated_at'>>
): Promise<WhatsAppTriggerConfig> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/triggers`, {
    method: 'PUT',
    headers: whatsAppHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse<{ data: WhatsAppTriggerConfig }>(response).then((r) => r.data);
}

export async function getWhatsAppTemplates(workspaceId: number): Promise<WhatsAppTemplateConfig[]> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/templates`, {
    headers: whatsAppHeaders(),
  });
  return handleResponse<{ data: WhatsAppTemplateConfig[] }>(response).then((r) => r.data);
}

export async function updateWhatsAppTemplate(
  workspaceId: number,
  kind: WhatsAppTriggerKind,
  data: Partial<Omit<WhatsAppTemplateConfig, 'kind' | 'updated_at'>>
): Promise<WhatsAppTemplateConfig> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/templates/${kind}`, {
    method: 'PUT',
    headers: whatsAppHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse<{ data: WhatsAppTemplateConfig }>(response).then((r) => r.data);
}

export async function sendWhatsAppNoAnswer(
  workspaceId: number,
  leadId: number
): Promise<{ queued: boolean; eventId?: string; reason?: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/whatsapp/${workspaceId}/leads/${leadId}/send-no-answer`,
    { method: 'POST', headers: whatsAppHeaders() }
  );
  return handleResponse<{ data: { queued: boolean; eventId?: string; reason?: string } }>(response).then(
    (r) => r.data
  );
}

export async function resendWhatsAppMessage(
  workspaceId: number,
  leadId: number,
  triggerKind: WhatsAppTriggerKind = 'new_lead'
): Promise<{ queued: boolean; eventId?: string; reason?: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/whatsapp/${workspaceId}/leads/${leadId}/resend`,
    {
      method: 'POST',
      headers: whatsAppHeaders(),
      body: JSON.stringify({ trigger_kind: triggerKind }),
    }
  );
  return handleResponse<{ data: { queued: boolean; eventId?: string; reason?: string } }>(response).then(
    (r) => r.data
  );
}

export async function getWhatsAppMessages(
  workspaceId: number,
  params?: { page?: number; limit?: number }
): Promise<WhatsAppMessageLogEntry[]> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const response = await fetch(
    `${API_BASE_URL}/api/whatsapp/${workspaceId}/messages?${qs.toString()}`,
    { headers: whatsAppHeaders() }
  );
  return handleResponse<{ data: WhatsAppMessageLogEntry[] }>(response).then((r) => r.data);
}

export async function getWhatsAppCampaigns(workspaceId: number): Promise<WhatsAppCampaignSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/campaigns`, {
    headers: whatsAppHeaders(),
  });
  return handleResponse<{ data: WhatsAppCampaignSummary[] }>(response).then((r) => r.data);
}

export async function createWhatsAppCampaign(
  workspaceId: number,
  data: {
    name: string;
    template_kind?: WhatsAppTriggerKind;
    lead_ids?: number[];
    status_ids?: number[];
    source_filter?: string;
  }
): Promise<{ campaignId?: string; queued?: number; skipped?: number }> {
  const response = await fetch(`${API_BASE_URL}/api/whatsapp/${workspaceId}/campaigns`, {
    method: 'POST',
    headers: whatsAppHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse<{ data: { campaignId?: string; queued?: number; skipped?: number } }>(response).then(
    (r) => r.data
  );
}

export async function cancelWhatsAppCampaign(
  workspaceId: number,
  campaignId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/whatsapp/${workspaceId}/campaigns/${encodeURIComponent(campaignId)}/cancel`,
    { method: 'POST', headers: whatsAppHeaders() }
  );
  await handleResponse(response);
}

export async function getPendingInvitations(workspaceId: number): Promise<any[]> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/invitations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = await handleResponse<{ data: any[] }>(response);
  return res.data || [];
}

export async function cancelInvitation(workspaceId: number, email: string): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/invitations/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  await handleResponse(response);
}

export async function getDealAssociations(workspaceId: number, dealId: number): Promise<any[]> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/deals/${dealId}/associations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = await handleResponse<{ data: any[] }>(response);
  return res.data || [];
}

export async function createDealAssociation(workspaceId: number, sourceDealId: number, targetDealId: number, type?: string): Promise<any> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/deal-associations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, source_deal_id: sourceDealId, target_deal_id: targetDealId, type }),
  });
  const res = await handleResponse<{ data: any }>(response);
  return res.data;
}

export async function deleteDealAssociation(associationId: number): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}/api/deal-associations/${associationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  await handleResponse(response);
}

export async function readWebFormDealMapping(
  workspaceId: number,
  sourceId: string,
): Promise<WebFormDealMapping | null> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(
    `${API_BASE_URL}/api/sources/${workspaceId}/${encodeURIComponent(sourceId)}/deal-mapping`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  const res = await handleResponse<ApiResponse<WebFormDealMapping | null>>(response);
  return res.data ?? null;
}

export async function saveWebFormDealMapping(
  workspaceId: number,
  sourceId: string,
  mapping: Partial<WebFormDealMapping>,
): Promise<WebFormDealMapping> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(
    `${API_BASE_URL}/api/sources/${workspaceId}/${encodeURIComponent(sourceId)}/deal-mapping`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...mapping, workspace_id: workspaceId, source_id: sourceId }),
    },
  );
  const res = await handleResponse<ApiResponse<WebFormDealMapping>>(response);
  return res.data;
}


// ============ AUTOMATIONS ============
export type AutomationTrigger = 'deal_created' | 'deal_moved' | 'deal_created_or_moved' | 'deal_owner_changed' | 'lead_created';
export type AutomationAction =
  | 'send_email' | 'send_whatsapp' | 'move_stage' | 'assign_owner' | 'add_tags'
  | 'remove_tags' | 'create_task' | 'notify_user' | 'send_webhook';

export interface AutomationConditions {
  still_in_stage?: boolean;
  min_value?: number | null;
  max_value?: number | null;
  owner_ids?: number[];
  tags_any?: string[];
  tags_none?: string[];
  lead_sources?: string[];
  priorities?: string[];
}

export interface AutomationRule {
  id?: number;
  workspace_id: number;
  name: string;
  pipeline_slug: string;
  stage: string;
  trigger_type: AutomationTrigger;
  delay_minutes: number;
  conditions: AutomationConditions;
  action_type: AutomationAction;
  action_config: Record<string, unknown>;
  active: boolean;
  sort_order: number;
}

export interface AutomationRun {
  id: number;
  automation_id: number;
  deal_id: number;
  lead_id: number;
  event_type: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  run_at: string;
  attempts: number;
  result: string;
  error: string;
  created_at: string;
}

export interface CrmTask {
  id: number;
  workspace_id: number;
  deal_id: number;
  lead_id: number;
  assigned_to: number;
  title: string;
  description: string;
  task_type: string;
  due_at: string;
  status: 'open' | 'done';
  completed_at: string | null;
  automation_id: number;
  created_at: string;
}

async function authedJson<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new ApiError('Missing auth token', 401);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return (await handleResponse<ApiResponse<T>>(response)).data as T;
}

export const listAutomations = (workspaceId: number) =>
  authedJson<AutomationRule[]>(`/api/automations?workspace_id=${workspaceId}`);

export const saveAutomation = (rule: AutomationRule) =>
  authedJson<AutomationRule>(rule.id ? `/api/automations/${rule.id}` : '/api/automations', {
    method: rule.id ? 'PUT' : 'POST',
    body: { ...rule, id: undefined },
  });

export const deleteAutomation = (workspaceId: number, id: number) =>
  authedJson<{ id: number }>(`/api/automations/${id}?workspace_id=${workspaceId}`, { method: 'DELETE' });

export const listAutomationRuns = (workspaceId: number, automationId?: number) =>
  authedJson<AutomationRun[]>(`/api/automations/runs?workspace_id=${workspaceId}${automationId ? `&automation_id=${automationId}` : ''}`);

export const listTasks = (workspaceId: number, scope: 'mine' | 'all', status?: 'open' | 'done') =>
  authedJson<CrmTask[]>(`/api/tasks?workspace_id=${workspaceId}&scope=${scope}${status ? `&status=${status}` : ''}`);

export const updateTaskStatus = (workspaceId: number, id: number, status: 'open' | 'done') =>
  authedJson<CrmTask>(`/api/tasks/${id}`, { method: 'PUT', body: { workspace_id: workspaceId, status } });
