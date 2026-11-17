import { automationsApi } from '../api.js';
import { formatMySqlDateTimeUtc } from '../../lib/validation.js';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, RULES_CACHE_MS, type AutomationRule } from './constants.js';

const rulesCache = new Map<number, { expiresAt: number; rules: AutomationRule[] }>();

export const nowSql = () => formatMySqlDateTimeUtc(new Date());

export const parseSqlDate = (value: unknown): number => {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

export const parseJsonObject = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export function toRule(row: any): AutomationRule | null {
  const trigger = String(row?.trigger_type || '');
  const action = String(row?.action_type || '');
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)) return null;
  if (!(AUTOMATION_ACTIONS as readonly string[]).includes(action)) return null;
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    pipeline_slug: String(row.pipeline_slug || 'default'),
    stage: String(row.stage || ''),
    name: String(row.name || ''),
    trigger_type: trigger as AutomationRule['trigger_type'],
    conditions: parseJsonObject(row.conditions),
    delay_minutes: Math.max(0, Number(row.delay_minutes) || 0),
    action_type: action as AutomationRule['action_type'],
    action_config: parseJsonObject(row.action_config),
    active: Number(row.active) === 1 || row.active === true,
    sort_order: Number(row.sort_order) || 0,
    created_by: Number(row.created_by) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toRow(rule: Omit<AutomationRule, 'id'>) {
  return {
    workspace_id: rule.workspace_id,
    pipeline_slug: rule.pipeline_slug,
    stage: rule.stage,
    name: rule.name,
    trigger_type: rule.trigger_type,
    conditions: JSON.stringify(rule.conditions || {}),
    delay_minutes: rule.delay_minutes,
    action_type: rule.action_type,
    action_config: JSON.stringify(rule.action_config || {}),
    active: rule.active ? 1 : 0,
    sort_order: rule.sort_order,
    created_by: rule.created_by || 0,
    created_at: rule.created_at || nowSql(),
    updated_at: nowSql(),
  };
}

export async function listWorkspaceRules(workspaceId: number, fresh = false): Promise<AutomationRule[]> {
  const cached = rulesCache.get(workspaceId);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.rules;
  const res: any = await automationsApi.list({ workspace_id: workspaceId, limit: 500 }, { fresh: true });
  if (res?.status !== 'success' || !Array.isArray(res.data)) {
    throw new Error(res?.message || res?.error || 'Could not load automations');
  }
  const rules = res.data
    .filter((row: any) => Number(row.workspace_id) === workspaceId)
    .map(toRule)
    .filter(Boolean)
    .sort((a: AutomationRule, b: AutomationRule) => a.sort_order - b.sort_order || a.id - b.id) as AutomationRule[];
  rulesCache.set(workspaceId, { expiresAt: Date.now() + RULES_CACHE_MS, rules });
  return rules;
}

export function invalidateRules(workspaceId: number) {
  rulesCache.delete(workspaceId);
}

export const createdIdOf = (res: any): number =>
  Number(res?.id ?? res?.data?.id ?? res?.data?.[0]?.id ?? 0) || 0;
