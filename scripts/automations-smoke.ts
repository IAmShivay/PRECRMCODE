// End-to-end check of the automation engine against the real database, in a throwaway workspace.
// Run: npx tsx scripts/automations-smoke.ts
import '../utils/loadEnv.js';
import { automationRunsApi, automationsApi, dealsApi, notificationsApi, tasksApi, webhookLogsApi } from '../services/api.js';
import { createDealRecord } from '../services/deals.js';
import { invalidateRules, toRow } from '../services/automations/store.js';
import { processDueAutomationRuns } from '../services/automations/runner.js';
import { registerRunKicker } from '../services/automations/engine.js';
import { loadDeal } from '../services/automations/dealOps.js';
import type { AutomationRule } from '../services/automations/constants.js';

const WORKSPACE = 999999;
const PIPELINE = 'default';
const STAGE_NEW = 'new_lead';
const STAGE_QUALIFIED = 'qualified';
const TEST_USER = 1;
const SETTLE_MS = 1500;
const MAX_CYCLES = 6;

const rows = (res: any): any[] => (Array.isArray(res?.data) ? res.data : []);
const testRows = (res: any): any[] => rows(res).filter((row) => Number(row?.workspace_id) === WORKSPACE);
const idOf = (res: any) => Number(res?.id ?? res?.data?.id ?? 0);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
};

const rule = (partial: Partial<AutomationRule>): Omit<AutomationRule, 'id'> => ({
  workspace_id: WORKSPACE,
  pipeline_slug: PIPELINE,
  stage: STAGE_NEW,
  name: '',
  trigger_type: 'deal_created',
  conditions: {},
  delay_minutes: 0,
  action_type: 'add_tags',
  action_config: {},
  active: true,
  sort_order: 0,
  created_by: 0,
  ...partial,
});

async function main() {
  registerRunKicker(() => undefined);
  const ruleIds: number[] = [];
  let dealId = 0;
  try {
    for (const r of [
      rule({ name: 'smoke: tag hot', action_type: 'add_tags', action_config: { tags: ['hot'] } }),
      rule({ name: 'smoke: move to qualified', action_type: 'move_stage', action_config: { stage: STAGE_QUALIFIED }, sort_order: 1 }),
      rule({ name: 'smoke: task on qualified', stage: STAGE_QUALIFIED, trigger_type: 'deal_moved', action_type: 'create_task', action_config: { title: 'Call about {{deal.name}}', assign_to: TEST_USER, due_in_minutes: 60 } }),
      rule({ name: 'smoke: skipped by condition', action_type: 'add_tags', action_config: { tags: ['big'] }, conditions: { min_value: 1000000 } }),
    ]) {
      const res: any = await automationsApi.create(toRow(r));
      check(`create rule "${r.name}"`, res?.status === 'success', `id ${idOf(res)}`);
      ruleIds.push(idOf(res));
    }
    invalidateRules(WORKSPACE);

    const created = await createDealRecord({ workspaceId: WORKSPACE, name: 'Smoke test deal', value: 5000, stage: STAGE_NEW, pipelineSlug: PIPELINE, ownerId: TEST_USER, skipReadBack: true });
    dealId = created.id;
    check('create test deal', dealId > 0, `deal ${dealId}`);

    for (let cycle = 0; cycle < MAX_CYCLES; cycle += 1) {
      await sleep(SETTLE_MS);
      await processDueAutomationRuns();
    }

    const loaded = await loadDeal(dealId);
    check('deal tagged "hot"', Boolean(loaded?.deal.tags.includes('hot')), `tags=${loaded?.deal.tags.join(',')}`);
    check('deal not tagged "big" (condition blocked it)', !loaded?.deal.tags.includes('big'));
    check('deal moved to qualified', loaded?.deal.stage === STAGE_QUALIFIED, `stage=${loaded?.deal.stage}`);

    const runs = rows(await automationRunsApi.list({ workspace_id: WORKSPACE, limit: 50 }, { fresh: true }));
    const summary = runs.map((r) => `${r.automation_id}:${r.status}`).join(' ');
    check('4 runs recorded (3 on create + 1 chained)', runs.length === 4, summary);
    check('no failed runs', runs.every((r) => r.status !== 'failed'), runs.filter((r) => r.status === 'failed').map((r) => r.error).join(' | '));
    check('condition rule skipped with reason', runs.some((r) => r.status === 'skipped' && /below/i.test(String(r.result))));

    const tasks = rows(await tasksApi.list({ workspace_id: WORKSPACE, limit: 20 }, { fresh: true }));
    check('chained task created', tasks.some((t) => t.title === 'Call about Smoke test deal' && Number(t.deal_id) === dealId), tasks.map((t) => t.title).join(', '));
  } finally {
    for (const id of ruleIds.filter(Boolean)) await automationsApi.remove(id).catch(() => undefined);
    for (const r of testRows(await automationRunsApi.list({ workspace_id: WORKSPACE, limit: 100 }, { fresh: true }))) await automationRunsApi.remove(Number(r.id)).catch(() => undefined);
    for (const t of testRows(await tasksApi.list({ workspace_id: WORKSPACE, limit: 100 }, { fresh: true }))) await tasksApi.remove(Number(t.id)).catch(() => undefined);
    for (const n of testRows(await notificationsApi.getNotifications({ workspace_id: WORKSPACE, limit: 100, bypassCache: true }))) await notificationsApi.deleteNotification(Number(n.id)).catch(() => undefined);
    for (const log of testRows(await webhookLogsApi.getWebhookLogs?.({ workspace_id: WORKSPACE, limit: 100 } as any).catch(() => ({})))) {
      await webhookLogsApi.deleteWebhookLog?.(Number(log.id)).catch(() => undefined);
    }
    if (dealId) await dealsApi.deleteDeal(dealId).catch(() => undefined);
    console.log('cleanup done');
  }
  console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
