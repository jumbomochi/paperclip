import { db, drafts } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export interface UpdateDraftInput {
  id: string;
  body?: string;
  hookTag?: string;
  research?: unknown;
  editorNotes?: unknown;
  scheduledFor?: Date | null;
  platformPostId?: string;
  platformPostUrl?: string;
  postedAt?: Date;
}

export async function updateDraft(input: UpdateDraftInput) {
  if ('status' in input) {
    throw new Error('use transitionStatus to change status');
  }
  const { id, ...rest } = input;
  const [row] = await db
    .update(drafts)
    .set({
      ...(rest.body !== undefined && { body: rest.body }),
      ...(rest.hookTag !== undefined && { hookTag: rest.hookTag }),
      ...(rest.research !== undefined && { research: rest.research as object }),
      ...(rest.editorNotes !== undefined && { editorNotes: rest.editorNotes as object }),
      ...(rest.scheduledFor !== undefined && { scheduledFor: rest.scheduledFor }),
      ...(rest.platformPostId !== undefined && { platformPostId: rest.platformPostId }),
      ...(rest.platformPostUrl !== undefined && { platformPostUrl: rest.platformPostUrl }),
      ...(rest.postedAt !== undefined && { postedAt: rest.postedAt }),
      updatedAt: new Date(),
    })
    .where(eq(drafts.id, id))
    .returning();
  if (!row) throw new Error(`draft not found: ${id}`);
  return row;
}
