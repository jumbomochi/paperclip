import { db, drafts, draftTransitions, DraftStatus, type Platform, Platform as P } from '@paperclip/db';
import { and, eq, lte, inArray } from 'drizzle-orm';
import { rewriteLinksWithUtm } from '@paperclip/drafts-mcp';
import { enqueueSnapshots } from './enqueueSnapshots.js';

export interface PostReadyDeps {
  now: Date;
  platforms: Platform[];
  postX: (input: { account: string; text: string }) => Promise<{ id: string; url: string }>;
}

const ACCOUNT = 'newsletter_main';

export async function postReady(deps: PostReadyDeps): Promise<void> {
  const due = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.status, DraftStatus.Approved),
        inArray(drafts.platform, deps.platforms),
        lte(drafts.scheduledFor, deps.now),
      ),
    );

  for (const d of due) {
    if (d.platform === P.LinkedIn) {
      await db.transaction(async (tx) => {
        await tx
          .update(drafts)
          .set({ status: DraftStatus.AwaitingPaste, updatedAt: new Date() })
          .where(eq(drafts.id, d.id));
        await tx.insert(draftTransitions).values({
          draftId: d.id,
          fromStatus: DraftStatus.Approved,
          toStatus: DraftStatus.AwaitingPaste,
          actor: 'scheduler',
        });
      });
      continue;
    }
    if (d.platform !== P.X) continue;
    try {
      const newsletterOrigin = process.env.NEWSLETTER_ORIGIN;
      const text = newsletterOrigin
        ? rewriteLinksWithUtm({
            text: d.body,
            newsletterOrigin,
            utm: {
              source: 'x',
              medium: 'social',
              campaign: `post_${d.id}`,
              content: d.hookTag ?? undefined,
            },
          })
        : d.body;
      const out = await deps.postX({ account: ACCOUNT, text });
      await db.transaction(async (tx) => {
        await tx
          .update(drafts)
          .set({
            status: DraftStatus.Posted,
            platformPostId: out.id,
            platformPostUrl: out.url,
            postedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(drafts.id, d.id));
        await tx.insert(draftTransitions).values({
          draftId: d.id,
          fromStatus: DraftStatus.Approved,
          toStatus: DraftStatus.Posted,
          actor: 'scheduler',
        });
      });
      await enqueueSnapshots(d.id, new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.transaction(async (tx) => {
        await tx
          .update(drafts)
          .set({ status: DraftStatus.PostFailed, updatedAt: new Date() })
          .where(eq(drafts.id, d.id));
        await tx.insert(draftTransitions).values({
          draftId: d.id,
          fromStatus: DraftStatus.Approved,
          toStatus: DraftStatus.PostFailed,
          actor: 'scheduler',
          reason: message,
        });
      });
    }
  }
}
