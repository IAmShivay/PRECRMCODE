import { botRunsApi, leadsApi } from '../api.js';
import { getDefaultStatusIdForWorkspace } from '../../utils/leadHelpers.js';
import { emitAutomationEvent } from '../automations/engine.js';
import { createdIdOf } from '../automations/store.js';
import { BOT_RUN_STATUS } from '../bots/constants.js';
import { createBotRun, kickBotRuns, resumeBotRun } from '../bots/engine.js';
import {
  CHANNEL_ENTITY_TYPE,
  MESSAGE_DIRECTION,
  SENDER_TYPE,
  type Channel,
  type Conversation,
  type Message,
} from './constants.js';
import {
  appendMessage,
  createConversation,
  findConversationByVisitor,
  updateConversation,
} from './store.js';

const LIVE_RUN_STATUSES: string[] = [BOT_RUN_STATUS.PENDING, BOT_RUN_STATUS.RUNNING, BOT_RUN_STATUS.WAITING];
const rowsOf = (res: any): any[] => (res?.status === 'success' && Array.isArray(res.data) ? res.data : []);

/**
 * Creates a CRM lead for a brand-new conversation, reusing the same lead-creation
 * path the public web-form webhook uses (`leadsApi.createLead` + the `lead_created`
 * fan-out in `services/automations/engine.ts`). Attribution (visitor_uid) is the
 * dedup key here, so the webhook's email/source_ref dedup does not apply.
 */
async function createLeadForConversation(channel: Channel, conversation: Conversation, firstMessage: string): Promise<number> {
  const name = `Chat visitor ${conversation.visitor_uid.slice(0, 8)}`;
  const statusId = await getDefaultStatusIdForWorkspace(channel.workspace_id);
  const created: any = await leadsApi.createLead({
    workspace_id: channel.workspace_id,
    name,
    email: '',
    phone: '',
    source: channel.type,
    source_old: channel.name || channel.type,
    source_ref: conversation.visitor_uid,
    email_verification_status: 'pending',
    email_valid: 0,
    phone_valid: 0,
    ...(statusId !== null && statusId !== undefined ? { status_id: statusId } : {}),
  });
  const leadId = createdIdOf(created);
  if (!leadId) throw new Error('Could not create lead for conversation');
  void firstMessage;
  emitAutomationEvent({ workspaceId: channel.workspace_id, type: 'lead_created', leadId });
  return leadId;
}

async function findLiveRun(conversation: Conversation): Promise<any | null> {
  const res: any = await botRunsApi.list(
    { conversation_id: conversation.id, sort: 'id', order: 'desc', limit: 50 },
    { fresh: true }
  );
  const runs = rowsOf(res).filter(
    (run) => Number(run.conversation_id) === conversation.id && Number(run.workspace_id) === conversation.workspace_id
  );
  const waiting = runs.find((run) => String(run.status) === BOT_RUN_STATUS.WAITING);
  if (waiting) return waiting;
  return runs.find((run) => LIVE_RUN_STATUSES.includes(String(run.status))) || null;
}

export interface IngestResult {
  conversation: Conversation;
  inboundMessage: Message;
  botRunId: number;
}

/**
 * Entry point for an inbound client message on any channel. Finds/creates the
 * conversation, ensures a lead, stores the message, then launches or resumes the
 * attached bot.
 */
export async function ingestInboundMessage(input: {
  channel: Channel;
  visitorUid: string;
  sessionId?: string;
  text: string;
  utm?: Record<string, any>;
}): Promise<IngestResult> {
  const { channel } = input;
  let conversation = await findConversationByVisitor(channel, input.visitorUid);
  if (!conversation) {
    conversation = await createConversation({
      channel,
      visitorUid: input.visitorUid,
      sessionId: input.sessionId || '',
      utm: input.utm || {},
    });
  }

  if (!conversation.lead_id) {
    const leadId = await createLeadForConversation(channel, conversation, input.text);
    conversation = { ...conversation, lead_id: leadId };
    await updateConversation(conversation.id, { lead_id: leadId });
  }

  const inboundMessage = await appendMessage({
    conversation,
    direction: MESSAGE_DIRECTION.IN,
    senderType: SENDER_TYPE.CLIENT,
    text: input.text,
  });

  let botRunId = conversation.bot_run_id;
  if (channel.bot_id > 0) {
    const liveRun = await findLiveRun(conversation);
    if (liveRun && String(liveRun.status) === BOT_RUN_STATUS.WAITING) {
      await resumeBotRun(liveRun, input.text);
      botRunId = Number(liveRun.id);
    } else if (!liveRun) {
      botRunId = await createBotRun({
        workspaceId: channel.workspace_id,
        botId: channel.bot_id,
        entityType: CHANNEL_ENTITY_TYPE,
        entityId: conversation.id,
        conversationId: conversation.id,
        cursor: { block: 'question', step: 0, vars: { message_text: input.text, json: { message: input.text } } },
      });
      await updateConversation(conversation.id, { bot_run_id: botRunId });
      kickBotRuns();
    }
  }

  return { conversation, inboundMessage, botRunId };
}
