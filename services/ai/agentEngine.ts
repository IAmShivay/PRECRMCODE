import {
  AI_EVENT_ACTION_REQUIRED,
  AI_EVENT_DELTA,
  AI_EVENT_DONE,
  AI_EVENT_ERROR,
  AI_EVENT_TOOL_END,
  AI_EVENT_TOOL_START,
  MCP_SECURITY_MUTATING_HIGH,
  MCP_TOOL_GET_PIPELINE_SUMMARY,
  MCP_TOOL_SEARCH_DEALS,
  MCP_TOOL_SEARCH_LEADS,
  type AiStreamEventType,
  type WorkspaceRole,
} from '../../types/constants.js';
import type { AiChatMessage } from '../../types/index.js';
import { crmToolDefinitions, executeCrmTool, getCrmGrokToolDeclarations } from '../mcp/toolRegistry.js';
import { createActionTicket } from './actionTickets.js';
import { callGrokChat, isGrokConfigured, type GrokMessage } from './grokClient.js';

export interface RunAgentInput {
  workspaceId: number;
  userId: number;
  userRole?: WorkspaceRole;
  message: string;
  history?: AiChatMessage[];
  onEvent: (event: AiStreamEventType, data: any) => void;
}

const SYSTEM_INSTRUCTION =
  'You are the Scraft CRM AI Assistant powered by Grok. You help sales teams, managers, and admins manage leads, deals, pipelines, activities, emails, and WhatsApp messaging. Always be concise, helpful, and professional. When users ask questions about leads, deals, or metrics, use the available tools to fetch accurate real-time data before answering. Format data with Markdown tables or lists when appropriate.';

async function handleOfflineIntent(input: RunAgentInput): Promise<void> {
  const msg = input.message.toLowerCase();
  input.onEvent(
    AI_EVENT_DELTA,
    { text: 'ℹ️ *Note: `GROK_API_KEY` is not configured in `.env`. Running local MCP tool agent engine.*\n\n' }
  );

  if (
    msg.includes('pipeline') ||
    ((msg.includes('deal') || msg.includes('pipeline')) && (msg.includes('summary') || msg.includes('metric')))
  ) {
    input.onEvent(AI_EVENT_TOOL_START, { tool: MCP_TOOL_GET_PIPELINE_SUMMARY, input: {} });
    try {
      const summary = await executeCrmTool(
        { workspace_id: input.workspaceId, user_id: input.userId },
        MCP_TOOL_GET_PIPELINE_SUMMARY,
        {}
      );
      input.onEvent(AI_EVENT_TOOL_END, { tool: MCP_TOOL_GET_PIPELINE_SUMMARY, result: summary });
      const text =
        `### Pipeline Summary\n` +
        `- **Total Deals**: ${summary.total_deals}\n` +
        `- **Total Value**: $${summary.total_pipeline_value.toLocaleString()}\n` +
        `- **Won Deals**: ${summary.won_deals_count} ($${summary.won_deals_value.toLocaleString()})\n` +
        `- **Win Rate**: ${summary.conversion_rate_percentage}%\n\n` +
        `**Stages Breakdown:**\n` +
        summary.stages.map((s: any) => `- **${s.name}**: ${s.deal_count} deals ($${s.value.toLocaleString()})`).join('\n');
      input.onEvent(AI_EVENT_DELTA, { text });
    } catch (e: any) {
      input.onEvent(AI_EVENT_ERROR, { message: e?.message || 'Failed to get pipeline summary' });
    }
  } else if (msg.includes('deal')) {
    input.onEvent(AI_EVENT_TOOL_START, { tool: MCP_TOOL_SEARCH_DEALS, input: {} });
    try {
      const dealsResult = await executeCrmTool(
        { workspace_id: input.workspaceId, user_id: input.userId },
        MCP_TOOL_SEARCH_DEALS,
        {}
      );
      input.onEvent(AI_EVENT_TOOL_END, { tool: MCP_TOOL_SEARCH_DEALS, result: dealsResult });
      if (!dealsResult.deals || dealsResult.deals.length === 0) {
        input.onEvent(AI_EVENT_DELTA, { text: 'No deals found in this workspace.' });
      } else {
        const text =
          `Found **${dealsResult.total}** deals:\n\n` +
          `| Deal Name | Value | Stage | Priority |\n` +
          `| :--- | :--- | :--- | :--- |\n` +
          dealsResult.deals
            .slice(0, 5)
            .map((d: any) => `| ${d.name} | $${Number(d.value).toLocaleString()} | ${d.stage} | ${d.priority || 'medium'} |`)
            .join('\n');
        input.onEvent(AI_EVENT_DELTA, { text });
      }
    } catch (e: any) {
      input.onEvent(AI_EVENT_ERROR, { message: e?.message || 'Failed to search deals' });
    }
  } else if (msg.includes('lead')) {
    input.onEvent(AI_EVENT_TOOL_START, { tool: MCP_TOOL_SEARCH_LEADS, input: {} });
    try {
      const leadsResult = await executeCrmTool(
        { workspace_id: input.workspaceId, user_id: input.userId },
        MCP_TOOL_SEARCH_LEADS,
        {}
      );
      input.onEvent(AI_EVENT_TOOL_END, { tool: MCP_TOOL_SEARCH_LEADS, result: leadsResult });
      if (!leadsResult.leads || leadsResult.leads.length === 0) {
        input.onEvent(AI_EVENT_DELTA, { text: 'No leads found in this workspace.' });
      } else {
        const text =
          `Found **${leadsResult.total}** leads:\n\n` +
          `| Name | Email | Phone |\n` +
          `| :--- | :--- | :--- |\n` +
          leadsResult.leads.slice(0, 5).map((l: any) => `| ${l.name} | ${l.email || '-'} | ${l.phone || '-'} |`).join('\n');
        input.onEvent(AI_EVENT_DELTA, { text });
      }
    } catch (e: any) {
      input.onEvent(AI_EVENT_ERROR, { message: e?.message || 'Failed to search leads' });
    }
  } else {
    input.onEvent(AI_EVENT_DELTA, {
      text:
        'Hello! I am your Scraft CRM Assistant powered by Grok. You can ask me to:\n' +
        '- **"Show pipeline summary"**\n' +
        '- **"List recent deals"**\n' +
        '- **"Search leads"**\n' +
        '- **"Verify email user@example.com"**\n\n' +
        '*(To enable conversational natural language answers, add GROK_API_KEY to your .env file).*',
    });
  }

  input.onEvent(AI_EVENT_DONE, { status: 'completed' });
}

export async function runAgent(input: RunAgentInput): Promise<void> {
  if (!isGrokConfigured()) {
    await handleOfflineIntent(input);
    return;
  }

  const messages: GrokMessage[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
  ];

  if (Array.isArray(input.history)) {
    for (const h of input.history) {
      if (h.role === 'user') {
        messages.push({ role: 'user', content: h.content });
      } else if (h.role === 'model' || h.role === 'assistant') {
        messages.push({ role: 'assistant', content: h.content });
      }
    }
  }
  messages.push({ role: 'user', content: input.message });

  let maxTurns = 5;
  while (maxTurns > 0) {
    maxTurns--;
    let completion;
    try {
      completion = await callGrokChat({
        messages,
        tools: getCrmGrokToolDeclarations(),
      });
    } catch (apiErr: any) {
      input.onEvent(AI_EVENT_DELTA, {
        text: `⚠️ *Grok API: ${apiErr?.message || 'Unable to connect'}. Executing with CRM engine fallback.*\n\n`,
      });
      await handleOfflineIntent(input);
      return;
    }

    const choice = completion.choices?.[0];
    if (!choice || !choice.message) {
      input.onEvent(AI_EVENT_ERROR, { message: 'No response message returned from Grok model' });
      break;
    }

    const assistantMsg = choice.message;
    if (assistantMsg.content) {
      input.onEvent(AI_EVENT_DELTA, { text: assistantMsg.content });
    }

    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: assistantMsg.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolName = call.function.name;
      let args: any = {};
      try {
        args = typeof call.function.arguments === 'string'
          ? JSON.parse(call.function.arguments || '{}')
          : call.function.arguments || {};
      } catch {
        args = {};
      }

      const toolDef = crmToolDefinitions.find((t) => t.name === toolName);

      if (!toolDef) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
        });
        continue;
      }

      if (toolDef.security_level === MCP_SECURITY_MUTATING_HIGH) {
        const ticket = createActionTicket({
          workspace_id: input.workspaceId,
          user_id: input.userId,
          tool_name: toolDef.name,
          params: args,
          summary: `Execute action ${toolDef.name} with parameters ${JSON.stringify(args)}`,
        });
        input.onEvent(AI_EVENT_ACTION_REQUIRED, {
          ticket,
          tool: toolDef.name,
          params: args,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            status: 'action_required',
            message: 'Action requires user confirmation via confirmation card.',
            ticket_id: ticket.ticket_id,
          }),
        });
      } else {
        input.onEvent(AI_EVENT_TOOL_START, { tool: toolDef.name, input: args });
        try {
          const toolResult = await executeCrmTool(
            { workspace_id: input.workspaceId, user_id: input.userId, user_role: input.userRole },
            toolDef.name,
            args
          );
          input.onEvent(AI_EVENT_TOOL_END, { tool: toolDef.name, result: toolResult });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResult),
          });
        } catch (err: any) {
          input.onEvent(AI_EVENT_TOOL_END, { tool: toolDef.name, error: err?.message });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: err?.message || 'Execution failed' }),
          });
        }
      }
    }
  }

  input.onEvent(AI_EVENT_DONE, { status: 'completed' });
}
