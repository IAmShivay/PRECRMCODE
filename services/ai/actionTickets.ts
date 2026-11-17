import crypto from 'crypto';
import {
  AI_ACTION_STATUS_CONFIRMED,
  AI_ACTION_STATUS_EXPIRED,
  AI_ACTION_STATUS_PENDING,
  AI_ACTION_STATUS_REJECTED,
  AI_CONFIRMATION_TICKET_EXPIRY_MS,
  type McpCrmToolName,
} from '../../types/constants.js';
import type { AiActionTicket } from '../../types/index.js';
import { executeCrmTool } from '../mcp/toolRegistry.js';

const tickets = new Map<string, AiActionTicket>();

export function createActionTicket(input: {
  workspace_id: number;
  user_id: number;
  tool_name: McpCrmToolName;
  params: Record<string, any>;
  summary: string;
}): AiActionTicket {
  const ticketId = `act_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  const ticket: AiActionTicket = {
    ticket_id: ticketId,
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    tool_name: input.tool_name,
    params: input.params,
    summary: input.summary,
    expires_at: now + AI_CONFIRMATION_TICKET_EXPIRY_MS,
    status: AI_ACTION_STATUS_PENDING,
  };
  tickets.set(ticketId, ticket);
  return ticket;
}

export function getActionTicket(ticketId: string): AiActionTicket | null {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  if (Date.now() > ticket.expires_at) {
    ticket.status = AI_ACTION_STATUS_EXPIRED;
    return ticket;
  }
  return ticket;
}

export async function confirmActionTicket(
  ticketId: string,
  userId: number
): Promise<{ success: boolean; result?: any; error?: string }> {
  const ticket = getActionTicket(ticketId);
  if (!ticket) return { success: false, error: 'Ticket not found' };
  if (ticket.status === AI_ACTION_STATUS_EXPIRED || Date.now() > ticket.expires_at) {
    ticket.status = AI_ACTION_STATUS_EXPIRED;
    return { success: false, error: 'Action ticket has expired' };
  }
  if (ticket.status !== AI_ACTION_STATUS_PENDING) {
    return { success: false, error: `Action is already ${ticket.status}` };
  }
  if (ticket.user_id !== userId) {
    return { success: false, error: 'You are not authorized to confirm this ticket' };
  }
  try {
    const result = await executeCrmTool(
      { workspace_id: ticket.workspace_id, user_id: ticket.user_id },
      ticket.tool_name,
      ticket.params
    );
    ticket.status = AI_ACTION_STATUS_CONFIRMED;
    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Tool execution failed' };
  }
}

export function rejectActionTicket(ticketId: string, userId: number): boolean {
  const ticket = getActionTicket(ticketId);
  if (!ticket || ticket.user_id !== userId || ticket.status !== AI_ACTION_STATUS_PENDING) {
    return false;
  }
  ticket.status = AI_ACTION_STATUS_REJECTED;
  return true;
}
