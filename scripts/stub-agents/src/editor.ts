import { transitionStatus, getDraft } from '@paperclip/drafts-mcp';
import { DraftStatus } from '@paperclip/db';

export async function review(draftId: string) {
  const d = await getDraft({ id: draftId });
  if (!d) throw new Error('not found');
  if (!d.body.trim()) {
    return transitionStatus({
      draftId,
      to: DraftStatus.ReworkRequested,
      actor: 'stub:editor',
      reason: 'empty body',
    });
  }
  return transitionStatus({
    draftId,
    to: DraftStatus.ApprovalQueue,
    actor: 'stub:editor',
    reason: 'looks good',
  });
}
