import { channelsApi, conversationsApi, messagesApi } from '../api.js';
import { createdIdOf, nowSql, parseJsonObject } from '../automations/store.js';
import {
  CHANNEL_LIST_LIMIT,
  CHANNEL_TYPES,
  CONVERSATION_LIST_LIMIT,
  CONVERSATION_STATUS,
  MESSAGE_DIRECTION,
  MESSAGE_LIST_LIMIT,
  SENDER_TYPE,
  type Channel,
  type Conversation,
  type ConversationStatus,
  type Message,
  type MessageDirection,
  type SenderType,
} from './constants.js';

export { createdIdOf, nowSql };

const rowsOf = (res: any): any[] => (res?.status === 'success' && Array.isArray(res.data) ? res.data : []);
const rowOf = (res: any): any => (Array.isArray(res?.data) ? res.data[0] : res?.data);

export function toChannel(row: any): Channel | null {
  const type = String(row?.type || '');
  if (!(Object.values(CHANNEL_TYPES) as string[]).includes(type)) return null;
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    type: type as Channel['type'],
    name: String(row.name || ''),
    config: parseJsonObject(row.config),
    secret: String(row.secret || ''),
    bot_id: Number(row.bot_id) || 0,
    active: Number(row.active) === 1 || row.active === true,
    created_at: row.created_at,
  };
}

export function toChannelRow(channel: Omit<Channel, 'id'>) {
  return {
    workspace_id: channel.workspace_id,
    type: channel.type,
    name: channel.name,
    config: JSON.stringify(channel.config || {}),
    secret: channel.secret || '',
    bot_id: channel.bot_id || 0,
    active: channel.active ? 1 : 0,
    created_at: channel.created_at || nowSql(),
  };
}

export function toConversation(row: any): Conversation {
  const status = String(row?.status || CONVERSATION_STATUS.OPEN);
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    channel_id: Number(row.channel_id) || 0,
    lead_id: Number(row.lead_id) || 0,
    visitor_uid: String(row.visitor_uid || ''),
    session_id: String(row.session_id || ''),
    utm: parseJsonObject(row.utm),
    status: (status === CONVERSATION_STATUS.CLOSED ? CONVERSATION_STATUS.CLOSED : CONVERSATION_STATUS.OPEN) as ConversationStatus,
    bot_run_id: Number(row.bot_run_id) || 0,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
  };
}

export function toConversationRow(conversation: Omit<Conversation, 'id'>) {
  return {
    workspace_id: conversation.workspace_id,
    channel_id: conversation.channel_id,
    lead_id: conversation.lead_id || 0,
    visitor_uid: conversation.visitor_uid,
    session_id: conversation.session_id || '',
    utm: JSON.stringify(conversation.utm || {}),
    status: conversation.status,
    bot_run_id: conversation.bot_run_id || 0,
    last_message_at: conversation.last_message_at || nowSql(),
    created_at: conversation.created_at || nowSql(),
  };
}

export function toMessage(row: any): Message {
  const direction = String(row?.direction || MESSAGE_DIRECTION.IN) as MessageDirection;
  const senderType = String(row?.sender_type || SENDER_TYPE.CLIENT) as SenderType;
  return {
    id: Number(row.id),
    workspace_id: Number(row.workspace_id),
    conversation_id: Number(row.conversation_id) || 0,
    direction,
    sender_type: senderType,
    text: String(row.text || ''),
    payload: parseJsonObject(row.payload),
    external_id: String(row.external_id || ''),
    created_at: row.created_at,
  };
}

export async function getChannel(id: number): Promise<Channel | null> {
  return toChannel(rowOf(await channelsApi.get(id)));
}

export async function listWorkspaceChannels(workspaceId: number): Promise<Channel[]> {
  const res: any = await channelsApi.list({ workspace_id: workspaceId, limit: CHANNEL_LIST_LIMIT }, { fresh: true });
  return rowsOf(res)
    .filter((row) => Number(row.workspace_id) === workspaceId)
    .map(toChannel)
    .filter((channel): channel is Channel => channel !== null)
    .sort((a, b) => b.id - a.id);
}

export async function loadConversation(id: number): Promise<Conversation | null> {
  const row = rowOf(await conversationsApi.get(id));
  return row && Number(row.id) ? toConversation(row) : null;
}

export async function listChannelConversations(channelId: number, workspaceId: number): Promise<Conversation[]> {
  const res: any = await conversationsApi.list(
    { channel_id: channelId, sort: 'id', order: 'desc', limit: CONVERSATION_LIST_LIMIT },
    { fresh: true }
  );
  return rowsOf(res)
    .filter((row) => Number(row.channel_id) === channelId && Number(row.workspace_id) === workspaceId)
    .map(toConversation)
    .sort((a, b) => b.id - a.id);
}

/** Finds the open conversation attributed to a visitor on a channel, or null. */
export async function findConversationByVisitor(channel: Channel, visitorUid: string): Promise<Conversation | null> {
  const res: any = await conversationsApi.list(
    { channel_id: channel.id, visitor_uid: visitorUid, limit: CONVERSATION_LIST_LIMIT },
    { fresh: true }
  );
  const match = rowsOf(res)
    .filter(
      (row) =>
        Number(row.channel_id) === channel.id &&
        Number(row.workspace_id) === channel.workspace_id &&
        String(row.visitor_uid || '') === visitorUid
    )
    .map(toConversation)
    .sort((a, b) => b.id - a.id)[0];
  return match || null;
}

export async function createConversation(input: {
  channel: Channel;
  visitorUid: string;
  sessionId: string;
  utm: Record<string, any>;
}): Promise<Conversation> {
  const now = nowSql();
  const row = toConversationRow({
    workspace_id: input.channel.workspace_id,
    channel_id: input.channel.id,
    lead_id: 0,
    visitor_uid: input.visitorUid,
    session_id: input.sessionId,
    utm: input.utm,
    status: CONVERSATION_STATUS.OPEN,
    bot_run_id: 0,
    last_message_at: now,
    created_at: now,
  });
  const created: any = await conversationsApi.create(row);
  const id = createdIdOf(created);
  return toConversation({ ...row, id });
}

export async function updateConversation(id: number, patch: Partial<Omit<Conversation, 'id'>>): Promise<void> {
  const fields: Record<string, any> = {};
  if (patch.lead_id !== undefined) fields.lead_id = patch.lead_id;
  if (patch.bot_run_id !== undefined) fields.bot_run_id = patch.bot_run_id;
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.last_message_at !== undefined) fields.last_message_at = patch.last_message_at;
  if (Object.keys(fields).length === 0) return;
  await conversationsApi.update(id, fields);
}

export async function appendMessage(input: {
  conversation: Conversation;
  direction: MessageDirection;
  senderType: SenderType;
  text: string;
  payload?: Record<string, any>;
  externalId?: string;
}): Promise<Message> {
  const now = nowSql();
  const row = {
    workspace_id: input.conversation.workspace_id,
    conversation_id: input.conversation.id,
    direction: input.direction,
    sender_type: input.senderType,
    text: input.text,
    payload: JSON.stringify(input.payload || {}),
    external_id: input.externalId || '',
    created_at: now,
  };
  const created: any = await messagesApi.create(row);
  const id = createdIdOf(created);
  await updateConversation(input.conversation.id, { last_message_at: now });
  return toMessage({ ...row, id });
}

export async function listConversationMessages(
  conversationId: number,
  options: { afterId?: number; direction?: MessageDirection; limit?: number } = {}
): Promise<Message[]> {
  const res: any = await messagesApi.list(
    { conversation_id: conversationId, sort: 'id', order: 'asc', limit: options.limit || MESSAGE_LIST_LIMIT },
    { fresh: true }
  );
  return rowsOf(res)
    .filter((row) => Number(row.conversation_id) === conversationId)
    .map(toMessage)
    .filter((msg) => (options.afterId ? msg.id > options.afterId : true))
    .filter((msg) => (options.direction ? msg.direction === options.direction : true))
    .sort((a, b) => a.id - b.id);
}
