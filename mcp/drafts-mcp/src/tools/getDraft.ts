import { db, drafts } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export async function getDraft(input: { id: string }) {
  const [row] = await db.select().from(drafts).where(eq(drafts.id, input.id));
  return row ?? null;
}
