import crypto from 'crypto';
import { botRunsApi, botsApi } from '../api.js';
import { formatMySqlDateTimeUtc } from '../../lib/validation.js';
import { SkipRun } from '../automations/actions.js';
import { loadDeal, loadLead } from '../automations/dealOps.js';
import {
  BLOCK_TYPES,
  BOT_ENTITY_TYPES,
  BOT_RETRY_BASE_MS,
  BOT_RETRY_MAX_MS,
  BOT_RUN_BATCH_SIZE,
  BOT_RUN_LIST_LIMIT,
  BOT_RUN_MAX_ATTEMPTS,
  BOT_RUN_STATUS,
  BOT_STALE_RUN_MS,
  DEPTH_VAR,
  MAX_BOT_DEPTH,
  MAX_STEP_ITERATIONS,
  type BlockType,
  type BotCursor,
  type BotRunStatus,
  type Handler,
  type Step,
} from './constants.js';
import { handlers, type BotContext, type HandlerResult, type OutboundMessage } from './handlers.js';
import { createBotRun, registerBotRunKicker } from './engine.js';
import { nowSql, parseJsonObject, parseSqlDate, toBot } from './store.js';
import { MESSAGE_DIRECTION, SENDER_TYPE, type Conversation } from '../channels/constants.js';
import { appendMessage, loadConversation, updateConversation } from '../channels/store.js';

let running = false;
let kickAgain = false;
let workerId = `bot-${process.pid}`;
let lastCycleError = '';
let lastCycleErrorAt = 0;
const ERROR_LOG_INTERVAL_MS = 10 * 60_000;

const rowsOf = (res: any): any[] => (res?.status === 'success' && Array.isArray(res.data) ? res.data : []);

function parseCursor(value: unknown): BotCursor {
  const obj = parseJsonObject(value);
  const block = (BLOCK_TYPES as readonly string[]).includes(String(obj.block)) ? (obj.block as BlockType) : 'question';
  const step = Math.max(0, Number(obj.step) || 0);
  const vars = obj.vars && typeof obj.vars === 'object' && !Array.isArray(obj.vars) ? (obj.vars as Record<string, unknown>) : {};
  return { block, step, vars };
}

function nextBlock(block: BlockType): BlockType | null {
  const next = BLOCK_TYPES[BLOCK_TYPES.indexOf(block) + 1];
  return next ?? null;
}

async function runList(ctx: BotContext, list: Handler[], logs: string[], depth: number): Promise<HandlerResult> {
  for (const entry of list) {
    const fn = handlers[entry.handler];
    if (!fn) {
      logs.push(`unknown handler ${entry.handler}`);
      continue;
    }
    const result = await fn(ctx, entry.params || {});
    if (result.log) logs.push(result.log);
    if (result.nested && result.nested.length && depth < MAX_BOT_DEPTH) {
      const inner = await runList(ctx, result.nested, logs, depth + 1);
      if (inner.goto || inner.stop || inner.wait) return inner;
    }
    if (result.goto || result.stop || result.wait) return result;
  }
  return {};
}

interface WalkOutcome {
  status: BotRunStatus;
  cursor: BotCursor;
  logs: string[];
  launchBotId?: number;
}

async function interpret(ctx: BotContext, script: Step[], start: BotCursor): Promise<WalkOutcome> {
  const logs: string[] = [];
  let cursor: BotCursor = { block: start.block, step: start.step, vars: ctx.vars };
  for (let i = 0; i < MAX_STEP_ITERATIONS; i++) {
    const step = script[cursor.step];
    if (!step) return { status: BOT_RUN_STATUS.DONE, cursor, logs };
    const list = (step[cursor.block] || []) as Handler[];
    const result = await runList(ctx, list, logs, 0);
    if (result.wait) {
      const resume = nextBlock(cursor.block) ?? 'finish';
      return { status: BOT_RUN_STATUS.WAITING, cursor: { block: resume, step: cursor.step, vars: ctx.vars }, logs };
    }
    if (result.stop) {
      return { status: BOT_RUN_STATUS.DONE, cursor, logs, launchBotId: result.launchBotId };
    }
    if (result.goto) {
      cursor = { block: result.goto.block, step: result.goto.step, vars: ctx.vars };
      continue;
    }
    const nb = nextBlock(cursor.block);
    cursor = nb ? { block: nb, step: cursor.step, vars: ctx.vars } : { block: 'question', step: cursor.step + 1, vars: ctx.vars };
  }
  throw new Error('Bot exceeded the maximum number of steps');
}

async function finish(
  run: any,
  status: BotRunStatus,
  fields: { result?: string; error?: string; run_at?: string; attempts?: number; cursor?: BotCursor }
) {
  await botRunsApi.update(Number(run.id), {
    status,
    result: fields.result ?? run.result ?? '',
    error: fields.error ?? '',
    attempts: fields.attempts ?? Number(run.attempts || 0),
    run_at: fields.run_at ?? run.run_at,
    cursor: fields.cursor ? JSON.stringify(fields.cursor) : run.cursor,
    claim_id: status === BOT_RUN_STATUS.PENDING ? '' : run.claim_id,
    updated_at: nowSql(),
  });
}

async function claim(run: any): Promise<any | null> {
  const claimId = `${workerId}-${crypto.randomUUID()}`;
  await botRunsApi.update(Number(run.id), { status: BOT_RUN_STATUS.RUNNING, claim_id: claimId, updated_at: nowSql() });
  const check: any = await botRunsApi.get(Number(run.id));
  const fresh = Array.isArray(check?.data) ? check.data[0] : check?.data;
  return fresh?.claim_id === claimId ? { ...fresh, claim_id: claimId } : null;
}

/**
 * Persists each queued outbound message to the conversation. For the live-chat
 * widget the stored `messages` row IS the delivery (the widget polls them);
 * external adapters (WhatsApp/Telegram) would additionally push here.
 */
async function deliverOutbound(conversation: Conversation, outbox: OutboundMessage[], botRunId: number): Promise<void> {
  for (const message of outbox) {
    await appendMessage({
      conversation,
      direction: MESSAGE_DIRECTION.OUT,
      senderType: SENDER_TYPE.BOT,
      text: message.text,
      payload: message.payload || {},
    }).catch((error) => console.error('[Bots] Could not deliver outbound message', error?.message || error));
  }
  if (conversation.bot_run_id !== botRunId) {
    await updateConversation(conversation.id, { bot_run_id: botRunId }).catch(() => undefined);
  }
}

async function execute(run: any) {
  const botRes: any = await botsApi.get(Number(run.bot_id));
  const bot = toBot(Array.isArray(botRes?.data) ? botRes.data[0] : botRes?.data);
  if (!bot || bot.workspace_id !== Number(run.workspace_id)) {
    return finish(run, BOT_RUN_STATUS.STOPPED, { result: 'Bot was deleted' });
  }
  if (!bot.active) return finish(run, BOT_RUN_STATUS.STOPPED, { result: 'Bot is turned off' });

  const entityId = Number(run.entity_id) || 0;
  const conversationId = Number(run.conversation_id) || 0;
  const isDeal = String(run.entity_type) === BOT_ENTITY_TYPES[0];

  const loaded = isDeal && entityId > 0 ? await loadDeal(entityId).catch(() => null) : null;
  if (isDeal && entityId > 0 && !loaded) return finish(run, BOT_RUN_STATUS.STOPPED, { result: 'Deal no longer exists' });

  let conversation: Conversation | null = null;
  if (conversationId > 0) {
    conversation = await loadConversation(conversationId).catch(() => null);
    if (!conversation) return finish(run, BOT_RUN_STATUS.STOPPED, { result: 'Conversation no longer exists' });
  }

  const deal = loaded?.deal || null;
  const leadId = Number(deal?.leadId) || Number(conversation?.lead_id) || 0;
  const lead = await loadLead(leadId);

  const cursor = parseCursor(run.cursor);
  const depth = Number((cursor.vars as Record<string, unknown>)[DEPTH_VAR]) || 0;
  const state = loaded ? { deal: loaded.deal, log: loaded.log } : null;
  const ctx: BotContext = { bot, deal, lead, depth, vars: cursor.vars, state, conversationId, outbox: [] };

  try {
    const outcome = await interpret(ctx, bot.script, cursor);
    if (conversation) await deliverOutbound(conversation, ctx.outbox, Number(run.id));
    if (outcome.launchBotId && depth < MAX_BOT_DEPTH) {
      await createBotRun({
        workspaceId: bot.workspace_id,
        botId: outcome.launchBotId,
        entityType: isDeal ? BOT_ENTITY_TYPES[0] : BOT_ENTITY_TYPES[1],
        entityId,
        conversationId,
        depth: depth + 1,
      }).catch(() => undefined);
    }
    await finish(run, outcome.status, { result: outcome.logs.join(' · ').slice(0, 2000), cursor: outcome.cursor });
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (error instanceof SkipRun) return finish(run, BOT_RUN_STATUS.STOPPED, { result: message });
    const attempts = Number(run.attempts || 0) + 1;
    if (attempts >= BOT_RUN_MAX_ATTEMPTS) return finish(run, BOT_RUN_STATUS.FAILED, { error: message, attempts });
    const backoff = Math.min(BOT_RETRY_MAX_MS, BOT_RETRY_BASE_MS * 2 ** (attempts - 1));
    await finish(run, BOT_RUN_STATUS.PENDING, {
      error: message,
      attempts,
      run_at: formatMySqlDateTimeUtc(new Date(Date.now() + backoff)),
    });
  }
}

async function requeueStale() {
  const stale = rowsOf(await botRunsApi.list({ status: BOT_RUN_STATUS.RUNNING, limit: BOT_RUN_LIST_LIMIT }, { fresh: true })).filter(
    (run) => Date.now() - parseSqlDate(run.updated_at) > BOT_STALE_RUN_MS
  );
  await Promise.all(stale.map((run) => finish(run, BOT_RUN_STATUS.PENDING, { error: 'Requeued after a stalled run' })));
}

/** Runs due bot steps. Safe to call often; overlapping calls coalesce. */
export async function processDueBotRuns(): Promise<void> {
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
        await botRunsApi.list({ status: BOT_RUN_STATUS.PENDING, sort: 'run_at', order: 'asc', limit: BOT_RUN_LIST_LIMIT }, { fresh: true })
      )
        .filter((run) => parseSqlDate(run.run_at) <= Date.now())
        .sort((a, b) => parseSqlDate(a.run_at) - parseSqlDate(b.run_at))
        .slice(0, BOT_RUN_BATCH_SIZE);
      for (const run of due) {
        const claimed = await claim(run).catch(() => null);
        if (!claimed) continue;
        await execute(claimed).catch(async (error) => {
          console.error('[Bots] Run crashed', run.id, error?.message || error);
          await finish(claimed, BOT_RUN_STATUS.FAILED, { error: error?.message || 'Run crashed' }).catch(() => undefined);
        });
      }
    } while (kickAgain);
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (message !== lastCycleError || Date.now() - lastCycleErrorAt > ERROR_LOG_INTERVAL_MS) {
      console.error('[Bots] Worker cycle failed', message);
      lastCycleError = message;
      lastCycleErrorAt = Date.now();
    }
  } finally {
    running = false;
  }
}

export function startBotWorker(instanceId: string, intervalMs: number) {
  workerId = instanceId;
  registerBotRunKicker(() => void processDueBotRuns());
  setInterval(() => void processDueBotRuns(), intervalMs);
  console.log(`[Bots] Worker running every ${Math.round(intervalMs / 1000)}s`);
}
