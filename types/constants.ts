export const ROLE_OWNER = 'owner';
export const ROLE_ADMIN = 'admin';
export const ROLE_MANAGER = 'manager';
export const ROLE_MEMBER = 'member';
export const ROLE_VIEWER = 'viewer';

export const ROLE_LABEL_ADMIN = 'Admin';
export const ROLE_LABEL_MANAGER = 'Manager';
export const ROLE_LABEL_MEMBER = 'Member';
export const ROLE_LABEL_VIEWER = 'Viewer';

export const WORKSPACE_ROLES = [ROLE_OWNER, ROLE_ADMIN, ROLE_MANAGER, ROLE_MEMBER, ROLE_VIEWER] as const;
export type WorkspaceRole = typeof WORKSPACE_ROLES[number];

export const MEMBER_ROLES = [ROLE_ADMIN, ROLE_MANAGER, ROLE_MEMBER, ROLE_VIEWER] as const;
export type MemberRole = typeof MEMBER_ROLES[number];

export const DEALS_PERM_NONE = 'none';
export const DEALS_PERM_VIEW = 'view';
export const DEALS_PERM_EDIT = 'edit';

export const DEALS_PERMISSIONS = [DEALS_PERM_NONE, DEALS_PERM_VIEW, DEALS_PERM_EDIT] as const;
export type DealsPermission = typeof DEALS_PERMISSIONS[number];

export const DEALS_SCOPE_ASSIGNED = 'assigned_only';
export const DEALS_SCOPE_ALL = 'all';

export const DEALS_SCOPES = [DEALS_SCOPE_ASSIGNED, DEALS_SCOPE_ALL] as const;
export type DealsScope = typeof DEALS_SCOPES[number];

export const CONV_PERM_NONE = 'none';
export const CONV_PERM_VIEW = 'view';
export const CONV_PERM_REPLY = 'reply';

export const CONVERSATIONS_PERMISSIONS = [CONV_PERM_NONE, CONV_PERM_VIEW, CONV_PERM_REPLY] as const;
export type ConversationsPermission = typeof CONVERSATIONS_PERMISSIONS[number];

export const PIPELINES_ALL = 'all';

export const DEAL_PRIORITIES = ['low', 'medium', 'high'] as const;
export type DealPriority = typeof DEAL_PRIORITIES[number];

export const PIPELINE_STATUS_TYPES = ['open', 'closed', 'won', 'lost'] as const;
export type PipelineStatusType = typeof PIPELINE_STATUS_TYPES[number];

export const CURRENCIES = ['INR', 'USD', 'AED', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD', 'SAR', 'QAR'] as const;
export type Currency = typeof CURRENCIES[number];

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'checkbox', 'select', 'multiselect', 'textarea', 'email', 'phone'] as const;
export type CustomFieldType = typeof CUSTOM_FIELD_TYPES[number];

export const DEAL_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'email', 'phone', 'select'] as const;
export type DealFieldType = typeof DEAL_FIELD_TYPES[number];

export const DEAL_ASSOCIATION_TYPES = ['related', 'parent_child', 'blocked_by'] as const;
export type DealAssociationType = typeof DEAL_ASSOCIATION_TYPES[number];

export const DEFAULT_PIPELINE_SLUG = 'default';

export const DEAL_STATUS = 'deal';
export const DEAL_SOURCE = 'deal';
export const DEAL_PIPELINE_STATUS = 'deal_pipeline';
export const DEAL_STAGE_WON = 'won';
export const DEFAULT_DEAL_STAGE_SLUG = 'new_lead';

export const WEB_FORM_MAPPING_STATUS = 'web_form_mapping';
export const WEB_FORM_DEAL_LOG_STATUS = 'web_form_deal';
export const WEB_FORM_MAPPING_EVENT_PREFIX = 'wfm_';
export const WEB_FORM_DEAL_EVENT_PREFIX = 'deal_wf_';

export const WEB_FORM_FIELD_LEAD_NAME = 'lead.name';
export const WEB_FORM_FIELD_LEAD_EMAIL = 'lead.email';
export const WEB_FORM_FIELD_LEAD_PHONE = 'lead.phone';

export const WEB_FORM_MAPPING_FIELD_KEYS = [
  'name',
  'contact',
  'value',
  'priority',
  'expected_close_date',
] as const;

export const DEAL_DOCUMENT_DEFAULT_KINDS = ['MOU', 'Quotation', 'NDA', 'Contract'] as const;
export type DealDocumentDefaultKind = typeof DEAL_DOCUMENT_DEFAULT_KINDS[number];

export const AI_ROLE_USER = 'user';
export const AI_ROLE_MODEL = 'model';
export const AI_ROLE_ASSISTANT = 'assistant';
export const AI_ROLE_SYSTEM = 'system';
export const AI_ROLE_TOOL = 'tool';
export const AI_ROLES = [AI_ROLE_USER, AI_ROLE_MODEL, AI_ROLE_ASSISTANT, AI_ROLE_SYSTEM, AI_ROLE_TOOL] as const;
export type AiRole = typeof AI_ROLES[number];

export const AI_EVENT_DELTA = 'delta';
export const AI_EVENT_TOOL_START = 'tool_start';
export const AI_EVENT_TOOL_END = 'tool_end';
export const AI_EVENT_ACTION_REQUIRED = 'action_required';
export const AI_EVENT_ERROR = 'error';
export const AI_EVENT_DONE = 'done';
export const AI_STREAM_EVENT_TYPES = [
  AI_EVENT_DELTA,
  AI_EVENT_TOOL_START,
  AI_EVENT_TOOL_END,
  AI_EVENT_ACTION_REQUIRED,
  AI_EVENT_ERROR,
  AI_EVENT_DONE,
] as const;
export type AiStreamEventType = typeof AI_STREAM_EVENT_TYPES[number];

export const AI_ACTION_STATUS_PENDING = 'pending';
export const AI_ACTION_STATUS_CONFIRMED = 'confirmed';
export const AI_ACTION_STATUS_REJECTED = 'rejected';
export const AI_ACTION_STATUS_EXPIRED = 'expired';
export const AI_ACTION_STATUSES = [
  AI_ACTION_STATUS_PENDING,
  AI_ACTION_STATUS_CONFIRMED,
  AI_ACTION_STATUS_REJECTED,
  AI_ACTION_STATUS_EXPIRED,
] as const;
export type AiActionStatus = typeof AI_ACTION_STATUSES[number];

export const MCP_SECURITY_READ_ONLY = 'read_only';
export const MCP_SECURITY_MUTATING_LOW = 'mutating_low';
export const MCP_SECURITY_MUTATING_HIGH = 'mutating_high';
export const MCP_SECURITY_LEVELS = [
  MCP_SECURITY_READ_ONLY,
  MCP_SECURITY_MUTATING_LOW,
  MCP_SECURITY_MUTATING_HIGH,
] as const;
export type McpSecurityLevel = typeof MCP_SECURITY_LEVELS[number];

export const MCP_TOOL_SEARCH_LEADS = 'search_leads';
export const MCP_TOOL_GET_LEAD_DETAILS = 'get_lead_details';
export const MCP_TOOL_CREATE_LEAD = 'create_lead';
export const MCP_TOOL_UPDATE_LEAD = 'update_lead';
export const MCP_TOOL_SEARCH_DEALS = 'search_deals';
export const MCP_TOOL_GET_PIPELINE_SUMMARY = 'get_pipeline_summary';
export const MCP_TOOL_CREATE_DEAL = 'create_deal';
export const MCP_TOOL_MOVE_DEAL_STAGE = 'move_deal_stage';
export const MCP_TOOL_VERIFY_EMAIL = 'verify_email';
export const MCP_TOOL_SEND_WHATSAPP_MESSAGE = 'send_whatsapp_message';
export const MCP_TOOL_LOG_ACTIVITY = 'log_activity';
export const MCP_TOOL_SEARCH_CUSTOMERS = 'search_customers';
export const MCP_TOOL_GET_CUSTOMER_DETAILS = 'get_customer_details';
export const MCP_TOOL_GET_DEAL_ASSOCIATIONS = 'get_deal_associations';
export const MCP_TOOL_LIST_PIPELINE_STAGES = 'list_pipeline_stages';
export const MCP_TOOL_LIST_CUSTOM_FIELDS = 'list_custom_fields';
export const MCP_TOOL_LIST_NOTIFICATIONS = 'list_notifications';

export const MCP_CRM_TOOL_NAMES = [
  MCP_TOOL_SEARCH_LEADS,
  MCP_TOOL_GET_LEAD_DETAILS,
  MCP_TOOL_CREATE_LEAD,
  MCP_TOOL_UPDATE_LEAD,
  MCP_TOOL_SEARCH_DEALS,
  MCP_TOOL_GET_PIPELINE_SUMMARY,
  MCP_TOOL_CREATE_DEAL,
  MCP_TOOL_MOVE_DEAL_STAGE,
  MCP_TOOL_VERIFY_EMAIL,
  MCP_TOOL_SEND_WHATSAPP_MESSAGE,
  MCP_TOOL_LOG_ACTIVITY,
  MCP_TOOL_SEARCH_CUSTOMERS,
  MCP_TOOL_GET_CUSTOMER_DETAILS,
  MCP_TOOL_GET_DEAL_ASSOCIATIONS,
  MCP_TOOL_LIST_PIPELINE_STAGES,
  MCP_TOOL_LIST_CUSTOM_FIELDS,
  MCP_TOOL_LIST_NOTIFICATIONS,
] as const;
export type McpCrmToolName = typeof MCP_CRM_TOOL_NAMES[number];

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
] as const;
export type GroqModel = typeof GROQ_MODELS[number];

export const DEFAULT_GROK_MODEL = 'grok-2-latest';
export const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
export const GROK_MODELS = [
  'grok-2-latest',
  'grok-2',
  'grok-beta',
] as const;
export type GrokModel = typeof GROK_MODELS[number];

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const AI_CONFIRMATION_TICKET_EXPIRY_MS = 300000;
export const MCP_TOKEN_PREFIX = 'scraft_mcp_';
export const MCP_SERVER_NAME = 'scraft-crm';
export const MCP_SERVER_VERSION = '1.0.0';
export const MCP_DEFAULT_SSE_ENDPOINT = '/api/mcp/sse';
export const MCP_DEFAULT_MESSAGES_ENDPOINT = '/api/mcp/messages';

export const MCP_RATE_LIMIT_GLOBAL_PER_MINUTE = 60;
export const MCP_RATE_LIMIT_EMAIL_VERIFY_PER_MINUTE = 10;
export const MCP_RATE_LIMIT_WHATSAPP_PER_MINUTE = 5;
