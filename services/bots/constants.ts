import { AUTOMATION_TRIGGERS, type AutomationConditions, type AutomationTrigger } from '../automations/constants.js';

export const BOT_TRIGGERS = AUTOMATION_TRIGGERS;
export type BotTrigger = AutomationTrigger;

export const HANDLER_TYPES = ['show', 'action', 'condition', 'goto', 'wait_answer', 'stop'] as const;
export type HandlerType = (typeof HANDLER_TYPES)[number];

export const ACTION_NAMES = [
  'move_stage',
  'add_tags',
  'remove_tags',
  'assign_owner',
  'create_task',
  'send_email',
  'send_whatsapp',
  'send_webhook',
  'notify_user',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export const CONDITION_OPERATIONS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'lt',
  'is_empty',
  'is_not_empty',
] as const;
export type ConditionOperation = (typeof CONDITION_OPERATIONS)[number];

export const BOT_RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  DONE: 'done',
  FAILED: 'failed',
  STOPPED: 'stopped',
} as const;
export type BotRunStatus = (typeof BOT_RUN_STATUS)[keyof typeof BOT_RUN_STATUS];

export const BLOCK_TYPES = ['question', 'answer', 'finish'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BOT_ENTITY_TYPES = ['deal', 'conversation'] as const;
export type BotEntityType = (typeof BOT_ENTITY_TYPES)[number];

export const STOP_ACTIONS = { CLOSE: 'talk-close', START_BOT: 'salesbot-start' } as const;
export const START_BOT_PREFIX = 'bot:';
export const DEPTH_VAR = '__depth';

export const MAX_SCRIPT_BYTES = 65536;
export const MAX_STEP_ITERATIONS = 200;
export const MAX_BOT_DEPTH = 3;

export const BOT_RUN_MAX_ATTEMPTS = 5;
export const BOT_RUN_BATCH_SIZE = 10;
export const BOT_RUN_LIST_LIMIT = 50;
export const BOTS_CACHE_MS = 30_000;
export const BOT_STALE_RUN_MS = 10 * 60_000;
export const BOT_RETRY_BASE_MS = 30_000;
export const BOT_RETRY_MAX_MS = 30 * 60_000;
export const MINUTE_MS = 60_000;

export interface Handler {
  handler: HandlerType;
  params: Record<string, any>;
}

export interface Step {
  question?: Handler[];
  answer?: Handler[];
  finish?: Handler[];
}

export interface Bot {
  id: number;
  workspace_id: number;
  name: string;
  active: boolean;
  sort_order: number;
  trigger_type: BotTrigger;
  pipeline_slug: string;
  stage: string;
  conditions: AutomationConditions;
  script: Step[];
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface BotCursor {
  block: BlockType;
  step: number;
  vars: Record<string, unknown>;
}

export interface BotRun {
  id: number;
  workspace_id: number;
  bot_id: number;
  entity_type: string;
  entity_id: number;
  conversation_id: number;
  status: BotRunStatus;
  cursor: BotCursor;
  attempts: number;
  claim_id: string;
  run_at: string;
  result?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
}
