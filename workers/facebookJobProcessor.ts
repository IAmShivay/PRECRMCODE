import { webhookLogsApi } from '../services/api.js';
import {
  processFacebookLeadJob,
  processFacebookImportJobBatch,
  FacebookLeadJobPayload,
  FacebookImportJobPayload,
} from '../services/facebook.js';
import { ApiResponse, WebhookLog } from '../types/index.js';

const FACEBOOK_LEAD_JOB_PENDING = 'fb_lead_pending';
const FACEBOOK_LEAD_JOB_PROCESSING = 'fb_lead_proc';
const FACEBOOK_LEAD_JOB_COMPLETED = 'fb_lead_done';
const FACEBOOK_LEAD_JOB_FAILED = 'fb_lead_failed';

const FACEBOOK_IMPORT_JOB_PENDING = 'fb_import_pending';
const FACEBOOK_IMPORT_JOB_PROCESSING = 'fb_import_proc';
const FACEBOOK_IMPORT_JOB_COMPLETED = 'fb_import_done';
const FACEBOOK_IMPORT_JOB_FAILED = 'fb_import_failed';

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 10;

let isProcessing = false;
let processingInterval: NodeJS.Timeout | null = null;

async function processLeadJobs(): Promise<void> {
  try {
    const response = (await webhookLogsApi.getWebhookLogs({
      status: FACEBOOK_LEAD_JOB_PENDING,
      limit: BATCH_SIZE,
    })) as ApiResponse<WebhookLog[]>;

    if (response.status !== 'success' || !response.data || response.data.length === 0) {
      return;
    }

    const jobs = Array.isArray(response.data) ? response.data : [response.data];

    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payload || '{}') as FacebookLeadJobPayload & {
          attempts?: number;
          nextRunAt?: string;
        };

        const attempts = payload.attempts || 0;
        if (attempts >= MAX_RETRIES) {
          await webhookLogsApi.updateWebhookLog(job.id, {
            status: FACEBOOK_LEAD_JOB_FAILED,
            error: 'Max retries exceeded',
          });
          continue;
        }

        await webhookLogsApi.updateWebhookLog(job.id, {
          status: FACEBOOK_LEAD_JOB_PROCESSING,
        });

        await processFacebookLeadJob(payload);

        await webhookLogsApi.updateWebhookLog(job.id, {
          status: FACEBOOK_LEAD_JOB_COMPLETED,
          error: null,
        });

        console.log(`[Facebook Job Processor] Successfully processed lead job ${job.event_id}`);
      } catch (error: any) {
        console.error(`[Facebook Job Processor] Error processing lead job ${job.event_id}:`, error);

        const payload = JSON.parse(job.payload || '{}');
        payload.attempts = (payload.attempts || 0) + 1;
        payload.lastError = error?.message || 'Unknown error';
        payload.nextRunAt = new Date(Date.now() + 60000 * Math.pow(2, payload.attempts)).toISOString();

        await webhookLogsApi.updateWebhookLog(job.id, {
          payload: JSON.stringify(payload),
          status: FACEBOOK_LEAD_JOB_PENDING,
          error: error?.message || 'Unknown error',
        });
      }
    }
  } catch (error) {
    console.error('[Facebook Job Processor] Error in processLeadJobs:', error);
  }
}

async function processImportJobs(): Promise<void> {
  try {
    const response = (await webhookLogsApi.getWebhookLogs({
      status: FACEBOOK_IMPORT_JOB_PENDING,
      limit: 5,
    })) as ApiResponse<WebhookLog[]>;

    if (response.status !== 'success' || !response.data || response.data.length === 0) {
      return;
    }

    const jobs = Array.isArray(response.data) ? response.data : [response.data];

    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payload || '{}') as FacebookImportJobPayload & {
          attempts?: number;
          createdAt?: string;
        };

        const attempts = payload.attempts || 0;
        if (attempts >= MAX_RETRIES) {
          await webhookLogsApi.updateWebhookLog(job.id, {
            status: FACEBOOK_IMPORT_JOB_FAILED,
            error: 'Max retries exceeded',
          });
          continue;
        }

        await webhookLogsApi.updateWebhookLog(job.id, {
          status: FACEBOOK_IMPORT_JOB_PROCESSING,
        });

        const result = await processFacebookImportJobBatch(payload);

        if (result.done) {
          await webhookLogsApi.updateWebhookLog(job.id, {
            status: FACEBOOK_IMPORT_JOB_COMPLETED,
            payload: JSON.stringify({ ...payload, stats: result.stats }),
            error: null,
          });
          console.log(
            `[Facebook Job Processor] Import job ${job.event_id} completed. Stats:`,
            result.stats
          );
        } else {
          payload.after = result.nextAfter;
          payload.stats = result.stats;
          await webhookLogsApi.updateWebhookLog(job.id, {
            status: FACEBOOK_IMPORT_JOB_PENDING,
            payload: JSON.stringify(payload),
          });
          console.log(
            `[Facebook Job Processor] Import job ${job.event_id} batch completed. Continuing...`,
            result.stats
          );
        }
      } catch (error: any) {
        console.error(`[Facebook Job Processor] Error processing import job ${job.event_id}:`, error);

        const payload = JSON.parse(job.payload || '{}');
        payload.attempts = (payload.attempts || 0) + 1;
        payload.lastError = error?.message || 'Unknown error';

        if (payload.attempts >= MAX_RETRIES) {
          await webhookLogsApi.updateWebhookLog(job.id, {
            status: FACEBOOK_IMPORT_JOB_FAILED,
            payload: JSON.stringify(payload),
            error: error?.message || 'Unknown error',
          });
        } else {
          await webhookLogsApi.updateWebhookLog(job.id, {
            status: FACEBOOK_IMPORT_JOB_PENDING,
            payload: JSON.stringify(payload),
            error: error?.message || 'Unknown error',
          });
        }
      }
    }
  } catch (error) {
    console.error('[Facebook Job Processor] Error in processImportJobs:', error);
  }
}

async function processJobs(): Promise<void> {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  try {
    await processLeadJobs();
    await processImportJobs();
  } catch (error) {
    console.error('[Facebook Job Processor] Error in processJobs:', error);
  } finally {
    isProcessing = false;
  }
}

export function startFacebookJobProcessor(): void {
  if (processingInterval) {
    console.log('[Facebook Job Processor] Already running');
    return;
  }

  console.log('[Facebook Job Processor] Starting...');
  processingInterval = setInterval(processJobs, POLL_INTERVAL_MS);
  processJobs();
}

export function stopFacebookJobProcessor(): void {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log('[Facebook Job Processor] Stopped');
  }
}
