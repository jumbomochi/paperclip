import { db, attributions } from '@paperclip/db';
import { gte, desc } from 'drizzle-orm';

export async function attributionsLastNDays(input: { days: number }) {
  const cutoff = new Date(Date.now() - input.days * 86400_000);
  return db
    .select()
    .from(attributions)
    .where(gte(attributions.signedUpAt, cutoff))
    .orderBy(desc(attributions.signedUpAt));
}
