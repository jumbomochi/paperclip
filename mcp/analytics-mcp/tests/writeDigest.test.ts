import { describe, it, expect, beforeEach } from 'vitest';
import { db, digests } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { writeDigest } from '../src/tools/writeDigest.js';

beforeEach(async () => {
  await db.delete(digests);
});

describe('writeDigest', () => {
  it('inserts a digest row', async () => {
    const r = await writeDigest({ kind: 'daily', contentMd: '# yesterday\n- top performer X' });
    expect(r.id).toBeDefined();
    const rows = await db.select().from(digests).where(eq(digests.id, r.id));
    expect(rows[0]!.contentMd).toContain('yesterday');
  });

  it('rejects unknown kind', async () => {
    // @ts-expect-error intentionally bad
    await expect(writeDigest({ kind: 'monthly', contentMd: 'x' })).rejects.toThrow(/kind/i);
  });
});
