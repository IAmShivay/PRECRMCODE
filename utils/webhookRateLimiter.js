/**
 * In-memory rate limiter for identical webhook bodies.
 *
 * Catches rapid-fire duplicate submissions (double-clicks, webhook retries)
 * BEFORE they hit the database-backed dedup system.  This is an ADDITIVE
 * safety layer — it does NOT replace the existing source_ref / email dedup.
 *
 * Design principles:
 *   1. FAIL-OPEN  — any error inside the limiter lets the request through.
 *                   The rate limiter must never be the reason a lead is lost.
 *   2. SHORT WINDOW — default 10 s.  Only catches true rapid-fire repeats,
 *                     not legitimate resubmissions minutes or hours apart.
 *   3. BOUNDED MEMORY — hard cap on map size + periodic GC sweep.  The map
 *                       cannot grow unboundedly even under sustained load.
 *   4. ATOMIC CHECK-AND-SET — all Map operations are synchronous.  In Node's
 *                            single-threaded event loop this eliminates race
 *                            conditions between concurrent requests.
 *
 * Configuration (environment variables, re-read on every call):
 *   WEBHOOK_RATE_LIMIT_ENABLED          "true" (default) | "false"
 *   WEBHOOK_RATE_LIMIT_WINDOW_SECONDS   1–300, default 10
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {number} Default rate-limit window in seconds */
const DEFAULT_WINDOW_SECONDS = 10;

/** @type {number} Absolute maximum entries before forced eviction */
const MAX_ENTRIES = 10_000;

/** @type {number} Interval between garbage-collection sweeps (ms) */
const CLEANUP_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Rate-limit map.
 * Key   = "${workspaceId}:${bodyFingerprint}"
 * Value = { timestamp: number (ms), count: number }
 *
 * @type {Map<string, { timestamp: number, count: number }>}
 */
const entries = new Map();

/** @type {ReturnType<typeof setInterval> | null} */
let cleanupTimer = null;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Read the rate-limit window from the environment.
 * Clamped to [1, 300] seconds.  Re-read on every call so the value can be
 * changed at runtime (e.g. via Coolify env editor) without a restart.
 *
 * @returns {number} window in milliseconds
 */
function getWindowMs() {
  const raw = Number(process.env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS);
  const seconds =
    Number.isFinite(raw) && raw >= 1
      ? Math.min(raw, 300)
      : DEFAULT_WINDOW_SECONDS;
  return seconds * 1000;
}

/**
 * Whether the rate limiter is enabled.
 * Defaults to true.  Set WEBHOOK_RATE_LIMIT_ENABLED=false (or "0") to
 * disable entirely — every call to checkWebhookRateLimit will return
 * { limited: false }.
 *
 * @returns {boolean}
 */
function isEnabled() {
  const val = (process.env.WEBHOOK_RATE_LIMIT_ENABLED ?? '').toLowerCase();
  // Only disabled when explicitly set to "false" or "0"
  return val !== 'false' && val !== '0';
}

// ---------------------------------------------------------------------------
// Garbage collection
// ---------------------------------------------------------------------------

/**
 * Start the periodic cleanup timer (idempotent — calling multiple times is
 * safe).  The timer is unref'd so it does not prevent the Node process from
 * exiting.
 */
function startCleanupTimer() {
  if (cleanupTimer !== null) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const windowMs = getWindowMs();
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > windowMs) {
        entries.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the Node process to exit even if the timer is still pending.
  if (
    typeof cleanupTimer === 'object' &&
    cleanupTimer !== null &&
    typeof cleanupTimer.unref === 'function'
  ) {
    cleanupTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Eviction (size cap)
// ---------------------------------------------------------------------------

/**
 * Enforce the hard size cap on the entries map.  Called synchronously before
 * every insert.
 *
 * Strategy:
 *   1. Delete entries older than half the current window (O(n) scan).
 *   2. If still at capacity, clear the entire map.  This briefly disables
 *      rate-limit protection but prevents unbounded memory growth.
 *
 * @param {number} now  Current timestamp (ms)
 * @param {number} windowMs  Current window (ms)
 */
function enforceMaxEntries(now, windowMs) {
  if (entries.size < MAX_ENTRIES) return;

  // Pass 1: evict entries older than half the window
  const cutoff = now - Math.floor(windowMs / 2);
  for (const [key, entry] of entries) {
    if (entry.timestamp < cutoff) {
      entries.delete(key);
    }
  }

  // Pass 2: if still over cap, clear everything (fail-open)
  if (entries.size >= MAX_ENTRIES) {
    console.warn(
      `[WebhookRateLimiter] Map still at capacity (${entries.size}) after aging — clearing entirely.`,
    );
    entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether this workspace + body combination should be rate-limited.
 *
 * The check AND the recording of the first occurrence are performed in a
 * single synchronous block (no await), so two requests that arrive on
 * overlapping event-loop ticks cannot both slip through.
 *
 * @param {number}  workspaceId      Validated positive integer
 * @param {string}  bodyFingerprint  SHA-256 hex digest of the canonical body
 * @returns {{ limited: boolean, hitCount?: number, firstSeenMs?: number }}
 */
export function checkWebhookRateLimit(workspaceId, bodyFingerprint) {
  // ---- Fail-open wrapper ----
  try {
    if (!isEnabled()) {
      return { limited: false };
    }

    const key = `${workspaceId}:${bodyFingerprint}`;
    const now = Date.now();
    const windowMs = getWindowMs();

    // ---- Synchronous check ----
    const existing = entries.get(key);
    if (existing !== undefined && now - existing.timestamp <= windowMs) {
      // Seen this exact body recently — rate-limit it.
      existing.count += 1;
      return {
        limited: true,
        hitCount: existing.count,
        firstSeenMs: now - existing.timestamp,
      };
    }

    // ---- First occurrence (or window expired) — record it ----
    enforceMaxEntries(now, windowMs);
    entries.set(key, { timestamp: now, count: 1 });
    startCleanupTimer();

    return { limited: false };
  } catch (err) {
    // FAIL-OPEN: never block a request because the rate limiter itself broke.
    console.warn(
      '[WebhookRateLimiter] Error during rate-limit check — allowing request:',
      err?.message || err,
    );
    return { limited: false };
  }
}

/**
 * Diagnostic snapshot for debug/monitoring endpoints.
 *
 * @returns {{ enabled: boolean, currentEntries: number, maxEntries: number,
 *             windowSeconds: number, cleanupRunning: boolean }}
 */
export function getWebhookRateLimiterStats() {
  return {
    enabled: isEnabled(),
    currentEntries: entries.size,
    maxEntries: MAX_ENTRIES,
    windowSeconds: getWindowMs() / 1000,
    cleanupRunning: cleanupTimer !== null,
  };
}

/**
 * Tear down the cleanup timer and release all memory.
 * Call during graceful process shutdown.
 */
export function shutdownWebhookRateLimiter() {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  entries.clear();
}
