import { leadStatusesApi, leadsApi, webhookLogsApi } from './api.js';
import { getConvertedLeadIdsForWorkspace } from './customers.js';
import { ApiResponse, Lead, LeadStatus, Prospect, ProspectsView, StoredDealLog } from '../types/index.js';

const PROSPECT_SELECTION_STATUS = 'prospect_selection';

function rows<T>(data: T | T[] | undefined): T[] {
  return Array.isArray(data) ? data : data ? [data] : [];
}

function selectionPayload(log: StoredDealLog): { lead_id: number; selected: boolean } | null {
  if (log.status !== PROSPECT_SELECTION_STATUS) return null;
  try {
    const payload: unknown = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
    if (!payload || typeof payload !== 'object') return null;
    const value = payload as Record<string, unknown>;
    const leadId = Number(value.lead_id);
    return Number.isSafeInteger(leadId) && leadId > 0 && typeof value.selected === 'boolean'
      ? { lead_id: leadId, selected: value.selected }
      : null;
  } catch {
    return null;
  }
}

async function getSelectionLogs(workspaceId: number): Promise<StoredDealLog[]> {
  const response = await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: PROSPECT_SELECTION_STATUS,
    limit: 10000,
    bypassCache: true,
  }) as ApiResponse<StoredDealLog[]>;
  if (response.status !== 'success') throw new Error('Failed to load prospect selections');
  return rows(response.data).filter((log) =>
    Number(log.workspace_id) === workspaceId && log.status === PROSPECT_SELECTION_STATUS
  );
}

async function getWorkspaceLeads(workspaceId: number): Promise<Lead[]> {
  const pageSize = 200;
  const maxPages = 50;
  const leads: Lead[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await leadsApi.getLeads({ workspace_id: workspaceId, page, limit: pageSize }) as ApiResponse<Lead[]>;
    if (response.status !== 'success') throw new Error('Failed to load leads');
    const pageLeads = rows(response.data);
    leads.push(...pageLeads);
    if (!response.metadata?.hasMore && pageLeads.length < pageSize) return leads;
    if (pageLeads.length === 0) return leads;
  }
  throw new Error('Prospect list exceeds the supported lead limit');
}

export async function getProspectsForWorkspace(workspaceId: number): Promise<ProspectsView> {
  const [leads, statusesResponse, selectionLogs, customerLeadIds] = await Promise.all([
    getWorkspaceLeads(workspaceId),
    leadStatusesApi.getStatuses(workspaceId) as Promise<ApiResponse<LeadStatus[]>>,
    getSelectionLogs(workspaceId),
    getConvertedLeadIdsForWorkspace(workspaceId),
  ]);
  if (statusesResponse.status !== 'success') throw new Error('Failed to load lead statuses');

  const statuses = new Map(rows(statusesResponse.data)
    .filter((status) => Number(status.workspace_id) === workspaceId)
    .map((status) => [Number(status.id), status]));
  const selections = new Map<number, boolean>();
  for (const log of [...selectionLogs].sort((left, right) => Number(left.id || 0) - Number(right.id || 0))) {
    const payload = selectionPayload(log);
    if (payload && Number(log.lead_id) === payload.lead_id) {
      selections.set(payload.lead_id, payload.selected);
    }
  }
  const candidates = leads.filter((lead) =>
    Number(lead.workspace_id) === workspaceId &&
    Number.isSafeInteger(Number(lead.id)) && Number(lead.id) > 0 &&
    !lead.deleted_at && !customerLeadIds.has(Number(lead.id))
  );
  const prospects: Prospect[] = candidates.flatMap((lead) => {
    const status = statuses.get(Number(lead.status_id));
    const qualified = Number(status?.is_qualified) === 1;
    const manuallySelected = selections.get(Number(lead.id)) === true;
    return qualified || manuallySelected
      ? [{ lead, status_name: status?.name || 'No status', qualified, manually_selected: manuallySelected }]
      : [];
  });
  prospects.sort((left, right) =>
    (right.lead.created_at || '').localeCompare(left.lead.created_at || '') || Number(right.lead.id) - Number(left.lead.id)
  );
  return { prospects, candidates };
}

export class ProspectAlreadyCustomerError extends Error {}

export async function setProspectSelection(workspaceId: number, leadId: number, selected: boolean): Promise<void> {
  const leadResponse = await leadsApi.getLeadById(leadId) as ApiResponse<Lead>;
  const lead = rows(leadResponse.data)[0];
  if (leadResponse.status !== 'success' || !lead || Number(lead.workspace_id) !== workspaceId || lead.deleted_at) {
    throw new Error('Lead not found');
  }
  if (selected) {
    const customerLeadIds = await getConvertedLeadIdsForWorkspace(workspaceId);
    if (customerLeadIds.has(leadId)) {
      throw new ProspectAlreadyCustomerError('This lead is already a customer');
    }
  }
  const logs = await getSelectionLogs(workspaceId);
  const existing = logs
    .filter((log) => Number(log.lead_id) === leadId && selectionPayload(log)?.lead_id === leadId)
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0];
  if (existing && selectionPayload(existing)?.selected === selected) return;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const record = {
    workspace_id: workspaceId,
    lead_id: leadId,
    source: PROSPECT_SELECTION_STATUS,
    event_id: `prospect_${workspaceId}_${leadId}`,
    status: PROSPECT_SELECTION_STATUS,
    payload: JSON.stringify({ lead_id: leadId, selected, updated_at: now }),
    created_at: existing?.created_at || now,
  };
  const response = existing?.id
    ? await webhookLogsApi.updateWebhookLog(existing.id, record) as ApiResponse<unknown>
    : await webhookLogsApi.createWebhookLog(record) as ApiResponse<unknown>;
  if (response.status !== 'success') throw new Error('Failed to save prospect selection');
}
