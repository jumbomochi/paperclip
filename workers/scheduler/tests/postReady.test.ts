import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, drafts, draftTransitions, metricsJobs, DraftStatus, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { postReady } from '../src/postReady.js';

beforeEach(async () => {
  await db.delete(metricsJobs);
  await db.delete(draftTransitions);
  await db.delete(drafts);
});

describe('postReady', () => {
  it('posts approved X drafts and transitions to posted, enqueues 5 metrics jobs', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'ready to fly',
        scheduledFor: new Date(Date.now() - 1000),
      })
      .returning();

    const postFn = vi.fn().mockResolvedValue({ id: '999', url: 'https://x.com/i/web/status/999' });
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });

    expect(postFn).toHaveBeenCalledOnce();
    const [after] = await db.select().from(drafts).where(eq(drafts.id, draft!.id));
    expect(after!.status).toBe(DraftStatus.Posted);
    expect(after!.platformPostId).toBe('999');

    const jobs = await db.select().from(metricsJobs).where(eq(metricsJobs.draftId, draft!.id));
    expect(jobs).toHaveLength(5);
  });

  it('skips drafts not yet due', async () => {
    await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'not yet',
        scheduledFor: new Date(Date.now() + 10 * 60_000),
      });
    const postFn = vi.fn();
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });
    expect(postFn).not.toHaveBeenCalled();
  });

  it('marks post_failed and records reason on error', async () => {
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'will fail',
        scheduledFor: new Date(Date.now() - 1000),
      })
      .returning();
    const postFn = vi.fn().mockRejectedValue(new Error('boom'));
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });
    const [after] = await db.select().from(drafts).where(eq(drafts.id, draft!.id));
    expect(after!.status).toBe(DraftStatus.PostFailed);
  });

  it('routes approved LinkedIn drafts to awaiting_paste (no API write call)', async () => {
    const [d] = await db
      .insert(drafts)
      .values({
        platform: Platform.LinkedIn,
        status: DraftStatus.Approved,
        body: 'hello LI',
        scheduledFor: new Date(Date.now() - 1000),
      })
      .returning();
    const postFn = vi.fn();
    await postReady({ now: new Date(), platforms: [Platform.X, Platform.LinkedIn], postX: postFn });
    expect(postFn).not.toHaveBeenCalled();
    const [after] = await db.select().from(drafts).where(eq(drafts.id, d!.id));
    expect(after!.status).toBe(DraftStatus.AwaitingPaste);
  });

  it('rewrites newsletter links with UTM params before posting', async () => {
    process.env.NEWSLETTER_ORIGIN = 'https://news.example.com';
    const [draft] = await db
      .insert(drafts)
      .values({
        platform: Platform.X,
        status: DraftStatus.Approved,
        body: 'Read it: https://news.example.com',
        hookTag: 'question-opener',
        scheduledFor: new Date(Date.now() - 1000),
      })
      .returning();

    const postFn = vi.fn().mockResolvedValue({ id: '1', url: 'https://x.com/i/web/status/1' });
    await postReady({ now: new Date(), platforms: [Platform.X], postX: postFn });

    expect(postFn).toHaveBeenCalledOnce();
    const passed = postFn.mock.calls[0]![0] as { text: string };
    expect(passed.text).toContain('utm_source=x');
    expect(passed.text).toContain(`utm_campaign=post_${draft!.id}`);
    expect(passed.text).toContain('utm_content=question-opener');
  });
});
