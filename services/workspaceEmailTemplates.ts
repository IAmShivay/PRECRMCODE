import { webhookLogsApi } from './api.js';
import { ApiResponse } from '../types/index.js';

export interface WorkspaceInviteEmailTemplate {
  subject: string;
  intro: string;
  buttonText: string;
  whatsTitle: string;
  whatsBody: string;
}

const TEMPLATE_STATUS = 'email_template';
const INVITE_TEMPLATE_SOURCE = 'workspace_invite';

export const DEFAULT_WORKSPACE_INVITE_TEMPLATE: WorkspaceInviteEmailTemplate = {
  subject: 'You’ve been invited to {{workspaceName}}',
  intro:
    "Hello! {{inviterName}} has invited you to collaborate on {{workspaceName}}, and we're excited to have you join their team! To get started, just click the button below.",
  buttonText: 'Accept invite',
  whatsTitle: "What's {{appName}}",
  whatsBody:
    '{{appName}} is a CRM workspace where your team can collaborate on leads, sources, and activity. Learn more about us {{learnMoreLink}}.',
};

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeInviteTemplate(
  input: Partial<WorkspaceInviteEmailTemplate>
): WorkspaceInviteEmailTemplate {
  return {
    subject: toTrimmedString(input.subject) || DEFAULT_WORKSPACE_INVITE_TEMPLATE.subject,
    intro: toTrimmedString(input.intro) || DEFAULT_WORKSPACE_INVITE_TEMPLATE.intro,
    buttonText: toTrimmedString(input.buttonText) || DEFAULT_WORKSPACE_INVITE_TEMPLATE.buttonText,
    whatsTitle: toTrimmedString(input.whatsTitle) || DEFAULT_WORKSPACE_INVITE_TEMPLATE.whatsTitle,
    whatsBody: toTrimmedString(input.whatsBody) || DEFAULT_WORKSPACE_INVITE_TEMPLATE.whatsBody,
  };
}

export interface StoredTemplateResult {
  template: WorkspaceInviteEmailTemplate | null;
  logId?: number;
  eventId?: string;
}

export async function getWorkspaceInviteEmailTemplate(
  workspaceId: number
): Promise<StoredTemplateResult> {
  try {
    const response = await webhookLogsApi.getWebhookLogs({
      workspace_id: workspaceId,
      status: TEMPLATE_STATUS,
      source: INVITE_TEMPLATE_SOURCE,
    }) as ApiResponse<any[]>;

    if (response.status !== 'success' || !response.data) {
      return { template: null };
    }

    const entries: any[] = Array.isArray(response.data) ? response.data : [response.data];
    if (entries.length === 0) return { template: null };

    // Pick the latest by id if multiple exist
    const latest = entries
      .filter(Boolean)
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))[0];

    if (!latest) return { template: null };

    let parsed: any = null;
    try {
      parsed = latest.payload ? JSON.parse(String(latest.payload)) : null;
    } catch {
      parsed = null;
    }

    const rawTemplate = parsed?.template ?? parsed ?? null;
    const template = rawTemplate ? normalizeInviteTemplate(rawTemplate) : null;

    return {
      template,
      logId: typeof latest.id === 'number' ? latest.id : Number(latest.id || 0) || undefined,
      eventId: typeof latest.event_id === 'string' ? latest.event_id : undefined,
    };
  } catch (error) {
    console.error('[EmailTemplates] Failed to load invite template:', error);
    return { template: null };
  }
}

export async function upsertWorkspaceInviteEmailTemplate(
  workspaceId: number,
  template: WorkspaceInviteEmailTemplate
): Promise<ApiResponse<any>> {
  const normalized = normalizeInviteTemplate(template);
  const existing = await getWorkspaceInviteEmailTemplate(workspaceId);

  const payload = JSON.stringify({
    kind: 'workspace_invite',
    template: normalized,
    updated_at: new Date().toISOString(),
  });

  // Keep a stable event_id per workspace (helps with debugging/searching)
  const event_id = existing.eventId || `tmpl_invite_ws${workspaceId}`;

  if (existing.logId) {
    return webhookLogsApi.updateWebhookLog(existing.logId, {
      workspace_id: workspaceId,
      lead_id: 0,
      source: INVITE_TEMPLATE_SOURCE,
      source_old: INVITE_TEMPLATE_SOURCE,
      event_id,
      payload,
      status: TEMPLATE_STATUS,
    }) as Promise<ApiResponse<any>>;
  }

  return webhookLogsApi.createWebhookLog({
    workspace_id: workspaceId,
    lead_id: 0,
    source: INVITE_TEMPLATE_SOURCE,
    source_old: INVITE_TEMPLATE_SOURCE,
    event_id,
    payload,
    status: TEMPLATE_STATUS,
  }) as Promise<ApiResponse<any>>;
}

