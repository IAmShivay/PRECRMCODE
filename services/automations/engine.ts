import { automationRunsApi } from '../api.js';
import { formatMySqlDateTimeUtc } from '../../lib/validation.js';
import {
  ANY_STAGE,
  MAX_CHAIN_DEPTH,
  MINUTE_MS,
  RUN_STATUS,
  TRIGGER_EVENTS,
  type AutomationEvent,
  type AutomationRule,
} from './constants.js';
import { listWorkspaceRules, nowSql } from './store.js';
import { maybeLaunchBotsForEvent } from '../bots/engine.js';

let kickRunner: (() => void) | null = null;

export function registerRunKicker(fn: () => void) {
  kickRunner = fn;
}

function matches(rule: AutomationRule, event: AutomationEvent): boolean {
  if (!rule.active) return false;
  if (!TRIGGER_EVENTS[rule.trigger_type].includes(event.type)) return false;
  if (event.type === 'lead_created') return true;
  if ((event.pipelineSlug || 'default') !== rule.pipeline_slug) return false;
  return rule.stage === ANY_STAGE || rule.stage === event.stage;
}

async function enqueue(rule: AutomationRule, event: AutomationEvent) {
  const now = nowSql();
  const runAt = formatMySqlDateTimeUtc(new Date(Date.now() + rule.delay_minutes * MINUTE_MS));
  await automationRunsApi.create({
    workspace_id: event.workspaceId,
    automation_id: rule.id,
    deal_id: event.dealId || 0,
    lead_id: event.leadId || 0,
    event_type: event.type,
    status: RUN_STATUS.PENDING,
    run_at: runAt,
    attempts: 0,
    claim_id: '',
    result: '',
    error: '',
    context: JSON.stringify({
      stage: event.stage || '',
      previous_stage: event.previousStage || '',
      pipeline_slug: event.pipelineSlug || '',
      depth: event.depth || 0,
    }),
    created_at: now,
    updated_at: now,
  });
}

/** Fire-and-forget: queues a run for every matching rule. Never throws. */
export function emitAutomationEvent(event: AutomationEvent): void {
  if (!event.workspaceId || (event.depth || 0) > MAX_CHAIN_DEPTH) return;
  maybeLaunchBotsForEvent(event);
  void (async () => {
    try {
      const rules = (await listWorkspaceRules(event.workspaceId)).filter((rule) => matches(rule, event));
      if (rules.length === 0) return;
      await Promise.all(rules.map((rule) => enqueue(rule, event)));
      if (rules.some((rule) => rule.delay_minutes === 0)) kickRunner?.();
    } catch (error) {
      console.error('[Automations] Could not queue event', event.type, (error as Error)?.message || error);
    }
  })();
}
