import crypto from 'crypto';
import { automationRunsApi, automationsApi } from '../api.js';
import { formatMySqlDateTimeUtc } from '../../lib/validation.js';
import {
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  RUN_BATCH_SIZE,
  RUN_LIST_LIMIT,
  RUN_MAX_ATTEMPTS,
  RUN_STATUS,
  STALE_RUN_MS,
  type AutomationConditions,
} from './constants.js';
import { runAction, SkipRun, type ActionContext } from './actions.js';
import { loadDeal, loadLead, type DealSnapshot } from './dealOps.js';
import { registerRunKicker } from './engine.js';
import { nowSql, parseJsonObject, parseSqlDate, toRule } from './store.js';

let running = false;
let kickAgain = false;
let workerId = `automation-${process.pid}`;
let lastCycleError = '';
let lastCycleErrorAt = 0;
const ERROR_LOG_INTERVAL_MS = 10 * 60_000;

const rowsOf = (res: any): any[] => (res?.status === 'success' && Array.isArray(res.data) ? res.data : []);

function conditionsMet(conditions: AutomationConditions, deal: DealSnapshot | null, lead: any | null): string | null {
  const value = deal?.value ?? 0;
  if (conditions.min_value != null && value < Number(conditions.min_value)) return `Value below ${conditions.min_value}`;
  if (conditions.max_value != null && value > Number(conditions.max_value)) return `Value above ${conditions.max_value}`;
  const ownerId = deal?.ownerId ?? (Number(lead?.user_id) || null);
  if (conditions.owner_ids?.length && !conditions.owner_ids.map(Number).includes(Number(ownerId))) return 'Owner does not match';
  const tags = (deal?.tags || []).map((tag) => tag.toLowerCase());
  if (conditions.tags_any?.length && !conditions.tags_any.some((tag) => tags.includes(tag.toLowerCase()))) return 'Required tag missing';
  if (conditions.tags_none?.length && conditions.tags_none.some((tag) => tags.includes(tag.toLowerCase()))) return 'Has an excluded tag';
  if (conditions.priorities?.length && !conditions.priorities.includes(String(deal?.priority || ''))) return 'Priority does not match';
  if (conditions.lead_sources?.length) {
    const haystack = [lead?.source_old, lead?.source_ref, lead?.source_id].map((v) => String(v || '').toLowerCase()).join(' ');
    if (!conditions.lead_sources.some((source) => source && haystack.includes(source.toLowerCase()))) return 'Lead source does not match';
  }
  return null;
}

async function finish(run: any, status: string, fields: { result?: string; error?: string; run_at?: string; attempts?: number }) {
  await automationRunsApi.update(Number(run.id), {
    status,
    result: fields.result ?? run.result ?? '',
    error: fields.error ?? '',
    attempts: fields.attempts ?? Number(run.attempts || 0),
    run_at: fields.run_at ?? run.run_at,
    claim_id: status === RUN_STATUS.PENDING ? '' : run.claim_id,
    updated_at: nowSql(),
  });
}

async function claim(run: any): Promise<any | null> {
  const claimId = `${workerId}-${crypto.randomUUID()}`;
  await automationRunsApi.update(Number(run.id), { status: RUN_STATUS.RUNNING, claim_id: claimId, updated_at: nowSql() });
  const check: any = await automationRunsApi.get(Number(run.id));
  const fresh = Array.isArray(check?.data) ? check.data[0] : check?.data;
  return fresh?.claim_id === claimId ? { ...fresh, claim_id: claimId } : null;
}

async function execute(run: any) {
  const ruleRes: any = await automationsApi.get(Number(run.automation_id));
  const rule = toRule(Array.isArray(ruleRes?.data) ? ruleRes.data[0] : ruleRes?.data);
  if (!rule || rule.workspace_id !== Number(run.workspace_id)) {
    return finish(run, RUN_STATUS.SKIPPED, { result: 'Automation was deleted' });
  }
  if (!rule.active) return finish(run, RUN_STATUS.SKIPPED, { result: 'Automation is turned off' });

  const context = parseJsonObject(run.context);
  const loaded = Number(run.deal_id) > 0 ? await loadDeal(Number(run.deal_id)) : null;
  if (Number(run.deal_id) > 0 && !loaded) return finish(run, RUN_STATUS.SKIPPED, { result: 'Deal no longer exists' });
  const deal = loaded?.deal || null;
  const lead = await loadLead(Number(run.lead_id) || deal?.leadId || 0);

  if (deal && rule.conditions.still_in_stage !== false && context.stage && deal.stage !== context.stage) {
    return finish(run, RUN_STATUS.SKIPPED, { result: `Deal left "${context.stage}" before the action ran` });
  }
  const unmet = conditionsMet(rule.conditions, deal, lead);
  if (unmet) return finish(run, RUN_STATUS.SKIPPED, { result: unmet });

  const ctx: ActionContext = { rule, deal, lead, depth: Number(context.depth) || 0 };
  try {
    const result = await runAction(ctx);
    await finish(run, RUN_STATUS.DONE, { result });
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (error instanceof SkipRun) return finish(run, RUN_STATUS.SKIPPED, { result: message });
    const attempts = Number(run.attempts || 0) + 1;
    if (attempts >= RUN_MAX_ATTEMPTS) return finish(run, RUN_STATUS.FAILED, { error: message, attempts });
    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1));
    await finish(run, RUN_STATUS.PENDING, {
      error: message,
      attempts,
      run_at: formatMySqlDateTimeUtc(new Date(Date.now() + backoff)),
    });
  }
}

async function requeueStale() {
  const stale = rowsOf(await automationRunsApi.list({ status: RUN_STATUS.RUNNING, limit: RUN_LIST_LIMIT }, { fresh: true }))
    .filter((run) => Date.now() - parseSqlDate(run.updated_at) > STALE_RUN_MS);
  await Promise.all(stale.map((run) => finish(run, RUN_STATUS.PENDING, { error: 'Requeued after a stalled run' })));
}

/** Runs due automation steps. Safe to call often; overlapping calls coalesce. */
export async function processDueAutomationRuns(): Promise<void> {
  if (running) {
    kickAgain = true;
    return;
  }
  running = true;
  try {
    do {
      kickAgain = false;
      await requeueStale();
      const due = rowsOf(
        await automationRunsApi.list({ status: RUN_STATUS.PENDING, sort: 'run_at', order: 'asc', limit: RUN_LIST_LIMIT }, { fresh: true })
      )
        .filter((run) => parseSqlDate(run.run_at) <= Date.now())
        .sort((a, b) => parseSqlDate(a.run_at) - parseSqlDate(b.run_at))
        .slice(0, RUN_BATCH_SIZE);
      for (const run of due) {
        const claimed = await claim(run).catch(() => null);
        if (!claimed) continue;
        await execute(claimed).catch(async (error) => {
          console.error('[Automations] Run crashed', run.id, error?.message || error);
          await finish(claimed, RUN_STATUS.FAILED, { error: error?.message || 'Run crashed' }).catch(() => undefined);
        });
      }
    } while (kickAgain);
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (message !== lastCycleError || Date.now() - lastCycleErrorAt > ERROR_LOG_INTERVAL_MS) {
      console.error('[Automations] Worker cycle failed', message);
      lastCycleError = message;
      lastCycleErrorAt = Date.now();
    }
  } finally {
    running = false;
  }
}

export function startAutomationWorker(instanceId: string, intervalMs: number) {
  workerId = instanceId;
  registerRunKicker(() => void processDueAutomationRuns());
  setInterval(() => void processDueAutomationRuns(), intervalMs);
  console.log(`[Automations] Worker running every ${Math.round(intervalMs / 1000)}s`);
}
