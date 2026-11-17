export const AUTOMATION_TRIGGERS = [
  'deal_created',
  'deal_moved',
  'deal_created_or_moved',
  'deal_owner_changed',
  'lead_created',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_ACTIONS = [
  'send_email',
  'send_whatsapp',
  'move_stage',
  'assign_owner',
  'add_tags',
  'remove_tags',
  'create_task',
  'notify_user',
  'send_webhook',
] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export type AutomationEventType = 'deal_created' | 'deal_moved' | 'deal_owner_changed' | 'lead_created';

export const TRIGGER_EVENTS: Record<AutomationTrigger, AutomationEventType[]> = {
  deal_created: ['deal_created'],
  deal_moved: ['deal_moved'],
  deal_created_or_moved: ['deal_created', 'deal_moved'],
  deal_owner_changed: ['deal_owner_changed'],
  lead_created: ['lead_created'],
};

export const RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export const TASK_STATUS = { OPEN: 'open', DONE: 'done' } as const;
export const TASK_TYPES = ['follow_up', 'call', 'meeting', 'email', 'other'] as const;

export const ANY_STAGE = '';
export const OWNER_TARGET = 'owner';
export const MAX_CHAIN_DEPTH = 3;
export const RUN_MAX_ATTEMPTS = 5;
export const RUN_BATCH_SIZE = 10;
export const RUN_LIST_LIMIT = 50;
export const RULES_CACHE_MS = 30_000;
export const STALE_RUN_MS = 10 * 60_000;
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 30 * 60_000;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const MAX_DELAY_MINUTES = 60 * 24 * 365;
export const MINUTE_MS = 60_000;

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
  id: number;
  workspace_id: number;
  pipeline_slug: string;
  stage: string;
  name: string;
  trigger_type: AutomationTrigger;
  conditions: AutomationConditions;
  delay_minutes: number;
  action_type: AutomationAction;
  action_config: Record<string, any>;
  active: boolean;
  sort_order: number;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AutomationEvent {
  workspaceId: number;
  type: AutomationEventType;
  dealId?: number;
  leadId?: number;
  pipelineSlug?: string;
  stage?: string;
  previousStage?: string;
  depth?: number;
}
