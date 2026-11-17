import { isIP } from 'net';
import { notificationsApi, tasksApi } from '../api.js';
import { sendWorkspaceEmail } from '../leadAutoReplyEmail.js';
import { sendWhatsAppTemplateFromAutomation } from '../whatsapp.js';
import { formatMySqlDateTimeUtc } from '../../lib/validation.js';
import { MINUTE_MS, OWNER_TARGET, TASK_STATUS, WEBHOOK_TIMEOUT_MS, type AutomationRule } from './constants.js';
import { patchDeal, type DealSnapshot } from './dealOps.js';
import { createdIdOf, nowSql } from './store.js';

export interface ActionContext {
  rule: AutomationRule;
  deal: DealSnapshot | null;
  lead: any | null;
  depth: number;
}

/** Skipped results are recorded but not retried (missing data, not a failure). */
export class SkipRun extends Error {}

const VAR_PATTERN = /\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/gi;

function variables(ctx: ActionContext): Record<string, Record<string, unknown>> {
  return {
    deal: {
      id: ctx.deal?.id ?? '',
      name: ctx.deal?.name ?? '',
      value: ctx.deal?.value ?? '',
      stage: ctx.deal?.stage ?? '',
      pipeline: ctx.deal?.pipelineSlug ?? '',
      tags: ctx.deal?.tags.join(', ') ?? '',
      contact: ctx.deal?.contact ?? '',
    },
    lead: {
      id: ctx.lead?.id ?? '',
      name: ctx.lead?.name ?? ctx.deal?.contact ?? '',
      email: ctx.lead?.email ?? '',
      phone: ctx.lead?.phone ?? '',
    },
  };
}

export function render(template: unknown, ctx: ActionContext): string {
  const vars = variables(ctx);
  return String(template ?? '').replace(VAR_PATTERN, (_match, scope: string, key: string) =>
    String(vars[scope.toLowerCase()]?.[key.toLowerCase()] ?? '')
  );
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];

function requireDeal(ctx: ActionContext): DealSnapshot {
  if (!ctx.deal) throw new SkipRun('This action needs a deal');
  return ctx.deal;
}

function resolveUser(target: unknown, ctx: ActionContext): number {
  if (target === OWNER_TARGET || target === undefined || target === '') {
    const owner = ctx.deal?.ownerId || Number(ctx.lead?.user_id) || 0;
    if (!owner) throw new SkipRun('Deal has no owner to assign to');
    return owner;
  }
  const id = Number(target);
  if (!id) throw new SkipRun('No user selected');
  return id;
}

async function notify(ctx: ActionContext, userId: number, title: string, message: string) {
  await notificationsApi.createNotification({
    workspace_id: ctx.rule.workspace_id,
    recipient_user_id: userId,
    actor_user_id: 0,
    lead_id: ctx.lead?.id || ctx.deal?.leadId || 0,
    type: 'automation',
    title,
    message,
    payload: JSON.stringify({ automation_id: ctx.rule.id, deal_id: ctx.deal?.id || null }),
  });
}

function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SkipRun('Webhook URL is not valid');
  }
  const host = url.hostname.toLowerCase();
  const privateIp = isIP(host) && /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/.test(host);
  if (url.protocol !== 'https:' || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || privateIp) {
    throw new SkipRun('Webhook URL must be a public https:// address');
  }
  return url;
}

export async function runAction(ctx: ActionContext): Promise<string> {
  const config = ctx.rule.action_config || {};

  switch (ctx.rule.action_type) {
    case 'send_email': {
      const to = String(ctx.lead?.email || '').trim();
      if (!to) throw new SkipRun('Lead has no email address');
      const subject = render(config.subject, ctx).trim();
      const body = render(config.body, ctx);
      if (!subject || !body.trim()) throw new SkipRun('Email subject or body is empty');
      const sent = await sendWorkspaceEmail(ctx.rule.workspace_id, {
        to,
        subject,
        text: body,
        html: escapeHtml(body).replace(/\r?\n/g, '<br>'),
      });
      return `Email sent to ${to}${sent.messageId ? ` (${sent.messageId})` : ''}`;
    }

    case 'send_whatsapp': {
      const phone = String(ctx.lead?.phone || '').trim();
      if (!phone) throw new SkipRun('Lead has no phone number');
      const templateName = String(config.template_name || '').trim();
      if (!templateName) throw new SkipRun('No WhatsApp template selected');
      const result = await sendWhatsAppTemplateFromAutomation(ctx.rule.workspace_id, {
        toPhone: phone,
        templateName,
        languageCode: String(config.language || 'en'),
        bodyParameters: listOf(config.params).map((param) => render(param, ctx)),
      });
      if (!result.success) throw new Error(result.message || 'WhatsApp send failed');
      return `WhatsApp template "${templateName}" sent to ${phone}`;
    }

    case 'move_stage': {
      const deal = requireDeal(ctx);
      const stage = String(config.stage || '').trim();
      if (!stage) throw new SkipRun('No target stage selected');
      if (stage === deal.stage) return `Already in "${stage}"`;
      await patchDeal(deal.id, { stage }, ctx.depth);
      return `Moved from "${deal.stage}" to "${stage}"`;
    }

    case 'assign_owner': {
      const deal = requireDeal(ctx);
      const userId = Number(config.user_id);
      if (!userId) throw new SkipRun('No user selected');
      if (userId === deal.ownerId) return 'Already assigned to this user';
      await patchDeal(deal.id, { owner_id: userId }, ctx.depth);
      await notify(ctx, userId, 'Deal assigned to you', `"${deal.name}" was assigned to you by an automation.`);
      return `Assigned to user ${userId}`;
    }

    case 'add_tags':
    case 'remove_tags': {
      const deal = requireDeal(ctx);
      const tags = listOf(config.tags);
      if (tags.length === 0) throw new SkipRun('No tags selected');
      const next =
        ctx.rule.action_type === 'add_tags'
          ? [...deal.tags, ...tags]
          : deal.tags.filter((tag) => !tags.some((t) => t.toLowerCase() === tag.toLowerCase()));
      await patchDeal(deal.id, { tags: next }, ctx.depth);
      return `${ctx.rule.action_type === 'add_tags' ? 'Added' : 'Removed'} tags: ${tags.join(', ')}`;
    }

    case 'create_task': {
      const assignee = resolveUser(config.assign_to, ctx);
      const title = render(config.title, ctx).trim() || 'Follow up';
      const dueMinutes = Math.max(0, Number(config.due_in_minutes) || 0);
      const res: any = await tasksApi.create({
        workspace_id: ctx.rule.workspace_id,
        deal_id: ctx.deal?.id || 0,
        lead_id: ctx.lead?.id || ctx.deal?.leadId || 0,
        assigned_to: assignee,
        title,
        description: render(config.description, ctx),
        task_type: String(config.task_type || 'follow_up'),
        due_at: formatMySqlDateTimeUtc(new Date(Date.now() + dueMinutes * MINUTE_MS)),
        status: TASK_STATUS.OPEN,
        completed_at: null,
        created_by: 0,
        automation_id: ctx.rule.id,
        created_at: nowSql(),
      });
      if (res?.status !== 'success') throw new Error('Could not create task');
      await notify(ctx, assignee, 'New task', title).catch(() => undefined);
      return `Task #${createdIdOf(res) || '?'} "${title}" for user ${assignee}`;
    }

    case 'notify_user': {
      const userId = resolveUser(config.user, ctx);
      const message = render(config.message, ctx).trim();
      if (!message) throw new SkipRun('Notification message is empty');
      await notify(ctx, userId, ctx.rule.name || 'Automation', message);
      return `Notified user ${userId}`;
    }

    case 'send_webhook': {
      const url = assertPublicHttpsUrl(String(config.url || '').trim());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'ScraftCRM-Automations/1.0' },
          body: JSON.stringify({
            event: ctx.rule.trigger_type,
            automation: { id: ctx.rule.id, name: ctx.rule.name },
            workspace_id: ctx.rule.workspace_id,
            deal: ctx.deal,
            lead: ctx.lead ? { id: ctx.lead.id, name: ctx.lead.name, email: ctx.lead.email, phone: ctx.lead.phone } : null,
            sent_at: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Webhook answered ${response.status}`);
        return `Webhook delivered (${response.status})`;
      } finally {
        clearTimeout(timer);
      }
    }

    default:
      throw new SkipRun(`Unknown action ${ctx.rule.action_type}`);
  }
}
