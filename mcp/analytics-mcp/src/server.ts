#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Platform } from '@paperclip/db';
import { topHooksLastNDays } from './queries/topHooksLastNDays.js';
import { topThemesLastNDays } from './queries/topThemesLastNDays.js';
import { topWinnersByPlatform } from './queries/topWinnersByPlatform.js';
import { postsLastNDays } from './queries/postsLastNDays.js';
import { attributionsLastNDays } from './queries/attributionsLastNDays.js';
import { getLastDigest } from './queries/getLastDigest.js';
import { writeDigest } from './tools/writeDigest.js';

const daysSchema = z.object({
  days: z.number().int().min(1).max(365),
  limit: z.number().optional(),
});
const platformDaysSchema = z.object({
  platform: z.enum([Platform.X, Platform.LinkedIn]),
  days: z.number().int().min(1),
  limit: z.number().optional(),
});
const digestKind = z.object({ kind: z.enum(['daily', 'weekly']) });
const writeDigestSchema = z.object({
  kind: z.enum(['daily', 'weekly']),
  contentMd: z.string().min(1),
});

const server = new Server(
  { name: 'analytics-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'topHooksLastNDays',
      description: 'Rank hooks by signups/1k impressions',
      inputSchema: { type: 'object' },
    },
    {
      name: 'topThemesLastNDays',
      description: 'Rank themes by signups/1k impressions',
      inputSchema: { type: 'object' },
    },
    {
      name: 'topWinnersByPlatform',
      description: 'Best posts on a platform',
      inputSchema: { type: 'object' },
    },
    { name: 'postsLastNDays', description: 'List recent posts', inputSchema: { type: 'object' } },
    {
      name: 'attributionsLastNDays',
      description: 'List recent attributions',
      inputSchema: { type: 'object' },
    },
    {
      name: 'getLastDigest',
      description: 'Get the most recent digest of a given kind',
      inputSchema: { type: 'object' },
    },
    {
      name: 'writeDigest',
      description: 'Persist a daily or weekly digest',
      inputSchema: { type: 'object' },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'topHooksLastNDays':
        result = await topHooksLastNDays(daysSchema.parse(args));
        break;
      case 'topThemesLastNDays':
        result = await topThemesLastNDays(daysSchema.parse(args));
        break;
      case 'topWinnersByPlatform':
        result = await topWinnersByPlatform(platformDaysSchema.parse(args));
        break;
      case 'postsLastNDays':
        result = await postsLastNDays(daysSchema.parse(args));
        break;
      case 'attributionsLastNDays':
        result = await attributionsLastNDays(daysSchema.parse(args));
        break;
      case 'getLastDigest':
        result = await getLastDigest(digestKind.parse(args));
        break;
      case 'writeDigest':
        result = await writeDigest(writeDigestSchema.parse(args));
        break;
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `ERROR: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
