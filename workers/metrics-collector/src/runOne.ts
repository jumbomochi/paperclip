import { db, drafts, metricsJobs, postMetricsSnapshots, Platform } from '@paperclip/db';
import { eq } from 'drizzle-orm';

export interface ReadXFn {
  (input: { tweetId: string }): Promise<{ impressions: number; engagement: number; raw: unknown }>;
}

export async function runOne(deps: { jobId: string; readX: ReadXFn }): Promise<void> {
  const [job] = await db
    .update(metricsJobs)
    .set({ status: 'running' })
    .where(eq(metricsJobs.id, deps.jobId))
    .returning();
  if (!job) return;

  const [draft] = await db.select().from(drafts).where(eq(drafts.id, job.draftId));
  if (!draft || !draft.platformPostId) {
    await db
      .update(metricsJobs)
      .set({ status: 'failed', lastError: 'draft not posted', attempts: job.attempts + 1 })
      .where(eq(metricsJobs.id, deps.jobId));
    return;
  }

  try {
    if (draft.platform !== Platform.X) {
      throw new Error(`unsupported platform: ${draft.platform}`);
    }
    const m = await deps.readX({ tweetId: draft.platformPostId });
    await db.insert(postMetricsSnapshots).values({
      draftId: draft.id,
      impressions: m.impressions,
      engagement: m.engagement,
      raw: m.raw as object,
    });
    await db
      .update(metricsJobs)
      .set({ status: 'done', attempts: job.attempts + 1 })
      .where(eq(metricsJobs.id, deps.jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(metricsJobs)
      .set({ status: 'failed', lastError: message, attempts: job.attempts + 1 })
      .where(eq(metricsJobs.id, deps.jobId));
  }
}
