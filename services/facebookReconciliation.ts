import { webhookLogsApi } from './api.js';
import {
  createLeadFromFacebookData,
  FacebookFormMapping,
  FacebookRateLimitError,
  getFacebookConnection,
  getFacebookFormLeads,
  getFacebookPages,
  normalizeFacebookLeadData,
} from './facebook.js';
import { ApiResponse, WebhookLog } from '../types/index.js';

const FACEBOOK_MAPPING_STATUS = 'facebook_mapping';
const FACEBOOK_RECONCILIATION_STATUS = 'fb_reconcile';

interface FacebookReconciliationState {
  workspaceId: number;
  userId: number;
  pageId: string;
  formId: string;
  lastSeenCreatedAt: string;
  lastSeenLeadIds: string[];
  lastCheckedAt: string;
  lastSuccessAt?: string;
}

interface StoredFacebookReconciliationState {
  log: WebhookLog;
  state: FacebookReconciliationState;
}

export interface FacebookReconciliationResult {
  mappingsChecked: number;
  pagesFetched: number;
  leadsExamined: number;
  leadsCreated: number;
  duplicatesSkipped: number;
  errors: number;
}

function parseTimestamp(value: unknown): number | null {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function mappingKey(mapping: Pick<FacebookFormMapping, 'workspace_id' | 'user_id' | 'form_id'>): string {
  return `${mapping.workspace_id}:${mapping.user_id}:${mapping.form_id}`;
}

function reconciliationEventId(
  mapping: Pick<FacebookFormMapping, 'workspace_id' | 'user_id' | 'form_id'>
): string {
  return `fb_reconcile_${mapping.workspace_id}_${mapping.user_id}_${mapping.form_id}`;
}

function parseMapping(log: WebhookLog): FacebookFormMapping | null {
  try {
    const mapping = JSON.parse(log.payload || '{}') as FacebookFormMapping;
    if (
      !mapping?.mapping_config ||
      !mapping.workspace_id ||
      !mapping.user_id ||
      !mapping.page_id ||
      !mapping.form_id
    ) {
      return null;
    }
    return mapping;
  } catch {
    return null;
  }
}

function parseState(log: WebhookLog): FacebookReconciliationState | null {
  try {
    const state = JSON.parse(log.payload || '{}') as FacebookReconciliationState;
    if (!state?.workspaceId || !state.userId || !state.pageId || !state.formId) {
      return null;
    }
    return {
      ...state,
      lastSeenLeadIds: Array.isArray(state.lastSeenLeadIds) ? state.lastSeenLeadIds : [],
    };
  } catch {
    return null;
  }
}

async function getAllFacebookMappings(): Promise<FacebookFormMapping[]> {
  const response = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_MAPPING_STATUS,
    limit: 1000,
    sort: 'id',
    order: 'desc',
    cache: 'no-store',
  })) as ApiResponse<WebhookLog[]>;

  if (response.status !== 'success' || !response.data) return [];

  const logs = Array.isArray(response.data) ? response.data : [response.data];
  const latestMappings = new Map<string, FacebookFormMapping>();

  for (const log of logs) {
    const mapping = parseMapping(log);
    if (!mapping) continue;

    const key = mappingKey(mapping);
    const existing = latestMappings.get(key);
    const incomingUpdatedAt = parseTimestamp(mapping.updated_at || mapping.created_at) || 0;
    const existingUpdatedAt = existing
      ? parseTimestamp(existing.updated_at || existing.created_at) || 0
      : -1;

    if (!existing || incomingUpdatedAt >= existingUpdatedAt) {
      latestMappings.set(key, mapping);
    }
  }

  return Array.from(latestMappings.values());
}

async function getAllReconciliationStates(): Promise<Map<string, StoredFacebookReconciliationState>> {
  const response = (await webhookLogsApi.getWebhookLogs({
    status: FACEBOOK_RECONCILIATION_STATUS,
    limit: 1000,
    sort: 'id',
    order: 'desc',
    cache: 'no-store',
  })) as ApiResponse<WebhookLog[]>;

  const storedStates = new Map<string, StoredFacebookReconciliationState>();
  if (response.status !== 'success' || !response.data) return storedStates;

  const logs = Array.isArray(response.data) ? response.data : [response.data];
  for (const log of logs) {
    const state = parseState(log);
    if (!state) continue;

    const key = `${state.workspaceId}:${state.userId}:${state.formId}`;
    const existing = storedStates.get(key);
    if (!existing || Number(log.id) > Number(existing.log.id)) {
      storedStates.set(key, { log, state });
    }
  }

  return storedStates;
}

async function saveReconciliationState(
  mapping: FacebookFormMapping,
  state: FacebookReconciliationState,
  existingLog: WebhookLog | undefined,
  error: string | null
): Promise<void> {
  const logData = {
    workspace_id: mapping.workspace_id,
    lead_id: 0,
    source: 'facebook',
    source_old: 'facebook',
    event_id: reconciliationEventId(mapping),
    payload: JSON.stringify(state),
    status: FACEBOOK_RECONCILIATION_STATUS,
    error,
  };

  if (existingLog?.id) {
    await webhookLogsApi.updateWebhookLog(existingLog.id, logData);
    return;
  }

  await webhookLogsApi.createWebhookLog({
    ...logData,
    created_at: new Date().toISOString(),
  });
}

function getInitialCutoff(mapping: FacebookFormMapping, lookbackMs: number): number {
  const configuredAt =
    parseTimestamp(mapping.updated_at) ||
    parseTimestamp(mapping.created_at) ||
    Date.now();
  const clockSkewAllowanceMs = 5 * 60 * 1000;
  return Math.max(configuredAt - clockSkewAllowanceMs, Date.now() - lookbackMs);
}

export async function reconcileFacebookLeadForms(options?: {
  batchSize?: number;
  gracePeriodMs?: number;
  lookbackMs?: number;
  maxPages?: number;
}): Promise<FacebookReconciliationResult> {
  const batchSize = Math.max(1, Math.min(100, Number(options?.batchSize || 50)));
  const gracePeriodMs = Math.max(0, Number(options?.gracePeriodMs ?? 2 * 60 * 1000));
  const lookbackMs = Math.max(60_000, Number(options?.lookbackMs || 24 * 60 * 60 * 1000));
  const maxPages = Math.max(1, Math.min(100, Number(options?.maxPages || 20)));
  const mappings = await getAllFacebookMappings();
  const storedStates = await getAllReconciliationStates();
  const pageCache = new Map<string, Awaited<ReturnType<typeof getFacebookPages>>>();
  const result: FacebookReconciliationResult = {
    mappingsChecked: 0,
    pagesFetched: 0,
    leadsExamined: 0,
    leadsCreated: 0,
    duplicatesSkipped: 0,
    errors: 0,
  };

  for (const mapping of mappings) {
    result.mappingsChecked++;
    const key = mappingKey(mapping);
    const stored = storedStates.get(key);
    const now = new Date().toISOString();
    const initialCutoffMs = getInitialCutoff(mapping, lookbackMs);
    const storedCutoffMs = parseTimestamp(stored?.state.lastSeenCreatedAt);
    let checkpointMs = storedCutoffMs ?? initialCutoffMs;
    let checkpointLeadIds = new Set(
      storedCutoffMs === null ? [] : stored?.state.lastSeenLeadIds || []
    );
    const reconciliationUpperBoundMs = Date.now() - gracePeriodMs;

    const baseState: FacebookReconciliationState = {
      workspaceId: mapping.workspace_id,
      userId: mapping.user_id,
      pageId: mapping.page_id,
      formId: mapping.form_id,
      lastSeenCreatedAt: new Date(checkpointMs).toISOString(),
      lastSeenLeadIds: Array.from(checkpointLeadIds),
      lastCheckedAt: now,
      ...(stored?.state.lastSuccessAt
        ? { lastSuccessAt: stored.state.lastSuccessAt }
        : {}),
    };

    try {
      const connection = await getFacebookConnection(mapping.workspace_id, mapping.user_id);
      if (!connection?.access_token) {
        throw new Error('Facebook connection not found');
      }

      const connectionKey = `${mapping.workspace_id}:${mapping.user_id}`;
      let pages = pageCache.get(connectionKey);
      if (!pages) {
        pages = await getFacebookPages(connection.access_token);
        pageCache.set(connectionKey, pages);
      }

      const page = pages.find((candidate) => candidate.id === mapping.page_id);
      if (!page?.access_token) {
        throw new Error('Facebook page not found or access token unavailable');
      }

      const leadsById = new Map<string, any>();
      let after: string | undefined;
      let reachedCheckpointBoundary = false;

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        const response = await getFacebookFormLeads(
          mapping.form_id,
          page.access_token,
          batchSize,
          after
        );
        result.pagesFetched++;

        const pageLeads = Array.isArray(response.data) ? response.data : [];
        for (const lead of pageLeads) {
          const leadId = String(lead?.id || '');
          if (leadId) leadsById.set(leadId, lead);
        }

        const oldestTimestamp = pageLeads.reduce<number | null>((oldest, lead) => {
          const createdAtMs = parseTimestamp(lead?.created_time);
          if (createdAtMs === null) return oldest;
          return oldest === null ? createdAtMs : Math.min(oldest, createdAtMs);
        }, null);
        const nextAfter = response.paging?.cursors?.after;

        if (
          pageLeads.length === 0 ||
          !nextAfter ||
          (oldestTimestamp !== null && oldestTimestamp < checkpointMs)
        ) {
          reachedCheckpointBoundary = true;
          break;
        }

        after = nextAfter;
      }

      if (!reachedCheckpointBoundary) {
        throw new Error(
          `Facebook lead backlog exceeds ${maxPages * batchSize} records; ` +
          'checkpoint was not advanced to avoid skipping leads'
        );
      }

      const candidates = Array.from(leadsById.values())
        .map((lead) => ({
          lead,
          id: String(lead?.id || ''),
          createdAtMs: parseTimestamp(lead?.created_time),
        }))
        .filter(
          (candidate): candidate is { lead: any; id: string; createdAtMs: number } =>
            Boolean(candidate.id) &&
            candidate.createdAtMs !== null &&
            candidate.createdAtMs <= reconciliationUpperBoundMs &&
            (candidate.createdAtMs > checkpointMs ||
              (candidate.createdAtMs === checkpointMs && !checkpointLeadIds.has(candidate.id)))
        )
        .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));

      for (const candidate of candidates) {
        result.leadsExamined++;
        const normalized = normalizeFacebookLeadData(candidate.lead, mapping.mapping_config);
        const creation = await createLeadFromFacebookData(
          mapping.workspace_id,
          candidate.id,
          normalized,
          mapping.mapping_config
        );

        if (creation.error) {
          throw new Error(`Lead ${candidate.id}: ${creation.error}`);
        }

        if (creation.created) {
          result.leadsCreated++;
        } else {
          result.duplicatesSkipped++;
        }

        if (candidate.createdAtMs > checkpointMs) {
          checkpointMs = candidate.createdAtMs;
          checkpointLeadIds = new Set([candidate.id]);
        } else {
          checkpointLeadIds.add(candidate.id);
        }
      }

      await saveReconciliationState(
        mapping,
        {
          ...baseState,
          lastSeenCreatedAt: new Date(checkpointMs).toISOString(),
          lastSeenLeadIds: Array.from(checkpointLeadIds),
          lastSuccessAt: now,
        },
        stored?.log,
        null
      );
    } catch (error) {
      result.errors++;
      const errorMessage = String((error as Error).message || 'Reconciliation failed').slice(0, 1000);
      console.error('[Facebook Reconciliation] Form check failed', {
        workspaceId: mapping.workspace_id,
        userId: mapping.user_id,
        pageId: mapping.page_id,
        formId: mapping.form_id,
        error: errorMessage,
      });

      try {
        await saveReconciliationState(mapping, baseState, stored?.log, errorMessage);
      } catch (stateError) {
        console.error('[Facebook Reconciliation] Failed to persist error state', {
          workspaceId: mapping.workspace_id,
          formId: mapping.form_id,
          error: (stateError as Error).message || stateError,
        });
      }
      if (error instanceof FacebookRateLimitError) break;
    }
  }

  return result;
}
