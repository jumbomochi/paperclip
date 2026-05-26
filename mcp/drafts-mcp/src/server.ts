#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createDraft } from './tools/createDraft.js';
import { updateDraft } from './tools/updateDraft.js';
import { getDraft } from './tools/getDraft.js';
import { listByStatus } from './tools/listByStatus.js';
import { transitionStatus } from './tools/transitionStatus.js';
import { type DraftStatus, Platform } from '@paperclip/db';

const createDraftSchema = z.object({
  platform: z.enum([Platform.X, Platform.LinkedIn]),
  status: z.string().optional(),
  themeId: z.string().uuid().optional(),
  parentBriefId: z.string().uuid().optional(),
  body: z.string().optional(),
  hookTag: z.string().optional(),
});

const updateDraftSchema = z.object({
  id: z.string().uuid(),
  body: z.string().optional(),
  hookTag: z.string().optional(),
  editorNotes: z.unknown().optional(),
  scheduledFor: z.string().datetime().optional(),
});

const transitionSchema = z.object({
  draftId: z.string().uuid(),
  to: z.string(),
  actor: z.string(),
  reason: z.string().optional(),
});

const listSchema = z.object({
  status: z.string(),
  platform: z.enum([Platform.X, Platform.LinkedIn]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const getSchema = z.object({ id: z.string().uuid() });

const tools = [
  { name: 'createDraft', description: 'Create a new draft row' },
  { name: 'updateDraft', description: 'Update non-status fields' },
  { name: 'transitionStatus', description: 'Transition a draft status (records audit row)' },
  { name: 'listByStatus', description: 'List drafts by status (and optional platform)' },
  { name: 'getDraft', description: 'Get one draft by id' },
] as const;

const server = new Server(
  { name: 'drafts-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'createDraft': {
        const v = createDraftSchema.parse(args);
        result = await createDraft({ ...v, status: v.status as DraftStatus | undefined });
        break;
      }
      case 'updateDraft': {
        const v = updateDraftSchema.parse(args);
        result = await updateDraft({
          ...v,
          scheduledFor: v.scheduledFor ? new Date(v.scheduledFor) : undefined,
        });
        break;
      }
      case 'transitionStatus': {
        const v = transitionSchema.parse(args);
        result = await transitionStatus({ ...v, to: v.to as DraftStatus });
        break;
      }
      case 'listByStatus': {
        const v = listSchema.parse(args);
        result = await listByStatus({ ...v, status: v.status as DraftStatus });
        break;
      }
      case 'getDraft': {
        const v = getSchema.parse(args);
        result = await getDraft(v);
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
