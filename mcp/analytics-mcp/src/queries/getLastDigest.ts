import { db, digests } from '@paperclip/db';
import { eq, desc } from 'drizzle-orm';

export async function getLastDigest(input: { kind: 'daily' | 'weekly' }) {
  const [row] = await db
    .select()
    .from(digests)
    .where(eq(digests.kind, input.kind))
    .orderBy(desc(digests.createdAt))
    .limit(1);
  return row ?? null;
}
