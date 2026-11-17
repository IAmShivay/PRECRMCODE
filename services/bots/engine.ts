import { botRunsApi } from '../api.js';
import { ANY_STAGE, TRIGGER_EVENTS, type AutomationEvent } from '../automations/constants.js';
import {
  BOT_ENTITY_TYPES,
  BOT_RUN_STATUS,
  DEPTH_VAR,
  MAX_BOT_DEPTH,
  type Bot,
  type BotCursor,
  type BotEntityType,
} from './constants.js';
import { createdIdOf, listWorkspaceBots, nowSql } from './store.js';

let kickRunner: (() => void) | null = null;

export function registerBotRunKicker(fn: () => void) {
  kickRunner = fn;
}

function matches(bot: Bot, event: AutomationEvent): boolean {
  if (!bot.active) return false;
  if (!TRIGGER_EVENTS[bot.trigger_type].includes(event.type)) return false;
  if (event.type === 'lead_created') return true;
  if ((event.pipelineSlug || 'default') !== bot.pipeline_slug) return false;
  return bot.stage === ANY_STAGE || bot.stage === event.stage;
}

function startCursor(depth: number): BotCursor {
  return { block: 'question', step: 0, vars: { [DEPTH_VAR]: depth } };
}

export async function createBotRun(params: {
  workspaceId: number;
  botId: number;
  entityType: BotEntityType;
  entityId: number;
  cursor?: BotCursor;
  depth?: number;
}): Promise<number> {
  const now = nowSql();
  const created: any = await botRunsApi.create({
    workspace_id: params.workspaceId,
    bot_id: params.botId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    conversation_id: 0,
    status: BOT_RUN_STATUS.PENDING,
    cursor: JSON.stringify(params.cursor || startCursor(params.depth || 0)),
    attempts: 0,
    claim_id: '',
    run_at: now,
    result: '',
    error: '',
    created_at: now,
    updated_at: now,
  });
  return createdIdOf(created);
}

/** Fire-and-forget: launches every bot whose trigger matches a deal event. Never throws. */
export function maybeLaunchBotsForEvent(event: AutomationEvent): void {
  if (!event.workspaceId || !event.dealId || (event.depth || 0) > MAX_BOT_DEPTH) return;
  void (async () => {
    try {
      const bots = (await listWorkspaceBots(event.workspaceId)).filter((bot) => matches(bot, event));
      if (bots.length === 0) return;
      await Promise.all(
        bots.map((bot) =>
          createBotRun({
            workspaceId: event.workspaceId,
            botId: bot.id,
            entityType: BOT_ENTITY_TYPES[0],
            entityId: event.dealId as number,
            depth: event.depth || 0,
          })
        )
      );
      kickRunner?.();
    } catch (error) {
      console.error('[Bots] Could not launch bots for event', event.type, (error as Error)?.message || error);
    }
  })();
}
