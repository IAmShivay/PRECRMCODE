import './utils/loadEnv.js';
import express, { Application } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { webhookMiddleware } from './middleware/webhook.js';
import { leadsApi, webhookLogsApi } from './services/api.js';
import { ApiResponse, Lead } from './types/index.js';
import { processFacebookImportJobBatch, processFacebookLeadJob } from './services/facebook.js';
import { processOneLeadAutoReplyEmailJob } from './services/leadAutoReplyEmail.js';
import { processOneWhatsAppSendJob } from './services/whatsapp.js';
import { reconcileFacebookLeadForms } from './services/facebookReconciliation.js';

// Middleware
// import { authMiddleware } from './middleware/auth.js';

// Routes
import sourcesRoutes from './routes/sourcesRoutes.js';
import leadsRoutes from './routes/leadsRoutes.js';
import authRoutes from './routes/authRoutes.js';
import authProtectedRoutes from './routes/authProtectedRoutes.js';
import usersRoutes from './routes/usersRoutes.js';
import workspacesRoutes from './routes/workspacesRoutes.js';
import leadStatusesRoutes from './routes/leadStatusesRoutes.js';
import leadActivitiesRoutes from './routes/leadActivitiesRoutes.js';
import customFieldsRoutes from './routes/customFieldsRoutes.js';
import debugRoutes from './routes/debugRoutes.js';
import facebookRoutes from './routes/facebookRoutes.js';
import emailVerifierRoutes from './routes/emailVerifierRoutes.js';
import dealsRoutes from './routes/dealsRoutes.js';
import customersRoutes from './routes/customersRoutes.js';
import prospectsRoutes from './routes/prospectsRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import whatsappRoutes, { whatsappWebhookRouter } from './routes/whatsappRoutes.js';
import instagramRoutes from './routes/instagramRoutes.js';
import dealAssociationsRoutes from './routes/dealAssociationsRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import mcpRoutes from './routes/mcpRoutes.js';
import automationsRoutes, { tasksRouter } from './routes/automationsRoutes.js';
import botsRoutes from './routes/botsRoutes.js';
import channelRoutes, { conversationsRouter } from './routes/channelRoutes.js';
import { startAutomationWorker } from './services/automations/runner.js';
import { startBotWorker } from './services/bots/runner.js';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

const ENABLE_VERBOSE_SERVER_LOGS =
  process.env.NODE_ENV !== 'production' ||
  String(process.env.VERBOSE_SERVER_LOGS || process.env.VERBOSE_LOGS || '').toLowerCase() ===
    'true';

function logInfo(...args: unknown[]): void {
  if (ENABLE_VERBOSE_SERVER_LOGS) {
    console.log(...args);
  }
}

// Log which API keys are present (without printing any portion of the secret)
logInfo(`[Server] API_KEY loaded: ${process.env.API_KEY ? 'YES' : 'NO'}`);
logInfo(`[Server] REOON_API_KEY loaded: ${process.env.REOON_API_KEY ? 'YES' : 'NO'}`);
logInfo(`[Server] AI API_KEY loaded: ${process.env.GROQ_API_KEY || process.env.GROK_API_KEY || process.env.XAI_API_KEY ? 'YES' : 'NO'}`);
logInfo(`[Server] FACEBOOK_APP_ID loaded: ${process.env.FACEBOOK_APP_ID ? 'YES' : 'NO'}`);
logInfo(`[Server] FACEBOOK_APP_SECRET loaded: ${process.env.FACEBOOK_APP_SECRET ? 'YES' : 'NO'}`);

const missingEnv: string[] = [];
if (!process.env.API_KEY) {
  missingEnv.push('API_KEY');
}
if (missingEnv.length > 0) {
  console.warn(`[Server] Missing recommended env vars: ${missingEnv.join(', ')}`);
}
if (!process.env.JWT_SECRET?.trim()) {
  throw new Error('JWT_SECRET is required');
}

const rawAllowedOrigins: string = String(
  process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || ''
);

function normalizeOrigin(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

const explicitAllowedOrigins: string[] = rawAllowedOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => normalizeOrigin(origin) || origin)
  .filter(Boolean) as string[];

const fallbackOrigins: string[] = [];
for (const key of ['PUBLIC_BASE_URL', 'APP_BASE_URL', 'APP_URL', 'FRONTEND_URL'] as const) {
  const envValue = process.env[key];
  const normalized = envValue ? normalizeOrigin(envValue) : null;
  if (normalized && !explicitAllowedOrigins.includes(normalized) && !fallbackOrigins.includes(normalized)) {
    fallbackOrigins.push(normalized);
  }
}

const productionDefaults: string[] = ['https://breaktheice.in', 'https://www.breaktheice.in', 'https://app.breaktheice.in'];
const developmentDefaults: string[] = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const defaultOrigins = process.env.NODE_ENV === 'production'
  ? [...fallbackOrigins, ...productionDefaults]
  : [...fallbackOrigins, ...productionDefaults, ...developmentDefaults];
for (const origin of defaultOrigins) {
  if (origin && !explicitAllowedOrigins.includes(origin)) {
    explicitAllowedOrigins.push(origin);
  }
}

const allowedOrigins: string[] = explicitAllowedOrigins;
const allowedOriginsSet: Set<string> = new Set(allowedOrigins);

const app: Application = express();
const PORT: number = Number(process.env.PORT) || 3006;

function readBooleanEnv(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function readBoundedNumberEnv(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number = Number.MAX_SAFE_INTEGER
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const PROCESS_ROLE = String(process.env.PROCESS_ROLE || process.env.SCRAFT_PROCESS_ROLE || '')
  .trim()
  .toLowerCase();
const isWorkerRole = PROCESS_ROLE === 'worker' || PROCESS_ROLE === 'all' || PROCESS_ROLE === 'web+worker';
const explicitWorkersEnabled = readBooleanEnv(
  process.env.BACKGROUND_WORKERS_ENABLED || process.env.WORKERS_ENABLED
);
const BACKGROUND_WORKERS_ENABLED =
  explicitWorkersEnabled ?? (PROCESS_ROLE ? isWorkerRole : true);
const HTTP_SERVER_ENABLED = PROCESS_ROLE !== 'worker';
const WORKER_INSTANCE_ID = `${process.env.WORKER_INSTANCE_ID || process.env.HOSTNAME || 'local'}-${process.pid}-${crypto.randomUUID()}`;

app.set('trust proxy', true);
if (allowedOrigins.length === 0) {
  console.warn('[Server] CORS_ALLOWED_ORIGINS is empty - allowing all origins. Set CORS_ALLOWED_ORIGINS in production.');
}
logInfo(`[Server] CORS allowedOrigins: ${allowedOrigins.length > 0 ? [...allowedOriginsSet].join(', ') : '(allow all)'}`);

const webhookCors = cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Workspace-Id', 'X-Webhook-Token', 'X-Channel-Token', 'X-Idempotency-Key', 'X-Request-Id'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
});

const appCors = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin) || origin;
    if (allowedOriginsSet.size === 0) return callback(null, true);
    if (allowedOriginsSet.has(normalized) || allowedOriginsSet.has(origin)) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin} not in [${[...allowedOriginsSet].join(', ')}]`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Workspace-Id', 'X-Webhook-Token', 'X-Channel-Token', 'X-Idempotency-Key', 'X-Request-Id'],
  exposedHeaders: ['Content-Length', 'X-Total-Count'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
});

const PUBLIC_CHANNEL_PATH = /^\/api\/channels\/\d+\/(inbound|poll|widget\.js)$/;
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/webhook') || PUBLIC_CHANNEL_PATH.test(req.path)) {
    return webhookCors(req, _res, next);
  }
  return appCors(req, _res, next);
});
app.use(
  express.json({
    limit: '1mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static files from dist directory (production build)
// Only if dist directory exists (for standalone deployments)
const distCandidates: string[] = [path.join(__dirname, 'dist'), path.join(__dirname, '..', 'dist')];
const distPath: string = distCandidates.find((candidate) => fs.existsSync(candidate)) ?? distCandidates[0] as string;
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  logInfo('[Server] Static files enabled from:', distPath);
} else {
  logInfo('[Server] Static files disabled - dist directory not found');
}

// ============ HEALTH CHECK ============
// Top-level liveness + database-connectivity probe.  Read-only, no auth.
// The underlying leadsApi.getLeads() call is served from the 15-second
// response cache when available, so repeated polls within that window
// do not generate additional NoCodeBackend traffic.
app.get('/api/health', async (_req: express.Request, res: express.Response): Promise<void> => {
  const start = Date.now();
  try {
    const probe = await leadsApi.getLeads({ limit: 1 }) as ApiResponse<Lead[]>;
    const latencyMs = Date.now() - start;
    res.json({
      status: 'ok',
      database: probe.status === 'success' ? 'connected' : 'degraded',
      latency_ms: latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const latencyMs = Date.now() - start;
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: (error as Error).message || 'Health check failed',
      latency_ms: latencyMs,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============ WEBHOOK ROUTES ============
// Support both with and without sourceId (Express doesn't support ? for optional params)
app.post('/api/webhook/:workspaceId/:sourceSlug/:sourceId', webhookMiddleware);
app.post('/api/webhook/:workspaceId/:sourceId', webhookMiddleware);
app.post('/api/webhook/:workspaceId', webhookMiddleware);

// ============ SOURCES ROUTES ============
app.use('/api/sources', sourcesRoutes);

// ============ LEADS ROUTES ============
app.use('/api/leads', leadsRoutes);

// ============ AUTH ROUTES ============
app.use('/api', authRoutes);
app.use('/api', authProtectedRoutes);

// ============ USERS ROUTES ============
app.use('/api/users', usersRoutes);

// ============ WORKSPACES ROUTES ============
app.use('/api/workspaces', workspacesRoutes);
app.use('/api/workspace-members', workspacesRoutes);

// ============ LEAD STATUSES ROUTES ============
app.use('/api/lead-statuses', leadStatusesRoutes);

// ============ LEAD ACTIVITIES ROUTES ============
app.use('/api', leadActivitiesRoutes);

// ============ CUSTOM FIELDS ROUTES ============
app.use('/api', customFieldsRoutes);

// ============ DEALS ROUTES ============
app.use('/api/deals', dealsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/prospects', prospectsRoutes);

// ============ NOTIFICATIONS ROUTES ============
app.use('/api/notifications', notificationsRoutes);

// ============ EMAIL VERIFIER ROUTES ============
app.use('/api/email-verify', emailVerifierRoutes);

// ============ FACEBOOK INTEGRATION ROUTES ============
app.use('/api/facebook', facebookRoutes);

// ============ WHATSAPP INTEGRATION ROUTES ============
app.use('/api/whatsapp/webhook', whatsappWebhookRouter);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/instagram', instagramRoutes);

// ============ INVITATION ROUTES ============
import invitationRoutes from './routes/invitationRoutes.js';
app.use('/api/invitations', invitationRoutes);
app.use('/api', dealAssociationsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/tasks', tasksRouter);
app.use('/api/bots', botsRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/conversations', conversationsRouter);

// ============ DEBUG ROUTES ============
app.use('/api/debug', debugRoutes);

// SPA fallback: serve index.html for all non-API routes
// This must be after all API routes
// Only enable if dist directory exists
if (fs.existsSync(distPath)) {
  app.use((req: express.Request, res: express.Response, next: express.NextFunction): void => {
    // Skip API routes
    if (req.path.startsWith('/api/')) {
      return next();
    }
    // Skip if it's a file request (has extension)
    if (req.path.includes('.')) {
      return next();
    }
    // Serve index.html for all other routes (SPA routing)
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ============ CLEANUP JOB: Permanently delete leads after 7 days ============
/**
 * Cleanup job that runs every 24 hours to permanently delete leads
 * that have been in trash (deleted_at set) for more than 7 days
 */
async function cleanupDeletedLeads(): Promise<void> {
  try {
    logInfo('[Cleanup] Starting cleanup job for deleted leads...');

    // Calculate the cutoff date (7 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    // Phase 1: Paginate through leads in small batches, collecting only IDs to delete.
    // The NoCodeBackend API doesn't support filtering by deleted_at, so we must
    // iterate all leads — but we do it in pages to keep memory usage low.
    const BATCH_SIZE = 200;
    const idsToDelete: number[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await leadsApi.getLeads({ page, limit: BATCH_SIZE }) as ApiResponse<Lead[]>;

      if (response.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
        break;
      }

      for (const lead of response.data) {
        if (!lead.deleted_at) continue;

        try {
          const deletedAtStr = String(lead.deleted_at).trim();
          if (deletedAtStr === '' || deletedAtStr === 'null' || deletedAtStr === 'undefined') continue;

          const deletedDate = new Date(deletedAtStr.replace(' ', 'T'));
          if (!isNaN(deletedDate.getTime()) && deletedDate < cutoffDate) {
            idsToDelete.push(lead.id);
          }
        } catch {
          // Skip leads with unparseable deleted_at
        }
      }

      hasMore = response.metadata?.hasMore === true || response.data.length === BATCH_SIZE;
      page++;
    }

    if (idsToDelete.length === 0) {
      logInfo('[Cleanup] No leads found that need permanent deletion');
      return;
    }

    logInfo(`[Cleanup] Found ${idsToDelete.length} leads to permanently delete`);

    // Phase 2: Delete the identified leads by ID
    let deletedCount = 0;
    let errorCount = 0;

    for (const id of idsToDelete) {
      try {
        await leadsApi.deleteLead(id);
        deletedCount++;
        if (deletedCount % 10 === 0) {
          logInfo(`[Cleanup] Permanently deleted ${deletedCount}/${idsToDelete.length} leads...`);
        }
      } catch (error) {
        console.error(`[Cleanup] Error deleting lead ${id}:`, (error as Error).message);
        errorCount++;
      }
    }

    logInfo(`[Cleanup] Cleanup complete. Deleted: ${deletedCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('[Cleanup] Error in cleanup job:', error);
  }
}

// Run cleanup job immediately on startup (for testing), then every 24 hours
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Run cleanup immediately (optional, for testing)
// cleanupDeletedLeads();

if (BACKGROUND_WORKERS_ENABLED) {
  setInterval(() => {
    cleanupDeletedLeads();
  }, CLEANUP_INTERVAL_MS);

  logInfo(`[Cleanup] Cleanup job scheduled to run every 24 hours`);
} else {
  logInfo('[Cleanup] Cleanup job disabled for this process');
}

const FACEBOOK_LEAD_JOB_PENDING = 'fb_lead_pending';
const FACEBOOK_LEAD_JOB_PROCESSING = 'fb_lead_proc';
const FACEBOOK_LEAD_JOB_COMPLETED = 'fb_lead_done';
const FACEBOOK_LEAD_JOB_FAILED = 'fb_lead_failed';
const FACEBOOK_IMPORT_JOB_PENDING = 'fb_import_pending';
const FACEBOOK_IMPORT_JOB_PROCESSING = 'fb_import_proc';
const FACEBOOK_IMPORT_JOB_COMPLETED = 'fb_import_done';
const FACEBOOK_IMPORT_JOB_FAILED = 'fb_import_failed';

const FACEBOOK_JOB_MAX_ATTEMPTS = Number(process.env.FACEBOOK_JOB_MAX_ATTEMPTS || 8);
const FACEBOOK_JOB_POLL_INTERVAL_MS = Number(process.env.FACEBOOK_JOB_POLL_INTERVAL_MS || 2000);
const FACEBOOK_JOB_FETCH_LIMIT = Number(process.env.FACEBOOK_JOB_FETCH_LIMIT || 25);
const FACEBOOK_JOB_MAX_PAGES = Number(process.env.FACEBOOK_JOB_MAX_PAGES || 20);
const FACEBOOK_JOB_STALE_MS = Number(process.env.FACEBOOK_JOB_STALE_MS || 10 * 60 * 1000);
const LEAD_EMAIL_JOB_POLL_INTERVAL_MS = Number(process.env.LEAD_EMAIL_JOB_POLL_INTERVAL_MS || 2000);
const WHATSAPP_JOB_POLL_INTERVAL_MS = Number(process.env.WHATSAPP_JOB_POLL_INTERVAL_MS || 3000);
const AUTOMATION_POLL_INTERVAL_MS = readBoundedNumberEnv(process.env.AUTOMATION_POLL_INTERVAL_MS, 5000, 1000);
const AUTOMATIONS_WORKER_ENABLED = readBooleanEnv(process.env.AUTOMATIONS_WORKER_ENABLED) ?? BACKGROUND_WORKERS_ENABLED;

if (AUTOMATIONS_WORKER_ENABLED) {
  startAutomationWorker(WORKER_INSTANCE_ID, AUTOMATION_POLL_INTERVAL_MS);
  startBotWorker(`${WORKER_INSTANCE_ID}-bot`, AUTOMATION_POLL_INTERVAL_MS);
}
const FACEBOOK_RECONCILIATION_ENABLED =
  readBooleanEnv(process.env.FACEBOOK_RECONCILIATION_ENABLED) ?? true;
const FACEBOOK_RECONCILIATION_INTERVAL_MS = readBoundedNumberEnv(
  process.env.FACEBOOK_RECONCILIATION_INTERVAL_MS,
  60_000,
  60_000
);
const FACEBOOK_RECONCILIATION_LOOKBACK_MS = readBoundedNumberEnv(
  process.env.FACEBOOK_RECONCILIATION_LOOKBACK_MS,
  24 * 60 * 60 * 1000,
  60_000
);
const FACEBOOK_RECONCILIATION_GRACE_MS = readBoundedNumberEnv(
  process.env.FACEBOOK_RECONCILIATION_GRACE_MS,
  2 * 60 * 1000,
  0
);
const FACEBOOK_RECONCILIATION_BATCH_SIZE = readBoundedNumberEnv(
  process.env.FACEBOOK_RECONCILIATION_BATCH_SIZE,
  50,
  1,
  100
);
const FACEBOOK_RECONCILIATION_MAX_PAGES = readBoundedNumberEnv(
  process.env.FACEBOOK_RECONCILIATION_MAX_PAGES,
  20,
  1,
  100
);

function safeJsonParse(value: any): any {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return null;
  }
}

function computeBackoffMs(attempts: number): number {
  const base = 5000;
  const cappedAttempts = Math.max(0, Math.min(10, attempts));
  const ms = base * Math.pow(2, cappedAttempts);
  return Math.min(ms, 5 * 60 * 1000);
}

function logFacebookWorkerInfo(message: string, context?: Record<string, unknown>): void {
  if (context && Object.keys(context).length > 0) {
    console.info(`[Facebook Sync Worker] ${message}`, context);
    return;
  }
  console.info(`[Facebook Sync Worker] ${message}`);
}

function withWorkerClaim<T extends Record<string, any>>(payload: T): T & {
  workerClaimId: string;
  workerClaimedAt: string;
} {
  return {
    ...payload,
    workerClaimId: WORKER_INSTANCE_ID,
    workerClaimedAt: new Date().toISOString(),
  };
}

async function findWebhookLogByIdAndStatus(log: any, status: string): Promise<any | null> {
  const response = (await webhookLogsApi.getWebhookLogs({
    workspace_id: Number(log.workspace_id || 0),
    status,
    event_id: String(log.event_id || ''),
    source: String(log.source || 'facebook'),
    limit: 10,
    sort: 'id',
    order: 'desc',
    cache: 'no-store',
  })) as any;

  if (response?.status !== 'success' || !Array.isArray(response.data)) return null;
  return response.data.find((entry: any) => Number(entry?.id) === Number(log.id)) || null;
}

async function claimFacebookJobLog(log: any, status: string, payload: Record<string, any>): Promise<boolean> {
  await webhookLogsApi.updateWebhookLog(log.id, {
    workspace_id: log.workspace_id,
    lead_id: log.lead_id || 0,
    source: log.source || 'facebook',
    event_id: log.event_id,
    payload: JSON.stringify(payload),
    status,
    error: null,
  });

  const claimed = await findWebhookLogByIdAndStatus(log, status);
  const claimedPayload = safeJsonParse(claimed?.payload);
  return claimedPayload?.workerClaimId === WORKER_INSTANCE_ID;
}

async function findDuePendingLog(status: string): Promise<any | null> {
  const nowMs = Date.now();
  for (let page = 1; page <= FACEBOOK_JOB_MAX_PAGES; page++) {
    const response = (await webhookLogsApi.getWebhookLogs({
      status,
      page,
      limit: FACEBOOK_JOB_FETCH_LIMIT,
      sort: 'id',
      order: 'asc',
      cache: 'no-store',
    })) as any;

    if (response?.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }

    const log = response.data.find((l: any) => {
      const payload = safeJsonParse(l?.payload);
      const nextRunAt = payload?.nextRunAt ? Date.parse(payload.nextRunAt) : nowMs;
      return Number.isFinite(nextRunAt) && nextRunAt <= nowMs;
    });

    if (log) return log;

    if (response.data.length < FACEBOOK_JOB_FETCH_LIMIT) return null;
  }

  return null;
}

async function findStaleProcessingLog(status: string): Promise<any | null> {
  const nowMs = Date.now();
  for (let page = 1; page <= FACEBOOK_JOB_MAX_PAGES; page++) {
    const response = (await webhookLogsApi.getWebhookLogs({
      status,
      page,
      limit: FACEBOOK_JOB_FETCH_LIMIT,
      sort: 'id',
      order: 'asc',
      cache: 'no-store',
    })) as any;

    if (response?.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }

    const log = response.data.find((l: any) => {
      const payload = safeJsonParse(l?.payload);
      const lastStartedAt = payload?.lastStartedAt ? Date.parse(payload.lastStartedAt) : NaN;
      return Number.isFinite(lastStartedAt) && nowMs - lastStartedAt > FACEBOOK_JOB_STALE_MS;
    });

    if (log) return log;

    if (response.data.length < FACEBOOK_JOB_FETCH_LIMIT) return null;
  }

  return null;
}

async function processOneFacebookLeadJob(): Promise<boolean> {
  const staleLog = await findStaleProcessingLog(FACEBOOK_LEAD_JOB_PROCESSING);
  if (staleLog) {
    const stalePayload = safeJsonParse(staleLog.payload);
    if (stalePayload) {
      const requeuedPayload = {
        ...stalePayload,
        nextRunAt: new Date().toISOString(),
        lastErrorAt: new Date().toISOString(),
      };
      await webhookLogsApi.updateWebhookLog(staleLog.id, {
        workspace_id: staleLog.workspace_id,
        lead_id: staleLog.lead_id || 0,
        source: staleLog.source || 'facebook',
        event_id: staleLog.event_id,
        payload: JSON.stringify(requeuedPayload),
        status: FACEBOOK_LEAD_JOB_PENDING,
        error: 'Requeued stale job',
      });
      logFacebookWorkerInfo('Requeued stale lead job', {
        logId: staleLog.id,
        eventId: staleLog.event_id,
      });
      return true;
    }
  }

  const log = await findDuePendingLog(FACEBOOK_LEAD_JOB_PENDING);
  if (!log) return false;

  const payload = safeJsonParse(log.payload);
  if (!payload?.workspaceId || !payload?.userId || !payload?.leadgenId || !payload?.mappingConfig) {
    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: log.workspace_id,
      lead_id: log.lead_id || 0,
      source: log.source || 'facebook',
      event_id: log.event_id,
      payload: log.payload,
      status: FACEBOOK_LEAD_JOB_FAILED,
      error: 'Invalid job payload',
    });
    console.warn('[Facebook Sync Worker] Marked lead job as failed due to invalid payload', {
      logId: log.id,
      eventId: log.event_id,
    });
    return true;
  }

  const claimedPayload = withWorkerClaim({
    ...payload,
    attempts: Number(payload.attempts || 0),
    lastStartedAt: new Date().toISOString(),
  });

  const claimed = await claimFacebookJobLog(log, FACEBOOK_LEAD_JOB_PROCESSING, claimedPayload);
  if (!claimed) {
    logFacebookWorkerInfo('Skipped lead job after claim verification failed', {
      logId: log.id,
      eventId: log.event_id,
      workerId: WORKER_INSTANCE_ID,
    });
    return true;
  }

  logFacebookWorkerInfo('Processing lead job', {
    logId: log.id,
    eventId: log.event_id,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    leadgenId: payload.leadgenId,
  });

  try {
    await processFacebookLeadJob({
      workspaceId: Number(payload.workspaceId),
      userId: Number(payload.userId),
      leadgenId: String(payload.leadgenId),
      pageId: String(payload.pageId || ''),
      formId: String(payload.formId || ''),
      mappingConfig: payload.mappingConfig,
    });

    const completedPayload = {
      ...claimedPayload,
      lastCompletedAt: new Date().toISOString(),
    };

    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: log.workspace_id,
      lead_id: log.lead_id || 0,
      source: log.source || 'facebook',
      event_id: log.event_id,
      payload: JSON.stringify(completedPayload),
      status: FACEBOOK_LEAD_JOB_COMPLETED,
      error: null,
    });

    logFacebookWorkerInfo('Lead job completed', {
      logId: log.id,
      eventId: log.event_id,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      leadgenId: payload.leadgenId,
    });
  } catch (error: any) {
    const attempts = Number(claimedPayload.attempts || 0) + 1;
    const nextRunAt = new Date(Date.now() + computeBackoffMs(attempts)).toISOString();
    const retryPayload = {
      ...claimedPayload,
      attempts,
      nextRunAt,
      lastErrorAt: new Date().toISOString(),
    };

    const terminal = attempts >= FACEBOOK_JOB_MAX_ATTEMPTS;

    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: log.workspace_id,
      lead_id: log.lead_id || 0,
      source: log.source || 'facebook',
      event_id: log.event_id,
      payload: JSON.stringify(retryPayload),
      status: terminal ? FACEBOOK_LEAD_JOB_FAILED : FACEBOOK_LEAD_JOB_PENDING,
      error: String(error?.message || 'Job failed').slice(0, 1000),
    });

    console.error('[Facebook Sync Worker] Lead job failed', {
      logId: log.id,
      eventId: log.event_id,
      attempts,
      terminal,
      nextRunAt: terminal ? null : nextRunAt,
      error: String(error?.message || 'Job failed').slice(0, 1000),
    });
  }

  return true;
}

async function processOneFacebookImportJob(): Promise<boolean> {
  const staleLog = await findStaleProcessingLog(FACEBOOK_IMPORT_JOB_PROCESSING);
  if (staleLog) {
    const stalePayload = safeJsonParse(staleLog.payload);
    if (stalePayload) {
      const requeuedPayload = {
        ...stalePayload,
        nextRunAt: new Date().toISOString(),
        lastErrorAt: new Date().toISOString(),
      };
      await webhookLogsApi.updateWebhookLog(staleLog.id, {
        workspace_id: staleLog.workspace_id,
        lead_id: staleLog.lead_id || 0,
        source: staleLog.source || 'facebook',
        event_id: staleLog.event_id,
        payload: JSON.stringify(requeuedPayload),
        status: FACEBOOK_IMPORT_JOB_PENDING,
        error: 'Requeued stale job',
      });
      logFacebookWorkerInfo('Requeued stale import job', {
        logId: staleLog.id,
        eventId: staleLog.event_id,
      });
      return true;
    }
  }

  const log = await findDuePendingLog(FACEBOOK_IMPORT_JOB_PENDING);
  if (!log) return false;

  const payload = safeJsonParse(log.payload);
  if (
    !payload?.workspaceId ||
    !payload?.userId ||
    !payload?.pageId ||
    !payload?.formId ||
    !payload?.mappingConfig
  ) {
    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: log.workspace_id,
      lead_id: log.lead_id || 0,
      source: log.source || 'facebook',
      event_id: log.event_id,
      payload: log.payload,
      status: FACEBOOK_IMPORT_JOB_FAILED,
      error: 'Invalid job payload',
    });
    console.warn('[Facebook Sync Worker] Marked import job as failed due to invalid payload', {
      logId: log.id,
      eventId: log.event_id,
    });
    return true;
  }

  const claimedPayload = withWorkerClaim({
    ...payload,
    attempts: Number(payload.attempts || 0),
    lastStartedAt: new Date().toISOString(),
    stats: payload.stats || { processed: 0, created: 0, duplicates: 0, errors: 0 },
  });

  const claimed = await claimFacebookJobLog(log, FACEBOOK_IMPORT_JOB_PROCESSING, claimedPayload);
  if (!claimed) {
    logFacebookWorkerInfo('Skipped import job after claim verification failed', {
      logId: log.id,
      eventId: log.event_id,
      workerId: WORKER_INSTANCE_ID,
    });
    return true;
  }

  logFacebookWorkerInfo('Processing import job batch', {
    logId: log.id,
    eventId: log.event_id,
    workspaceId: claimedPayload.workspaceId,
    userId: claimedPayload.userId,
    formId: claimedPayload.formId,
    pageId: claimedPayload.pageId,
    after: claimedPayload.after || null,
  });

  try {
    const result = await processFacebookImportJobBatch({
      workspaceId: Number(claimedPayload.workspaceId),
      userId: Number(claimedPayload.userId),
      pageId: String(claimedPayload.pageId),
      formId: String(claimedPayload.formId),
      mappingConfig: claimedPayload.mappingConfig,
      after: claimedPayload.after,
      stats: claimedPayload.stats,
      batchSize: Number(claimedPayload.batchSize || 50),
    });

    if (result.done) {
      const completedPayload = {
        ...claimedPayload,
        stats: result.stats,
        lastCompletedAt: new Date().toISOString(),
      };

      await webhookLogsApi.updateWebhookLog(log.id, {
        workspace_id: log.workspace_id,
        lead_id: log.lead_id || 0,
        source: log.source || 'facebook',
        event_id: log.event_id,
        payload: JSON.stringify(completedPayload),
        status: FACEBOOK_IMPORT_JOB_COMPLETED,
        error: null,
      });

      logFacebookWorkerInfo('Import job completed', {
        logId: log.id,
        eventId: log.event_id,
        stats: result.stats,
      });
    } else {
      const nextRunAt = new Date(Date.now() + 1500).toISOString();
      const nextPayload = {
        ...claimedPayload,
        after: result.nextAfter,
        stats: result.stats,
        nextRunAt,
      };

      await webhookLogsApi.updateWebhookLog(log.id, {
        workspace_id: log.workspace_id,
        lead_id: log.lead_id || 0,
        source: log.source || 'facebook',
        event_id: log.event_id,
        payload: JSON.stringify(nextPayload),
        status: FACEBOOK_IMPORT_JOB_PENDING,
        error: null,
      });

      logFacebookWorkerInfo('Import job batch queued for next cursor', {
        logId: log.id,
        eventId: log.event_id,
        nextAfter: result.nextAfter || null,
        stats: result.stats,
      });
    }
  } catch (error: any) {
    const attempts = Number(claimedPayload.attempts || 0) + 1;
    const nextRunAt = new Date(Date.now() + computeBackoffMs(attempts)).toISOString();
    const retryPayload = {
      ...claimedPayload,
      attempts,
      nextRunAt,
      lastErrorAt: new Date().toISOString(),
    };

    const terminal = attempts >= FACEBOOK_JOB_MAX_ATTEMPTS;

    await webhookLogsApi.updateWebhookLog(log.id, {
      workspace_id: log.workspace_id,
      lead_id: log.lead_id || 0,
      source: log.source || 'facebook',
      event_id: log.event_id,
      payload: JSON.stringify(retryPayload),
      status: terminal ? FACEBOOK_IMPORT_JOB_FAILED : FACEBOOK_IMPORT_JOB_PENDING,
      error: String(error?.message || 'Job failed').slice(0, 1000),
    });

    console.error('[Facebook Sync Worker] Import job failed', {
      logId: log.id,
      eventId: log.event_id,
      attempts,
      terminal,
      nextRunAt: terminal ? null : nextRunAt,
      error: String(error?.message || 'Job failed').slice(0, 1000),
    });
  }

  return true;
}

if (BACKGROUND_WORKERS_ENABLED) {
  logInfo('[Workers] Background workers enabled', {
    processRole: PROCESS_ROLE || 'default',
    workerInstanceId: WORKER_INSTANCE_ID,
  });

  let facebookWorkerRunning = false;
  setInterval(async () => {
    if (facebookWorkerRunning) return;
    facebookWorkerRunning = true;
    try {
      const didLead = await processOneFacebookLeadJob();
      const didImport = didLead ? false : await processOneFacebookImportJob();
      void didImport;
    } catch (error: any) {
      console.error('[Facebook Sync Worker] Poll cycle failed', error?.message || error);
    } finally {
      facebookWorkerRunning = false;
    }
  }, FACEBOOK_JOB_POLL_INTERVAL_MS);

  let leadEmailWorkerRunning = false;
  setInterval(async () => {
    if (leadEmailWorkerRunning) return;
    leadEmailWorkerRunning = true;
    try {
      await processOneLeadAutoReplyEmailJob(WORKER_INSTANCE_ID);
    } catch (error: any) {
      console.error('[Lead Email Worker] Poll cycle failed', error?.message || error);
    } finally {
      leadEmailWorkerRunning = false;
    }
  }, LEAD_EMAIL_JOB_POLL_INTERVAL_MS);

  let whatsAppWorkerRunning = false;
  setInterval(async () => {
    if (whatsAppWorkerRunning) return;
    whatsAppWorkerRunning = true;
    try {
      await processOneWhatsAppSendJob(WORKER_INSTANCE_ID);
    } catch (error: any) {
      console.error('[WhatsApp Worker] Poll cycle failed', error?.message || error);
    } finally {
      whatsAppWorkerRunning = false;
    }
  }, WHATSAPP_JOB_POLL_INTERVAL_MS);

  if (FACEBOOK_RECONCILIATION_ENABLED) {
    let facebookReconciliationRunning = false;
    const runFacebookReconciliation = async (): Promise<void> => {
      if (facebookReconciliationRunning) return;
      facebookReconciliationRunning = true;
      try {
        const result = await reconcileFacebookLeadForms({
          batchSize: FACEBOOK_RECONCILIATION_BATCH_SIZE,
          gracePeriodMs: FACEBOOK_RECONCILIATION_GRACE_MS,
          lookbackMs: FACEBOOK_RECONCILIATION_LOOKBACK_MS,
          maxPages: FACEBOOK_RECONCILIATION_MAX_PAGES,
        });
        if (result.leadsCreated > 0 || result.errors > 0) {
          console.info('[Facebook Reconciliation] Cycle completed', result);
        }
      } catch (error) {
        console.error(
          '[Facebook Reconciliation] Cycle failed',
          (error as Error).message || error
        );
      } finally {
        facebookReconciliationRunning = false;
      }
    };

    setTimeout(() => {
      void runFacebookReconciliation();
    }, 10_000);
    setInterval(() => {
      void runFacebookReconciliation();
    }, FACEBOOK_RECONCILIATION_INTERVAL_MS);
  }
} else {
  logInfo('[Workers] Background workers disabled for this process', {
    processRole: PROCESS_ROLE || 'default',
  });
}

// Start server
if (HTTP_SERVER_ENABLED) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
} else {
  logInfo('[Server] HTTP listener disabled for worker-only process');
}
