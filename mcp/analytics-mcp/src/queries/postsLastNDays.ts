import { db, drafts } from '@paperclip/db';
import { and, gte, isNotNull, desc } from 'drizzle-orm';

export async function postsLastNDays(input: { days: number }) {
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  return db
    .select()
    .from(drafts)
    .where(and(isNotNull(drafts.postedAt), gte(drafts.postedAt, cutoff)))
    .orderBy(desc(drafts.postedAt));
}
