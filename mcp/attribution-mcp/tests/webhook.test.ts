import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, attributions, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { handleSignupEvent } from '../src/handlers/webhook.js';

beforeEach(async () => {
  await db.delete(attributions);
  await db.delete(drafts);
});

describe('handleSignupEvent', () => {
  it('records attribution when referrer points to a known post', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();
    const res = await handleSignupEvent({
      subscriberId: 'sub_1',
      signedUpAt: new Date(),
      utm: {
        source: 'x',
        medium: 'social',
        campaign: `post_${d!.id}`,
        content: 'question-opener',
      },
    });
    expect(res).toEqual({ attributed: true, draftId: d!.id });

    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subscriberId).toBe('sub_1');
  });

  it('ignores events without utm campaign', async () => {
    const res = await handleSignupEvent({ subscriberId: 'sub_2', signedUpAt: new Date(), utm: {} });
    expect(res).toEqual({ attributed: false, reason: 'no_campaign' });
  });

  it('ignores events whose draft id does not exist', async () => {
    const res = await handleSignupEvent({
      subscriberId: 'sub_3',
      signedUpAt: new Date(),
      utm: { campaign: 'post_00000000-0000-0000-0000-000000000000' },
    });
    expect(res).toEqual({ attributed: false, reason: 'draft_not_found' });
  });

  it('is idempotent on duplicate (draft_id, subscriber_id)', async () => {
    const [d] = await db
      .insert(drafts)
      .values({ platform: Platform.X, status: DraftStatus.Posted, body: 'b' })
      .returning();
    const ev = {
      subscriberId: 'sub_dup',
      signedUpAt: new Date(),
      utm: { campaign: `post_${d!.id}` },
    };
    await handleSignupEvent(ev);
    await handleSignupEvent(ev);
    const rows = await db.select().from(attributions).where(eq(attributions.draftId, d!.id));
    expect(rows).toHaveLength(1);
  });
});
