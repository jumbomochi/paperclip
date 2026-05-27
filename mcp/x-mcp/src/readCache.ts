import { db, xReadCache } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export async function cached<T>(
  key: string,
  maxAgeSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const [row] = await db.select().from(xReadCache).where(eq(xReadCache.cacheKey, key));
  if (row && Date.now() - row.fetchedAt.getTime() < maxAgeSeconds * 1000) {
    return row.body as T;
  }
  const fresh = await fetcher();
  await db
    .insert(xReadCache)
    .values({ cacheKey: key, body: fresh as object, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: xReadCache.cacheKey,
      set: { body: fresh as object, fetchedAt: new Date() },
    });
  return fresh;
}
