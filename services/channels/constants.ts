export const CHANNEL_TYPES = {
  LIVE_CHAT: 'live_chat',
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
} as const;
export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES];
export const CHANNEL_TYPE_VALUES = [CHANNEL_TYPES.LIVE_CHAT, CHANNEL_TYPES.WHATSAPP, CHANNEL_TYPES.TELEGRAM] as const;

export const CONVERSATION_STATUS = { OPEN: 'open', CLOSED: 'closed' } as const;
export type ConversationStatus = (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

export const MESSAGE_DIRECTION = { IN: 'in', OUT: 'out' } as const;
export type MessageDirection = (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION];

export const SENDER_TYPE = { CLIENT: 'client', BOT: 'bot', MANAGER: 'manager' } as const;
export type SenderType = (typeof SENDER_TYPE)[keyof typeof SENDER_TYPE];

export const CHANNEL_ENTITY_TYPE = 'conversation';
export const LEAD_CHAT_STATUS = 'lead_created';

export const CHANNEL_LIST_LIMIT = 500;
export const CONVERSATION_LIST_LIMIT = 200;
export const MESSAGE_LIST_LIMIT = 200;
export const POLL_MESSAGE_LIMIT = 50;

export const MESSAGE_TEXT_VAR = 'message_text';
export const MESSAGE_JSON_VAR = 'json';

export interface Channel {
  id: number;
  workspace_id: number;
  type: ChannelType;
  name: string;
  config: Record<string, any>;
  secret: string;
  bot_id: number;
  active: boolean;
  created_at?: string;
}

export interface Conversation {
  id: number;
  workspace_id: number;
  channel_id: number;
  lead_id: number;
  visitor_uid: string;
  session_id: string;
  utm: Record<string, any>;
  status: ConversationStatus;
  bot_run_id: number;
  last_message_at?: string;
  created_at?: string;
}

export interface Message {
  id: number;
  workspace_id: number;
  conversation_id: number;
  direction: MessageDirection;
  sender_type: SenderType;
  text: string;
  payload: Record<string, any>;
  external_id: string;
  created_at?: string;
}

export interface OutboundMessage {
  text: string;
  payload?: Record<string, any>;
}
