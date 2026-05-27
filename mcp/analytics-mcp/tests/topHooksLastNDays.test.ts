import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, postMetricsSnapshots, attributions, DraftStatus, Platform } from '@paperclip/db';
import { topHooksLastNDays } from '../src/queries/topHooksLastNDays.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(postMetricsSnapshots);
  await db.delete(drafts);
});

describe('topHooksLastNDays', () => {
  it('ranks hooks by signups per 1k impressions', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000);
    const [a, b] = await db
      .insert(drafts)
      .values([
        {
          platform: Platform.X,
          status: DraftStatus.Posted,
          body: 'a',
          hookTag: 'question-opener',
          postedAt: fiveDaysAgo,
        },
        {
          platform: Platform.X,
          status: DraftStatus.Posted,
          body: 'b',
          hookTag: 'bold-claim',
          postedAt: fiveDaysAgo,
        },
      ])
      .returning();
    await db.insert(postMetricsSnapshots).values([
      { draftId: a!.id, impressions: 1000, engagement: 50 },
      { draftId: b!.id, impressions: 10000, engagement: 200 },
    ]);
    await db.insert(attributions).values([
      { draftId: a!.id, subscriberId: 's1', signedUpAt: fiveDaysAgo, utmPayload: {} },
      { draftId: a!.id, subscriberId: 's2', signedUpAt: fiveDaysAgo, utmPayload: {} },
      { draftId: b!.id, subscriberId: 's3', signedUpAt: fiveDaysAgo, utmPayload: {} },
    ]);

    const r = await topHooksLastNDays({ days: 7, limit: 10 });
    expect(r[0]!.hookTag).toBe('question-opener');
    expect(r[0]!.signupsPer1kImpressions).toBeCloseTo(2.0, 1);
    expect(r[1]!.hookTag).toBe('bold-claim');
  });

  it('excludes posts older than N days', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400_000);
    const [a] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Posted,
        body: 'old',
        hookTag: 'question-opener',
        postedAt: eightDaysAgo,
      })
      .returning();
    await db.insert(postMetricsSnapshots).values({
      draftId: a!.id,
      impressions: 1000,
      engagement: 50,
    });
    const r = await topHooksLastNDays({ days: 7, limit: 10 });
    expect(r).toHaveLength(0);
  });
});
