export interface InstagramConnectionView {
  configured: boolean;
  connected: boolean;
  account_id?: string;
  username?: string;
  expires_at?: string;
  last_webhook_at?: string;
}

export interface InstagramParticipant { id: string; username?: string; }
export interface InstagramConversation {
  id: string;
  updated_time?: string;
  participants: { data: InstagramParticipant[] };
}
export interface InstagramMessage {
  id: string;
  created_time: string;
  from: InstagramParticipant;
  to?: { data: InstagramParticipant[] };
  message?: string;
}
export interface InstagramConversationPage { conversations: InstagramConversation[]; after?: string; }
export interface InstagramMessagePage { messages: InstagramMessage[]; can_reply: boolean; recipient_id?: string; }
