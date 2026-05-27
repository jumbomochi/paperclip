import { updateDraft, transitionStatus } from '@paperclip/drafts-mcp';
import { DraftStatus } from '@paperclip/db';

const cannedResearch = {
  trends: ['async-first newsletters', 'agentic dev workflows'],
  topPosts: [
    { platform: 'x', text: 'Threads with one strong stat outperform 3:1.' },
    { platform: 'x', text: 'Question openers double reply rate.' },
  ],
  audienceNotes: 'Founders and indie devs reading at 7-9am ET.',
};

export async function research(draftId: string) {
  await updateDraft({ id: draftId, research: cannedResearch });
  return transitionStatus({ draftId, to: DraftStatus.Researched, actor: 'stub:researcher' });
}
