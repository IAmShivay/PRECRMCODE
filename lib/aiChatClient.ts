import { getAuthToken } from './storage';
import type { AiChatMessage, AiStreamEvent, WorkspaceMcpToken } from '../components/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export async function streamAiChat(
  workspaceId: number,
  message: string,
  history: AiChatMessage[],
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new Error('Missing auth token');

  const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      message,
      history: history.slice(-20).map((h) => ({
        role: h.role,
        content: h.content,
        tool_name: h.tool_name,
        timestamp: h.timestamp,
      })),
    }),
    signal,
  });

  if (!response.ok) {
    let errText = 'Failed to send message';
    try {
      const errJson = await response.json();
      errText = errJson.message || errText;
    } catch {}
    throw new Error(errText);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No readable stream available');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = 'delta';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          onEvent({
            type: currentEvent as any,
            text: parsed.text,
            tool: parsed.tool,
            input: parsed.input,
            result: parsed.result,
            ticket: parsed.ticket,
            message: parsed.message,
          });
        } catch {}
      }
    }
  }
}

export async function confirmAiAction(
  ticketId: string,
  confirmed: boolean
): Promise<{ success: boolean; data?: any; error?: string }> {
  const token = getAuthToken();
  if (!token) throw new Error('Missing auth token');

  const response = await fetch(`${API_BASE_URL}/api/ai/confirm-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticket_id: ticketId, confirmed }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || 'Action confirmation failed');
  }
  return { success: json.status === 'success', data: json.data };
}

export async function fetchAiTools(): Promise<any[]> {
  const token = getAuthToken();
  if (!token) throw new Error('Missing auth token');

  const response = await fetch(`${API_BASE_URL}/api/ai/tools`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  return json.data || [];
}

export async function fetchMcpTokens(workspaceId: number): Promise<WorkspaceMcpToken[]> {
  const token = getAuthToken();
  if (!token) throw new Error('Missing auth token');

  const response = await fetch(`${API_BASE_URL}/api/mcp/tokens?workspace_id=${workspaceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  return json.data || [];
}

export async function createMcpToken(
  workspaceId: number,
  name: string
): Promise<{ token: string; record: WorkspaceMcpToken }> {
  const token = getAuthToken();
  if (!token) throw new Error('Missing auth token');

  const response = await fetch(`${API_BASE_URL}/api/mcp/tokens?workspace_id=${workspaceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || 'Failed to generate token');
  }
  return json.data;
}

export async function revokeMcpToken(workspaceId: number, tokenId: number): Promise<boolean> {
  const token = getAuthToken();
  if (!token) throw new Error('Missing auth token');

  const response = await fetch(
    `${API_BASE_URL}/api/mcp/tokens/${tokenId}?workspace_id=${workspaceId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const json = await response.json();
  return json.status === 'success';
}
