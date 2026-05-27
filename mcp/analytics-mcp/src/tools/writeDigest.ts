import { db, digests } from '@paperclip/db';

export async function writeDigest(input: { kind: 'daily' | 'weekly'; contentMd: string }) {
  if (input.kind !== 'daily' && input.kind !== 'weekly') {
    throw new Error(`invalid kind: ${input.kind}`);
  }
  const [row] = await db
    .insert(digests)
    .values({ kind: input.kind, contentMd: input.contentMd })
    .returning();
  return row!;
}
