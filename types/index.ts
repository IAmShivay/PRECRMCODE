import { WorkspaceRole } from './constants.js';
// Express Types
import { Request } from 'express';

// User Types
export interface User {
  id: number;
  name: string;
  email: string;
  password?: string;
  created_at?: string;
  accepted_terms?: number;
  accepted_terms_at?: string;
}

export interface JWTPayload {
  id: number;
  email: string;
}

// Workspace Types
export interface Workspace {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  currency?: string;
  created_at?: string;
}

export interface WorkspaceMember {
  permissions?: import('./permissions.js').WorkspacePermissions;
  id: number;
  workspace_id: number;
  user_id: number;
  role: 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
  created_at: string;
}

// Lead Types
export interface Lead {
  id: number;
  workspace_id: number;
  status_id: number | null;
  name: string;
  email: string;
  phone: string;
  source_old: string; // Normalized SourceType enum as string
  source_ref: string;
  source_id?: string; // Registry source ID (e.g., 'fb_ads_ws1_k1j2m3')
  user_id: number | null;
  email_valid: boolean;
  phone_valid: boolean;
  email_verified_at?: string; // Timestamp when email was last verified
  email_verification_status?: 'valid' | 'invalid' | 'disposable' | 'spamtrap'; // Detailed status
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface SourceOption {
  value: string;
  label: string;
}

export interface LeadCreateData {
  workspace_id: number;
  status_id?: number;
  name?: string;
  email?: string;
  phone?: string;
  source_old?: string;
  source_ref?: string;
  source_id?: string;
}

export interface LeadUpdateData {
  workspace_id?: number;
  status_id?: number;
  name?: string;
  email?: string;
  phone?: string;
  source_old?: string; // Normalized SourceType enum as string
  source_ref?: string;
  source_id?: string; // Registry source ID
  email_valid?: boolean;
  phone_valid?: boolean;
  email_verified_at?: string;
  email_verification_status?: 'valid' | 'invalid' | 'disposable' | 'spamtrap';
  user_id?: number;
  deleted_at?: string | null;
}

export type DealStage = string;
export type { DealCustomField, DealFieldType, DealFieldValues } from './dealFields.js';

export interface DealStageConfig {
  slug: string;
  name: string;
  color: string;
  counts_as_conversion: boolean;
}

export interface Prospect {
  lead: Lead;
  status_name: string;
  qualified: boolean;
  manually_selected: boolean;
}

export interface ProspectsView {
  prospects: Prospect[];
  candidates: Lead[];
}

export interface DealDocument {
  id: string;
  name: string;
  kind: string;
  mime: string;
  size: number;
  storage_path: string;
  resource_type?: string;
  uploaded_by?: number | null;
  uploaded_at?: string;
}

export interface Deal {
  custom_fields?: import('./dealFields.js').DealFieldValues;
  documents?: DealDocument[];
  id: number;
  workspace_id: number;
  name: string;
  value: number;
  contact?: string;
  owner_id?: number | null;
  stage: DealStage | string;
  pipeline_slug?: string;
  expected_close_date?: string;
  priority?: import('./constants.js').DealPriority | string;
  lead_id?: number;
  created_at?: string;
  updated_at?: string;
  won_at?: string;
  converted_at?: string;
  tags?: string[];
}

export interface DealAssociation {
  id: number;
  workspace_id: number;
  source_deal_id: number;
  target_deal_id: number;
  type: import('./constants.js').DealAssociationType;
  created_by: number;
  created_at: string;
}

export interface DealAssociationCreateData {
  workspace_id: number;
  source_deal_id: number;
  target_deal_id: number;
  type?: import('./constants.js').DealAssociationType;
  created_by?: number;
}

// NoCodeBackend lead_webhook_logs row used to persist deals.
export interface StoredDealLog {
  id?: number;
  workspace_id?: number;
  lead_id?: number;
  status?: string;
  event_id?: string;
  source?: string;
  source_old?: string;
  error?: string | null;
  payload?: string | Record<string, unknown>;
  created_at?: string;
}

export interface CustomerOrder {
  deal_id: number;
  deal_name: string;
  value: number;
  pipeline_slug: string;
  won_at: string;
  items: CustomerOrderItem[];
}

export interface CustomerOrderItem {
  name: string;
  quantity: number;
}

export interface CustomerCustomField {
  label: string;
  value: string;
}

export interface CustomerProfileUpdate {
  workspace_id: number;
  email?: string;
  phone?: string;
  address: string;
  custom_fields: CustomerCustomField[];
  order_items: Record<string, CustomerOrderItem[]>;
}

export interface Customer {
  id: string;
  workspace_id: number;
  lead_id?: number;
  name: string;
  email?: string;
  phone?: string;
  lead_email?: string;
  lead_phone?: string;
  address: string;
  contact: string;
  custom_fields: CustomerCustomField[];
  order_count: number;
  total_value: number;
  first_won_at: string;
  last_won_at: string;
  orders: CustomerOrder[];
}

export interface DealCreateData {
  custom_fields?: import('./dealFields.js').DealFieldValues;
  workspace_id: number;
  name: string;
  value?: number;
  contact?: string;
  owner_id?: number | null;
  stage?: DealStage | string;
  created_at?: string;
  updated_at?: string;
}

export interface DealUpdateData {
  custom_fields?: import('./dealFields.js').DealFieldValues;
  workspace_id?: number;
  name?: string;
  value?: number;
  contact?: string;
  owner_id?: number | null;
  stage?: DealStage | string;
  updated_at?: string;
}

export interface DealStageHistory {
  id: number;
  workspace_id: number;
  deal_id: number;
  user_id?: number | null;
  old_stage: string;
  new_stage: string;
  created_at: string;
}

// Lead Status Types
export interface LeadStatus {
  id: number;
  workspace_id: number;
  name: string;
  slug: string;
  color: string;
  type: 'open' | 'closed' | 'won' | 'lost';
  is_default: number;
  is_active: number;
  order_index: number;
  is_qualified: number;
  created_at?: string;
}

export interface LeadStatusCreateData {
  workspace_id: number;
  name: string;
  slug: string;
  color?: string;
  type?: string;
  is_default?: number;
  is_active?: number;
  order_index?: number;
  is_qualified?: number;
}

// Lead Activity Types
export interface LeadActivity {
  id: number;
  lead_id: number;
  workspace_id: number;
  user_id: number;
  type: string;
  title: string;
  description: string;
  metadata: string;
  created_at: string;
  actor_name?: string;
  actor_role?: 'owner' | 'admin' | 'member';
}

export interface ActivityMetadata {
  old_status_id?: number;
  new_status_id?: number;
  old_status_name?: string;
  new_status_name?: string;
}

// Notification Types
export interface Notification {
  id: number;
  workspace_id: number;
  recipient_user_id: number;
  actor_user_id?: number | null;
  lead_id?: number | null;
  type: string;
  title: string;
  message?: string | null;
  payload?: string | null;
  read_at?: string | null;
  created_at: string;
  updated_at?: string;
  actor_name?: string;
  actor_email?: string;
  lead_name?: string;
}

export interface NotificationCreateData {
  workspace_id: number;
  recipient_user_id: number;
  actor_user_id?: number | null;
  lead_id?: number | null;
  type: string;
  title: string;
  message?: string | null;
  payload?: string | null;
  read_at?: string | null;
  created_at?: string;
}

export interface NotificationUpdateData {
  read_at?: string | null;
  updated_at?: string;
}

// Custom Field Types
export interface CustomField {
  id: number;
  workspace_id: number;
  label: string;
  slug: string;
  field_type: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multiselect' | 'textarea';
  options: string | null;
  is_required: number;
  is_active: number;
  sort_order: number;
  created_at?: string;
}

export interface CustomFieldCreateData {
  workspace_id: number;
  label: string;
  slug: string;
  field_type?: string;
  options?: string | null;
  is_required?: number;
  is_active?: number;
  sort_order?: number;
  created_at?: string;
}

export interface CustomFieldValue {
  id: number;
  lead_id: number;
  field_id: number;
  value: string;
  created_at?: string;
}

export interface CustomFieldExtractedValue {
  field_id: number;
  field_slug: string;
  field_label: string;
  field_type: string;
  value: string;
}

// Source/Webhook Log Types
export interface WebhookLog {
  id: number;
  workspace_id: number;
  lead_id: number;
  source: string;
  source_old: string;
  event_id: string;
  payload: string;
  status: string;
  error?: string | null;
  created_at?: string;
}

// Legacy Source interface (keep for backward compatibility)
export interface Source {
  id: number;
  workspace_id: number;
  source: string;
  event_id: string;
  payload: string;
  status: 'source_registry';
  lead_id?: number;
  created_at?: string;
}

// New source interfaces are imported from './sources' above
// Re-export for convenience
export type {
  SourceType as NormalizedSourceType,
  SourceConfig as NormalizedSourceConfig,
  NormalizedSource,
  SourceRegistryEntry,
  SourceCreateData,
  SourceUpdateData,
  SourceCreateData as NormalizedSourceCreateData,
  SourceUpdateData as NormalizedSourceUpdateData,
} from './sources';

// Legacy SourceCreateData for backward compatibility (will be deprecated)
export interface LegacySourceCreateData {
  workspace_id: number;
  source: string;
  event_id: string;
  payload?: string;
  status?: string;
}

// Legacy SourceUpdateData for backward compatibility (will be deprecated)
export interface LegacySourceUpdateData {
  source: string;
  payload?: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  status: 'success' | 'error' | 'failed';
  data?: T;
  message?: string;
  error?: string;
  id?: number;
  metadata?: {
    total?: number;
    hasMore?: boolean;
    truncated?: boolean;
    unreadCount?: number;
  };
}

export interface AuthResponse {
  success: boolean;
  status: 'success' | 'error';
  data: {
    user: User;
    token: string;
  };
  error?: string;
}

export interface AuthErrorResponse {
  success: false;
  status: 'error';
  error: string;
}

// Extended Request Types with User/Role
export interface AuthenticatedRequest<Params = any, Query = any, Body = any> extends Request<Params, Query, Body> {
  workspacePermissions?: import('./permissions.js').WorkspacePermissions;
  user?: JWTPayload;
  userRole?: WorkspaceRole;
  workspaceAccess?: boolean;
}

// Query/Body Types
export interface LeadsQuery {
  workspace_id: string;
  status_id?: string;
  page?: string;
  limit?: string;
  sort?: string;
  order?: string;
  includeTotal?: string;
  deleted?: string;
  search?: string;
}

export interface WorkspaceQuery {
  owner_id?: string;
}

export interface StatusQuery {
  workspace_id: string;
}

export interface CustomFieldQuery {
  workspace_id: string;
}

export interface DeleteQuery {
  workspace_id?: string;
}

export interface RequestWithQuery {
  email?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface SignupBody {
  name: string;
  email: string;
  password: string;
  accepted_terms: number;
  accepted_terms_at: string;
}

export interface CreateLeadBody extends LeadCreateData {
  [key: string]: any; // Allow custom field keys
}

export interface UpdateLeadBody extends LeadUpdateData {
  [key: string]: any; // Allow custom field keys
}

export interface InviteMemberBody {
  email: string;
  role?: 'admin' | 'manager' | 'member' | 'viewer';
}

export interface UpdateMemberBody {
  workspace_id: number;
  role: 'admin' | 'manager' | 'member' | 'viewer';
}

// Invitation Types
export interface WorkspaceInvitation {
  id: number;
  workspace_id: number;
  email: string;
  token: string;
  invited_by: number;
  status: 'pending' | 'accepted' | 'expired';
  role?: 'admin' | 'manager' | 'member' | 'viewer';
  expires_at: string;
  created_at: string;
}

export interface CreateInvitationBody {
  email: string;
  role?: 'admin' | 'manager' | 'member' | 'viewer';
}

export interface ValidateInvitationResponse {
  valid: boolean;
  workspace?: Workspace;
  workspaceName?: string;
  inviterName?: string;
  email?: string;
  workspaceId?: number;
  expiresAt?: string;
}

export interface CreateActivityBody {
  lead_id: number;
  workspace_id: number;
  user_id: number;
  type: string;
  title: string;
  description: string;
  metadata?: string | ActivityMetadata;
  created_at?: string;
}

export interface UpdateActivityBody {
  title?: string;
  description?: string;
  metadata?: string | ActivityMetadata;
}

// WhatsApp Integration Types
export type WhatsAppTriggerKind =
  | 'new_lead'
  | 'hello_world'
  | 'call_no_answer'
  | 'lead_done'
  | 'bulk_marketing';

export interface WhatsAppWorkspaceConfigMasked {
  workspace_id: number;
  enabled: boolean;
  phone_number_id: string;
  waba_id: string;
  display_phone?: string;
  connected: boolean;
  has_access_token: boolean;
  updated_at: string;
}

export interface WhatsAppTemplateConfig {
  kind: WhatsAppTriggerKind;
  enabled: boolean;
  meta_template_name: string;
  language: string;
  body: string;
  meta_approved: boolean;
  updated_at: string;
}

export interface WhatsAppTriggerConfig {
  workspace_id: number;
  new_lead: boolean;
  call_no_answer: boolean;
  lead_done: boolean;
  done_status_ids: number[];
  done_status_types: Array<'won' | 'closed' | 'lost' | 'open'>;
  no_answer_cooldown_hours: number;
  updated_at: string;
}

export interface WhatsAppCampaignSummary {
  campaignId: string;
  workspaceId: number;
  templateKind: WhatsAppTriggerKind;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  totalRecipients: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchUsersBody {
  email: string;
}

// Email Verification Types
export interface EmailVerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'disposable' | 'spamtrap';
  username: string;
  domain: string;
  is_valid_syntax: boolean;
  is_disposable: boolean;
  is_role_account: boolean;
  mx_accepts_mail: boolean;
  is_spamtrap: boolean;
  is_free_email: boolean;
  mx_records: string[];
  verification_mode: 'quick';
}

export interface EmailVerifierBalance {
  api_status: 'active' | 'inactive';
  remaining_daily_credits: number;
  remaining_instant_credits: number;
  status: 'success' | 'error';
}

// NoCodeBackend API Client Types
export interface ApiClient {
  getLeads(params?: any): Promise<ApiResponse<Lead[]>>;
  getLeadById(id: number): Promise<ApiResponse<Lead>>;
  createLead(data: LeadCreateData): Promise<ApiResponse<Lead>>;
  updateLead(id: number, data: LeadUpdateData): Promise<ApiResponse<Lead>>;
  deleteLead(id: number): Promise<ApiResponse>;
  searchLeads(params: any): Promise<ApiResponse<Lead[]>>;

  getDeals(params?: any): Promise<ApiResponse<Deal[]>>;
  getDealById(id: number): Promise<ApiResponse<Deal>>;
  createDeal(data: DealCreateData): Promise<ApiResponse<Deal>>;
  updateDeal(id: number, data: DealUpdateData): Promise<ApiResponse<Deal>>;
  deleteDeal(id: number): Promise<ApiResponse>;
  
  getStatuses(workspaceId: number): Promise<ApiResponse<LeadStatus[]>>;
  getStatusById(id: number): Promise<ApiResponse<LeadStatus>>;
  createStatus(data: LeadStatusCreateData): Promise<ApiResponse<LeadStatus>>;
  updateStatus(id: number, data: Partial<LeadStatus>): Promise<ApiResponse<LeadStatus>>;
  deleteStatus(id: number): Promise<ApiResponse>;
  
  getActivities(leadId: number): Promise<ApiResponse<LeadActivity[]>>;
  createActivity(data: LeadActivity): Promise<ApiResponse<LeadActivity>>;
  updateActivity(id: number, data: Partial<LeadActivity>): Promise<ApiResponse<LeadActivity>>;
  deleteActivity(id: number): Promise<ApiResponse>;
  
  getCustomFields(workspaceId: number): Promise<ApiResponse<CustomField[]>>;
  getCustomFieldValues(leadId: number): Promise<ApiResponse<CustomFieldValue[]>>;
  createCustomField(data: CustomFieldCreateData): Promise<ApiResponse<CustomField>>;
  updateCustomField(id: number, data: Partial<CustomField>): Promise<ApiResponse<CustomField>>;
  deleteCustomField(id: number): Promise<ApiResponse>;
  createCustomFieldValue(data: { lead_id: number; field_id: number; value: string }): Promise<ApiResponse<CustomFieldValue>>;
  updateCustomFieldValue(id: number, data: Partial<CustomFieldValue>): Promise<ApiResponse<CustomFieldValue>>;
  deleteCustomFieldValue(id: number): Promise<ApiResponse>;
  
  getUsers(): Promise<ApiResponse<User[]>>;
  getUserById(id: number): Promise<ApiResponse<User>>;
  searchUserByEmail(email: string): Promise<ApiResponse<User[]>>;
  createUser(data: { name: string; email: string; password: string }): Promise<ApiResponse<User>>;
  
  getWorkspaces(params?: any): Promise<ApiResponse<Workspace[]>>;
  getWorkspaceById(id: number, bypassCache?: boolean): Promise<ApiResponse<Workspace>>;
  createWorkspace(data: Partial<Workspace>): Promise<ApiResponse<Workspace>>;
  updateWorkspace(id: number, data: Partial<Workspace>): Promise<ApiResponse<Workspace>>;
  
  getWorkspaceMembers(workspaceId: number): Promise<ApiResponse<WorkspaceMember[]>>;
  getWorkspaceMemberById(id: number): Promise<ApiResponse<WorkspaceMember>>;
  addWorkspaceMember(data: { workspace_id: number; user_id: number; role: string; created_at: string }): Promise<ApiResponse<WorkspaceMember>>;
  updateWorkspaceMember(id: number, data: Partial<WorkspaceMember>): Promise<ApiResponse<WorkspaceMember>>;
  deleteWorkspaceMember(id: number): Promise<ApiResponse>;
  
  getWebhookLogs(params?: any): Promise<ApiResponse<WebhookLog[]>>;
  createWebhookLog(data: WebhookLog): Promise<ApiResponse<WebhookLog>>;
  updateWebhookLog(id: number, data: Partial<WebhookLog>): Promise<ApiResponse<WebhookLog>>;
  deleteWebhookLog(id: number): Promise<ApiResponse>;

  getNotifications(params?: any): Promise<ApiResponse<Notification[]>>;
  getNotificationById(id: number): Promise<ApiResponse<Notification>>;
  createNotification(data: NotificationCreateData): Promise<ApiResponse<Notification>>;
  updateNotification(id: number, data: NotificationUpdateData): Promise<ApiResponse<Notification>>;
}


export interface AiChatMessage {
  id: string;
  role: import('./constants.js').AiRole;
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  timestamp?: string;
}

export interface AiChatRequestBody {
  session_id?: string;
  workspace_id: number;
  message: string;
  history?: AiChatMessage[];
}

export interface AiActionTicket {
  ticket_id: string;
  workspace_id: number;
  user_id: number;
  tool_name: import('./constants.js').McpCrmToolName;
  params: Record<string, any>;
  summary: string;
  expires_at: number;
  status: import('./constants.js').AiActionStatus;
}

export interface AiConfirmActionRequestBody {
  ticket_id: string;
  confirmed: boolean;
}

export interface McpToolExecutionContext {
  workspace_id: number;
  user_id: number;
  user_role?: import('./constants.js').WorkspaceRole;
}

export interface McpToolDefinition {
  name: import('./constants.js').McpCrmToolName;
  description: string;
  security_level: import('./constants.js').McpSecurityLevel;
  input_schema: Record<string, any>;
  execute: (context: McpToolExecutionContext, params: any) => Promise<any>;
}

export interface WorkspaceMcpToken {
  id: number;
  workspace_id: number;
  user_id: number;
  name: string;
  token_prefix: string;
  token_hash: string;
  active: boolean;
  created_at: string;
  last_used_at?: string | null;
}
