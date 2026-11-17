import crypto from 'crypto';
import { readIntegrationRecords, writeIntegrationRecord } from '../metaIntegrationStore.js';
import { MCP_TOKEN_PREFIX } from '../../types/constants.js';
import type { WorkspaceMcpToken } from '../../types/index.js';
import { webhookLogsApi } from '../api.js';

const MCP_STORE_SOURCE = 'mcp';
const MCP_STORE_STATUS = 'mcp_token';

export async function createWorkspaceMcpToken(
  workspaceId: number,
  userId: number,
  name: string
): Promise<{ token: string; record: WorkspaceMcpToken }> {
  const randomHex = crypto.randomBytes(24).toString('hex');
  const token = `${MCP_TOKEN_PREFIX}${randomHex}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenPrefix = `${token.slice(0, 15)}...${token.slice(-4)}`;
  const now = new Date().toISOString();

  const payload = {
    name,
    token_prefix: tokenPrefix,
    user_id: userId,
    workspace_id: workspaceId,
    active: true,
    created_at: now,
  };

  await writeIntegrationRecord(MCP_STORE_SOURCE, MCP_STORE_STATUS, workspaceId, tokenHash, payload);
  const rows = await readIntegrationRecords(MCP_STORE_SOURCE, MCP_STORE_STATUS, workspaceId, tokenHash);
  const id = rows[0]?.id || Date.now();

  const record: WorkspaceMcpToken = {
    id,
    workspace_id: workspaceId,
    user_id: userId,
    name,
    token_prefix: tokenPrefix,
    token_hash: tokenHash,
    active: true,
    created_at: now,
  };

  return { token, record };
}

export async function validateMcpToken(
  token: string
): Promise<{ valid: boolean; workspaceId?: number; userId?: number }> {
  if (!token || !token.startsWith(MCP_TOKEN_PREFIX)) {
    return { valid: false };
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const rows = await readIntegrationRecords(MCP_STORE_SOURCE, MCP_STORE_STATUS, undefined, tokenHash);
  if (!rows || rows.length === 0) return { valid: false };
  const row = rows[0];
  if (!row) return { valid: false };
  try {
    const payload = JSON.parse(row.payload);
    if (!payload.active) return { valid: false };
    return {
      valid: true,
      workspaceId: Number(row.workspace_id),
      userId: Number(payload.user_id),
    };
  } catch {
    return { valid: false };
  }
}

export async function listWorkspaceMcpTokens(workspaceId: number): Promise<WorkspaceMcpToken[]> {
  const rows = await readIntegrationRecords(MCP_STORE_SOURCE, MCP_STORE_STATUS, workspaceId);
  return rows.map((r) => {
    let payload: any = {};
    try {
      payload = JSON.parse(r.payload);
    } catch {}
    return {
      id: r.id,
      workspace_id: Number(r.workspace_id),
      user_id: Number(payload.user_id || 0),
      name: String(payload.name || 'MCP Token'),
      token_prefix: String(payload.token_prefix || 'scraft_mcp_...'),
      token_hash: r.event_id || '',
      active: Boolean(payload.active),
      created_at: String(payload.created_at || r.created_at),
    };
  });
}

export async function revokeWorkspaceMcpToken(workspaceId: number, tokenId: number): Promise<boolean> {
  const rows = await readIntegrationRecords(MCP_STORE_SOURCE, MCP_STORE_STATUS, workspaceId);
  const target = rows.find((r) => r.id === tokenId);
  if (!target) return false;
  const res = await webhookLogsApi.deleteWebhookLog(tokenId);
  return res.status === 'success';
}
