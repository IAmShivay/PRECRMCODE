import {
  MCP_RATE_LIMIT_EMAIL_VERIFY_PER_MINUTE,
  MCP_RATE_LIMIT_GLOBAL_PER_MINUTE,
  MCP_RATE_LIMIT_WHATSAPP_PER_MINUTE,
  MCP_TOOL_SEND_WHATSAPP_MESSAGE,
  MCP_TOOL_VERIFY_EMAIL,
} from '../../types/constants.js';

interface RateLimitBucket {
  global: number[];
  emailVerify: number[];
  whatsapp: number[];
}

const buckets = new Map<number, RateLimitBucket>();

function pruneOld(timestamps: number[], windowMs = 60000, now = Date.now()): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

export function checkMcpRateLimit(
  workspaceId: number,
  toolName: string
): { allowed: boolean; reason?: string } {
  const now = Date.now();
  let bucket = buckets.get(workspaceId);
  if (!bucket) {
    bucket = { global: [], emailVerify: [], whatsapp: [] };
    buckets.set(workspaceId, bucket);
  }

  bucket.global = pruneOld(bucket.global, 60000, now);
  if (bucket.global.length >= MCP_RATE_LIMIT_GLOBAL_PER_MINUTE) {
    return {
      allowed: false,
      reason: `Workspace rate limit exceeded (${MCP_RATE_LIMIT_GLOBAL_PER_MINUTE} calls/min)`,
    };
  }

  if (toolName === MCP_TOOL_VERIFY_EMAIL) {
    bucket.emailVerify = pruneOld(bucket.emailVerify, 60000, now);
    if (bucket.emailVerify.length >= MCP_RATE_LIMIT_EMAIL_VERIFY_PER_MINUTE) {
      return {
        allowed: false,
        reason: `Email verification rate limit exceeded (${MCP_RATE_LIMIT_EMAIL_VERIFY_PER_MINUTE} calls/min)`,
      };
    }
    bucket.emailVerify.push(now);
  }

  if (toolName === MCP_TOOL_SEND_WHATSAPP_MESSAGE) {
    bucket.whatsapp = pruneOld(bucket.whatsapp, 60000, now);
    if (bucket.whatsapp.length >= MCP_RATE_LIMIT_WHATSAPP_PER_MINUTE) {
      return {
        allowed: false,
        reason: `WhatsApp messaging rate limit exceeded (${MCP_RATE_LIMIT_WHATSAPP_PER_MINUTE} calls/min)`,
      };
    }
    bucket.whatsapp.push(now);
  }

  bucket.global.push(now);
  return { allowed: true };
}
