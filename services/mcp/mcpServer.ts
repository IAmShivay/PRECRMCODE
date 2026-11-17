import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../../types/constants.js';
import { executeCrmTool, getCrmMcpToolDefinitions } from './toolRegistry.js';

export function createCrmMcpServer(workspaceId: number, userId: number): Server {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getCrmMcpToolDefinitions(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await executeCrmTool(
        { workspace_id: workspaceId, user_id: userId },
        name,
        args
      );
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error?.message || 'Tool execution failed',
          },
        ],
      };
    }
  });

  return server;
}
