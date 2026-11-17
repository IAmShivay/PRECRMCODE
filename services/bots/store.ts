import { botsApi } from '../api.js';
import type { AutomationConditions } from '../automations/constants.js';
import { createdIdOf, nowSql, parseJsonObject, parseSqlDate } from '../automations/store.js';
import { BOT_TRIGGERS, BOTS_CACHE_MS, type Bot, type Step } from './constants.js';

export { createdIdOf, nowSql, parseJsonObject, parseSqlDate };

const botsCache = new Map<number, { expiresAt: number; bots: Bot[] }>();

export function parseScript(value: unknown): Step[] {
  if (Array.isArray(value)) return value as Step[];
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? (parsed as Step[]) : [];
  } catch {
    return [];
  }
}

export function toBot(row: any): Bot | null {
  const trigger = String(row?.trigger_type || '');
  if (!(BOT_TRIGGERS as readonly string[]).includes(trigger)) return null;
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    name: String(row.name || ''),
    active: Number(row.active) === 1 || row.active === true,
    sort_order: Number(row.sort_order) || 0,
    trigger_type: trigger as Bot['trigger_type'],
    pipeline_slug: String(row.pipeline_slug || 'default'),
    stage: String(row.stage || ''),
    conditions: parseJsonObject(row.conditions) as AutomationConditions,
    script: parseScript(row.script),
    created_by: Number(row.created_by) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toRow(bot: Omit<Bot, 'id'>) {
  return {
    workspace_id: bot.workspace_id,
    name: bot.name,
    active: bot.active ? 1 : 0,
    sort_order: bot.sort_order,
    trigger_type: bot.trigger_type,
    pipeline_slug: bot.pipeline_slug,
    stage: bot.stage,
    conditions: JSON.stringify(bot.conditions || {}),
    script: JSON.stringify(bot.script || []),
    created_by: bot.created_by || 0,
    created_at: bot.created_at || nowSql(),
    updated_at: nowSql(),
  };
}

export async function listWorkspaceBots(workspaceId: number, fresh = false): Promise<Bot[]> {
  const cached = botsCache.get(workspaceId);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.bots;
  const res: any = await botsApi.list({ workspace_id: workspaceId, limit: 500 }, { fresh: true });
  if (res?.status !== 'success' || !Array.isArray(res.data)) {
    throw new Error(res?.message || res?.error || 'Could not load bots');
  }
  const bots = res.data
    .filter((row: any) => Number(row.workspace_id) === workspaceId)
    .map(toBot)
    .filter(Boolean)
    .sort((a: Bot, b: Bot) => a.sort_order - b.sort_order || a.id - b.id) as Bot[];
  botsCache.set(workspaceId, { expiresAt: Date.now() + BOTS_CACHE_MS, bots });
  return bots;
}

export function invalidateBots(workspaceId: number) {
  botsCache.delete(workspaceId);
}
