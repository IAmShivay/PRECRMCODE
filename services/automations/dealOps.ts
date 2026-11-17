import crypto from 'crypto';
import { dealsApi, dealStageHistoryApi, leadsApi } from '../api.js';
import { parseDealFromLog } from '../deals.js';
import { emitAutomationEvent } from './engine.js';
import { nowSql, parseJsonObject } from './store.js';

const DEAL_STATUS = 'deal';
const WON_STAGE = 'won';

export interface DealSnapshot {
  id: number;
  workspaceId: number;
  leadId: number;
  name: string;
  value: number;
  contact: string;
  ownerId: number | null;
  stage: string;
  pipelineSlug: string;
  priority: string;
  tags: string[];
}

export const normalizeTags = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map((tag) => String(tag || '').trim()).filter(Boolean))]
    : [];

export async function loadDeal(dealId: number): Promise<{ deal: DealSnapshot; log: any } | null> {
  const res: any = await dealsApi.getDealById(dealId);
  const log = Array.isArray(res?.data) ? res.data[0] : res?.data;
  if (res?.status !== 'success' || !log || log.status !== DEAL_STATUS) return null;
  const parsed = parseDealFromLog(log);
  const payload = parseJsonObject(log.payload);
  return {
    log,
    deal: {
      id: parsed.id,
      workspaceId: parsed.workspace_id,
      leadId: Number(parsed.lead_id || log.lead_id || 0) || 0,
      name: parsed.name,
      value: Number(parsed.value) || 0,
      contact: parsed.contact || '',
      ownerId: parsed.owner_id ?? null,
      stage: String(parsed.stage || ''),
      pipelineSlug: parsed.pipeline_slug || 'default',
      priority: String(parsed.priority || ''),
      tags: normalizeTags(payload.tags),
    },
  };
}

export async function loadLead(leadId: number): Promise<any | null> {
  if (!leadId) return null;
  const res: any = await leadsApi.getLeadById(leadId);
  const lead = Array.isArray(res?.data) ? res.data[0] : res?.data;
  return res?.status === 'success' && lead ? lead : null;
}

/** Applies a partial change to a deal the same way the deals API does, then emits follow-up events. */
export async function patchDeal(
  dealId: number,
  patch: { stage?: string; owner_id?: number | null; tags?: string[] },
  depth: number
): Promise<DealSnapshot> {
  const loaded = await loadDeal(dealId);
  if (!loaded) throw new Error(`Deal ${dealId} not found`);
  const { deal, log } = loaded;
  const payload = parseJsonObject(log.payload);
  const now = nowSql();
  const nextStage = patch.stage ?? deal.stage;
  const nextOwner = patch.owner_id !== undefined ? patch.owner_id : deal.ownerId;
  const nextPayload = {
    ...payload,
    stage: nextStage,
    owner_id: nextOwner,
    tags: patch.tags ? normalizeTags(patch.tags) : deal.tags,
    updated_at: now,
    won_at: nextStage === WON_STAGE ? (deal.stage === WON_STAGE ? payload.won_at || now : now) : undefined,
  };

  const res: any = await dealsApi.updateDeal(dealId, {
    workspace_id: deal.workspaceId,
    lead_id: Number(log.lead_id || 0) || 0,
    source: String(log.source || DEAL_STATUS),
    event_id: String(log.event_id || ''),
    payload: JSON.stringify(nextPayload),
    status: DEAL_STATUS,
  });
  if (res?.status !== 'success') throw new Error('Failed to update deal');

  if (nextStage !== deal.stage) {
    await dealStageHistoryApi
      .createStageHistory({
        workspace_id: deal.workspaceId,
        lead_id: dealId,
        source: 'deal_stage_history',
        event_id: `deal_hist_${crypto.randomUUID().replace(/-/g, '')}`,
        payload: JSON.stringify({ deal_id: dealId, user_id: null, old_stage: deal.stage, new_stage: nextStage, created_at: now, via: 'automation' }),
        status: 'deal_stage_history',
        created_at: now,
      })
      .catch(() => undefined);
    emitAutomationEvent({
      workspaceId: deal.workspaceId,
      type: 'deal_moved',
      dealId,
      leadId: deal.leadId,
      pipelineSlug: deal.pipelineSlug,
      stage: nextStage,
      previousStage: deal.stage,
      depth: depth + 1,
    });
  }

  if (patch.owner_id !== undefined && nextOwner !== deal.ownerId) {
    emitAutomationEvent({
      workspaceId: deal.workspaceId,
      type: 'deal_owner_changed',
      dealId,
      leadId: deal.leadId,
      pipelineSlug: deal.pipelineSlug,
      stage: nextStage,
      depth: depth + 1,
    });
  }

  return { ...deal, stage: nextStage, ownerId: nextOwner, tags: nextPayload.tags };
}
