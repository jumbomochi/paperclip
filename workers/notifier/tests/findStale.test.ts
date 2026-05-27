import { describe, it, expect, beforeEach } from 'vitest';
import { db, drafts, DraftStatus, Platform } from '@paperclip/db';
import { findStaleAwaitingPaste } from '../src/findStale.js';

beforeEach(async () => {
  await db.delete(drafts);
});

describe('findStaleAwaitingPaste', () => {
  it('returns drafts older than threshold', async () => {
    const old = new Date(Date.now() - 90 * 60_000);
    const fresh = new Date(Date.now() - 5 * 60_000);

    await db.insert(drafts).values([
      { platform: Platform.LinkedIn, status: DraftStatus.AwaitingPaste, body: 'old', updatedAt: old },
      { platform: Platform.LinkedIn, status: DraftStatus.AwaitingPaste, body: 'fresh', updatedAt: fresh },
      { platform: Platform.LinkedIn, status: DraftStatus.Posted, body: 'done', updatedAt: old },
    ]);

    const stale = await findStaleAwaitingPaste({ thresholdMinutes: 60 });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.body).toBe('old');
  });
});
