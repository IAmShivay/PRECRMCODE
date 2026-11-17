import {
  DEFAULT_GROK_MODEL,
  DEFAULT_GROQ_MODEL,
  GROK_API_URL,
  GROQ_API_URL,
} from '../../types/constants.js';

export interface GrokToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface GrokMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: GrokToolCall[];
  tool_call_id?: string;
  reasoning?: string;
}

export interface GrokToolFunction {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface GrokChatCompletionRequest {
  model?: string;
  messages: GrokMessage[];
  tools?: GrokToolFunction[];
  temperature?: number;
}

export interface GrokChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content?: string | null;
      reasoning?: string;
      tool_calls?: GrokToolCall[];
    };
    finish_reason: string;
  }>;
}

export function getGrokApiKey(): string | null {
  const key =
    process.env.GROQ_API_KEY ||
    process.env.GROK_API_KEY ||
    process.env.XAI_API_KEY;
  if (key && key.trim().length > 0) {
    return key.trim();
  }
  return null;
}

export function isGrokConfigured(): boolean {
  const key = getGrokApiKey();
  return Boolean(key && key.length > 5);
}

export async function callGrokChat(
  request: GrokChatCompletionRequest
): Promise<GrokChatCompletionResponse> {
  const apiKey = getGrokApiKey();
  if (!apiKey || !isGrokConfigured()) {
    throw new Error('Valid AI API key is not configured');
  }

  const isGroq = apiKey.startsWith('gsk_') || Boolean(process.env.GROQ_API_KEY && !process.env.GROK_API_KEY);
  const defaultUrl = isGroq ? GROQ_API_URL : GROK_API_URL;
  const defaultModel = isGroq ? DEFAULT_GROQ_MODEL : DEFAULT_GROK_MODEL;

  const endpoint =
    process.env.GROQ_API_URL ||
    process.env.GROK_API_URL ||
    defaultUrl;

  const model =
    request.model ||
    process.env.GROQ_MODEL ||
    process.env.GROK_MODEL ||
    defaultModel;

  const payload: Record<string, any> = {
    model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
  };

  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools;
    payload.tool_choice = 'auto';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as GrokChatCompletionResponse;
}
