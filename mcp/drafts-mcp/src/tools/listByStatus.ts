import { db, drafts, type DraftStatus, type Platform } from '@paperclip/db';
import { and, eq, desc } from 'drizzle-orm';

export async function listByStatus(input: { status: DraftStatus; platform?: Platform; limit?: number }) {
  const where = input.platform
    ? and(eq(drafts.status, input.status), eq(drafts.platform, input.platform))
    : eq(drafts.status, input.status);
  return db.select().from(drafts).where(where).orderBy(desc(drafts.updatedAt)).limit(input.limit ?? 100);
}
