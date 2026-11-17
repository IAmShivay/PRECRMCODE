type SendEmailResult =
  | { sent: true; messageId?: string }
  | { sent: false; skipped: true; reason: string }
  | { sent: false; skipped?: false; error: string };

import { DEFAULT_WORKSPACE_INVITE_TEMPLATE, WorkspaceInviteEmailTemplate } from './workspaceEmailTemplates.js';
import { errorToLogObject, logJson, maskEmail } from '../utils/logger.js';

export interface SendWorkspaceInviteEmailParams {
  to: string;
  inviterName: string;
  workspaceName: string;
  workspaceId: number;
  template?: WorkspaceInviteEmailTemplate | null;
  traceId?: string;
  inviteToken?: string;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractEmailAddress(value: string): string {
  const raw = stripOuterQuotes(value);
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] || raw).trim();
}

function isValidEmailAddress(value: string): boolean {
  // Simple sanity check (matches typical user-input email format).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function interpolatePlain(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

function renderHtmlTemplate(template: string, vars: Record<string, string>): string {
  const escaped = escapeHtml(template);
  // We replace placeholders after escaping the template so user-provided content can't inject HTML.
  const rendered = escaped.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
  return rendered.replace(/\n/g, '<br />');
}

function getAppUrl(): string | null {
  const raw = (process.env.APP_URL || '').trim();
  if (!raw) return null;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function getAppName(): string {
  return (process.env.APP_NAME || '').trim() || 'Break the ice';
}

function getInviteLink(): string | null {
  const appUrl = getAppUrl();
  if (!appUrl) return null;
  return `${appUrl}/leads`;
}

function getInviteAcceptLink(token: string): string | null {
  const appUrl = getAppUrl();
  if (!appUrl) return null;
  return `${appUrl}/accept-invite/${token}`;
}

function getLearnMoreLink(): string | null {
  const appUrl = getAppUrl();
  if (!appUrl) return null;
  return `${appUrl}/`;
}

function getEmailitConfig(): {
  apiKey: string;
  from: string;
  replyTo?: string;
  apiBaseUrl: string;
  timeoutMs: number;
} | null {
  const apiKey = (process.env.EMAILIT_API_KEY || '').trim();
  const from = (process.env.EMAILIT_FROM || '').trim();
  const replyTo = (process.env.EMAILIT_REPLY_TO || '').trim();
  const apiBaseUrlRaw = (process.env.EMAILIT_API_BASE_URL || 'https://api.emailit.com').trim();
  const timeoutMsRaw = (process.env.EMAILIT_TIMEOUT_MS || '').trim();

  if (!apiKey || !from) return null;

  const timeoutMsParsed = timeoutMsRaw ? Number(timeoutMsRaw) : 60000;
  const timeoutMs =
    Number.isFinite(timeoutMsParsed) && timeoutMsParsed > 0 ? timeoutMsParsed : 60000;

  const apiBaseUrl = apiBaseUrlRaw.endsWith('/') ? apiBaseUrlRaw.slice(0, -1) : apiBaseUrlRaw;

  return {
    apiKey,
    from,
    ...(replyTo ? { replyTo } : {}),
    apiBaseUrl,
    timeoutMs,
  };
}

function buildInviteEmail(params: SendWorkspaceInviteEmailParams & { inviteToken?: string }): {
  subject: string;
  text: string;
  html: string;
} | null {
  const appName = getAppName();
  const acceptUrl = params.inviteToken ? getInviteAcceptLink(params.inviteToken) : getInviteLink();
  const learnMoreUrl = getLearnMoreLink();

  if (!acceptUrl || !learnMoreUrl) return null;

  const inviterName = params.inviterName || 'Someone';
  const workspaceName = params.workspaceName || 'your workspace';

  const tpl = params.template || DEFAULT_WORKSPACE_INVITE_TEMPLATE;

  const plainVars: Record<string, string> = {
    inviterName,
    workspaceName,
    appName,
    acceptUrl,
    learnMoreUrl,
    // In plain text, learnMoreLink should resolve to the URL.
    learnMoreLink: learnMoreUrl,
  };

  const subject = interpolatePlain(tpl.subject, plainVars);
  const introText = interpolatePlain(tpl.intro, plainVars);
  const buttonText = interpolatePlain(tpl.buttonText, plainVars) || 'Accept invite';
  const whatsTitle = interpolatePlain(tpl.whatsTitle, plainVars);
  const whatsBodyText = interpolatePlain(tpl.whatsBody, plainVars);

  const text = [
    introText,
    '',
    `To get started, open this link: ${acceptUrl}`,
    '',
    whatsTitle,
    whatsBodyText,
  ].join('\n');

  const htmlVars: Record<string, string> = {
    inviterName: `<strong>${escapeHtml(inviterName)}</strong>`,
    workspaceName: `<strong>${escapeHtml(workspaceName)}</strong>`,
    appName: escapeHtml(appName),
    acceptUrl: escapeHtml(acceptUrl),
    learnMoreUrl: escapeHtml(learnMoreUrl),
    learnMoreLink: `<a href="${learnMoreUrl}" style="color:#111827; font-weight: 600;" target="_blank" rel="noreferrer">here</a>`,
  };

  const introHtml = renderHtmlTemplate(tpl.intro, htmlVars);
  const whatsTitleHtml = renderHtmlTemplate(tpl.whatsTitle, htmlVars);
  const whatsBodyHtml = renderHtmlTemplate(tpl.whatsBody, htmlVars);

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'; line-height: 1.5; color: #111827;">
    <p style="margin: 0 0 16px 0;">${introHtml}</p>

    <p style="margin: 24px 0; text-align: center;">
      <a
        href="${acceptUrl}"
        style="display: inline-block; background: #0071e3; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 10px; font-weight: 600;"
        target="_blank"
        rel="noreferrer"
      >
        ${escapeHtml(buttonText)}
      </a>
    </p>

    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

    <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #111827;">${whatsTitleHtml}</h3>
    <p style="margin: 0 0 8px 0; color: #374151;">${whatsBodyHtml}</p>

    <p style="margin: 16px 0 0 0; color: #6b7280; font-size: 12px;">
      If the button doesn't work, copy and paste this link into your browser:<br />
      <span style="word-break: break-all;">${acceptUrl}</span>
    </p>
  </div>
  `.trim();

  return { subject, text, html };
}

export async function sendWorkspaceInviteEmail(
  params: SendWorkspaceInviteEmailParams & { inviteToken?: string }
): Promise<SendEmailResult> {
  const traceId = params.traceId;
  const cfg = getEmailitConfig();
  if (!cfg) {
    const reason =
      'Invite email skipped: Emailit is not configured (set EMAILIT_API_KEY and EMAILIT_FROM).';
    logJson('warn', 'workspace_invite_email_skipped', {
      traceId,
      reason,
      workspaceId: params.workspaceId,
      to: maskEmail(params.to),
      configured: {
        emailitApiKey: Boolean((process.env.EMAILIT_API_KEY || '').trim()),
        emailitFrom: Boolean((process.env.EMAILIT_FROM || '').trim()),
        emailitReplyTo: Boolean((process.env.EMAILIT_REPLY_TO || '').trim()),
        appUrl: Boolean((process.env.APP_URL || '').trim()),
      },
    });
    return { sent: false, skipped: true, reason };
  }

  const fromEmail = extractEmailAddress(cfg.from);
  const replyToEmail = extractEmailAddress(cfg.replyTo || cfg.from);

  if (!isValidEmailAddress(fromEmail)) {
    const reason =
      'Invite email skipped: EMAILIT_FROM must be a valid email address (example: noreply@scraftstudio.com or scraftstudio@gmail.com).';
    logJson('warn', 'workspace_invite_email_skipped', {
      traceId,
      reason,
      workspaceId: params.workspaceId,
      to: maskEmail(params.to),
      from: maskEmail(fromEmail),
    });
    return { sent: false, skipped: true, reason };
  }

  if (!isValidEmailAddress(replyToEmail)) {
    const reason =
      'Invite email skipped: EMAILIT_REPLY_TO must be a valid email address (example: info@scraftstudio.com).';
    logJson('warn', 'workspace_invite_email_skipped', {
      traceId,
      reason,
      workspaceId: params.workspaceId,
      to: maskEmail(params.to),
      replyTo: maskEmail(replyToEmail),
    });
    return { sent: false, skipped: true, reason };
  }

  const email = buildInviteEmail(params);
  if (!email) {
    const reason = 'Invite email skipped: APP_URL is not configured (set APP_URL).';
    logJson('warn', 'workspace_invite_email_skipped', {
      traceId,
      reason,
      workspaceId: params.workspaceId,
      to: maskEmail(params.to),
      configured: {
        appUrl: Boolean((process.env.APP_URL || '').trim()),
      },
    });
    return { sent: false, skipped: true, reason };
  }

  const url = `${cfg.apiBaseUrl}/v2/emails`;
  const maxRetriesRaw = (process.env.EMAILIT_MAX_RETRIES || '').trim();
  const retryDelayRaw = (process.env.EMAILIT_RETRY_DELAY_MS || '').trim();
  const maxRetriesParsed = maxRetriesRaw ? Number(maxRetriesRaw) : 2;
  const retryDelayParsed = retryDelayRaw ? Number(retryDelayRaw) : 2000;
  const maxRetries = Number.isFinite(maxRetriesParsed) && maxRetriesParsed >= 0 ? maxRetriesParsed : 2;
  const baseDelay = Number.isFinite(retryDelayParsed) && retryDelayParsed > 0 ? retryDelayParsed : 2000;
  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
  const shouldRetryStatus = (s: number) => s === 429 || (s >= 500 && s < 600);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logJson('info', 'workspace_invite_email_send_attempt', {
        traceId,
        workspaceId: params.workspaceId,
        to: maskEmail(params.to),
        from: maskEmail(fromEmail),
        replyTo: maskEmail(replyToEmail),
        apiBaseUrl: cfg.apiBaseUrl,
        timeoutMs: cfg.timeoutMs,
        subject: email.subject,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: params.to,
          reply_to: replyToEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => null);

      if (!response.ok) {
        const apiErrorText =
          typeof payload === 'object' && payload && typeof (payload as any)?.error === 'string'
            ? String((payload as any).error)
            : null;

        const details =
          typeof payload === 'string'
            ? payload
            : payload
              ? JSON.stringify(payload)
              : '(no details)';

        const hint =
          apiErrorText && apiErrorText.toLowerCase().includes('domain not verified')
            ? `Emailit domain not verified. Verify the sending domain for ${fromEmail} in Emailit (Domains) and try again.`
            : null;

        const error = hint
          ? `${hint} (Emailit API error: ${response.status} ${response.statusText} - ${details})`
          : `Emailit API error: ${response.status} ${response.statusText} - ${details}`;
        logJson('error', 'workspace_invite_email_send_failed', {
          traceId,
          workspaceId: params.workspaceId,
          to: maskEmail(params.to),
          status: response.status,
          statusText: response.statusText,
          error,
        });
        if (shouldRetryStatus(response.status) && attempt <= maxRetries) {
          const waitMs = baseDelay * Math.pow(2, attempt - 1);
          await delay(waitMs);
          continue;
        }
        return { sent: false, error };
      }

      const messageId =
        typeof (payload as any)?.id === 'string'
          ? (payload as any).id
          : typeof (payload as any)?.messageId === 'string'
            ? (payload as any).messageId
            : undefined;

      logJson('info', 'workspace_invite_email_send_ok', {
        traceId,
        workspaceId: params.workspaceId,
        to: maskEmail(params.to),
        messageId,
        status: response.status,
      });

      return { sent: true, messageId };
    } catch (err) {
      const baseError =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Invite email request timed out (Emailit).'
            : err.message
          : 'Failed to send invite email';

      const cause: any = (err as any)?.cause;
      const causeCode: string | undefined = typeof cause?.code === 'string' ? cause.code : undefined;
      const causeMessage: string | undefined =
        typeof cause?.message === 'string' ? cause.message : undefined;

      const causeDetails = [causeCode, causeMessage].filter(Boolean).join(': ');
      const error = causeDetails ? `${baseError} (${causeDetails})` : baseError;

      logJson('error', 'workspace_invite_email_send_error', {
        traceId,
        workspaceId: params.workspaceId,
        to: maskEmail(params.to),
        error,
        err: errorToLogObject(err),
      });
      if (
        (causeCode === 'UND_ERR_CONNECT_TIMEOUT') ||
        (err instanceof Error && err.name === 'AbortError') ||
        (err instanceof Error && typeof err.message === 'string' && err.message.toLowerCase().includes('fetch failed'))
      ) {
        if (attempt <= maxRetries) {
          const waitMs = baseDelay * Math.pow(2, attempt - 1);
          await delay(waitMs);
          continue;
        }
      }
      return { sent: false, error };
    }
  }
  return { sent: false, error: 'Invite email sending exhausted' };
}
