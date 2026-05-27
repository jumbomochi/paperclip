#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadToken } from '@paperclip/shared';
import { searchTopPosts } from './tools/searchTopPosts.js';

const schema = z.object({ account: z.string(), query: z.string() });
const server = new Server(
  { name: 'linkedin-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'searchTopPosts',
      description: 'Search top LinkedIn posts (read-only, may return empty)',
      inputSchema: { type: 'object' },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'searchTopPosts') {
    return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true };
  }
  const v = schema.parse(req.params.arguments);
  const token = await loadToken<{ accessToken: string }>({
    account: v.account,
    platform: 'linkedin',
  });
  if (!token) return { content: [{ type: 'text', text: 'no linkedin token' }], isError: true };
  const out = await searchTopPosts({ query: v.query, accessToken: token.accessToken });
  return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
