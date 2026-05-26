import { db, drafts, DraftStatus, type Platform } from '@paperclip/db';

export interface CreateDraftInput {
  platform: Platform;
  status?: DraftStatus;
  themeId?: string;
  parentBriefId?: string;
  body?: string;
  hookTag?: string;
  research?: unknown;
  scheduledFor?: Date;
}

export async function createDraft(input: CreateDraftInput) {
  const [row] = await db
    .insert(drafts)
    .values({
      platform: input.platform,
      status: input.status ?? DraftStatus.Briefed,
      themeId: input.themeId,
      parentBriefId: input.parentBriefId,
      body: input.body ?? '',
      hookTag: input.hookTag,
      research: input.research as object | undefined,
      scheduledFor: input.scheduledFor,
    })
    .returning();
  return row!;
}
