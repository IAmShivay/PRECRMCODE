import { webhookLogsApi } from './api.js';
import type { ApiResponse, WebhookLog } from '../types/index.js';

// Integration records share the existing NoCodeBackend table. Never expose their payloads in log APIs.
export async function readIntegrationRecords(source: string, status: string, workspaceId?: number, eventId?: string): Promise<WebhookLog[]> {
  const records: WebhookLog[] = [];
  for (let page = 1; page <= 1000; page++) {
    const result = await webhookLogsApi.getWebhookLogs({
      source, status, workspace_id: workspaceId, event_id: eventId,
      page, limit: 100, sort: 'id', order: 'asc', cache: 'no-store',
    }) as ApiResponse<WebhookLog[]>;
    if (result.status !== 'success' || !Array.isArray(result.data)) {
      throw new Error('Unable to read integration settings');
    }
    records.push(...result.data.filter(row => row.source === source && row.status === status &&
      (workspaceId === undefined || Number(row.workspace_id) === workspaceId) && (!eventId || row.event_id === eventId)));
    if (result.data.length < 100) return records;
  }
  throw new Error('Integration settings exceed the supported page limit');
}

export function parseIntegrationPayload<T>(row: WebhookLog): T {
  return JSON.parse(row.payload) as T;
}

export async function writeIntegrationRecord(source: string, status: string, workspaceId: number, eventId: string, payload: unknown): Promise<void> {
  const rows = await readIntegrationRecords(source, status, workspaceId, eventId);
  const body = {
    workspace_id: workspaceId, lead_id: 0, source, source_old: source, status, event_id: eventId,
    payload: JSON.stringify(payload), error: null, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  const result = (rows[0]
    ? await webhookLogsApi.updateWebhookLog(rows[0].id, body)
    : await webhookLogsApi.createWebhookLog(body)) as ApiResponse;
  if (result.status !== 'success') throw new Error('Unable to save integration settings');
}

export async function deleteIntegrationRecords(rows: WebhookLog[]): Promise<void> {
  for (const row of rows) {
    const result = await webhookLogsApi.deleteWebhookLog(row.id) as ApiResponse;
    if (result.status !== 'success') throw new Error('Unable to remove integration settings');
  }
}
