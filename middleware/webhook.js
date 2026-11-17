/**
 * Webhook Middleware
 * Processes incoming webhooks and stores leads in the database
 */

import {
  leadsApi,
  webhookLogsApi,
  customFieldValuesApi,
  customFieldsApi,
  leadStatusesApi,
} from '../services/api.js';
import crypto from 'crypto';
import { emitAutomationEvent } from '../services/automations/engine.js';
import { SourceRegistry } from '../services/sourceRegistry.js';
import { normalizeSourceString } from '../types/sources.js';
import { validatePhone, formatMySqlDateTimeUtc } from '../lib/validation.js';
import { sanitizeWebhookBody } from '../utils/validation.js';
import { verifyEmail as verifyEmailAPI, isEmailValid } from '../services/emailVerifier.js';
import {
  enqueueLeadAutoReplyEmailJob,
  sendLeadNotificationForNewLead,
} from '../services/leadAutoReplyEmail.js';
import { enqueueWhatsAppMessage } from '../services/whatsapp.js';
import { checkWebhookRateLimit } from '../utils/webhookRateLimiter.js';
import { ensureDealForLead, logWebFormDealOutcome } from '../services/webFormDeals.js';

const ENABLE_VERBOSE_WEBHOOK_LOGS =
  process.env.NODE_ENV !== 'production' ||
  String(process.env.WEBHOOK_VERBOSE_LOGS || process.env.VERBOSE_LOGS || '').toLowerCase() ===
    'true';

function debugLog(...args) {
  if (ENABLE_VERBOSE_WEBHOOK_LOGS) {
    console.log(...args);
  }
}

// ---------------------------------------------------------------------------
// Dedup time-window configuration
// Only treat a lead as a duplicate if it was created within this window.
// Default: 48 hours (2 days). Override via DEDUP_WINDOW_HOURS env var.
// ---------------------------------------------------------------------------
const DEDUP_WINDOW_HOURS = Math.max(1, Number(process.env.DEDUP_WINDOW_HOURS) || 48);
const DEDUP_WINDOW_MS = DEDUP_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Parse a created_at value (MySQL "YYYY-MM-DD HH:MM:SS" or ISO-8601) to a
 * Date.  Returns null if the value is missing or unparseable.
 */
function parseDateSafe(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str || str === 'null' || str === 'undefined') return null;
  const normalized = str.includes('T') ? str : `${str.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Returns true when the existing lead should block a new submission, i.e. it
 * was created recently (within DEDUP_WINDOW_MS) AND is not soft-deleted.
 *
 * Soft-deleted leads (deleted_at is set) never block new submissions because
 * the user explicitly removed them from the CRM.
 */
function isDuplicateWithinWindow(lead) {
  // Soft-deleted leads must not block new submissions
  const deletedAt = lead.deleted_at != null ? String(lead.deleted_at).trim() : '';
  if (deletedAt && deletedAt !== 'null' && deletedAt !== 'undefined') {
    return false;
  }

  const createdAt = parseDateSafe(lead.created_at);
  if (!createdAt) {
    // If we cannot parse the date fall back to treating it as within-window so
    // existing (timeless) records still receive basic dedup protection.
    return true;
  }

  return (Date.now() - createdAt.getTime()) <= DEDUP_WINDOW_MS;
}

async function getCustomSourceRegistryEntry(workspaceId, sourceId) {
  const response = await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: 'source_registry',
    event_id: sourceId,
  });

  if (response.status === 'success' && Array.isArray(response.data) && response.data.length > 0) {
    return response.data[0];
  }

  return null;
}

function readWebhookSecret(entry) {
  if (!entry?.payload) return null;
  try {
    const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
    const secret = String(payload?.webhookSecret || '').trim();
    return secret ? secret : null;
  } catch {
    return null;
  }
}

function secretsMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function resolveEmailVerificationStatus(verification, emailValidFlag) {
  const status =
    typeof verification?.status === 'string' ? verification.status.trim().toLowerCase() : '';
  if (status) return status;
  return emailValidFlag === 1 ? 'valid' : 'invalid';
}

async function verifyEmailForLead(email) {
  const toLeadEmailValidFlag = (verification, mode) => {
    if (isEmailValid(verification, mode)) return 1;

    const status =
      typeof verification?.status === 'string' ? verification.status.trim().toLowerCase() : '';
    const syntaxOk = verification?.is_valid_syntax !== false;
    const notDisposable = verification?.is_disposable !== true;
    const notSpamtrap = verification?.is_spamtrap !== true;
    const treatSafeAsDeliverable =
      (status === 'safe' || status === 'valid') && syntaxOk && notDisposable && notSpamtrap;

    return treatSafeAsDeliverable ? 1 : 0;
  };

  try {
    const verification = await verifyEmailAPI(email, 'power');
    const emailValidFlag = toLeadEmailValidFlag(verification, 'power');
    return { verification, mode: 'power', emailValidFlag };
  } catch (powerError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[Webhook] Power email verification failed, falling back to quick:',
        powerError?.message || powerError
      );
    }
    const verification = await verifyEmailAPI(email, 'quick');
    const emailValidFlag = toLeadEmailValidFlag(verification, 'quick');
    return { verification, mode: 'quick', emailValidFlag };
  }
}

async function persistLeadEmailVerification(leadId, payload) {
  const verificationStatus = resolveEmailVerificationStatus(
    payload.verification,
    payload.emailValidFlag
  );
  const verifiedAt = formatMySqlDateTimeUtc(new Date());

  try {
    await leadsApi.updateLead(leadId, {
      email_valid: payload.emailValidFlag,
      email_verification_status: verificationStatus,
      email_verified_at: verifiedAt,
    });
  } catch (richUpdateError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[Webhook] Failed to persist full email verification payload for lead ${leadId}, retrying with email_valid only:`,
        richUpdateError?.message || richUpdateError
      );
    }
    await leadsApi.updateLead(leadId, {
      email_valid: payload.emailValidFlag,
    });
  }
}

async function runLeadEmailVerification(leadId, email) {
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  if (!leadId || !trimmedEmail) return;

  try {
    const { verification, mode, emailValidFlag } = await verifyEmailForLead(trimmedEmail);
    await persistLeadEmailVerification(leadId, { verification, emailValidFlag });
    debugLog(
      `[Webhook] Email verified for lead ${leadId} (${mode}):`,
      { status: verification?.status, email_valid: emailValidFlag }
    );
  } catch (verifyError) {
    console.error(`[Webhook] Email verification failed for lead ${leadId}:`, verifyError?.message || verifyError);
  }
}

/**
 * Webhook middleware for Express
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @param {Function} next
 */
export async function webhookMiddleware(req, res, next) {
  const startTime = Date.now();
  const workspaceId = parseInt(req.params.workspaceId);
  const sourceId = req.params.sourceId || null;
  const sourceSlug = req.params.sourceSlug || null;

  // Validate workspaceId is a positive integer
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({
      status: 'failed',
      error: 'Invalid workspaceId: must be a positive integer',
    });
  }

  // Normalize source for use throughout the function
  let normalizedSource = 'MANUAL';
  let sourceRegistryId = null;
  let mappedByRegistry = null;
  let sourceWebhookSecret = null;

  try {
    const registry = new SourceRegistry(workspaceId);
    const incomingSource = req.body.source || req.body.source_old || sourceSlug || sourceId || 'webhook';

    if (sourceId && /^src_/i.test(sourceId)) {
      const entry = await getCustomSourceRegistryEntry(workspaceId, sourceId);
      if (entry?.source) {
        mappedByRegistry = { displayName: entry.source };
        normalizedSource = normalizeSourceString(entry.source);
        sourceRegistryId = sourceId;
        sourceWebhookSecret = readWebhookSecret(entry);
      } else {
        normalizedSource = normalizeSourceString(incomingSource);
        sourceRegistryId = sourceId;
      }
    } else {
      normalizedSource = normalizeSourceString(incomingSource);
      sourceRegistryId = await registry.getSourceId(normalizedSource);
    }

    debugLog(`[Source Normalization] Mapped "${incomingSource}" to "${normalizedSource}" (sourceId: ${sourceRegistryId})`);
  } catch (sourceError) {
    console.error('[Source Normalization] Warning: Could not normalize source:', sourceError);
  }

  if (sourceWebhookSecret) {
    const providedToken = String(req.query?.token || req.headers?.['x-webhook-token'] || '').trim();
    if (!secretsMatch(providedToken, sourceWebhookSecret)) {
      return res.status(401).json({
        status: 'failed',
        error: 'Invalid or missing webhook token',
      });
    }
  }

  debugLog('📥 Webhook received:', {
    workspaceId,
    sourceId,
    normalizedSource,
    sourceRegistryId,
    body: req.body
  });

  try {
    // Sanitize webhook body (lenient — does not reject, only cleans)
    const { warnings: sanitizeWarnings } = sanitizeWebhookBody(req.body);
    if (sanitizeWarnings.length > 0) {
      console.warn('[Webhook] Body sanitized:', sanitizeWarnings.join('; '));
    }

    const bodyFingerprint = computeBodyFingerprint(req.body);

    // Build a stable, per-submission source_ref for idempotency.
    //
    // IMPORTANT – only fields that are genuinely unique **per form submission**
    // belong here.  Generic identifiers that are shared across submissions
    // (e.g. `id` which may be a page/form/campaign ID, or `session_id` which
    // spans multiple submissions from the same browser session) are excluded
    // because they cause every submission after the first to be silently
    // dropped as a duplicate.
    //
    // If none of the explicit fields are present the SHA-256 body fingerprint
    // is used instead — it is inherently unique per unique request body.
    const explicitEventId =
      req.body?.event_id ??
      req.body?.submission_id ??
      req.body?.submissionId ??
      req.headers?.['x-idempotency-key'] ??
      req.headers?.['x-request-id'] ??
      req.body?.lead_id ??
      req.body?.leadId ??
      req.body?.contact_id ??
      req.body?.contactId ??
      req.body?.utm_id ??
      null;
    const stableSourceRef = toSafeIdPart(String(explicitEventId ?? `fp_${bodyFingerprint.slice(0, 24)}`)).slice(0, 180);

    // 1. Validate required fields
    const nameCandidate =
      (typeof req.body.name === 'string' && req.body.name.trim()) ||
      (typeof req.body.full_name === 'string' && req.body.full_name.trim()) ||
      ((typeof req.body.first_name === 'string' || typeof req.body.last_name === 'string')
        ? `${(req.body.first_name || '').trim()} ${(req.body.last_name || '').trim()}`.trim()
        : '');
    const email = req.body.email;
    if (!email && !nameCandidate) {
      return res.status(400).json({
        status: 'failed',
        error: 'Either email or name is required',
        event_id: stableSourceRef,
      });
    }

    // --- Rapid-fire identical-body rate limit ---
    // Catches double-clicks and webhook retries BEFORE hitting the database.
    // This is additive — the existing source_ref / email dedup still runs for
    // requests that pass the rate limit.
    //
    // Safe to place before dedup because:
    //   - Only IDENTICAL bodies are rate-limited (same fingerprint).
    //   - The email-dedup enrichment path (updating name/phone on an existing
    //     lead) is a no-op for identical bodies — same data, nothing to enrich.
    //   - Fail-open: any error in the limiter allows the request through.
    const rateLimitResult = checkWebhookRateLimit(workspaceId, bodyFingerprint);
    if (rateLimitResult.limited) {
      debugLog(
        `[RateLimit] Blocked duplicate body for workspace ${workspaceId}` +
        ` (seen ${rateLimitResult.hitCount}x in ${rateLimitResult.firstSeenMs}ms)`
      );

      // Fire-and-forget audit log — never let a logging failure affect the
      // response.  The .catch() swallows write errors silently; the lead
      // pipeline must not depend on this log succeeding.
      webhookLogsApi.createWebhookLog({
        workspace_id: workspaceId,
        lead_id: 0,
        source: normalizedSource,
        source_old: normalizedSource,
        event_id: stableSourceRef,
        payload: JSON.stringify(req.body),
        status: 'rate_limited',
        error: `Identical webhook body rate-limited (hit ${rateLimitResult.hitCount}, window ${rateLimitResult.firstSeenMs}ms)`,
      }).catch(() => {});

      return res.json({
        status: 'success',
        message: 'Duplicate submission rate-limited',
        data: {
          is_rate_limited: true,
          is_duplicate: true,
          workspace_id: workspaceId,
          processing_time_ms: Date.now() - startTime,
        },
      });
    }

    // 2. Get default status for this workspace
    const statusId = await getDefaultStatusIdForWorkspace(workspaceId);

    // 3. Get custom fields for this workspace
    const customFields = await getActiveCustomFields(workspaceId);

    // 4. Extract extra fields from webhook payload
    const extraFields = extractCustomFieldValues(req.body, customFields);

    // --- source_ref dedup (idempotency guard) ---
    // Wrapped in try-catch so that a transient NoCodeBackend failure does not
    // crash the entire webhook and return a 500 to the sender.  External
    // systems (Swipe Pages, etc.) may permanently stop retrying after repeated
    // 500 responses, which silently kills lead ingestion for that workspace.
    try {
      const bySourceRef = await leadsApi.searchLeads({
        workspace_id: workspaceId,
        source_ref: stableSourceRef,
      });

      if (bySourceRef.status === 'success' && bySourceRef.data && bySourceRef.data.length > 0) {
        const match = bySourceRef.data.find(isDuplicateWithinWindow);
        if (match) {
          // Fire-and-forget dead-letter log — record the dropped duplicate
          // for auditing without blocking the response.  The .catch()
          // swallows write errors so a logging failure can never break the
          // dedup response path.
          webhookLogsApi.createWebhookLog({
            workspace_id: workspaceId,
            lead_id: match.id,
            source: normalizedSource,
            source_old: normalizedSource,
            event_id: stableSourceRef,
            payload: JSON.stringify(req.body),
            status: 'duplicate_skipped',
            error: `Duplicate lead by source_ref (matched lead ${match.id})`,
          }).catch(() => {});

          return res.json({
            status: 'success',
            message: 'Lead already exists',
            data: {
              lead_id: match.id,
              workspace_id: workspaceId,
              is_duplicate: true,
              source: match.source,
            },
          });
        }
      }
    } catch (sourceRefError) {
      // Log but continue — a failed dedup search should not block lead creation.
      console.warn(
        '[Deduplication] Failed to check for existing leads by source_ref:',
        sourceRefError?.message || sourceRefError
      );
    }

    // --- email dedup (time-windowed) ---
    // Only treat the email as a duplicate if a non-deleted lead with the same
    // email was created within the configurable DEDUP_WINDOW (default 48 h).
    // This allows returning customers to create new leads while still
    // preventing rapid-fire duplicates from webhook retries or double-clicks.
    if (email) {
      try {
        const existingLeadsResponse = await leadsApi.searchLeads({
          workspace_id: workspaceId,
          email,
        });

        if (existingLeadsResponse.status === 'success' && existingLeadsResponse.data && existingLeadsResponse.data.length > 0) {
          const recentDuplicate = existingLeadsResponse.data.find(isDuplicateWithinWindow);

          if (recentDuplicate) {
            // Enrich the existing lead with any new data (name / phone)
            const updatePayload = {};
            const incomingName = (nameCandidate || '').trim();
            const existingName = (recentDuplicate.name || '').trim();
            const emailPrefix = (email || '').split('@')[0] || '';
            if (incomingName && (!existingName || existingName === emailPrefix)) {
              updatePayload.name = incomingName;
            }
            const incomingPhone = (req.body.phone || '').trim();
            const existingPhone = (recentDuplicate.phone || '').trim();
            if (incomingPhone && !existingPhone) {
              // Normalize phone before enriching the existing lead
              const enrichPhoneValidation = validatePhone(incomingPhone, false);
              if (enrichPhoneValidation.valid && enrichPhoneValidation.normalized) {
                updatePayload.phone = enrichPhoneValidation.normalized;
                updatePayload.phone_valid = 1;
              } else {
                updatePayload.phone = incomingPhone;
                updatePayload.phone_valid = 0;
              }
            }
            if (Object.keys(updatePayload).length > 0) {
              await leadsApi.updateLead(recentDuplicate.id, updatePayload);
            }

            await webhookLogsApi.createWebhookLog({
              workspace_id: workspaceId,
              lead_id: recentDuplicate.id,
              source: normalizedSource,
              source_old: normalizedSource,
              event_id: stableSourceRef,
              payload: JSON.stringify(req.body),
              status: 'success',
              error: 'Duplicate lead email - updated existing lead',
            });

            return res.json({
              status: 'success',
              message: 'Lead already exists',
              data: {
                lead_id: recentDuplicate.id,
                workspace_id: workspaceId,
                is_duplicate: true,
                source: recentDuplicate.source,
              },
            });
          }
        }
      } catch (checkError) {
        console.warn('[Deduplication] Failed to check for existing leads by email:', checkError);
      }
    }

    // 5. Create lead in database with normalized source
    const urlSourceName = sourceSlug || (sourceId && !/^src_/i.test(sourceId) ? sourceId : null);
    const desiredSourceName =
      (mappedByRegistry ? (mappedByRegistry.displayName || mappedByRegistry.id || normalizedSource) : null) ||
      req.body.source_old ||
      req.body.source ||
      urlSourceName ||
      normalizedSource;

    const stableSuffix = toSafeIdPart(stableSourceRef).slice(0, 32) || bodyFingerprint.slice(0, 12);
    
    // Validate and normalize phone number if provided
    let normalizedPhone = '';
    let phoneValid = 0;
    if (req.body.phone && req.body.phone.trim()) {
      const phoneValidation = validatePhone(req.body.phone.trim(), false);
      if (phoneValidation.valid && phoneValidation.normalized) {
        normalizedPhone = phoneValidation.normalized;
        phoneValid = 1;
      } else {
        // Log warning but include original phone, marked as invalid
        console.warn(`[Webhook] Invalid phone number provided: ${req.body.phone.trim()}. Error: ${phoneValidation.error || 'Invalid format'}`);
        normalizedPhone = req.body.phone.trim();
        phoneValid = 0;
      }
    }
    
    const leadData = {
      workspace_id: workspaceId,
      name: nameCandidate || email?.split('@')[0] || 'Unknown',
      email: email || '',
      phone: normalizedPhone,
      source: `${normalizedSource}_${stableSuffix}`,
      source_old: desiredSourceName,
      source_ref: stableSourceRef,
      
      // Required fields with defaults
      email_verification_status: 'pending',
      email_valid: 0,
      phone_valid: phoneValid,
    };

    // Include source registry ID if available
    if (sourceRegistryId) {
      leadData.source_id = sourceRegistryId;
    }

    // Only include status_id if we could resolve one for this workspace.
    // Some workspaces may not yet have any statuses configured.
    if (statusId !== null) {
      leadData.status_id = statusId;
    }

    debugLog(`💾 Creating lead (source: ${normalizedSource}, sourceId: ${sourceRegistryId}):`, leadData);

    const leadResponse = await leadsApi.createLead(leadData);

    // Log full response for debugging
    debugLog('📦 NoCodeBackend createLead response:', JSON.stringify(leadResponse, null, 2));

    // NoCodeBackend sometimes returns a weird combination like:
    // { status: "failed", error: "Record created successfully" } even though the insert worked.
    // Treat that specific case as success.
    const isClearlySuccess =
      leadResponse.status === 'success' ||
      (leadResponse.status === 'failed' &&
        (leadResponse.message === 'Record created successfully' ||
          leadResponse.error === 'Record created successfully'));

    if (!isClearlySuccess) {
      throw new Error(leadResponse.message || leadResponse.error || 'Failed to create lead');
    }

    // NoCodeBackend may return the ID in different formats:
    // - leadResponse.data.id (object with id property)
    // - leadResponse.data (direct ID number)
    // - leadResponse.id (top-level id)
    // - Or we may need to query for it if data is null but message says success
    let leadId = null;
    if (leadResponse.data) {
      leadId = leadResponse.data.id || leadResponse.data;
    } else if (leadResponse.id) {
      leadId = leadResponse.id;
    } else if (leadResponse.message && leadResponse.message.includes('created successfully')) {
      // If NoCodeBackend says success but doesn't return the ID, we need to query for it
      // by searching for the most recent lead with matching workspace_id and source_ref
      debugLog('⚠️ No ID in response, querying for created lead...');
      try {
        const searchResponse = await leadsApi.searchLeads({
          workspace_id: workspaceId,
          source_ref: leadData.source_ref,
        });
        if (searchResponse.status === 'success' && searchResponse.data && searchResponse.data.length > 0) {
          // Get the most recent match
          leadId = searchResponse.data[0].id;
          debugLog(`✅ Found created lead via search: ID ${leadId}`);
        } else {
          throw new Error('Lead was created but could not retrieve its ID');
        }
      } catch (searchError) {
        console.error('❌ Failed to query for created lead:', searchError);
        throw new Error('Lead was created but could not retrieve its ID');
      }
    } else {
      throw new Error('Lead creation succeeded but no ID was returned');
    }

    if (!leadId) {
      throw new Error('Could not determine lead ID from response');
    }

    debugLog(`✅ Lead created with ID: ${leadId}`);
    emitAutomationEvent({ workspaceId: Number(workspaceId), type: 'lead_created', leadId: Number(leadId) });

    void enqueueLeadAutoReplyEmailJob({
      workspaceId,
      leadId,
      leadName: leadData.name,
      leadEmail: leadData.email,
      leadPhone: leadData.phone,
      leadSource: leadData.source_old || normalizedSource,
      leadSourceRef: leadData.source_ref,
      leadCreatedAt: leadData.created_at,
    }).catch((queueError) => {
      console.error(
        `[Webhook] Failed to enqueue lead auto-reply for lead ${leadId}:`,
        queueError?.message || queueError
      );
    });

    void sendLeadNotificationForNewLead({
      workspaceId,
      leadId,
      leadName: leadData.name,
      leadEmail: leadData.email,
      leadPhone: leadData.phone,
      leadSource: leadData.source_old || normalizedSource,
      leadSourceRef: leadData.source_ref,
      leadCreatedAt: leadData.created_at,
    }).then((notificationResult) => {
      if (!notificationResult.sent && notificationResult.reason) {
        console.warn(
          `[Webhook] Lead notification email not sent for lead ${leadId}. Reason: ${notificationResult.reason}`
        );
      }
    }).catch((notificationError) => {
      console.error(
        `[Webhook] Failed to send lead notification for lead ${leadId}:`,
        notificationError?.message || notificationError
      );
    });

    void enqueueWhatsAppMessage({
      workspaceId,
      leadId,
      triggerKind: 'new_lead',
      leadName: leadData.name,
      leadPhone: leadData.phone,
      leadEmail: leadData.email,
      leadSource: leadData.source_old || normalizedSource,
    }).catch((waError) => {
      console.error(
        `[Webhook] Failed to enqueue WhatsApp for lead ${leadId}:`,
        waError?.message || waError
      );
    });

    // Auto-verify email in the background so webhook delivery remains responsive.
    if (email && typeof email === 'string' && email.trim()) {
      void runLeadEmailVerification(leadId, email);
    }

    // 6. Save custom field values
    let customFieldsSaved = 0;
    if (extraFields.length > 0) {
      debugLog(`💾 Saving ${extraFields.length} custom field values...`);

      for (const field of extraFields) {
        try {
          await customFieldValuesApi.createCustomFieldValue({
            lead_id: leadId,
            field_id: field.field_id,
            value: field.value,
          });
          customFieldsSaved++;
        } catch (error) {
          console.error(`❌ Failed to save custom field ${field.field_label}:`, error.message);
        }
      }
    }

    // 7. Log webhook activity
    await webhookLogsApi.createWebhookLog({
      workspace_id: workspaceId,
      lead_id: leadId,
      source: normalizedSource,
      source_old: normalizedSource,
      event_id: stableSourceRef,
      payload: JSON.stringify(req.body),
      status: 'success',
      error: null,
    });

    // 8. Create a deal from the form fill when the source has deal automation enabled
    let createdDealId = null;
    let dealSkipReason = null;
    try {
      const dealOutcome = await ensureDealForLead({
        workspaceId,
        sourceId: sourceRegistryId,
        lead: { id: leadId, name: leadData.name, email: leadData.email, phone: leadData.phone },
        payload: req.body,
        sourceRef: stableSourceRef,
      });

      if (dealOutcome.status === 'created') {
        createdDealId = dealOutcome.dealId ?? null;
        debugLog(`✅ Deal created with ID: ${createdDealId}`);
      } else {
        dealSkipReason = dealOutcome.reason ?? null;
      }

      await logWebFormDealOutcome({
        workspaceId,
        leadId,
        sourceId: sourceRegistryId,
        sourceRef: stableSourceRef,
        source: normalizedSource,
        outcome: dealOutcome,
      });
    } catch (dealError) {
      dealSkipReason = dealError?.message || 'Failed to create deal';
      console.error('❌ Failed to create deal from form fill:', dealError);
    }

    const duration = Date.now() - startTime;

    // 9. Return success response
    return res.json({
      status: 'success',
      message: 'Lead created successfully via webhook',
      data: {
        lead_id: leadId,
        deal_id: createdDealId,
        workspace_id: workspaceId,
        source: leadData.source,
        custom_fields_saved: customFieldsSaved,
        deal_skipped_reason: dealSkipReason,
        processing_time_ms: duration,
      },
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);

    // Log failed webhook
    try {
      const failedBodyFingerprint = computeBodyFingerprint(req.body);
      const explicitEventId =
        req.body?.event_id ??
        req.body?.submission_id ??
        req.body?.submissionId ??
        req.headers?.['x-idempotency-key'] ??
        req.headers?.['x-request-id'] ??
        req.body?.lead_id ??
        req.body?.leadId ??
        req.body?.contact_id ??
        req.body?.contactId ??
        req.body?.utm_id ??
        null;
      const stableSourceRef = toSafeIdPart(String(explicitEventId ?? `fp_${failedBodyFingerprint.slice(0, 24)}`)).slice(0, 180);

      await webhookLogsApi.createWebhookLog({
        workspace_id: workspaceId,
        lead_id: 0,
        source: normalizedSource,
        source_old: normalizedSource,
        event_id: stableSourceRef,
        payload: JSON.stringify(req.body),
        status: 'failed',
        error: error.message,
      });
    } catch (logError) {
      console.error('❌ Failed to log webhook error:', logError);
    }

    return res.status(500).json({
      status: 'failed',
      error: error.message || 'Internal server error',
      event_id: req.body?.id || req.body?.event_id || null,
    });
  }
}

/**
 * Get active custom fields for a workspace
 */
async function getActiveCustomFields(workspaceId) {
  try {
    const response = await customFieldsApi.getCustomFields(workspaceId);
    if (response.status === 'success' && response.data) {
      return response.data.filter(field => field.is_active === 1);
    }
    return [];
  } catch (error) {
    console.error('Error fetching custom fields:', error);
    return [];
  }
}

/**
 * Get default status ID for a workspace
 */
async function getDefaultStatusIdForWorkspace(workspaceId) {
  try {
    const response = await leadStatusesApi.getStatuses(workspaceId);
    if (response.status === 'success' && response.data && response.data.length > 0) {
      // First, try to find a status marked as default
      const defaultStatus = response.data.find((s) => s.is_default === 1);
      if (defaultStatus) return defaultStatus.id;
      
      // If no default is marked, prefer "Pending" status
      const pendingStatus = response.data.find(
        (s) => s.slug === 'pending' || s.name.toLowerCase() === 'pending'
      );
      if (pendingStatus) return pendingStatus.id;
      
      // Fall back to first status
      return response.data[0]?.id || null;
    }

    // If no statuses exist for this workspace yet, create "Pending" as default
    debugLog(
      `ℹ️ No lead statuses found for workspace ${workspaceId}, creating default "Pending" status...`
    );

    const createResponse = await leadStatusesApi.createStatus({
      workspace_id: workspaceId,
      name: 'Pending',
      slug: 'pending',
      color: '#6B7280',
      type: 'open',
      is_default: 1,
      is_active: 1,
      order_index: 1,
      is_qualified: 0,
    });

    if (createResponse.status === 'success' && createResponse.id) {
      debugLog(
        `✅ Created default lead status for workspace ${workspaceId} with id ${createResponse.id}`
      );
      return createResponse.id;
    }

    console.error(
      'Failed to create default status for workspace',
      workspaceId,
      createResponse?.message || createResponse?.error
    );
    return null;
  } catch (error) {
    console.error('Error getting default status for workspace', workspaceId, error);
    return null;
  }
}

/**
 * Extract custom field values from webhook payload
 */
function extractCustomFieldValues(payload, customFields) {
  const values = [];

  for (const field of customFields) {
    let value = null;

    // Try different key matching strategies
    const keysToTry = [
      field.slug,
      field.slug.replace(/_/g, ''),
      field.slug.replace(/_/g, '-'),
      field.label.toLowerCase().replace(/\s+/g, '_'),
      field.label.toLowerCase().replace(/\s+/g, '-'),
      toCamelCase(field.label),
    ];

    for (const key of keysToTry) {
      if (payload[key] !== undefined && payload[key] !== null) {
        value = payload[key];
        break;
      }
    }

    if (value !== undefined && value !== null) {
      // Convert value based on field type
      let convertedValue = value;
      if (field.field_type === 'number') {
        convertedValue = String(Number(value));
      } else if (field.field_type === 'checkbox') {
        convertedValue = String(value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0);
      } else if (field.field_type === 'multiselect' && Array.isArray(value)) {
        convertedValue = value.join(',');
      } else {
        convertedValue = String(value);
      }

      values.push({
        field_id: field.id,
        field_slug: field.slug,
        field_label: field.label,
        field_type: field.field_type,
        value: convertedValue,
      });
    }
  }

  return values;
}

/**
 * Convert string to camelCase
 */
function toCamelCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
    .replace(/^[A-Z]/, (chr) => chr.toLowerCase());
}

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function computeBodyFingerprint(body) {
  const input = stableStringify(body);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function toSafeIdPart(str) {
  return String(str).trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/**
 * Generate a unique event ID
 */
function generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
