import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, drafts, metricsJobs, postMetricsSnapshots, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { runOne } from '../src/runOne.js';

beforeEach(async () => {
  await db.delete(postMetricsSnapshots);
  await db.delete(metricsJobs);
  await db.delete(drafts);
});

describe('runOne', () => {
  it('reads metrics for a posted draft and writes a snapshot', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Posted,
        body: 'b',
        platformPostId: '999',
      })
      .returning();
    const [job] = await db
      .insert(metricsJobs)
      .values({ draftId: draft!.id, runAt: new Date() })
      .returning();

    const readFn = vi.fn().mockResolvedValue({
      tweetId: '999',
      impressions: 100,
      engagement: 9,
      raw: { hi: 'mock' },
    });

    await runOne({ jobId: job!.id, readX: readFn });

    const snaps = await db.select().from(postMetricsSnapshots).where(eq(postMetricsSnapshots.draftId, draft!.id));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.impressions).toBe(100);
    expect(snaps[0]!.engagement).toBe(9);

    const [updatedJob] = await db.select().from(metricsJobs).where(eq(metricsJobs.id, job!.id));
    expect(updatedJob!.status).toBe('done');
  });

  it('marks job failed on read error', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b', platformPostId: '1' })
      .returning();
    const [job] = await db
      .insert(metricsJobs)
      .values({ draftId: draft!.id, runAt: new Date() })
      .returning();

    await runOne({ jobId: job!.id, readX: vi.fn().mockRejectedValue(new Error('429')) });

    const [updatedJob] = await db.select().from(metricsJobs).where(eq(metricsJobs.id, job!.id));
    expect(updatedJob!.status).toBe('failed');
    expect(updatedJob!.lastError).toMatch(/429/);
  });
});
