#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadToken } from '@paperclip/shared';
import { postTweet } from './tools/postTweet.js';
import { postThread } from './tools/postThread.js';
import { readTweetMetrics } from './tools/readTweetMetrics.js';
import { searchTopPosts } from './tools/searchTopPosts.js';
import type { XCreds } from './client.js';

async function credsFor(account: string): Promise<XCreds> {
  const t = await loadToken<XCreds>({ account, platform: 'x' });
  if (!t) throw new Error(`no X creds for account=${account}`);
  return t;
}

const postTweetSchema = z.object({ account: z.string(), text: z.string() });
const postThreadSchema = z.object({ account: z.string(), tweets: z.array(z.string()).min(1) });
const readMetricsSchema = z.object({
  account: z.string(),
  tweetId: z.string(),
  maxAgeSeconds: z.number().optional(),
});
const searchSchema = z.object({
  account: z.string(),
  query: z.string(),
  maxAgeSeconds: z.number().optional(),
});

const server = new Server({ name: 'x-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'postTweet', description: 'Post a single tweet', inputSchema: { type: 'object' } },
    {
      name: 'postThread',
      description: 'Post a thread (replies chained)',
      inputSchema: { type: 'object' },
    },
    {
      name: 'readTweetMetrics',
      description: 'Fetch public_metrics for a tweet (cached)',
      inputSchema: { type: 'object' },
    },
    {
      name: 'searchTopPosts',
      description: 'Search relevant top posts (cached)',
      inputSchema: { type: 'object' },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'postTweet': {
        const v = postTweetSchema.parse(args);
        result = await postTweet({ ...v, creds: await credsFor(v.account) });
        break;
      }
      case 'postThread': {
        const v = postThreadSchema.parse(args);
        result = await postThread({ ...v, creds: await credsFor(v.account) });
        break;
      }
      case 'readTweetMetrics': {
        const v = readMetricsSchema.parse(args);
        result = await readTweetMetrics({ ...v, creds: await credsFor(v.account) });
        break;
      }
      case 'searchTopPosts': {
        const v = searchSchema.parse(args);
        result = await searchTopPosts({ ...v, creds: await credsFor(v.account) });
        break;
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `ERROR: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
