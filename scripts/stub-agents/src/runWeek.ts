#!/usr/bin/env node
import { createDraft, transitionStatus, listByStatus } from '@paperclip/drafts-mcp';
import { DraftStatus, Platform } from '@paperclip/db';
import { research } from './researcher.js';
import { draft as writeVariants, moveToEditorReview } from './copywriter.js';
import { review } from './editor.js';
import { makeLogger } from '@paperclip/shared';

const log = makeLogger('stub:runWeek');

async function main() {
  const briefX = await createDraft({
    platform: Platform.X,
    status: DraftStatus.Briefed,
    body: 'Theme: building in public the AI marketing agency',
  });
  const briefLi = await createDraft({
    platform: Platform.LinkedIn,
    status: DraftStatus.Briefed,
    body: 'Theme: building in public the AI marketing agency',
  });
  log.info({ briefXId: briefX.id, briefLiId: briefLi.id }, 'briefs created');

  await research(briefX.id);
  await research(briefLi.id);

  await transitionStatus({ draftId: briefX.id, to: DraftStatus.Drafted, actor: 'stub:strategist' });
  await transitionStatus({ draftId: briefLi.id, to: DraftStatus.Drafted, actor: 'stub:strategist' });

  const xVariants = await writeVariants({ briefId: briefX.id, platform: Platform.X });
  const liVariants = await writeVariants({ briefId: briefLi.id, platform: Platform.LinkedIn });
  log.info({ x: xVariants.length, li: liVariants.length }, 'variants created');

  for (const id of [...xVariants, ...liVariants]) {
    await moveToEditorReview(id);
    await review(id);
  }

  const queue = await listByStatus({ status: DraftStatus.ApprovalQueue });
  log.info({ queueDepth: queue.length }, 'done — visit /queue to approve');
}

main().catch((err: Error) => {
  log.error({ err }, 'runWeek failed');
  process.exit(1);
});
