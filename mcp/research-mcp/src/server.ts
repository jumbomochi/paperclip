#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { searchHackerNews } from './tools/searchHackerNews.js';
import { searchReddit } from './tools/searchReddit.js';
import { fetchRssFeed } from './tools/fetchRssFeed.js';

const hn = z.object({ query: z.string(), maxAgeSeconds: z.number().optional() });
const reddit = z.object({
  query: z.string(),
  subreddit: z.string().optional(),
  maxAgeSeconds: z.number().optional(),
});
const rss = z.object({
  url: z.string().url(),
  maxAgeSeconds: z.number().optional(),
  max: z.number().optional(),
});

const server = new Server(
  { name: 'research-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'searchHackerNews',
      description: 'Search HN via Algolia',
      inputSchema: { type: 'object' },
    },
    { name: 'searchReddit', description: 'Search Reddit top posts', inputSchema: { type: 'object' } },
    {
      name: 'fetchRssFeed',
      description: 'Fetch and parse an RSS feed',
      inputSchema: { type: 'object' },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    let result: unknown;
    switch (req.params.name) {
      case 'searchHackerNews':
        result = await searchHackerNews(hn.parse(req.params.arguments));
        break;
      case 'searchReddit':
        result = await searchReddit(reddit.parse(req.params.arguments));
        break;
      case 'fetchRssFeed':
        result = await fetchRssFeed(rss.parse(req.params.arguments));
        break;
      default:
        throw new Error(`unknown: ${req.params.name}`);
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
