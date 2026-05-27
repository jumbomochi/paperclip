import { db, researchCache } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const [row] = await db.select().from(researchCache).where(eq(researchCache.cacheKey, key));
  if (row && Date.now() - row.fetchedAt.getTime() < ttlSeconds * 1000) return row.body as T;
  const fresh = await fetcher();
  await db
    .insert(researchCache)
    .values({ cacheKey: key, body: fresh as object, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: researchCache.cacheKey,
      set: { body: fresh as object, fetchedAt: new Date() },
    });
  return fresh;
}
