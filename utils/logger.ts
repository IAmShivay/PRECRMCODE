import { randomUUID } from 'crypto';

export type LogLevel = 'info' | 'warn' | 'error';

export function createTraceId(): string {
  try {
    return randomUUID();
  } catch {
    // Fallback: not cryptographically strong, but good enough for log correlation.
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function maskEmail(email: string): string {
  const raw = (email || '').trim();
  if (!raw) return '';

  const at = raw.indexOf('@');
  if (at <= 0) return raw;

  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);

  if (local.length <= 2) return `***@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(0, local.length - 2))}@${domain}`;
}

export function errorToLogObject(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const anyErr = error as any;
    return {
      name: error.name,
      message: error.message,
      // Keep stack for server logs (do not surface to client).
      stack: error.stack,
      ...(anyErr?.code ? { code: anyErr.code } : {}),
      ...(anyErr?.cause ? { cause: String(anyErr.cause) } : {}),
    };
  }
  return { message: String(error) };
}

export function logJson(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(meta || {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

