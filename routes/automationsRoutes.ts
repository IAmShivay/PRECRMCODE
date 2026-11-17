import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { validate } from '../utils/validation.js';
import { automationRunsApi, automationsApi, tasksApi } from '../services/api.js';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  MAX_DELAY_MINUTES,
  RUN_LIST_LIMIT,
  TASK_STATUS,
} from '../services/automations/constants.js';
import { createdIdOf, invalidateRules, listWorkspaceRules, nowSql, toRow, toRule } from '../services/automations/store.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

const stringList = z.array(z.string().trim().min(1).max(80)).max(50).optional();

const ruleSchema = z.object({
  workspace_id: z.number().int().positive(),
  name: z.string().trim().max(120).default(''),
  pipeline_slug: z.string().trim().min(1).max(80).default('default'),
  stage: z.string().trim().max(80).default(''),
  trigger_type: z.enum(AUTOMATION_TRIGGERS),
  delay_minutes: z.number().int().min(0).max(MAX_DELAY_MINUTES).default(0),
  conditions: z
    .object({
      still_in_stage: z.boolean().optional(),
      min_value: z.number().nullable().optional(),
      max_value: z.number().nullable().optional(),
      owner_ids: z.array(z.number().int().positive()).max(50).optional(),
      tags_any: stringList,
      tags_none: stringList,
      lead_sources: stringList,
      priorities: stringList,
    })
    .default({}),
  action_type: z.enum(AUTOMATION_ACTIONS),
  action_config: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(100000).default(0),
});

const taskUpdateSchema = z.object({
  workspace_id: z.number().int().positive(),
  status: z.enum([TASK_STATUS.OPEN, TASK_STATUS.DONE]),
});

type Req = AuthenticatedRequest<any, any, any>;
const fail = (res: Response, status: number, message: string): void => {
  res.status(status).json({ status: 'error', message });
};
const workspaceOf = (req: Req) => Number(req.body?.workspace_id || req.query.workspace_id);
const rowOf = (res: any) => (Array.isArray(res?.data) ? res.data[0] : res?.data);

async function ownedRule(id: number, workspaceId: number) {
  const rule = toRule(rowOf(await automationsApi.get(id)));
  return rule && rule.workspace_id === workspaceId ? rule : null;
}

router.get('/', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    res.json({ status: 'success', data: await listWorkspaceRules(workspaceOf(req), true) });
  } catch (error) {
    console.error('[Automations] list failed', error);
    fail(res, 500, 'Could not load automations. Check the automations table exists in NoCodeBackend.');
  }
});

router.post('/', authMiddleware, validate(ruleSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const body = req.body as z.infer<typeof ruleSchema>;
    const created: any = await automationsApi.create(toRow({ ...body, created_by: Number(req.user?.id) || 0 }));
    if (created?.status !== 'success') return fail(res, 500, 'Could not save automation');
    invalidateRules(body.workspace_id);
    res.status(201).json({ status: 'success', data: { ...body, id: createdIdOf(created) } });
  } catch (error) {
    console.error('[Automations] create failed', error);
    fail(res, 500, 'Could not save automation');
  }
});

router.put('/:id', authMiddleware, validate(ruleSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof ruleSchema>;
    const existing = await ownedRule(id, body.workspace_id);
    if (!existing) return fail(res, 404, 'Automation not found');
    const updated: any = await automationsApi.update(id, toRow({ ...body, created_by: existing.created_by, created_at: existing.created_at }));
    if (updated?.status !== 'success') return fail(res, 500, 'Could not save automation');
    invalidateRules(body.workspace_id);
    res.json({ status: 'success', data: { ...body, id } });
  } catch (error) {
    console.error('[Automations] update failed', error);
    fail(res, 500, 'Could not save automation');
  }
});

router.delete('/:id', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const workspaceId = workspaceOf(req);
    if (!(await ownedRule(id, workspaceId))) return fail(res, 404, 'Automation not found');
    await automationsApi.remove(id);
    invalidateRules(workspaceId);
    res.json({ status: 'success', data: { id } });
  } catch (error) {
    console.error('[Automations] delete failed', error);
    fail(res, 500, 'Could not delete automation');
  }
});

router.get('/runs', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const workspaceId = workspaceOf(req);
    const result: any = await automationRunsApi.list(
      {
        workspace_id: workspaceId,
        automation_id: Number(req.query.automation_id) || undefined,
        sort: 'id',
        order: 'desc',
        limit: Math.min(Number(req.query.limit) || RUN_LIST_LIMIT, 200),
      },
      { fresh: true }
    );
    const rows = Array.isArray(result?.data) ? result.data.filter((run: any) => Number(run.workspace_id) === workspaceId) : [];
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Automations] runs failed', error);
    fail(res, 500, 'Could not load the run log');
  }
});

export const tasksRouter = Router();

tasksRouter.get('/', authMiddleware, workspaceAuthMiddleware, async (req: Req, res: Response) => {
  try {
    const workspaceId = workspaceOf(req);
    const mine = String(req.query.scope || 'mine') === 'mine';
    const result: any = await tasksApi.list(
      {
        workspace_id: workspaceId,
        status: req.query.status ? String(req.query.status) : undefined,
        assigned_to: mine ? Number(req.user?.id) : undefined,
        sort: 'due_at',
        order: 'asc',
        limit: 200,
      },
      { fresh: true }
    );
    const rows = Array.isArray(result?.data) ? result.data.filter((task: any) => Number(task.workspace_id) === workspaceId) : [];
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Tasks] list failed', error);
    fail(res, 500, 'Could not load tasks. Check the tasks table exists in NoCodeBackend.');
  }
});

tasksRouter.put('/:id', authMiddleware, validate(taskUpdateSchema), workspaceAuthMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { workspace_id: workspaceId, status } = req.body as z.infer<typeof taskUpdateSchema>;
    const task = rowOf(await tasksApi.get(id));
    if (!task || Number(task.workspace_id) !== workspaceId) return fail(res, 404, 'Task not found');
    const isAssignee = Number(task.assigned_to) === Number(req.user?.id);
    if (!isAssignee && req.userRole !== 'admin' && req.userRole !== 'owner') return fail(res, 403, 'Only the assignee or an admin can update this task');
    await tasksApi.update(id, { status, completed_at: status === TASK_STATUS.DONE ? nowSql() : null });
    res.json({ status: 'success', data: { ...task, status } });
  } catch (error) {
    console.error('[Tasks] update failed', error);
    fail(res, 500, 'Could not update task');
  }
});

export default router;
