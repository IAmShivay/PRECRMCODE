import type { WorkspaceRole } from '../types/constants.js';
// API Configuration
export const API_BASE_URL = 'https://api.nocodebackend.com';
export const API_INSTANCE = '54182_scraft_crm_database';

// Import normalized source types
export type {
  SourceType,
  SourceConfig,
  SourceCategory,
} from '../types/sources.js';

// Lead Types
export interface Lead {
  id: number;
  workspace_id: number;
  status_id: number;
  name: string;
  email: string;
  phone: string;
  source_old: string; // Normalized SourceType as string
  source_ref?: string;
  source_id?: string; // Registry source ID
  user_id?: number | null;
  email_valid: number; // 0 or 1
  phone_valid: number; // 0 or 1
  email_verified_at?: string;
  email_verification_status?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CreateLeadRequest {
  workspace_id: number;
  status_id: number;
  name: string;
  email: string;
  phone: string;
  source_old: string; // Normalized SourceType as string
  source_ref?: string;
  source_id?: string; // Registry source ID
}

export interface UpdateLeadRequest {
  workspace_id?: number;
  status_id?: number;
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  source_ref?: string;
}

// Lead Status Types
export interface LeadStatus {
  id: number;
  workspace_id: number;
  name: string;
  slug: string;
  color: string;
  order_index: number;
  type: 'open' | 'closed_won' | 'closed_lost';
  is_default: number; // 0 or 1
  is_active: number; // 0 or 1
  is_qualified: number; // 0 or 1
  created_at: string;
  updated_at: string;
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
  metadata?: string;
  created_at: string;
  actor_name?: string;
  actor_role?: WorkspaceRole;
}

export interface AppNotification {
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
}

// Lead Custom Field Types
export interface LeadCustomField {
  id: number;
  workspace_id: number;
  label: string;
  slug: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'textarea';
  options?: string;
  is_required: number; // 0 or 1
  is_active: number; // 0 or 1
  sort_order: number;
  created_at: string;
}

export interface LeadCustomFieldValue {
  id: number;
  lead_id: number;
  field_id: number;
  value: string;
  created_at: string;
}

// User Types
export interface User {
  id: number;
  name: string;
  email: string;
  password?: string;
  created_at: string;
  accepted_terms?: number;
  accepted_terms_at?: string;
}

// Workspace Types
export interface Workspace {
  id: number;
  owner_id: number;
  name: string;
  currency?: string;
  created_at: string;
}

export interface WorkspaceMember {
  permissions?: import('../types/permissions').WorkspacePermissions;
  id: number;
  workspace_id: number;
  user_id: number;
  role: WorkspaceRole;
  created_at: string;
}

// Webhook Types
export interface LeadWebhookLog {
  id: number;
  workspace_id: number;
  lead_id: number;
  source: string;
  event_id: string;
  payload: string;
  status: 'success' | 'failed' | 'pending';
  error?: string;
  created_at: string;
}

export type DealStage = string;
export type { DealCustomField, DealFieldType, DealFieldValues } from '../types/dealFields.js';

export interface DealStageConfig {
  slug: string;
  name: string;
  color: string;
  counts_as_conversion: boolean;
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

export interface Deal {
  custom_fields?: import('../types/dealFields').DealFieldValues;
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
  priority?: 'low' | 'medium' | 'high' | string;
  lead_id?: number;
  created_at?: string;
  updated_at?: string;
  won_at?: string;
  converted_at?: string;
}

export type { WebFormDealFieldMap, WebFormDealMapping } from '../types/webFormDeals.js';

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

// API Response Types
export interface ApiResponse<T> {
  status: string;
  data: T;
  message?: string;
  id?: number;
  metadata?: {
    total?: number;
    hasMore?: boolean;
    unreadCount?: number;
  };
}

export interface PaginatedResponse<T> {
  status: string;
  data: T[];
  total?: number;
  totalPages?: number;
}

// Auth Types
export interface AuthSession {
  user: User | null;
  workspaces: Workspace[];
  currentWorkspaceId: number | null;
}

export class ApiError extends Error {
  public status: number;
  constructor(message: string, status: number = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Extended User type with password (for internal use)
export interface UserWithPassword extends User {
  password?: string;
}

// Validation Types
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// API Client Types
export interface CreateUserRequest {
  name: string;
  email: string;
  password?: string;
  created_at: string;
}

export interface CreateUserResponse {
  status: string;
  id: number;
}

export interface SearchUserRequest {
  email: string;
}

export interface SearchUserResponse {
  status: string;
  data: UserWithPassword[];
}

export interface CreateWorkspaceRequest {
  owner_id: number;
  name: string;
  currency?: string;
  created_at: string;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  currency?: string;
}

export interface CreateWorkspaceResponse {
  status: string;
  id: number;
}

export interface ReadWorkspaceResponse {
  status: string;
  data: Workspace[];
}

export interface CreateWorkspaceMemberRequest {
  workspace_id: number;
  user_id: number;
  role: string;
  created_at: string;
}

export interface CreateWorkspaceMemberResponse {
  status: string;
  id: number;
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

export interface WhatsAppMessageLogEntry {
  id: number;
  lead_id: number;
  workspace_id: number;
  created_at: string;
  to_phone?: string;
  trigger_kind?: string;
  template_name?: string;
  delivery_status?: string;
  error?: string;
  campaign_id?: string;
}


export interface AiChatMessage {
  id: string;
  role: import('../types/constants.js').AiRole;
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  timestamp?: string;
  actionTicket?: AiActionTicket;
}

export interface AiActionTicket {
  ticket_id: string;
  workspace_id: number;
  user_id: number;
  tool_name: import('../types/constants.js').McpCrmToolName;
  params: Record<string, any>;
  summary: string;
  expires_at: number;
  status: import('../types/constants.js').AiActionStatus;
}

export interface AiStreamEvent {
  type: import('../types/constants.js').AiStreamEventType;
  text?: string;
  tool?: string;
  input?: any;
  result?: any;
  ticket?: AiActionTicket;
  message?: string;
}

export interface WorkspaceMcpToken {
  id: number;
  workspace_id: number;
  name: string;
  token_prefix: string;
  active: boolean;
  created_at: string;
  last_used_at?: string | null;
}
