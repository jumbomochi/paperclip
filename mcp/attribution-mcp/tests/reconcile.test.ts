import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, drafts, attributions, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { reconcile } from '../src/handlers/reconcile.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(drafts);
});

describe('reconcile', () => {
  it('writes attributions for signups missed by the webhook', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();

    const fakeClient = {
      listRecentSignups: vi.fn().mockResolvedValue([
        { subscriberId: 's1', signedUpAt: new Date(), utm: { campaign: `post_${d!.id}` } },
        { subscriberId: 's2', signedUpAt: new Date(), utm: { campaign: `post_${d!.id}` } },
        { subscriberId: 's3', signedUpAt: new Date(), utm: {} },
      ]),
    };

    const summary = await reconcile({ client: fakeClient, since: new Date(0) });
    expect(summary.attributed).toBe(2);
    expect(summary.ignored).toBe(1);

    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(2);
  });

  it('does not double-write signups already attributed', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();
    await db.insert(attributions).values({
      draftId: d!.id,
      subscriberId: 's1',
      signedUpAt: new Date(),
      utmPayload: { campaign: `post_${d!.id}` },
    });

    const fakeClient = {
      listRecentSignups: vi.fn().mockResolvedValue([
        { subscriberId: 's1', signedUpAt: new Date(), utm: { campaign: `post_${d!.id}` } },
      ]),
    };
    const summary = await reconcile({ client: fakeClient, since: new Date(0) });
    expect(summary.attributed).toBe(1);
    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(1);
  });
});
