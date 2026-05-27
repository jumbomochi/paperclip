#!/usr/bin/env tsx
import { createDraft } from '@paperclip/drafts-mcp';
import { DraftStatus, Platform } from '@paperclip/db';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('promote-brief');
const theme = process.argv[2];
if (!theme) {
  console.error('usage: tsx scripts/promote-brief.ts "<one-line theme>"');
  process.exit(1);
}

const brief = await createDraft({
  platform: Platform.X,
  status: DraftStatus.Briefed,
  body: theme,
});
log.info(
  { briefId: brief.id },
  'brief created — strategist ticket will be opened by paperclip on next heartbeat',
);
