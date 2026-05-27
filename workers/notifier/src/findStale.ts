import { db, drafts, DraftStatus } from '@paperclip/db';
import { and, eq, lt } from 'drizzle-orm';

export async function findStaleAwaitingPaste(input: { thresholdMinutes: number }) {
  const cutoff = new Date(Date.now() - input.thresholdMinutes * 60_000);
  return db
    .select()
    .from(drafts)
    .where(and(eq(drafts.status, DraftStatus.AwaitingPaste), lt(drafts.updatedAt, cutoff)));
}
