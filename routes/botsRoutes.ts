import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { validate } from '../utils/validation.js';
import { botRunsApi, botsApi } from '../services/api.js';
import { BOT_ENTITY_TYPES, BOT_RUN_LIST_LIMIT, BOT_TRIGGERS } from '../services/bots/constants.js';
import { scriptSchema } from '../services/bots/schema.js';
import { createdIdOf, invalidateBots, listWorkspaceBots, toBot, toRow } from '../services/bots/store.js';
import { createBotRun } from '../services/bots/engine.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

const stringList = z.array(z.string().trim().min(1).max(80)).max(50).optional();

const botSchema = z.object({
  workspace_id: z.number().int().positive(),
  name: z.string().trim().max(120).default(''),
  pipeline_slug: z.string().trim().min(1).max(80).default('default'),
  stage: z.string().trim().max(80).default(''),
  trigger_type: z.enum(BOT_TRIGGERS),
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
  script: scriptSchema.default([]),
  active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(100000).default(0),
});

const runSchema = z.object({
  workspace_id: z.number().int().positive(),
  entity_id: z.number().int().positive(),
  entity_type: z.enum(BOT_ENTITY_TYPES).default('deal'),
});

type Req = AuthenticatedRequest<any, any, any>;
const fail = (res: Response, status: number, message: string): void => {
  res.status(status).json({ status: 'error', message });
};
const workspaceOf = (req: Req) => Number(req.body?.workspace_id || req.query.workspace_id);
const rowOf = (res: any) => (Array.isArray(res?.data) ? res.data[0] : res?.data);

async function ownedBot(id: number, workspaceId: number) {
  const bot = toBot(rowOf(await botsApi.get(id)));
  return bot && bot.workspace_id === workspaceId ? bot : null;
}

router.get('/', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    res.json({ status: 'success', data: await listWorkspaceBots(workspaceOf(req), true) });
  } catch (error) {
    console.error('[Bots] list failed', error);
    fail(res, 500, 'Could not load bots. Check the bots table exists in NoCodeBackend.');
  }
});

router.get('/runs', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const workspaceId = workspaceOf(req);
    const result: any = await botRunsApi.list(
      {
        workspace_id: workspaceId,
        bot_id: Number(req.query.bot_id) || undefined,
        sort: 'id',
        order: 'desc',
        limit: Math.min(Number(req.query.limit) || BOT_RUN_LIST_LIMIT, 200),
      },
      { fresh: true }
    );
    const rows = Array.isArray(result?.data) ? result.data.filter((run: any) => Number(run.workspace_id) === workspaceId) : [];
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Bots] runs failed', error);
    fail(res, 500, 'Could not load the run log');
  }
});

router.post('/', authMiddleware, validate(botSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const body = req.body as z.infer<typeof botSchema>;
    const created: any = await botsApi.create(toRow({ ...body, created_by: Number(req.user?.id) || 0 }));
    if (created?.status !== 'success') return fail(res, 500, 'Could not save bot');
    invalidateBots(body.workspace_id);
    res.status(201).json({ status: 'success', data: { ...body, id: createdIdOf(created) } });
  } catch (error) {
    console.error('[Bots] create failed', error);
    fail(res, 500, 'Could not save bot');
  }
});

router.put('/:id', authMiddleware, validate(botSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof botSchema>;
    const existing = await ownedBot(id, body.workspace_id);
    if (!existing) return fail(res, 404, 'Bot not found');
    const updated: any = await botsApi.update(id, toRow({ ...body, created_by: existing.created_by, created_at: existing.created_at }));
    if (updated?.status !== 'success') return fail(res, 500, 'Could not save bot');
    invalidateBots(body.workspace_id);
    res.json({ status: 'success', data: { ...body, id } });
  } catch (error) {
    console.error('[Bots] update failed', error);
    fail(res, 500, 'Could not save bot');
  }
});

router.delete('/:id', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const workspaceId = workspaceOf(req);
    if (!(await ownedBot(id, workspaceId))) return fail(res, 404, 'Bot not found');
    await botsApi.remove(id);
    invalidateBots(workspaceId);
    res.json({ status: 'success', data: { id } });
  } catch (error) {
    console.error('[Bots] delete failed', error);
    fail(res, 500, 'Could not delete bot');
  }
});

router.post('/:id/run', authMiddleware, validate(runSchema), workspaceAuthMiddleware, adminOnlyMiddleware, async (req: Req, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof runSchema>;
    const bot = await ownedBot(id, body.workspace_id);
    if (!bot) return fail(res, 404, 'Bot not found');
    const runId = await createBotRun({
      workspaceId: body.workspace_id,
      botId: id,
      entityType: body.entity_type,
      entityId: body.entity_id,
    });
    res.status(201).json({ status: 'success', data: { id: runId, bot_id: id, entity_id: body.entity_id, entity_type: body.entity_type } });
  } catch (error) {
    console.error('[Bots] run failed', error);
    fail(res, 500, 'Could not launch bot');
  }
});

export default router;
