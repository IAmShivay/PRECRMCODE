import type { AutomationRule } from '../automations/constants.js';
import { render, runAction, SkipRun, type ActionContext } from '../automations/actions.js';
import type { DealSnapshot } from '../automations/dealOps.js';
import {
  ACTION_NAMES,
  BLOCK_TYPES,
  START_BOT_PREFIX,
  STOP_ACTIONS,
  type ActionName,
  type BlockType,
  type Bot,
  type ConditionOperation,
  type Handler,
  type HandlerType,
} from './constants.js';

export interface BotContext {
  bot: Bot;
  deal: DealSnapshot | null;
  lead: any | null;
  depth: number;
  vars: Record<string, unknown>;
}

export interface HandlerResult {
  log?: string;
  goto?: { block: BlockType; step: number };
  stop?: boolean;
  wait?: boolean;
  nested?: Handler[];
  launchBotId?: number;
}

function actionContext(ctx: BotContext, actionType: ActionName, config: Record<string, any>): ActionContext {
  const rule: AutomationRule = {
    id: ctx.bot.id,
    workspace_id: ctx.bot.workspace_id,
    pipeline_slug: ctx.bot.pipeline_slug,
    stage: ctx.bot.stage,
    name: ctx.bot.name,
    trigger_type: ctx.bot.trigger_type,
    conditions: ctx.bot.conditions,
    delay_minutes: 0,
    action_type: actionType,
    action_config: config,
    active: ctx.bot.active,
    sort_order: ctx.bot.sort_order,
    created_by: ctx.bot.created_by,
  };
  return { rule, deal: ctx.deal, lead: ctx.lead, depth: ctx.depth };
}

function compare(a: string, b: string, operation: ConditionOperation): boolean {
  switch (operation) {
    case 'equals':
      return a === b;
    case 'not_equals':
      return a !== b;
    case 'contains':
      return a.toLowerCase().includes(b.toLowerCase());
    case 'not_contains':
      return !a.toLowerCase().includes(b.toLowerCase());
    case 'gt':
      return Number(a) > Number(b);
    case 'lt':
      return Number(a) < Number(b);
    case 'is_empty':
      return a.trim() === '';
    case 'is_not_empty':
      return a.trim() !== '';
    default:
      return false;
  }
}

async function show(ctx: BotContext, params: Record<string, any>): Promise<HandlerResult> {
  const text = render(params.text, actionContext(ctx, 'notify_user', {}));
  return { log: `show: ${text.slice(0, 200)}` };
}

async function action(ctx: BotContext, params: Record<string, any>): Promise<HandlerResult> {
  const name = String(params.action || '') as ActionName;
  if (!(ACTION_NAMES as readonly string[]).includes(name)) throw new SkipRun(`Unknown action ${name}`);
  const config = params.config && typeof params.config === 'object' ? (params.config as Record<string, any>) : {};
  const result = await runAction(actionContext(ctx, name, config));
  return { log: `${name}: ${result}` };
}

async function condition(ctx: BotContext, params: Record<string, any>): Promise<HandlerResult> {
  const renderCtx = actionContext(ctx, 'notify_user', {});
  const term1 = render(params.term1, renderCtx);
  const term2 = render(params.term2, renderCtx);
  const operation = String(params.operation || 'equals') as ConditionOperation;
  const met = compare(term1, term2, operation);
  const nested = met && Array.isArray(params.result) ? (params.result as Handler[]) : undefined;
  return { log: `condition ${operation}: ${met ? 'met' : 'not met'}`, nested };
}

async function goto(_ctx: BotContext, params: Record<string, any>): Promise<HandlerResult> {
  const step = Math.max(0, Number(params.step) || 0);
  const requested = String(params.block || 'question');
  const block = (BLOCK_TYPES as readonly string[]).includes(requested) ? (requested as BlockType) : 'question';
  return { goto: { block, step }, log: `goto ${block}/${step}` };
}

async function waitAnswer(_ctx: BotContext, _params: Record<string, any>): Promise<HandlerResult> {
  return { wait: true, log: 'wait_answer: paused for a reply' };
}

async function stop(_ctx: BotContext, params: Record<string, any>): Promise<HandlerResult> {
  const stopAction = String(params.action || STOP_ACTIONS.CLOSE);
  if (stopAction === STOP_ACTIONS.START_BOT) {
    const raw = String(params.target || params.bot_id || '');
    const matched = raw.startsWith(START_BOT_PREFIX) ? raw.slice(START_BOT_PREFIX.length) : raw;
    const botId = Number(matched) || 0;
    return { stop: true, launchBotId: botId || undefined, log: `stop → start ${START_BOT_PREFIX}${botId}` };
  }
  return { stop: true, log: `stop (${stopAction})` };
}

export const handlers: Record<HandlerType, (ctx: BotContext, params: Record<string, any>) => Promise<HandlerResult>> = {
  show,
  action,
  condition,
  goto,
  wait_answer: waitAnswer,
  stop,
};
